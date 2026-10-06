import type { D1Database } from "./db.js";

/** Requested: when a member picks a date for an event, show what is already on that day, so a free time is easy to pick.
 * The overview names an approved event or the member's own, and says only "Optaget" for everything else - another
 * member's event waiting for approval is not shown by its title. */

export type DayItem = {
  startsAt: string;
  endsAt: string;
  label: string;
  /** The member's own booking. */
  own: boolean;
  /** An event from the membership system's calendar, not a booking made here. */
  external: boolean;
  /** Waiting for approval: it already holds the time. */
  waiting: boolean;
};

export type ExternalDayEvent = { title: string; startsAt: string; endsAt?: string | null };

const TIME_ZONE = "Europe/Copenhagen";
const DAY_MS = 86_400_000;

function offsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - Math.floor(instant / 1000) * 1000;
}

/** Midnight at the start of a Copenhagen calendar day (YYYY-MM-DD), as milliseconds; null for anything that is not a real date. */
export function copenhagenMidnightMs(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const guess = Date.UTC(year, month - 1, day);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const first = offsetMs(guess);
  let utc = guess - first;
  const second = offsetMs(utc);
  if (second !== first) utc = guess - second;
  return utc;
}

/** The first and last moment (exclusive) of a Copenhagen day, so a day with a clock change still gets 23 or 25 hours. */
export function copenhagenDayRange(date: string): { fromMs: number; toMs: number } | null {
  const fromMs = copenhagenMidnightMs(date);
  if (fromMs === null) return null;
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const toMs = copenhagenMidnightMs(next);
  return toMs === null ? null : { fromMs, toMs };
}

type Row = { clerk_user_id: string; title: string; starts_at_ms: number; ends_at_ms: number; review_status: string | null };

export async function listDayItems(db: D1Database, userId: string, date: string, external: ExternalDayEvent[]): Promise<DayItem[] | null> {
  const range = copenhagenDayRange(date);
  if (!range) return null;
  const rows = (await db.prepare(
    `SELECT clerk_user_id, title, starts_at_ms, ends_at_ms, review_status FROM room_bookings
     WHERE status = 'scheduled' AND starts_at_ms < ? AND ends_at_ms > ? ORDER BY starts_at_ms ASC`
  ).bind(range.toMs, range.fromMs).all<Row>()).results ?? [];
  const bookings: DayItem[] = rows.map((row) => {
    const own = row.clerk_user_id === userId;
    const approved = (row.review_status ?? "approved") === "approved";
    return {
      startsAt: new Date(row.starts_at_ms).toISOString(), endsAt: new Date(row.ends_at_ms).toISOString(),
      label: own || approved ? row.title : "Optaget", own, external: false, waiting: !approved
    };
  });
  const outside: DayItem[] = external.flatMap((event) => {
    const start = Date.parse(event.startsAt);
    const end = event.endsAt ? Date.parse(event.endsAt) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < range.toMs && Math.max(end, start + 1) > range.fromMs)) return [];
    return [{ startsAt: new Date(start).toISOString(), endsAt: new Date(Math.max(end, start + 30 * 60_000)).toISOString(), label: event.title, own: false, external: true, waiting: false }];
  });
  return [...bookings, ...outside].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
