import type { D1Database } from "../db.js";

export type BoardMessage = { author_name: string; text: string; sent_at_ms: number; from_assistant: number };
export type PostDraft = { id: number; kind: string; text: string; status: string; reply_to_message_id: number | null;
  minutes_id: number | null; approval_message_id: number | null };
export type Minutes = { id: number; source: string; source_file_id: string; file_name: string; mime_type: string | null;
  status: string; meeting_date: string | null; transcript: string | null; draft_markdown: string | null;
  approval_message_id: number | null; drive_document_url: string | null; attempts: number; created_at_ms: number };

export async function saveBoardMessage(db: D1Database, message: { chatId: string; messageId: number; author: string;
  authorId: string | null; text: string; sentAtMs: number; fromAssistant?: boolean }): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO board_messages
    (chat_id, telegram_message_id, author_name, author_telegram_id, text, sent_at_ms, from_assistant)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(message.chatId, message.messageId, message.author, message.authorId, message.text, message.sentAtMs, message.fromAssistant ? 1 : 0).run();
}

export async function recentBoardMessages(db: D1Database, chatId: string, sinceMs: number, limit = 300): Promise<BoardMessage[]> {
  const rows = await db.prepare(`SELECT author_name, text, sent_at_ms, from_assistant FROM board_messages
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
export async function queueMinutes(db: D1Database, file: { source: "telegram" | "drive"; fileId: string; fileName: string;
  mimeType: string | null; meetingDate: string | null; nowMs: number }): Promise<number | null> {
  const result = await db.prepare(`INSERT OR IGNORE INTO board_minutes (source, source_file_id, file_name, mime_type, meeting_date, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(file.source, file.fileId, file.fileName, file.mimeType, file.meetingDate, file.nowMs, file.nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1 ? Number(result.meta?.last_row_id) : null;
}

export const getMinutes = (db: D1Database, id: number) =>
  db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE id = ?`).bind(id).first<Minutes>();

export const minutesByApprovalMessage = (db: D1Database, messageId: number) =>
  db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE approval_message_id = ? AND status = 'drafted'`).bind(messageId).first<Minutes>();

/** Claims the oldest queued recording (at most three attempts each). */
export async function claimNextMinutes(db: D1Database, nowMs: number): Promise<Minutes | null> {
  const next = await db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE status = 'queued' AND attempts < 3 ORDER BY created_at_ms LIMIT 1`).first<Minutes>();
  if (!next) return null;
  const claimed = await db.prepare("UPDATE board_minutes SET status = 'transcribing', attempts = attempts + 1, updated_at_ms = ? WHERE id = ? AND status = 'queued'")
    .bind(nowMs, next.id).run();
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

/** Decides a drafted minutes exactly once. */
export async function decideMinutes(db: D1Database, id: number, status: "approved" | "rejected", nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE board_minutes SET status = ?, updated_at_ms = ? WHERE id = ? AND status = 'drafted'").bind(status, nowMs, id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function recentMinutes(db: D1Database, limit = 5): Promise<Minutes[]> {
  const rows = await db.prepare(`SELECT ${MINUTES_COLUMNS} FROM board_minutes WHERE status IN ('drafted', 'approved') ORDER BY created_at_ms DESC LIMIT ?`).bind(limit).all<Minutes>();
  return rows.results ?? [];
}

/** One run of a scheduled job per slot (the repo's job_claims ledger). */
export async function claimJob(db: D1Database, key: string, slotMs: number, nowMs: number): Promise<boolean> {
  const result = await db.prepare("INSERT OR IGNORE INTO job_claims (job_key, scheduled_for_ms, status, claimed_at_ms) VALUES (?, ?, 'claimed', ?)").bind(key, slotMs, nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
