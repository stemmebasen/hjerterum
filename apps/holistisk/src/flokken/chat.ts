import type { D1Database } from "../db.js";

/** The chat in each flock (flok): a few lines of text between the people going together, so they can say hello, find
 * each other at the meeting place and say "I'm running late". Only the flock's current members can read and write.
 * Phone numbers and e-mail addresses are masked before a message is saved, so they are never shown or kept. Writing
 * closes a week after the event; the messages are deleted 30 days after it (purgeOldChats, from the daily cron).
 * A member can report a message: it is hidden from them at once, and from everyone once two members have reported it.
 *
 * The page asks for new messages every so often (site.js); each poll reads a handful of rows through indexes, so it
 * stays cheap on D1's free tier. */

export const MAX_LENGTH = 500;
/** How long after the event the chat stays open for new messages. */
export const OPEN_AFTER_EVENT_MS = 7 * 86_400_000;
/** How long after the event the messages are kept. */
export const KEEP_AFTER_EVENT_MS = 30 * 86_400_000;
/** At most this many messages per member and flock in RATE_WINDOW_MS. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60_000;
/** Reports from this many members hide a message from everyone. */
export const HIDE_AFTER_REPORTS = 2;
/** Messages shown at most (the newest). */
const SHOWN = 200;

const ENDS = "COALESCE(e.ends_at, e.starts_at + 10800000)";

export type ChatMessage = { id: string; member_id: string; first_name: string; body: string; created_at: number };
export type ChatAccess = { flockId: string; status: "open" | "closed"; eventEnds: number };
export type ChatError = "not_member" | "chat_closed" | "chat_empty" | "chat_too_long" | "chat_too_fast" | "not_found";

export const chatOpen = (a: Pick<ChatAccess, "status" | "eventEnds">, now: number): boolean =>
  a.status === "open" && now <= a.eventEnds + OPEN_AFTER_EVENT_MS;

/** The flock's chat as seen by a member, or null when they are not a current member of it. One indexed lookup. */
export async function chatAccess(db: D1Database, flockId: string, memberId: string): Promise<ChatAccess | null> {
  const row = await db.prepare(`SELECT f.id, f.status, ${ENDS} AS ends FROM flocks f
    JOIN flock_members fm ON fm.flock_id = f.id AND fm.member_id = ? AND fm.left_at IS NULL
    JOIN events e ON e.id = f.event_id WHERE f.id = ?`).bind(memberId, flockId).first<{ id: string; status: "open" | "closed"; ends: number }>();
  return row ? { flockId: row.id, status: row.status, eventEnds: row.ends } : null;
}

const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
/** Hides e-mail addresses and phone numbers (8 or more digits, with or without +45, spaces, dots or dashes). Dates such
 * as 10.11.2026 and times such as 18.30 are left alone. */
export function maskContacts(text: string): string {
  return text
    .replace(/[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[a-z]{2,}/gi, "[e-mail skjult]")
    .replace(/(?:\+|00)?\d[\d .\-/]{6,}\d/g, match => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 8 && !DATE_LIKE.test(match.trim()) ? "[nummer skjult]" : match;
    });
}

export function cleanMessage(raw: string): string {
  return maskContacts(raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim());
}

/** Messages the member may see, oldest first: all from `after` (a created_at; the page drops the ones it has), or the
 * newest SHOWN. Messages hidden by
 * reports, and those the member reported, are left out. */
export async function chatMessages(db: D1Database, flockId: string, memberId: string, after = 0): Promise<ChatMessage[]> {
  const { results } = await db.prepare(`SELECT * FROM (SELECT c.id, c.member_id, m.first_name, c.body, c.created_at FROM flock_messages c
    JOIN members m ON m.id = c.member_id
    WHERE c.flock_id = ? AND c.created_at >= ? AND c.hidden_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM flock_message_reports r WHERE r.message_id = c.id AND r.member_id = ?)
    ORDER BY c.created_at DESC LIMIT ${SHOWN}) ORDER BY created_at, id`).bind(flockId, after, memberId).all<ChatMessage>();
  return results;
}

export async function postMessage(db: D1Database, access: ChatAccess, memberId: string, raw: string, now: number): Promise<{ message: ChatMessage } | { error: ChatError }> {
  if (!chatOpen(access, now)) return { error: "chat_closed" };
  const body = cleanMessage(raw);
  if (!body) return { error: "chat_empty" };
  if (body.length > MAX_LENGTH) return { error: "chat_too_long" };
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM flock_messages WHERE member_id = ? AND created_at > ?")
    .bind(memberId, now - RATE_WINDOW_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT) return { error: "chat_too_fast" };
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO flock_messages (id, flock_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, access.flockId, memberId, body, now).run();
  const name = await db.prepare("SELECT first_name FROM members WHERE id = ?").bind(memberId).first<{ first_name: string }>();
  return { message: { id, member_id: memberId, first_name: name?.first_name ?? "", body, created_at: now } };
}

/** Reports a message in the flock. The reporter no longer sees it; enough reports hide it from everyone. A member
 * cannot report their own message. */
export async function reportMessage(db: D1Database, access: ChatAccess, memberId: string, messageId: string, now: number): Promise<{ ok: true } | { error: ChatError }> {
  const msg = await db.prepare("SELECT member_id FROM flock_messages WHERE id = ? AND flock_id = ?").bind(messageId, access.flockId).first<{ member_id: string }>();
  if (!msg || msg.member_id === memberId) return { error: "not_found" };
  await db.batch([
    db.prepare("INSERT INTO flock_message_reports (message_id, member_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(messageId, memberId, now),
    db.prepare(`UPDATE flock_messages SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL
      AND (SELECT COUNT(*) FROM flock_message_reports WHERE message_id = ?) >= ${HIDE_AFTER_REPORTS}`).bind(now, messageId, messageId)
  ]);
  console.log(JSON.stringify({ event: "chat_report", messageId, flockId: access.flockId }));
  return { ok: true };
}

/** Reported messages, newest report first, for looking through by hand (GET /api/chat-meldinger with the ingest token). */
export async function reportedMessages(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare(`SELECT c.id, c.flock_id, c.body, c.created_at, c.hidden_at, m.first_name AS written_by,
    COUNT(r.member_id) AS reports, MAX(r.created_at) AS last_report_at
    FROM flock_message_reports r JOIN flock_messages c ON c.id = r.message_id JOIN members m ON m.id = c.member_id
    GROUP BY c.id ORDER BY last_report_at DESC LIMIT 200`).all();
  return results;
}

/** Deletes messages from flocks whose event ended more than 30 days ago. Run from the daily cron. */
export async function purgeOldChats(db: D1Database, now: number): Promise<number> {
  const cutoff = now - KEEP_AFTER_EVENT_MS;
  const result = await db.prepare(`DELETE FROM flock_messages WHERE flock_id IN
    (SELECT f.id FROM flocks f JOIN events e ON e.id = f.event_id WHERE ${ENDS} < ?1)`).bind(cutoff).run();
  return result.meta?.changes ?? 0;
}
