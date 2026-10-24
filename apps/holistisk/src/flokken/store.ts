import type { D1Database } from "../db.js";

/** Flocks (flokke): small groups going to one event together. Members join and leave themselves; nobody is put in a
 * flock automatically. A member is in at most one flock per event. */

export const DEFAULT_SIZE = 6;
export const MIN_SIZE = 2;
export const MAX_SIZE = 10;
/** How many flocks one member may start in a day, so the lists stay real. */
const CREATED_PER_DAY = 5;

export type FlockRow = {
  id: string; event_id: string; created_by: string; meeting_place: string; meeting_at: number; note: string | null;
  max_size: number; follows_flock_id: string | null; status: "open" | "closed"; created_at: number;
  event_slug: string; event_title: string; event_starts_at: number; event_ends_at: number | null; event_status: string;
  event_venue: string | null; event_city: string | null;
  member_count: number;
  /** The viewer's own membership, when logged in: 1 if a current member. */
  is_member: number; again: number | null;
};

const ENDS = "COALESCE(e.ends_at, e.starts_at + 10800000)";
const FLOCK_SELECT = `SELECT f.*, e.slug AS event_slug, e.title AS event_title, e.starts_at AS event_starts_at, e.ends_at AS event_ends_at,
  e.status AS event_status, e.venue_name AS event_venue, e.city AS event_city,
  (SELECT COUNT(*) FROM flock_members m WHERE m.flock_id = f.id AND m.left_at IS NULL) AS member_count,
  COALESCE((SELECT 1 FROM flock_members m WHERE m.flock_id = f.id AND m.member_id = ?1 AND m.left_at IS NULL), 0) AS is_member,
  (SELECT m.again FROM flock_members m WHERE m.flock_id = f.id AND m.member_id = ?1 AND m.left_at IS NULL) AS again
  FROM flocks f JOIN events e ON e.id = f.event_id`;

export const eventOver = (f: Pick<FlockRow, "event_starts_at" | "event_ends_at">, now: number): boolean =>
  (f.event_ends_at ?? f.event_starts_at + 3 * 3600_000) < now;
export const isFull = (f: Pick<FlockRow, "member_count" | "max_size">): boolean => f.member_count >= f.max_size;

export async function flocksForEvent(db: D1Database, eventId: string, memberId: string | null): Promise<FlockRow[]> {
  const { results } = await db.prepare(`${FLOCK_SELECT} WHERE f.event_id = ?2 AND f.status = 'open' ORDER BY f.meeting_at, f.created_at`)
    .bind(memberId ?? "", eventId).all<FlockRow>();
  return results.filter(f => f.member_count > 0);
}

export async function flockById(db: D1Database, id: string, memberId: string | null): Promise<FlockRow | null> {
  return db.prepare(`${FLOCK_SELECT} WHERE f.id = ?2`).bind(memberId ?? "", id).first<FlockRow>();
}

/** The current members' first names, in the order they joined. Only shown to members of the flock. */
export async function flockMemberNames(db: D1Database, flockId: string): Promise<Array<{ id: string; first_name: string; again: number | null }>> {
  const { results } = await db.prepare(`SELECT m.id, m.first_name, fm.again FROM flock_members fm JOIN members m ON m.id = fm.member_id
    WHERE fm.flock_id = ? AND fm.left_at IS NULL ORDER BY fm.joined_at`).bind(flockId).all<{ id: string; first_name: string; again: number | null }>();
  return results;
}

/** The member who looks after the meeting place and time: the one who started the flock, or, once they have left,
 * whoever has been in it longest. */
export async function flockHost(db: D1Database, f: Pick<FlockRow, "id" | "created_by">): Promise<string | null> {
  const row = await db.prepare(`SELECT member_id FROM flock_members WHERE flock_id = ? AND left_at IS NULL
    ORDER BY member_id = ? DESC, joined_at LIMIT 1`).bind(f.id, f.created_by).first<{ member_id: string }>();
  return row?.member_id ?? null;
}

/** The viewer's current flock for an event, if any. */
export async function memberFlockForEvent(db: D1Database, eventId: string, memberId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT f.id FROM flocks f JOIN flock_members m ON m.flock_id = f.id
    WHERE f.event_id = ? AND f.status = 'open' AND m.member_id = ? AND m.left_at IS NULL`).bind(eventId, memberId).first<{ id: string }>();
  return row?.id ?? null;
}

/** Flocks the member is in, newest event first. */
export async function memberFlocks(db: D1Database, memberId: string): Promise<FlockRow[]> {
  const { results } = await db.prepare(`${FLOCK_SELECT} WHERE f.id IN (SELECT flock_id FROM flock_members WHERE member_id = ?1 AND left_at IS NULL)
    ORDER BY e.starts_at DESC`).bind(memberId).all<FlockRow>();
  return results;
}

/** Earlier flocks the member said yes to meeting again after (Eftermødet), to start a new flock from. */
export async function eftermoedeFlocks(db: D1Database, memberId: string, now: number): Promise<FlockRow[]> {
  const { results } = await db.prepare(`${FLOCK_SELECT} WHERE f.id IN (SELECT flock_id FROM flock_members WHERE member_id = ?1 AND left_at IS NULL AND again = 1)
    AND ${ENDS} < ?2 ORDER BY e.starts_at DESC LIMIT 20`).bind(memberId, now).all<FlockRow>();
  return results;
}

/** New flocks started from an Eftermøde the member said yes to, that the member has not joined. They are only shown,
 * never joined for the member. */
export async function eftermoedeInvitations(db: D1Database, memberId: string, now: number): Promise<Array<FlockRow & { started_by: string; from_title: string }>> {
  const { results } = await db.prepare(`SELECT x.*, s.first_name AS started_by, pe.title AS from_title FROM (${FLOCK_SELECT}) x
    JOIN flocks p ON p.id = x.follows_flock_id JOIN events pe ON pe.id = p.event_id JOIN members s ON s.id = x.created_by
    WHERE x.status = 'open' AND x.is_member = 0 AND x.event_status = 'scheduled' AND x.event_starts_at > ?2
      AND EXISTS (SELECT 1 FROM flock_members pm WHERE pm.flock_id = x.follows_flock_id AND pm.member_id = ?1 AND pm.again = 1)
      AND EXISTS (SELECT 1 FROM flock_members sm WHERE sm.flock_id = x.follows_flock_id AND sm.member_id = x.created_by AND sm.again = 1)
    ORDER BY x.event_starts_at`).bind(memberId, now).all<FlockRow & { started_by: string; from_title: string }>();
  return results;
}

export type FlockInput = { meetingPlace: string; meetingAt: number; note: string | null; maxSize: number; followsFlockId: string | null };

export type FlockError = "event_closed" | "already_in_flock" | "too_many" | "full" | "closed" | "not_member" | "not_host" | "too_small" | "not_eftermoede";

export async function createFlock(db: D1Database, event: { id: string; starts_at: number; status: string }, memberId: string, input: FlockInput, now: number): Promise<{ id: string } | { error: FlockError }> {
  if (event.status !== "scheduled" || event.starts_at <= now) return { error: "event_closed" };
  if (await memberFlockForEvent(db, event.id, memberId)) return { error: "already_in_flock" };
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM flocks WHERE created_by = ? AND created_at > ?").bind(memberId, now - 86_400_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= CREATED_PER_DAY) return { error: "too_many" };
  if (input.followsFlockId) {
    const ok = await db.prepare("SELECT 1 AS ok FROM flock_members WHERE flock_id = ? AND member_id = ? AND left_at IS NULL AND again = 1")
      .bind(input.followsFlockId, memberId).first<{ ok: number }>();
    if (!ok) return { error: "not_eftermoede" };
  }
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO flocks (id, event_id, created_by, meeting_place, meeting_at, note, max_size, follows_flock_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
      .bind(id, event.id, memberId, input.meetingPlace, input.meetingAt, input.note, input.maxSize, input.followsFlockId, now, now),
    db.prepare("INSERT INTO flock_members (flock_id, member_id, joined_at) VALUES (?, ?, ?)").bind(id, memberId, now)
  ]);
  return { id };
}

export async function joinFlock(db: D1Database, f: FlockRow, memberId: string, now: number): Promise<{ ok: true } | { error: FlockError }> {
  if (f.status !== "open") return { error: "closed" };
  if (f.event_status !== "scheduled" || f.event_starts_at <= now) return { error: "event_closed" };
  if (f.is_member) return { ok: true };
  if (await memberFlockForEvent(db, f.event_id, memberId)) return { error: "already_in_flock" };
  if (isFull(f)) return { error: "full" };
  await db.prepare(`INSERT INTO flock_members (flock_id, member_id, joined_at) VALUES (?, ?, ?)
    ON CONFLICT (flock_id, member_id) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, again = NULL`).bind(f.id, memberId, now).run();
  return { ok: true };
}

/** Leaves a flock. A flock nobody is left in closes. */
export async function leaveFlock(db: D1Database, f: FlockRow, memberId: string, now: number): Promise<{ ok: true } | { error: FlockError }> {
  if (!f.is_member) return { error: "not_member" };
  await db.batch([
    db.prepare("UPDATE flock_members SET left_at = ? WHERE flock_id = ? AND member_id = ? AND left_at IS NULL").bind(now, f.id, memberId),
    db.prepare(`UPDATE flocks SET status = 'closed', updated_at = ? WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM flock_members WHERE flock_id = ? AND left_at IS NULL)`).bind(now, f.id, f.id)
  ]);
  return { ok: true };
}

/** Eftermødet: whether the member wants to find something to do together again. */
export async function setAgain(db: D1Database, f: FlockRow, memberId: string, again: boolean): Promise<{ ok: true } | { error: FlockError }> {
  if (!f.is_member) return { error: "not_member" };
  await db.prepare("UPDATE flock_members SET again = ? WHERE flock_id = ? AND member_id = ? AND left_at IS NULL").bind(again ? 1 : 0, f.id, memberId).run();
  return { ok: true };
}

export async function updateFlock(db: D1Database, f: FlockRow, memberId: string, input: Omit<FlockInput, "followsFlockId">, now: number): Promise<{ ok: true } | { error: FlockError }> {
  if (!f.is_member) return { error: "not_member" };
  if (await flockHost(db, f) !== memberId) return { error: "not_host" };
  if (input.maxSize < f.member_count) return { error: "too_small" };
  await db.prepare("UPDATE flocks SET meeting_place = ?, meeting_at = ?, note = ?, max_size = ?, updated_at = ? WHERE id = ?")
    .bind(input.meetingPlace, input.meetingAt, input.note, input.maxSize, now, f.id).run();
  return { ok: true };
}

/** Open flocks for coming events that still have room, soonest first: the public "Find en flok" list. */
export async function upcomingFlocks(db: D1Database, regions: string[], now: number, limit = 30): Promise<FlockRow[]> {
  const { results } = await db.prepare(`${FLOCK_SELECT} WHERE f.status = 'open' AND e.status = 'scheduled' AND e.starts_at > ?2
    AND e.region IN (${regions.map((_, i) => `?${i + 4}`).join(",")})
    ORDER BY f.meeting_at LIMIT ?3`).bind("", now, limit, ...regions).all<FlockRow>();
  return results.filter(f => f.member_count > 0 && f.member_count < f.max_size);
}
