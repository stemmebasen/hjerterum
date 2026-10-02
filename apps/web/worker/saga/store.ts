import type { D1Database } from "../db.js";

export type BoardMessage = { author_name: string; text: string; sent_at_ms: number; from_assistant: number; telegram_message_id?: number };
export type PostDraft = { id: number; kind: string; text: string; status: string; reply_to_message_id: number | null;
  minutes_id: number | null; approval_message_id: number | null };
export type Minutes = { id: number; source: string; source_file_id: string; file_name: string; mime_type: string | null;
  status: string; meeting_date: string | null; transcript: string | null; draft_markdown: string | null;
  approval_message_id: number | null; drive_document_url: string | null; attempts: number; created_at_ms: number };

export async function saveBoardMessage(db: D1Database, message: { chatId: string; messageId: number; author: string;
  authorId: string | null; text: string; sentAtMs: number; fromAssistant?: boolean }): Promise<void> {
  // A member who writes from someone else's account is kept under their own name (board_people).
  await db.prepare(`INSERT OR IGNORE INTO board_messages
    (chat_id, telegram_message_id, author_name, author_telegram_id, text, sent_at_ms, from_assistant)
    VALUES (?, ?, COALESCE((SELECT name FROM board_people WHERE telegram_id = ?), ?), ?, ?, ?, ?)`)
    .bind(message.chatId, message.messageId, message.authorId, message.author, message.authorId, message.text, message.sentAtMs, message.fromAssistant ? 1 : 0).run();
}

export async function recentBoardMessages(db: D1Database, chatId: string, sinceMs: number, limit = 300): Promise<BoardMessage[]> {
  const rows = await db.prepare(`SELECT author_name, text, sent_at_ms, from_assistant, telegram_message_id FROM board_messages
    WHERE chat_id = ? AND sent_at_ms >= ? ORDER BY sent_at_ms DESC LIMIT ?`).bind(chatId, sinceMs, limit).all<BoardMessage>();
  return (rows.results ?? []).reverse();
}

export async function createPostDraft(db: D1Database, draft: { kind: string; text: string; replyTo?: number | null;
  minutesId?: number | null; nowMs: number }): Promise<number> {
  const result = await db.prepare(`INSERT INTO board_post_drafts (kind, text, reply_to_message_id, minutes_id, created_at_ms)
    VALUES (?, ?, ?, ?, ?)`).bind(draft.kind, draft.text, draft.replyTo ?? null, draft.minutesId ?? null, draft.nowMs).run();
  const id = Number(result.meta?.last_row_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("post_draft_not_created");
  return id;
}

export const getPostDraft = (db: D1Database, id: number) =>
  db.prepare("SELECT id, kind, text, status, reply_to_message_id, minutes_id, approval_message_id FROM board_post_drafts WHERE id = ?").bind(id).first<PostDraft>();

export const postDraftByApprovalMessage = (db: D1Database, messageId: number) =>
  db.prepare("SELECT id, kind, text, status, reply_to_message_id, minutes_id, approval_message_id FROM board_post_drafts WHERE approval_message_id = ? AND status = 'pending'").bind(messageId).first<PostDraft>();

export async function updatePostDraft(db: D1Database, id: number, fields: { text?: string; approvalMessageId?: number }): Promise<void> {
  if (fields.text !== undefined) await db.prepare("UPDATE board_post_drafts SET text = ? WHERE id = ? AND status = 'pending'").bind(fields.text, id).run();
  if (fields.approvalMessageId !== undefined) await db.prepare("UPDATE board_post_drafts SET approval_message_id = ? WHERE id = ?").bind(fields.approvalMessageId, id).run();
}

/** Moves a draft from pending to a decision exactly once; false when it was already decided. */
export async function decidePostDraft(db: D1Database, id: number, status: "approved" | "rejected", nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE board_post_drafts SET status = ?, decided_at_ms = ? WHERE id = ? AND status = 'pending'").bind(status, nowMs, id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function markPosted(db: D1Database, id: number, postedMessageId: number | null, error?: string): Promise<void> {
  await db.prepare("UPDATE board_post_drafts SET status = ?, posted_message_id = ?, last_error = ? WHERE id = ?")
    .bind(error ? "failed" : "posted", postedMessageId, error ?? null, id).run();
}

export const pendingPostCount = async (db: D1Database) =>
  Number((await db.prepare("SELECT COUNT(*) AS n FROM board_post_drafts WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0);

const MINUTES_COLUMNS = "id, source, source_file_id, file_name, mime_type, status, meeting_date, transcript, draft_markdown, approval_message_id, drive_document_url, attempts, created_at_ms";

/** Queues a recording once; a file already queued (by id) is never processed twice. */
export async function queueMinutes(db: D1Database, file: { source: "telegram" | "drive" | "upload" | "document"; fileId: string; fileName: string;
  mimeType: string | null; meetingDate: string | null; nowMs: number }): Promise<number | null> {
  const result = await db.prepare(`INSERT OR IGNORE INTO board_minutes (source, source_file_id, file_name, mime_type, meeting_date, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(file.source, file.fileId, file.fileName, file.mimeType, file.meetingDate, file.nowMs, file.nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1 ? Number(result.meta?.last_row_id) : null;
}

export const getMinutes = (db: D1Database, id: number) =>
  db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE id = ?`).bind(id).first<Minutes>();

export const minutesByApprovalMessage = (db: D1Database, messageId: number) =>
  db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE approval_message_id = ? AND status IN ('drafted', 'approved')`).bind(messageId).first<Minutes>();

/** A recording whose work stopped halfway (the Worker was ended) is taken up again after this long. */
export const STALE_TRANSCRIBING_MS = 20 * 60_000;

/** Claims the oldest queued recording, or one stuck halfway (at most three attempts each). */
export async function claimNextMinutes(db: D1Database, nowMs: number): Promise<Minutes | null> {
  const next = await db.prepare(`SELECT ${MINUTES_COLUMNS}, updated_at_ms FROM board_minutes WHERE attempts < 3 AND (status = 'queued' OR (status = 'transcribing' AND updated_at_ms < ?))
    ORDER BY created_at_ms LIMIT 1`).bind(nowMs - STALE_TRANSCRIBING_MS).first<Minutes & { updated_at_ms: number }>();
  if (!next) return null;
  const claimed = await db.prepare("UPDATE board_minutes SET status = 'transcribing', attempts = attempts + 1, updated_at_ms = ? WHERE id = ? AND status = ? AND updated_at_ms = ?")
    .bind(nowMs, next.id, next.status, next.updated_at_ms).run();
  return Number(claimed.meta?.changes ?? 0) === 1 ? { ...next, status: "transcribing", attempts: next.attempts + 1 } : null;
}

export async function updateMinutes(db: D1Database, id: number, fields: { status?: string; transcript?: string; draft?: string;
  approvalMessageId?: number; driveId?: string; driveUrl?: string; error?: string | null }, nowMs: number): Promise<void> {
  const sets: string[] = ["updated_at_ms = ?"];
  const values: unknown[] = [nowMs];
  const add = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (fields.status !== undefined) add("status", fields.status);
  if (fields.transcript !== undefined) add("transcript", fields.transcript);
  if (fields.draft !== undefined) add("draft_markdown", fields.draft);
  if (fields.approvalMessageId !== undefined) add("approval_message_id", fields.approvalMessageId);
  if (fields.driveId !== undefined) add("drive_document_id", fields.driveId);
  if (fields.driveUrl !== undefined) add("drive_document_url", fields.driveUrl);
  if (fields.error !== undefined) add("last_error", fields.error);
  await db.prepare(`UPDATE board_minutes SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
}

/** The meeting the board planned in its cockpit for a day: Saga follows its agenda in the minutes. */
export const plannedMeeting = (db: D1Database, day: string) =>
  db.prepare("SELECT start_time, place, agenda FROM board_meetings WHERE meeting_date = ? ORDER BY id DESC LIMIT 1").bind(day)
    .first<{ start_time: string | null; place: string | null; agenda: string }>();

/** Decides a drafted minutes exactly once. */
export async function decideMinutes(db: D1Database, id: number, status: "approved" | "rejected", nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE board_minutes SET status = ?, updated_at_ms = ? WHERE id = ? AND status = 'drafted'").bind(status, nowMs, id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function recentMinutes(db: D1Database, limit = 5): Promise<Minutes[]> {
  // Reported: "Hjerterum i Matrix er helt outdated ... slet ikke noget om ... det nyeste referat". The meetings imported
  // from the minutes document were created after 1 October's minutes and pushed them out; newest meeting first.
  const rows = await db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE status IN ('drafted', 'approved') ORDER BY COALESCE(meeting_date, '') DESC, created_at_ms DESC LIMIT ?`).bind(limit).all<Minutes>();
  return rows.results ?? [];
}

/** What waits for the chair: posts not yet decided and minutes drafted but not yet approved. */
export async function pendingForOwner(db: D1Database) {
  const posts = await db.prepare("SELECT id, kind, text, created_at_ms FROM board_post_drafts WHERE status = 'pending' ORDER BY created_at_ms DESC LIMIT 20")
    .all<{ id: number; kind: string; text: string; created_at_ms: number }>();
  const minutes = await db.prepare("SELECT id, file_name, meeting_date, draft_markdown, updated_at_ms FROM board_minutes WHERE status = 'drafted' ORDER BY created_at_ms DESC LIMIT 10")
    .all<{ id: number; file_name: string; meeting_date: string | null; draft_markdown: string | null; updated_at_ms: number }>();
  return { posts: posts.results ?? [], minutes: minutes.results ?? [] };
}

/** The latest weekly summary the board has seen (posted), if any. */
export const latestWeeklySummary = (db: D1Database) =>
  db.prepare("SELECT text, created_at_ms FROM board_post_drafts WHERE kind = 'weekly_summary' AND status = 'posted' ORDER BY created_at_ms DESC LIMIT 1")
    .first<{ text: string; created_at_ms: number }>();

/** One run of a scheduled job per slot (the repo's job_claims ledger). */
export async function claimJob(db: D1Database, key: string, slotMs: number, nowMs: number): Promise<boolean> {
  const result = await db.prepare("INSERT OR IGNORE INTO job_claims (job_key, scheduled_for_ms, status, claimed_at_ms) VALUES (?, ?, 'claimed', ?)").bind(key, slotMs, nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

// ---- Hjerterum's mailbox (team@), relayed from Matrix ----

export type BoardMail = { id: number; message_ref: string; sender: string; subject: string; received_at_ms: number; preview: string; verdict: string; reason: string | null };

/** Stores a relayed mail once (by its mailbox reference); null when it was already seen. */
export async function insertMail(db: D1Database, mail: { ref: string; sender: string; subject: string; receivedAtMs: number; preview: string; nowMs: number }): Promise<number | null> {
  // The year before the connection is relayed too (Matrix reads every folder then), so the same mail can come
  // again under another reference: the same sender, subject and minute is the same mail.
  const result = await db.prepare(`INSERT OR IGNORE INTO board_mail (message_ref, sender, subject, received_at_ms, preview, created_at_ms)
    SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM board_mail WHERE sender = ? AND subject = ? AND received_at_ms / 60000 = ? / 60000)`)
    .bind(mail.ref, mail.sender, mail.subject, mail.receivedAtMs, mail.preview, mail.nowMs, mail.sender, mail.subject, mail.receivedAtMs).run();
  return Number(result.meta?.changes ?? 0) === 1 ? Number(result.meta?.last_row_id) : null;
}

export async function setMailVerdict(db: D1Database, id: number, verdict: "attention" | "fyi" | "ignore", reason: string, notified: boolean): Promise<void> {
  await db.prepare("UPDATE board_mail SET verdict = ?, reason = ?, notified = ? WHERE id = ?").bind(verdict, reason, notified ? 1 : 0, id).run();
}

export async function recentMail(db: D1Database, sinceMs: number, limit = 60): Promise<BoardMail[]> {
  const rows = await db.prepare("SELECT id, message_ref, sender, subject, received_at_ms, preview, verdict, reason FROM board_mail WHERE received_at_ms >= ? ORDER BY received_at_ms DESC LIMIT ?")
    .bind(sinceMs, limit).all<BoardMail>();
  return rows.results ?? [];
}

// ---- The chair's overview and the connection check ----

export type Overview = { text: string; data: string | null; doc_hash: string | null; created_at_ms: number };

/** The overview's text, its structured picture (JSON, when the AI gave one) and the fingerprint of the minutes document it read. */
export async function saveOverview(db: D1Database, text: string, nowMs: number, extra: { data?: string | null; docHash?: string | null } = {}): Promise<void> {
  await db.prepare("INSERT INTO board_overviews (text, created_at_ms, data, doc_hash) VALUES (?, ?, ?, ?)").bind(text, nowMs, extra.data ?? null, extra.docHash ?? null).run();
}

export async function latestOverview(db: D1Database): Promise<Overview | null> {
  // Reported: the cockpit greeted with "```json {" - an answer cut off mid-JSON was kept as the overview's
  // text. Such an answer is never the overview: the last good one stands until a new one is read.
  return db.prepare(`SELECT text, data, doc_hash, created_at_ms FROM board_overviews
    WHERE data IS NOT NULL OR (LTRIM(text) NOT LIKE '\`\`\`%' AND LTRIM(text) NOT LIKE '{%')
    ORDER BY created_at_ms DESC, id DESC LIMIT 1`).first<Overview>();
}

/** Requested: "samle ét sted med spørgsmål og todos til mig" - an item the chair marked as done is
 * hidden and not raised again by the next overview (for 60 days). */
export async function markOwnerDone(db: D1Database, key: string, text: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO board_owner_done (item_key, text, done_at_ms) VALUES (?, ?, ?) ON CONFLICT(item_key) DO UPDATE SET done_at_ms = excluded.done_at_ms")
    .bind(key, text.slice(0, 300), nowMs).run();
}

export async function ownerDone(db: D1Database, sinceMs: number): Promise<Array<{ item_key: string; text: string }>> {
  const rows = await db.prepare("SELECT item_key, text FROM board_owner_done WHERE done_at_ms >= ? ORDER BY done_at_ms DESC LIMIT 60").bind(sinceMs).all<{ item_key: string; text: string }>();
  return rows.results ?? [];
}

/** Anything new for the board since a moment: a message in its chat, a mail to team@, or minutes
 * drafted or decided. */
export async function boardActivitySince(db: D1Database, chatId: string, sinceMs: number): Promise<boolean> {
  const [message, mail, minutes] = await Promise.all([
    db.prepare("SELECT 1 AS hit FROM board_messages WHERE chat_id = ? AND sent_at_ms > ? LIMIT 1").bind(chatId, sinceMs).first<{ hit: number }>(),
    db.prepare("SELECT 1 AS hit FROM board_mail WHERE received_at_ms > ? LIMIT 1").bind(sinceMs).first<{ hit: number }>(),
    db.prepare("SELECT 1 AS hit FROM board_minutes WHERE updated_at_ms > ? AND status IN ('drafted', 'approved') LIMIT 1").bind(sinceMs).first<{ hit: number }>(),
  ]);
  return Boolean(message || mail || minutes);
}

export type ServiceStatus = { ok: number; detail: string | null; at_ms: number };

/** The last outcome of an outside service (the AI, Telegram deliveries); never throws. */
export async function setServiceStatus(db: D1Database, key: string, ok: boolean, detail: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO saga_status (key, ok, detail, at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ok = excluded.ok, detail = excluded.detail, at_ms = excluded.at_ms")
    .bind(key, ok ? 1 : 0, detail.slice(0, 300), nowMs).run().catch(() => undefined);
}

export async function serviceStatus(db: D1Database, key: string): Promise<ServiceStatus | null> {
  return db.prepare("SELECT ok, detail, at_ms FROM saga_status WHERE key = ?").bind(key).first<ServiceStatus>();
}

export async function boardActivity(db: D1Database, chatId: string): Promise<{ groupMessages: number; lastGroupMessageMs: number | null; mails: number; lastMailMs: number | null; lastRelayedMs: number | null }> {
  const chat = await db.prepare("SELECT COUNT(*) AS n, MAX(sent_at_ms) AS last FROM board_messages WHERE chat_id = ? AND from_assistant = 0").bind(chatId).first<{ n: number; last: number | null }>();
  const mail = await db.prepare("SELECT COUNT(*) AS n, MAX(received_at_ms) AS last, MAX(created_at_ms) AS relayed FROM board_mail").first<{ n: number; last: number | null; relayed: number | null }>();
  return { groupMessages: Number(chat?.n ?? 0), lastGroupMessageMs: chat?.last ?? null, mails: Number(mail?.n ?? 0), lastMailMs: mail?.last ?? null, lastRelayedMs: mail?.relayed ?? null };
}
