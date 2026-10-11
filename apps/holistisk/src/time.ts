/** Danish time. Every instant is stored as UTC epoch milliseconds; wall-clock times are always read and written in
 * an explicit IANA zone (Europe/Copenhagen by default), so summer and winter time follow the zone's rules. */
export const TIMEZONE = "Europe/Copenhagen";

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function wallClock(ms: number, timeZone = TIMEZONE): WallClock {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

/** The zone's offset from UTC at an instant, in milliseconds (+2h in Danish summer, +1h in winter). */
export function offsetMs(ms: number, timeZone = TIMEZONE): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in a zone to the UTC instant. In the autumn hour that occurs twice the earlier one is used; a time
 * in the skipped spring hour moves forward by the gap, as calendar programs do. */
export function zonedToUtc(w: Omit<WallClock, "second"> & { second?: number }, timeZone = TIMEZONE): number {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
  const before = asUtc - offsetMs(asUtc - 12 * 3600_000, timeZone);
  const after = asUtc - offsetMs(asUtc + 12 * 3600_000, timeZone);
  const valid = [before, after].filter(t => t + offsetMs(t, timeZone) === asUtc);
  return valid.length ? Math.min(...valid) : before;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** "2026-10-11" for the zone's calendar day. */
export function localDate(ms: number, timeZone = TIMEZONE): string {
  const w = wallClock(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** ISO 8601 with the zone's offset, e.g. 2026-10-11T15:30:00+02:00 (for schema.org and iCalendar export). */
export function isoWithOffset(ms: number, timeZone = TIMEZONE): string {
  const w = wallClock(ms, timeZone);
  const off = Math.round(offsetMs(ms, timeZone) / 60_000);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "2026-10-11" (a local calendar day) to the UTC instant of its midnight in the zone. Null for anything else. */
export function startOfLocalDay(date: string, timeZone = TIMEZONE): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/** The local calendar day after a given one ("2026-10-31" -> "2026-11-01"). */
export function nextLocalDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Day of week for a local date, 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// Danish names written out here, so labels are the same in every runtime regardless of its ICU data.
const WEEKDAYS = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
export const monthName = (month: number): string => MONTHS[month - 1] ?? "";

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const hhmm = (ms: number, timeZone = TIMEZONE): string => {
  const w = wallClock(ms, timeZone);
  return `${pad(w.hour)}.${pad(w.minute)}`;
};

/** "lørdag 11. oktober" (with the year when it is not the current one). */
export function dayLabel(ms: number, now: number): string {
  const w = wallClock(ms);
  const label = `${WEEKDAYS[weekdayIndex(localDate(ms))]} ${w.day}. ${MONTHS[w.month - 1]}`;
  return w.year === wallClock(now).year ? label : `${label} ${w.year}`;
}

/** The pieces of a calendar-leaf date badge: "lør", "11", "okt". */
export function dateBadge(ms: number): { weekday: string; day: string; month: string } {
  const w = wallClock(ms);
  return { weekday: WEEKDAYS[weekdayIndex(localDate(ms))]!.slice(0, 3), day: String(w.day), month: MONTHS[w.month - 1]!.slice(0, 3) };
}

/** "kl. 15.30–18.00", or a day span when the event runs over several days. */
export function timeRangeLabel(start: number, end: number | null, allDay: boolean, now: number): string {
  if (allDay) {
    if (end && localDate(end - 1) !== localDate(start)) return `${dayLabel(start, now)} – ${dayLabel(end - 1, now)}`;
    return "Hele dagen";
  }
  if (!end) return `kl. ${hhmm(start)}`;
  if (localDate(end) !== localDate(start)) return `${dayLabel(start, now)} kl. ${hhmm(start)} – ${dayLabel(end, now)} kl. ${hhmm(end)}`;
  return `kl. ${hhmm(start)}–${hhmm(end)}`;
}
