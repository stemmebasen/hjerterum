import { complete } from "./ai.js";
import { appendToDoc, createGoogleDoc, downloadDriveFile, driveAccessToken, listRecordings, MAX_RECORDING_BYTES, minutesDocText, minutesDocUrl, plainMinutes } from "./drive.js";
import { postsToBoard, requireDb, SAGA_NAME, type SagaDeps, type SagaEnv } from "./env.js";
import { markdownToHtml, section } from "./markdown.js";
import { transcribe } from "./transcribe.js";
import { OVERVIEW_SYSTEM, boardContext, MAIL_SYSTEM, mailContext, MINUTES_SYSTEM, PRIVATE_SYSTEM, REPLY_SYSTEM, REVISE_SYSTEM, WEEKLY_SYSTEM } from "./prompts.js";
import {
  saveOverview, latestOverview, boardActivitySince, claimJob, claimNextMinutes, insertMail, recentMail, setMailVerdict, createPostDraft, decideMinutes, decidePostDraft, getMinutes, getPostDraft, markPosted,
  queueMinutes, recentBoardMessages, recentMinutes, saveBoardMessage, updateMinutes, updatePostDraft
} from "./store.js";
import { approvalButtons, telegramClient } from "./telegram.js";

const DAY = 86_400_000;
const copenhagenDate = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const danishDate = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};
const owner = (env: SagaEnv) => { if (!env.SAGA_OWNER_TELEGRAM_ID) throw new Error("owner_not_configured"); return env.SAGA_OWNER_TELEGRAM_ID; };
const board = (env: SagaEnv) => { if (!env.SAGA_BOARD_CHAT_ID) throw new Error("board_not_configured"); return env.SAGA_BOARD_CHAT_ID; };

/** The board's minutes document, trimmed to what fits (its start and its newest end). Never
 * stops Saga: without it she answers from the chat and her own minutes. */
async function archive(env: SagaEnv, deps: SagaDeps, max = 30_000): Promise<string> {
  if (!env.GOOGLE_MINUTES_DOC_ID) return "";
  try {
    const text = (await minutesDocText(env, deps)).trim();
    return text.length <= max ? text : `${text.slice(0, Math.floor(max * 0.25))}\n[…]\n${text.slice(-Math.floor(max * 0.75))}`;
  } catch (error) {
    console.warn("saga_doc_read_failed", error instanceof Error ? error.message : error);
    return "";
  }
}

async function context(env: SagaEnv, deps: SagaDeps, days = 30) {
  const db = requireDb(env);
  return boardContext(await recentBoardMessages(db, board(env), deps.now() - days * DAY), await recentMinutes(db, 3), await archive(env, deps),
    mailContext(await recentMail(db, deps.now() - Math.min(days, 14) * DAY, 60)));
}

// ---- Hjerterum's mailbox ----

export type RelayedMail = { ref: string; from: string; subject: string; receivedAt: string; text: string };

/** New mails to team@ (relayed from Matrix): each is judged once, and only what demands the
 * chair's attention reaches him - one Telegram message per batch. */
export async function watchMail(env: SagaEnv, deps: SagaDeps, mails: RelayedMail[]): Promise<{ received: number; fresh: number; attention: number }> {
  const db = requireDb(env);
  const fresh: Array<{ id: number; mail: RelayedMail }> = [];
  for (const mail of mails) {
    const at = Date.parse(mail.receivedAt);
    const id = await insertMail(db, { ref: mail.ref, sender: mail.from.slice(0, 320), subject: (mail.subject || "(intet emne)").slice(0, 500),
      receivedAtMs: Number.isFinite(at) ? at : deps.now(), preview: mail.text.replace(/\s+/g, " ").trim().slice(0, 1500), nowMs: deps.now() });
    if (id) fresh.push({ id, mail });
  }
  if (!fresh.length) return { received: mails.length, fresh: 0, attention: 0 };
  let verdicts: Array<{ n?: number; verdict?: string; reason?: string }> = [];
  try {
    const answer = await complete(env, deps, [{ role: "system", content: MAIL_SYSTEM }, { role: "user", content: fresh.map(({ mail }, i) =>
      `MAIL ${i + 1}\nFra: ${mail.from}\nEmne: ${mail.subject}\nModtaget: ${mail.receivedAt}\n${mail.text.replace(/\s+/g, " ").trim().slice(0, 1500)}`).join("\n\n") }]);
    const json = answer.slice(answer.indexOf("["), answer.lastIndexOf("]") + 1);
    verdicts = JSON.parse(json) as typeof verdicts;
  } catch (error) {
    console.warn("saga_mail_triage_failed", error instanceof Error ? error.message : error);
  }
  const flagged: Array<{ mail: RelayedMail; reason: string }> = [];
  for (const [i, { id, mail }] of fresh.entries()) {
    const found = verdicts.find(v => Number(v.n) === i + 1);
    // A mail she could not judge is shown to the chair rather than quietly dropped.
    const verdict = found?.verdict === "ignore" || found?.verdict === "fyi" ? found.verdict : "attention";
    const reason = String(found?.reason || (found ? "" : "Kunne ikke vurderes automatisk")).slice(0, 200);
    await setMailVerdict(db, id, verdict, reason, verdict === "attention");
    if (verdict === "attention") flagged.push({ mail, reason });
  }
  if (flagged.length) {
    const lines = flagged.map(({ mail, reason }) => `• Fra ${mail.from}: "${mail.subject}"${reason ? `\n  ${reason}` : ""}`);
    await telegramClient(env, deps).sendMessage(owner(env), `📬 team@holistisk.org - ${flagged.length === 1 ? "én mail kræver" : `${flagged.length} mails kræver`} din opmærksomhed:\n\n${lines.join("\n")}`);
  }
  return { received: mails.length, fresh: fresh.length, attention: flagged.length };
}

/** Every post to the board goes through here: saved as pending and sent to Jacob with Godkend/Afvis. */
export async function proposePost(env: SagaEnv, deps: SagaDeps, kind: "reply" | "weekly_summary" | "announcement", text: string, replyTo?: number): Promise<number> {
  const db = requireDb(env);
  const id = await createPostDraft(db, { kind, text, replyTo: replyTo ?? null, nowMs: deps.now() });
  const label = kind === "reply" ? "Svar i bestyrelseschatten" : kind === "weekly_summary" ? "Ugeopsummering til bestyrelsen" : "Opslag i bestyrelseschatten";
  const sent = await telegramClient(env, deps).sendMessage(owner(env), `${label} - venter på dit ok:\n\n${text}\n\nSvar på denne besked for at rette teksten.`, { buttons: approvalButtons("post", id) });
  await updatePostDraft(db, id, { approvalMessageId: sent.message_id });
  return id;
}

export async function approvePost(env: SagaEnv, deps: SagaDeps, id: number, approve: boolean): Promise<string> {
  const db = requireDb(env);
  const draft = await getPostDraft(db, id);
  if (!draft || !(await decidePostDraft(db, id, approve ? "approved" : "rejected", deps.now()))) return "Allerede afgjort.";
  const telegram = telegramClient(env, deps);
  if (draft.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), draft.approval_message_id).catch(() => undefined);
  if (!approve) return "Afvist - intet sendt.";
  try {
    const sent = await telegram.sendMessage(board(env), draft.text, draft.reply_to_message_id ? { replyTo: draft.reply_to_message_id } : {});
    await markPosted(db, id, sent.message_id);
    await saveBoardMessage(db, { chatId: board(env), messageId: sent.message_id, author: SAGA_NAME, authorId: null, text: draft.text, sentAtMs: deps.now(), fromAssistant: true });
    return "Sendt til bestyrelsen.";
  } catch (error) {
    await markPosted(db, id, null, error instanceof Error ? error.message : "post_failed");
    return "Kunne ikke sendes - prøv igen senere.";
  }
}

export async function revisePost(env: SagaEnv, deps: SagaDeps, id: number, instruction: string): Promise<void> {
  const db = requireDb(env);
  const draft = await getPostDraft(db, id);
  if (!draft || draft.status !== "pending") return;
  const text = await complete(env, deps, [{ role: "system", content: REVISE_SYSTEM }, { role: "user", content: `TEKST:\n${draft.text}\n\nRETTELSE:\n${instruction}` }]);
  await updatePostDraft(db, id, { text });
  const telegram = telegramClient(env, deps);
  if (draft.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), draft.approval_message_id).catch(() => undefined);
  const sent = await telegram.sendMessage(owner(env), `Rettet - venter på dit ok:\n\n${text}\n\nSvar på denne besked for at rette igen.`, { buttons: approvalButtons("post", id) });
  await updatePostDraft(db, id, { approvalMessageId: sent.message_id });
}

/** Someone in the board chat asked Saga something: the answer is drafted for Jacob's approval. */
export async function draftBoardReply(env: SagaEnv, deps: SagaDeps, question: string, author: string, replyTo: number): Promise<void> {
  const answer = await complete(env, deps, [{ role: "system", content: REPLY_SYSTEM },
    { role: "user", content: `${await context(env, deps)}\n\nSPØRGSMÅL FRA ${author}:\n${question}` }]);
  await proposePost(env, deps, "reply", answer, replyTo);
}

export async function answerOwnerPrivately(env: SagaEnv, deps: SagaDeps, question: string): Promise<void> {
  const answer = await complete(env, deps, [{ role: "system", content: PRIVATE_SYSTEM },
    { role: "user", content: `${await context(env, deps, 60)}\n\nJACOB SPØRGER:\n${question}` }]);
  await telegramClient(env, deps).sendMessage(owner(env), answer);
}

export async function draftWeeklySummary(env: SagaEnv, deps: SagaDeps): Promise<boolean> {
  const messages = await recentBoardMessages(requireDb(env), board(env), deps.now() - 7 * DAY);
  if (!messages.some(m => !m.from_assistant) && !(await recentMail(requireDb(env), deps.now() - 7 * DAY, 1)).length) return false;
  const summary = await complete(env, deps, [{ role: "system", content: WEEKLY_SYSTEM }, { role: "user", content: await context(env, deps, 7) }]);
  if (postsToBoard(env)) { await proposePost(env, deps, "weekly_summary", summary); return true; }
  // Listening only: the summary is the chair's own, straight to him (and to Matrix).
  const db = requireDb(env);
  const id = await createPostDraft(db, { kind: "weekly_summary", text: summary, nowMs: deps.now() });
  const sent = await telegramClient(env, deps).sendMessage(owner(env), `Ugen i bestyrelsen:\n\n${summary}`);
  if (await decidePostDraft(db, id, "approved", deps.now())) await markPosted(db, id, sent.message_id);
  return true;
}

/** Requested: "Jeg skal ikke se mails. Jeg skal have overordnet resume" - the board as a whole,
 * from its group, the minutes, the minutes document and team@, for the chair's Hjerterum page. */
export async function draftOverview(env: SagaEnv, deps: SagaDeps): Promise<void> {
  const db = requireDb(env), since = deps.now() - 14 * DAY;
  // Nothing written, mailed or recorded: nothing to sum up (and no AI call).
  if (!(await recentBoardMessages(db, board(env), since, 1)).length && !(await recentMail(db, since, 1)).length && !(await recentMinutes(db, 1)).length) return;
  const text = await complete(env, deps, [{ role: "system", content: OVERVIEW_SYSTEM }, { role: "user", content: await context(env, deps, 14) }]);
  await saveOverview(requireDb(env), text, deps.now());
}

// ---- Minutes ----

/** A recording Jacob sent Saga privately. Telegram lets a bot download at most 20 MB. */
export async function queueTelegramRecording(env: SagaEnv, deps: SagaDeps, file: { fileId: string; fileName: string; mimeType: string | null; size: number }): Promise<string> {
  if (file.size > 20 * 1024 * 1024) return "Filen er over 20 MB, som er Telegrams grænse for bots. Læg optagelsen i Drev-mappen til optagelser, så tager jeg den derfra.";
  const queued = await queueMinutes(requireDb(env), { source: "telegram", fileId: file.fileId, fileName: file.fileName, mimeType: file.mimeType, meetingDate: copenhagenDate(deps.now()), nowMs: deps.now() });
  return queued ? "Modtaget. Jeg transskriberer optagelsen og sender dig et referatudkast til godkendelse." : "Den optagelse har jeg allerede fået.";
}

/** New recordings in the Drive recordings folder are queued (each file once). */
export async function queueDriveRecordings(env: SagaEnv, deps: SagaDeps): Promise<number> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_RECORDINGS_FOLDER_ID) return 0;
  const token = await driveAccessToken(env, deps);
  let queued = 0;
  for (const file of await listRecordings(env, deps, token)) {
    const meetingDate = file.createdTime ? copenhagenDate(Date.parse(file.createdTime)) : null;
    if (await queueMinutes(requireDb(env), { source: "drive", fileId: file.id, fileName: file.name, mimeType: file.mimeType, meetingDate, nowMs: deps.now() })) queued++;
  }
  return queued;
}

async function sendMinutesForApproval(env: SagaEnv, deps: SagaDeps, id: number, markdown: string, meetingDate: string | null, note: string): Promise<void> {
  const sent = await telegramClient(env, deps).sendDocument(owner(env), `Referat ${meetingDate ?? ""}.md`.replace(/\s+\.md$/, ".md"), markdown,
    `${note}\n\n${postsToBoard(env) ? "Godkend = gem på Drevet og del beslutninger og opgaver i bestyrelseschatten." : "Godkend = gem på Drevet (intet deles i gruppen)."} Svar på denne besked for at rette referatet.`, approvalButtons("minutes", id));
  await updateMinutes(requireDb(env), id, { approvalMessageId: sent.message_id }, deps.now());
}

/** Transcribes and drafts the oldest queued recording; a failure is retried up to three times. */
export async function processNextMinutes(env: SagaEnv, deps: SagaDeps): Promise<boolean> {
  const db = requireDb(env);
  const item = await claimNextMinutes(db, deps.now());
  if (!item) return false;
  try {
    let audio: ArrayBuffer;
    if (item.source === "drive") audio = await downloadDriveFile(deps, await driveAccessToken(env, deps), item.source_file_id);
    else audio = await telegramClient(env, deps).downloadFile(item.source_file_id);
    if (audio.byteLength > MAX_RECORDING_BYTES) throw new Error("recording_too_large");
    const transcript = await transcribe(env, deps, audio, item.file_name, item.mime_type ?? "");
    const draft = await complete(env, deps, [{ role: "system", content: MINUTES_SYSTEM },
      { role: "user", content: `Mødedato: ${danishDate(item.meeting_date) || "ukendt"}\n\nTRANSSKRIPTION:\n${transcript}`
        + await archive(env, deps, 8_000).then(text => text ? `\n\nBAGGRUND - tidligere referater (kun til navne og sammenhæng; referatet skrives ud fra transskriptionen):\n${text}` : "") }]);
    await updateMinutes(db, item.id, { status: "drafted", transcript, draft, error: null }, deps.now());
    await sendMinutesForApproval(env, deps, item.id, draft, item.meeting_date, `Referatudkast fra ${item.file_name}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "minutes_failed";
    const final = message === "recording_too_large" || item.attempts >= 3;
    await updateMinutes(db, item.id, { status: final ? "failed" : "queued", error: message }, deps.now());
    if (final) await telegramClient(env, deps).sendMessage(owner(env), message === "recording_too_large"
      ? `Optagelsen ${item.file_name} er for stor til at behandle (over 60 MB). Gem den gerne i lavere kvalitet (fx m4a/mp3) og læg den ind igen.`
      : `Jeg kunne ikke lave referat af ${item.file_name} (${message}).`).catch(() => undefined);
  }
  return true;
}

export async function reviseMinutes(env: SagaEnv, deps: SagaDeps, id: number, instruction: string): Promise<void> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item || item.status !== "drafted" || !item.draft_markdown) return;
  const draft = await complete(env, deps, [{ role: "system", content: REVISE_SYSTEM },
    { role: "user", content: `REFERAT:\n${item.draft_markdown}\n\nTRANSSKRIPTION (til opslag):\n${item.transcript ?? ""}\n\nRETTELSE:\n${instruction}` }]);
  await updateMinutes(db, id, { draft }, deps.now());
  if (item.approval_message_id) await telegramClient(env, deps).editMessageReplyMarkup(owner(env), item.approval_message_id).catch(() => undefined);
  await sendMinutesForApproval(env, deps, id, draft, item.meeting_date, "Rettet referat.");
}

/** Approved: a Google Doc in the minutes folder, and decisions, tasks and the link in the board chat. */
export async function approveMinutes(env: SagaEnv, deps: SagaDeps, id: number, approve: boolean): Promise<string> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item || !item.draft_markdown || !(await decideMinutes(db, id, approve ? "approved" : "rejected", deps.now()))) return "Allerede afgjort.";
  const telegram = telegramClient(env, deps);
  if (item.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), item.approval_message_id).catch(() => undefined);
  if (!approve) return "Afvist - intet gemt eller delt.";
  const title = `Referat - bestyrelsesmøde ${item.meeting_date ?? ""}`.trim();
  let link = "", failed = "";
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_MINUTES_DOC_ID) {
    // Requested: approved minutes go into the board's own minutes document, at the end.
    try {
      link = await appendToDoc(deps, await driveAccessToken(env, deps), env.GOOGLE_MINUTES_DOC_ID, title, plainMinutes(item.draft_markdown));
      await updateMinutes(db, id, { driveId: env.GOOGLE_MINUTES_DOC_ID, driveUrl: link }, deps.now());
    } catch (error) {
      failed = error instanceof Error ? error.message : "drive_failed";
      await updateMinutes(db, id, { error: failed }, deps.now());
    }
  } else if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_DRIVE_MINUTES_FOLDER_ID) {
    try {
      const doc = await createGoogleDoc(env, deps, await driveAccessToken(env, deps), title, markdownToHtml(item.draft_markdown));
      await updateMinutes(db, id, { driveId: doc.id, driveUrl: doc.url }, deps.now());
      link = doc.url;
    } catch (error) {
      await updateMinutes(db, id, { error: error instanceof Error ? error.message : "drive_failed" }, deps.now());
    }
  }
  // An open document Saga can only read: the approved minutes are kept here, and the chair pastes them in.
  const readOnly = !link && !failed && !env.GOOGLE_SERVICE_ACCOUNT_JSON && minutesDocUrl(env);
  if (!postsToBoard(env)) return link ? `Skrevet ind i referatdokumentet: ${link}`
    : failed ? `Godkendt, men det kunne ikke skrives i referatdokumentet (${failed}). Referatet er filen ovenfor.`
    : readOnly ? `Godkendt og gemt hos Saga. Hun kan læse referatdokumentet, men ikke skrive i det, så sæt referatet ind her: ${readOnly}`
    : "Godkendt. Referatet er filen ovenfor (referatdokumentet er ikke koblet på endnu).";
  const decisions = section(item.draft_markdown, /beslutninger/i), tasks = section(item.draft_markdown, /opgaver/i);
  const text = [`${title}`, decisions && `Beslutninger:\n${decisions}`, tasks && `Opgaver:\n${tasks}`, link ? `Hele referatet: ${link}` : ""].filter(Boolean).join("\n\n");
  const sent = await telegram.sendMessage(board(env), text);
  await saveBoardMessage(db, { chatId: board(env), messageId: sent.message_id, author: SAGA_NAME, authorId: null, text, sentAtMs: deps.now(), fromAssistant: true });
  if (!link) await telegram.sendDocument(board(env), `${title}.md`, item.draft_markdown, title).catch(() => undefined);
  return link ? "Gemt på Drevet og delt med bestyrelsen." : "Delt med bestyrelsen (Drevet er ikke sat op endnu, så referatet er vedhæftet som fil).";
}

// ---- Scheduled ----

/** Every five minutes: new Drive recordings, one recording processed, and the weekly summary
 * on Sunday evening (18-19 Copenhagen time, once per week). */
export async function runSagaJobs(env: SagaEnv, deps: SagaDeps): Promise<void> {
  if (!env.DB || !env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return;
  await queueDriveRecordings(env, deps).catch(error => console.warn("saga_drive_poll_failed", error instanceof Error ? error.message : error));
  await processNextMinutes(env, deps).catch(error => console.warn("saga_minutes_failed", error instanceof Error ? error.message : error));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", hour12: false })
    .formatToParts(deps.now()).map(p => [p.type, p.value]));
  // A fresh overview up to four times a day (the first one as soon as Saga runs) - only when
  // something happened since the last one. Requested: "Undersøg igen unødvendig og kontinuerlig
  // brug af AI" - it was rewritten every six hours whether or not anything was new.
  if (env.SAGA_BOARD_CHAT_ID && env.AI_API_KEY && await claimJob(env.DB, "saga_overview", Math.floor(deps.now() / (6 * 3_600_000)), deps.now())) {
    const last = await latestOverview(env.DB);
    if (!last || await boardActivitySince(env.DB, env.SAGA_BOARD_CHAT_ID, last.created_at_ms))
      await draftOverview(env, deps).catch(error => console.warn("saga_overview_failed", error instanceof Error ? error.message : error));
  }
  if (parts.weekday === "Sun" && parts.hour === "18" && env.SAGA_BOARD_CHAT_ID && env.AI_API_KEY) {
    const week = Math.floor(deps.now() / (7 * DAY));
    if (await claimJob(env.DB, "saga_weekly_summary", week, deps.now())) await draftWeeklySummary(env, deps).catch(error => console.warn("saga_weekly_failed", error instanceof Error ? error.message : error));
  }
}
