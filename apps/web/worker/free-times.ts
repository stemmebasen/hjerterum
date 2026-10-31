import { copenhagenMs } from "./cockpit/data.js";
import type { D1Database } from "./db.js";
import type { ExternalEvent } from "./external-events.js";
import { WINDOW_END, WINDOW_START } from "./room-bookings.js";

/** Reported: "Hun skal ikke forslå et tidspunkt der ikke er ledigt" - in "Opret med Saga" she suggested Thursday 26/11 19-21 and then
 * had to say it was taken. The times offered are now worked out here from the calendar, as the booking itself checks it: the
 * members' bookings with their setup and cleanup, and the house's own events; a time the member writes is checked the same way. */

export const BUFFER_MINUTES = 30;
export type Busy = ReadonlyArray<readonly [number, number]>;
export type FreeTime = { date: string; start: string; end: string; label: string };

const DAY = 86_400_000;
const ZONE = "Europe/Copenhagen";
const WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];

/** What occupies the hall between two instants: bookings (with setup and cleanup) and the house calendar's events. */
export async function busyWindows(db: D1Database, external: ExternalEvent[], fromMs: number, toMs: number): Promise<Busy> {
  const rows = await db.prepare(`SELECT ${WINDOW_START} AS f, ${WINDOW_END} AS t FROM room_bookings WHERE status = 'scheduled' AND ${WINDOW_START} < ? AND ${WINDOW_END} > ?`)
    .bind(toMs, fromMs).all<{ f: number; t: number }>().then(r => r.results ?? []).catch(() => []);
  const outside = external.map(e => { const s = Date.parse(e.startsAt), t = e.endsAt ? Date.parse(e.endsAt) : s; return [s, t] as const; })
    .filter(([s, t]) => Number.isFinite(s) && Number.isFinite(t) && s < toMs && t > fromMs);
  return [...rows.map(r => [r.f, r.t] as const), ...outside];
}

/** Whether the hall is free for the event with its setup and cleanup (the same rule as the booking). */
export function isFree(busy: Busy, date: string, start: string, end: string, buffer = BUFFER_MINUTES): boolean {
  const from = copenhagenMs(date, start) - buffer * 60_000, to = copenhagenMs(date, end) + buffer * 60_000;
  return !busy.some(([s, t]) => s < to && t > from);
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const short = (hhmm: string) => hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : `${Number(hhmm.slice(0, 2))}.${hhmm.slice(3)}`;
const dayParts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
  .formatToParts(ms).map(p => [p.type, p.value]));

export function timeLabel(date: string, start: string, end: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  return `${weekday} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))} kl. ${short(start)}-${short(end)}`;
}

/** The next free times, one a day, from tomorrow: weekday evenings and afternoons, weekend mornings, afternoons and evenings. */
export function freeTimes(busy: Busy, nowMs: number, minutes = 120, count = 5, days = 28): FreeTime[] {
  const out: FreeTime[] = [];
  for (let d = 1; d <= days && out.length < count; d++) {
    const p = dayParts(nowMs + d * DAY);
    const date = `${p.year}-${p.month}-${p.day}`;
    const weekend = p.weekday === "Sat" || p.weekday === "Sun";
    const starts = weekend ? [10 * 60, 14 * 60, 18 * 60] : [19 * 60, 16 * 60];
    for (const s of starts) {
      const start = clock(s), end = clock(Math.min(s + minutes, 23 * 60 + 30));
      if (copenhagenMs(date, start) - BUFFER_MINUTES * 60_000 <= nowMs) continue;
      if (isFree(busy, date, start, end)) { out.push({ date, start, end, label: timeLabel(date, start, end) }); break; }
    }
  }
  return out;
}

/** A time the way the buttons write it - "Tirsdag 24/11 kl. 19-21" - read without asking the model; the year is the next time
 * that day comes. Null when it is not written that way. */
export function readTimeChoice(text: string, nowMs: number): { date: string; start: string; end: string } | null {
  const m = /(\d{1,2})\/(\d{1,2})\D+?kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?/i.exec(text);
  if (!m) return null;
  const [day, month, sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5]), Number(m[6] ?? 0)];
  if (month < 1 || month > 12 || day < 1 || day > 31 || sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
  const today = dayParts(nowMs);
  let year = Number(today.year);
  if (`${year}-${pad(month)}-${pad(day)}` < `${today.year}-${today.month}-${today.day}`) year += 1;
  const start = `${pad(sh)}:${pad(sm)}`, end = `${pad(eh)}:${pad(em)}`;
  return end > start ? { date: `${year}-${pad(month)}-${pad(day)}`, start, end } : null;
}
