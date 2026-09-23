import { requireDb, SAGA_NAME, type SagaDeps, type SagaEnv } from "./env.js";
import {
  answerOwnerPrivately, approveMinutes, approvePost, draftBoardReply, draftWeeklySummary, queueTelegramRecording,
  processNextMinutes, reviseMinutes, revisePost
} from "./saga.js";
import { minutesByApprovalMessage, pendingPostCount, postDraftByApprovalMessage, recentBoardMessages, recentMinutes, saveBoardMessage } from "./store.js";
import { section } from "./markdown.js";
import { telegramClient } from "./telegram.js";

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
type TgFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string; caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>; reply_to_message?: { message_id: number; from?: TgUser };
  voice?: TgFile; audio?: TgFile; video?: TgFile; document?: TgFile };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; data?: string } };

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

  // The board chat: every text is kept for Saga's overview; a question to her is answered via Jacob's approval.
  if (boardId && chatId === boardId) {
    const text = (message.text ?? message.caption ?? "").trim();
    if (!text || message.from?.is_bot) return;
    const db = requireDb(env);
    await saveBoardMessage(db, { chatId, messageId: message.message_id, author: name(message.from), authorId: message.from ? String(message.from.id) : null, text, sentAtMs: message.date * 1000 });
    if (addressesSaga(message, env.SAGA_TELEGRAM_BOT_USERNAME)) await draftBoardReply(env, deps, text, name(message.from), message.message_id);
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
      + "Skriv /opsummering for en ugeopsummering til bestyrelsen, eller spørg mig om noget fra bestyrelsens chat og referater.");
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
  if (url.pathname === "/api/saga/liva/overview" && request.method === "GET") {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!sameSecret(bearer, env.SAGA_LIVA_SECRET)) return json({ error: "unauthorized" }, 401);
    if (!env.SAGA_BOARD_CHAT_ID) return json({ error: "board_not_configured" }, 503);
    const db = requireDb(env);
    const days = Math.min(Math.max(Number(url.searchParams.get("days") || 7), 1), 60);
    const [messages, minutes, pending] = await Promise.all([recentBoardMessages(db, env.SAGA_BOARD_CHAT_ID, deps.now() - days * 86_400_000, 200), recentMinutes(db, 5), pendingPostCount(db)]);
    return json({
      assistant: SAGA_NAME, days,
      messages: messages.map(m => ({ author: m.from_assistant ? SAGA_NAME : m.author_name, text: m.text, sentAt: new Date(m.sent_at_ms).toISOString() })),
      minutes: minutes.map(m => ({ meetingDate: m.meeting_date, status: m.status, decisions: section(m.draft_markdown ?? "", /beslutninger/i),
        tasks: section(m.draft_markdown ?? "", /opgaver/i), url: m.drive_document_url })),
      pendingApprovals: pending
    });
  }
  return json({ error: "not_found" }, 404);
}
