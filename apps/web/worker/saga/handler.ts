import { chairItemDone, chairItems } from "../cockpit/chairTasks.js";
import { askInput, askSagaMarkdown, DAILY_QUESTIONS, questionsToday } from "../cockpit/ask.js";
import { boardMembers } from "../cockpit/data.js";
import { answerLoginRequest, isLoginRequest } from "../cockpit/personalLogin.js";
import { postsToBoard, requireDb, SAGA_NAME, type SagaDeps, type SagaEnv } from "./env.js";
import {
  answerOwnerPrivately, approveMinutes, draftOverview, approvePost, draftBoardReply, draftWeeklySummary, queueTelegramRecording,
  processNextMinutes, reviseMinutes, revisePost, watchMail, type RelayedMail
} from "./saga.js";
import { recordMailWatch, sagaConnections } from "./connections.js";
import { minutesDocUrl } from "./drive.js";
import { claimJob, latestOverview, markOwnerDone, ownerDone, setServiceStatus, latestWeeklySummary, minutesByApprovalMessage, pendingForOwner, postDraftByApprovalMessage, recentBoardMessages, recentMail, recentMinutes, saveBoardMessage } from "./store.js";
import { section } from "./markdown.js";
import { groupActivity, itemKey, telegramLink, type BoardPicture } from "./picture.js";
import { telegramClient } from "./telegram.js";

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
type TgFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string; caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>; reply_to_message?: { message_id: number; from?: TgUser };
  voice?: TgFile; audio?: TgFile; video?: TgFile; document?: TgFile };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; data?: string } };

const POST_LABELS: Record<string, string> = { reply: "Svar i bestyrelseschatten", weekly_summary: "Ugeopsummering", announcement: "Opslag i bestyrelseschatten" };
/** The stored picture without what the chair already marked as done. */
function picture(data: string | null, done: Set<string>): BoardPicture | null {
  if (!data) return null;
  try { const parsed = JSON.parse(data) as BoardPicture; return { ...parsed, forJacob: (parsed.forJacob ?? []).filter(f => !done.has(f.key)) }; }
  catch { return null; }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** Constant-time comparison of two secrets. */
function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const name = (user?: TgUser) => [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "Ukendt";

/** Whether a board message is addressed to Saga: @mention of her username, her name, or a reply to her. */
export function addressesSaga(message: TgMessage, username?: string): boolean {
  const text = message.text ?? message.caption ?? "";
  if (message.reply_to_message?.from?.is_bot && (!username || message.reply_to_message.from.username === username)) return true;
  if (username && text.toLowerCase().includes(`@${username.toLowerCase()}`)) return true;
  return new RegExp(`(^|[^\\p{L}])${SAGA_NAME}([^\\p{L}]|$)`, "iu").test(text) && /\?/.test(text);
}

async function handleUpdate(env: SagaEnv, deps: SagaDeps, update: TgUpdate): Promise<void> {
  const ownerId = env.SAGA_OWNER_TELEGRAM_ID, boardId = env.SAGA_BOARD_CHAT_ID;
  const telegram = telegramClient(env, deps);

  const callback = update.callback_query;
  if (callback) {
    if (String(callback.from.id) !== ownerId) { await telegram.answerCallbackQuery(callback.id, "Kun formanden kan godkende."); return; }
    const match = /^(approve|reject):(post|minutes):(\d+)$/.exec(callback.data ?? "");
    if (!match) { await telegram.answerCallbackQuery(callback.id); return; }
    const approve = match[1] === "approve", id = Number(match[3]);
    const result = match[2] === "post" ? await approvePost(env, deps, id, approve) : await approveMinutes(env, deps, id, approve);
    await telegram.answerCallbackQuery(callback.id, result);
    await telegram.sendMessage(String(ownerId), result);
    return;
  }

  const message = update.message;
  if (!message) return;
  const chatId = String(message.chat.id);
  // For the connection check: a group Saga hears but is not set up for (a wrong board id).
  if (env.DB && boardId && chatId !== boardId && /group/.test(message.chat.type)) await setServiceStatus(env.DB, "telegram_other_group", false, chatId, deps.now());

  // The board chat: every text is kept for Saga's overview; a question to her is answered via Jacob's approval.
  if (boardId && chatId === boardId) {
    const text = (message.text ?? message.caption ?? "").trim();
    if (!text || message.from?.is_bot) return;
    const db = requireDb(env);
    await saveBoardMessage(db, { chatId, messageId: message.message_id, author: name(message.from), authorId: message.from ? String(message.from.id) : null, text, sentAtMs: message.date * 1000 });
    // Listening only (the default), a question to her is just part of the chat she reads.
    if (postsToBoard(env) && addressesSaga(message, env.SAGA_TELEGRAM_BOT_USERNAME)) await draftBoardReply(env, deps, text, name(message.from), message.message_id);
    return;
  }

  // Any board member may ask Saga privately for their personal cockpit login (cockpit/personalLogin.ts).
  if (message.chat.type === "private" && message.from && !message.from.is_bot && isLoginRequest(message.text ?? "")) {
    await answerLoginRequest(env, deps, requireDb(env), chatId, String(message.from.id));
    return;
  }

  // Private chat with Jacob; anyone else is ignored.
  if (message.chat.type !== "private" || !message.from || String(message.from.id) !== ownerId) return;
  const file = message.voice ?? message.audio ?? message.video ?? (message.document && /^(audio|video)\//.test(message.document.mime_type ?? "") ? message.document : undefined);
  if (file) {
    const reply = await queueTelegramRecording(env, deps, { fileId: file.file_id, fileName: file.file_name ?? `optagelse-${message.date}`, mimeType: file.mime_type ?? null, size: file.file_size ?? 0 });
    await telegram.sendMessage(chatId, reply);
    if (/^Modtaget/.test(reply)) await processNextMinutes(env, deps);
    return;
  }
  const text = (message.text ?? "").trim();
  if (!text) return;
  const repliedTo = message.reply_to_message?.message_id;
  if (repliedTo) {
    const db = requireDb(env);
    const minutes = await minutesByApprovalMessage(db, repliedTo);
    if (minutes) { await reviseMinutes(env, deps, minutes.id, text); return; }
    const post = await postDraftByApprovalMessage(db, repliedTo);
    if (post) { await revisePost(env, deps, post.id, text); return; }
  }
  if (/^\/(start|hjælp|help)\b/i.test(text)) {
    await telegram.sendMessage(chatId, `Hej, jeg er ${SAGA_NAME}. Send mig en lydoptagelse af et bestyrelsesmøde, så laver jeg et referat til din godkendelse. `
      + (postsToBoard(env) ? "Skriv /opsummering for en ugeopsummering til bestyrelsen" : "Jeg læser med i bestyrelsens gruppe uden at skrive der. Skriv /opsummering for en opsummering af ugen")
      + ", eller spørg mig om noget fra bestyrelsens chat og referater.");
    return;
  }
  if (/^\/opsummering\b/i.test(text)) {
    if (!(await draftWeeklySummary(env, deps))) await telegram.sendMessage(chatId, "Der er ikke skrevet noget i bestyrelsens chat den seneste uge.");
    return;
  }
  await answerOwnerPrivately(env, deps, text);
}

/** /api/saga/telegram (Telegram webhook) and /api/saga/liva/overview (Liva's read access). */
export async function handleSagaRequest(request: Request, env: SagaEnv, deps: SagaDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/saga/telegram" && request.method === "POST") {
    if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), env.SAGA_TELEGRAM_WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
    const update = await request.json().catch(() => null) as TgUpdate | null;
    if (!update) return json({ error: "invalid_update" }, 400);
    // Telegram retries anything but a quick 200, so slow work (transcription, AI) continues after the reply.
    const work = handleUpdate(env, deps, update).catch(error => console.warn("saga_update_failed", error instanceof Error ? error.message : error));
    if (deps.waitUntil) deps.waitUntil(work); else await work;
    return json({ ok: true });
  }
  if (url.pathname.startsWith("/api/saga/liva/")) {
    // Matrix (Liva and the chair's Hjerterum page) - one bearer secret, never the Telegram one.
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!sameSecret(bearer, env.SAGA_LIVA_SECRET)) return json({ error: "unauthorized" }, 401);
    if (!env.SAGA_BOARD_CHAT_ID) return json({ error: "board_not_configured" }, 503);
    const db = requireDb(env);
    if (url.pathname === "/api/saga/liva/overview" && request.method === "GET") {
      const days = Math.min(Math.max(Number(url.searchParams.get("days") || 7), 1), 60);
      const [messages, minutes, pending, weekly, mail, overview, connections, fortnight, done] = await Promise.all([recentBoardMessages(db, env.SAGA_BOARD_CHAT_ID, deps.now() - days * 86_400_000, 200),
        recentMinutes(db, 5), pendingForOwner(db), latestWeeklySummary(db), recentMail(db, deps.now() - 14 * 86_400_000, 200),
        latestOverview(db), sagaConnections(env, deps, url.origin), recentBoardMessages(db, env.SAGA_BOARD_CHAT_ID, deps.now() - 14 * 86_400_000, 1000),
        ownerDone(db, deps.now() - 60 * 86_400_000)]);
      // The first overview is written as soon as the chair looks, if the cron has not yet.
      if (!overview && env.AI_API_KEY && deps.waitUntil && await claimJob(db, "saga_overview_first", Math.floor(deps.now() / 600_000), deps.now())) deps.waitUntil(draftOverview(env, deps).catch(error => console.warn("saga_overview_failed", error instanceof Error ? error.message : error)));
      const week = mail.filter(m => m.received_at_ms >= deps.now() - 7 * 86_400_000);
      const at = (ms: number) => new Date(ms).toISOString();
      return json({
        assistant: SAGA_NAME, days,
        messages: messages.map(m => ({ author: m.from_assistant ? SAGA_NAME : m.author_name, text: m.text, sentAt: at(m.sent_at_ms) })),
        minutes: minutes.map(m => ({ id: m.id, meetingDate: m.meeting_date, status: m.status, decisions: section(m.draft_markdown ?? "", /beslutninger/i),
          tasks: section(m.draft_markdown ?? "", /opgaver/i), url: m.drive_document_url })),
        pending: [
          ...pending.minutes.map(m => ({ kind: "minutes" as const, id: m.id, label: `Referat ${m.meeting_date ?? ""}`.trim(), text: m.draft_markdown ?? "", fileName: m.file_name, at: at(m.updated_at_ms) })),
          ...pending.posts.map(p => ({ kind: "post" as const, id: p.id, label: POST_LABELS[p.kind] ?? "Opslag", text: p.text, at: at(p.created_at_ms) }))
        ],
        pendingApprovals: pending.posts.length + pending.minutes.length,
        weeklySummary: weekly ? { text: weekly.text, at: at(weekly.created_at_ms) } : null,
        overview: overview ? { text: overview.text, at: at(overview.created_at_ms) } : null,
        // Requested: "hvad vil være en smart gengivelse af telegram gruppechatten?" - "Ja!" - and the
        // same for the minutes document, with one list of questions and tasks for the chair.
        picture: picture(overview?.data ?? null, new Set(done.map(d => d.item_key))),
        group: {
          activity: groupActivity(fortnight, deps.now()),
          recent: fortnight.filter(m => !m.from_assistant).slice(-15).map(m => ({ author: m.author_name, text: m.text.slice(0, 600), sentAt: at(m.sent_at_ms),
            link: telegramLink(env.SAGA_BOARD_CHAT_ID!, m.telegram_message_id) })),
          link: telegramLink(env.SAGA_BOARD_CHAT_ID, fortnight.at(-1)?.telegram_message_id)
        },
        connections,
        minutesDoc: { url: minutesDocUrl(env), writable: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_MINUTES_DOC_ID) },
        // Only a count: the chair does not handle team@ (no single mail is shown to him).
        mail: { week: { total: week.length } }
      });
    }
    // Hjerterum's mailbox (team@), read in Matrix and relayed here as background for the overview.
    if (url.pathname === "/api/saga/liva/mail" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { mails?: unknown; status?: unknown } | null;
      const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
      // Asked: "Og er vi sikre på, at mailen bliver tjekket kontinuerligt?" - Matrix reports every run, also an empty
      // or failed one, so a stopped watch shows (saga/connections.ts) instead of looking connected.
      if (body?.status && typeof body.status === "object") await recordMailWatch(db, body.status as Record<string, unknown>, deps.now());
      const mails: RelayedMail[] = (Array.isArray(body?.mails) ? body.mails : []).slice(0, 50)
        .map(m => m as Record<string, unknown>).filter(m => typeof m?.ref === "string" && m.ref)
        .map(m => ({ ref: text(m.ref, 1600), from: text(m.from, 320) || "ukendt", subject: text(m.subject, 500), receivedAt: text(m.receivedAt, 40), text: text(m.text, 4000) }));
      if (!Array.isArray(body?.mails)) return body?.status ? json({ received: 0, fresh: 0 }) : json({ error: "invalid_request" }, 400);
      return json(await watchMail(env, deps, mails));
    }
    // Requested: "min adgang til cockpittet synkroniseres med Matrix ... når jeg klikker på »klaret«, jamen så
    // forsvinder opgaven begge steder" - the chair's open items as the cockpit shows them, and Matrix's "done".
    if (url.pathname === "/api/saga/liva/chair-tasks" && request.method === "GET") return json(await chairItems(env, db, deps.now()));
    // Requested: "Kan jeg have Saga og Zilla tilgængelig i chat i Matrix på en klog måde?" - "Ja". The chair asks Saga from
    // Matrix's chat: the same answer as in the cockpit (her own knowledge and EU model, the same daily limit); Matrix only
    // shows it. Links point into the cockpit.
    if (url.pathname === "/api/saga/liva/ask" && request.method === "POST") {
      const input = askInput(await request.json().catch(() => null));
      if (!input) return json({ error: "invalid_request" }, 400);
      if (!env.AI_API_KEY || !env.AI_MODEL) return json({ error: "Saga kan ikke svare lige nu (hendes AI er ikke sat op)." }, 503);
      if (await questionsToday(db, deps.now()) >= DAILY_QUESTIONS) return json({ error: "Saga har svaret på mange spørgsmål det seneste døgn. Prøv igen i morgen." }, 429);
      const chair = (await boardMembers(env, db)).chair;
      try { return json({ answer: await askSagaMarkdown(env, deps, db, chair, input, `${url.origin}/cockpit`) }); }
      catch (error) {
        console.warn("saga_liva_ask_failed", error instanceof Error ? error.message : error);
        return json({ error: "Saga kunne ikke svare lige nu. Prøv igen om lidt." }, 502);
      }
    }
    if (url.pathname === "/api/saga/liva/chair-tasks/done" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { key?: unknown } | null;
      const key = typeof body?.key === "string" && /^[a-z0-9]{1,16}$/.test(body.key) ? body.key : "";
      if (!key) return json({ error: "invalid_request" }, 400);
      return json({ done: await chairItemDone(env, db, key, deps.now()) });
    }
    // Requested: "samle ét sted med spørgsmål og todos til mig" - the chair marks one as done.
    if (url.pathname === "/api/saga/liva/done" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { key?: unknown; text?: unknown } | null;
      const key = typeof body?.key === "string" && /^[a-z0-9]{1,16}$/.test(body.key) ? body.key : "";
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, 300) : "";
      if (!key || !text || itemKey(text) !== key) return json({ error: "invalid_request" }, 400);
      await markOwnerDone(db, key, text, deps.now());
      return json({ done: true });
    }
    // The chair decides or revises in Matrix exactly as with the buttons in Telegram (once only).
    if (request.method === "POST" && (url.pathname === "/api/saga/liva/decide" || url.pathname === "/api/saga/liva/revise")) {
      const body = await request.json().catch(() => null) as { kind?: unknown; id?: unknown; approve?: unknown; instruction?: unknown } | null;
      const kind = body?.kind === "post" || body?.kind === "minutes" ? body.kind : null;
      const id = Number(body?.id);
      if (!kind || !Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_request" }, 400);
      if (url.pathname.endsWith("/decide")) {
        if (typeof body?.approve !== "boolean") return json({ error: "invalid_request" }, 400);
        const result = kind === "post" ? await approvePost(env, deps, id, body.approve) : await approveMinutes(env, deps, id, body.approve);
        return json({ result, decided: result !== "Allerede afgjort." });
      }
      const instruction = typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 2000) : "";
      if (!instruction) return json({ error: "invalid_request" }, 400);
      if (kind === "post") await revisePost(env, deps, id, instruction); else await reviseMinutes(env, deps, id, instruction);
      return json({ revised: true });
    }
    return json({ error: "not_found" }, 404);
  }
  return json({ error: "not_found" }, 404);
}
