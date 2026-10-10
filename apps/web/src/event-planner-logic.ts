import { calculate, crossesBand, type CalcResult } from "../worker/beregner/quote";

/** The member's event planner (requested): one date from a date picker, the day's overview next to it, the times as
 * choices, and the room's price for each kind of rent. An event is always one day, so it ends by midnight at the latest.
 * Everything here is plain functions, so the rules can be tested without a browser. */

export type RentType = "standard" | "reduced" | "free";
/** setup and cleanup: minutes the room is taken before and after the event (0, 30 or 60). The rent, the rules and the
 * busy check go by that whole window. Requested: the room must be ready before the guests come and tidy after they leave. */
export type Plan = { date: string; start: string; end: string; type: RentType; setup: number; cleanup: number };
export type DayEntry = { startsAt: string; endsAt: string; label: string; own: boolean; external: boolean; waiting: boolean; id?: number };
export type Cell = { date: string; inMonth: boolean };

export const FIRST_HOUR = 8;
export const LAST_HOUR = 24;
export const MIN_MINUTES = 120;
export const MAX_MINUTES = 600;
export const EVENING_FROM = 18 * 60 + 30;
/** The shortest event itself; the room is still rented for at least MIN_MINUTES with setup and cleanup. */
export const MIN_EVENT_MINUTES = 60;
export const BUFFER_CHOICES = [0, 30, 60] as const;
export const DEFAULT_BUFFER = 30;
export const bufferText = (minutes: number): string => minutes === 0 ? "Ingen" : minutes === 60 ? "1 time" : `${minutes} min.`;

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
export const todayKey = (now = new Date()) => dateKey(now.getFullYear(), now.getMonth(), now.getDate());
export const minutesOf = (clock: string): number => { const m = /^(\d{2}):(\d{2})$/.exec(clock); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const clockOf = (minutes: number): string => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
/** "14.00" as Danes write it; midnight at the end of the day reads "24.00". */
export const danishClock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}`;
export const hoursText = (minutes: number): string => `${String(minutes / 60).replace(".", ",")} ${minutes === 60 ? "time" : "timer"}`;

function parts(key: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(y, mo, d);
  return check.getFullYear() === y && check.getMonth() === mo && check.getDate() === d ? [y, mo, d] : null;
}

export function weekdayOf(key: string): number { const p = parts(key); return p ? new Date(p[0], p[1], p[2]).getDay() : NaN; }
export function localMidnightMs(key: string): number { const p = parts(key); return p ? new Date(p[0], p[1], p[2]).getTime() : NaN; }
export function longDay(key: string): string {
  const p = parts(key);
  if (!p) return "";
  const text = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date(p[0], p[1], p[2]));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export const monthTitle = (year: number, month: number): string => {
  const text = new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/** The month as weeks, Monday first, with the days of the neighbouring months that fill the first and last week. */
export function monthGrid(year: number, month: number): Cell[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const total = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const cells: Cell[] = [];
  for (let i = 0; i < total; i += 1) {
    const day = new Date(year, month, 1 - lead + i);
    cells.push({ date: dateKey(day.getFullYear(), day.getMonth(), day.getDate()), inMonth: day.getMonth() === month });
  }
  return Array.from({ length: total / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Starting times: every half hour, as late as a two-hour event can still end by midnight. */
export function startOptions(): string[] {
  const options: string[] = [];
  for (let m = FIRST_HOUR * 60; m <= LAST_HOUR * 60 - MIN_MINUTES; m += 30) options.push(clockOf(m));
  return options;
}
/** The event's shortest and longest end for a start, so the room is rented 2-10 hours with setup and cleanup, and the
 * cleanup is done by midnight (no overnight events). */
export function endRange(from: number, setup = 0, cleanup = 0): { min: number; max: number } {
  return { min: from + Math.max(MIN_EVENT_MINUTES, MIN_MINUTES - setup - cleanup), max: Math.min(from + MAX_MINUTES - setup - cleanup, LAST_HOUR * 60 - cleanup) };
}
/** Ending times for a start, in half hours. */
export function endOptions(start: string, setup = 0, cleanup = 0): string[] {
  const from = minutesOf(start);
  if (!Number.isFinite(from)) return [];
  const { min, max } = endRange(from, setup, cleanup);
  const options: string[] = [];
  for (let m = min; m <= max; m += 30) options.push(m === 24 * 60 ? "24:00" : clockOf(m));
  return options;
}
export const clockOrMidnight = (minutes: number): string => minutes === 24 * 60 ? "24:00" : clockOf(minutes);
export const endMinutes = (end: string): number => end === "24:00" ? 24 * 60 : minutesOf(end);

/** A moment of a day as a local Date; 24:00 is the midnight that ends the day. */
export function atLocal(key: string, minutes: number): Date {
  const p = parts(key);
  return p ? new Date(p[0], p[1], p[2], Math.floor(minutes / 60), minutes % 60) : new Date(NaN);
}

/** An entry of the day as clock minutes (0-1440) of that day; null when it does not touch the day. */
export function entryMinutes(entry: Pick<DayEntry, "startsAt" | "endsAt">, key: string): { from: number; to: number } | null {
  const s = new Date(entry.startsAt), e = new Date(entry.endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const startKey = todayKey(s), endKey = todayKey(e);
  const from = startKey < key ? 0 : startKey === key ? s.getHours() * 60 + s.getMinutes() : 24 * 60;
  const to = endKey > key ? 24 * 60 : endKey === key ? e.getHours() * 60 + e.getMinutes() : 0;
  return to > from ? { from, to } : null;
}

export function busyDuring(entries: DayEntry[], key: string, from: number, to: number): DayEntry[] {
  return entries.filter((entry) => { const range = entryMinutes(entry, key); return range !== null && range.from < to && range.to > from; });
}

/** The first start from 10.00 where an event of the given length (with its setup and cleanup) fits between the day's
 * entries; null when the day is full. */
export function firstFreeStart(entries: DayEntry[], key: string, length = MIN_MINUTES, setup = 0, cleanup = 0): string | null {
  for (let m = 10 * 60; m + length + cleanup <= LAST_HOUR * 60; m += 30) if (!busyDuring(entries, key, m - setup, m + length + cleanup).length) return clockOf(m);
  return null;
}

/** The time the room is taken, as clock minutes of the day. */
export function windowOf(plan: Pick<Plan, "start" | "end" | "setup" | "cleanup">): { from: number; to: number } {
  return { from: minutesOf(plan.start) - (plan.setup ?? 0), to: endMinutes(plan.end) + (plan.cleanup ?? 0) };
}

export type Problem = "no_date" | "past" | "too_short" | "too_long" | "too_late" | "crosses_evening" | "busy";
/** What is wrong with the chosen day and time, in the order a person should fix it. */
export function planProblem(plan: Plan, entries: DayEntry[], now = new Date()): Problem | null {
  if (!plan.date || !Number.isFinite(weekdayOf(plan.date))) return "no_date";
  const from = minutesOf(plan.start), to = endMinutes(plan.end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "no_date";
  const room = windowOf(plan);
  if (atLocal(plan.date, room.from).getTime() <= now.getTime()) return "past";
  if (to - from < MIN_EVENT_MINUTES || room.to - room.from < MIN_MINUTES) return "too_short";
  if (room.to - room.from > MAX_MINUTES) return "too_long";
  if (room.from < 0 || room.to > LAST_HOUR * 60) return "too_late";
  if (crossesBand({ day: weekdayOf(plan.date), start: clockOf(room.from), hours: (room.to - room.from) / 60, type: plan.type })) return "crosses_evening";
  if (busyDuring(entries, plan.date, room.from, room.to).length) return "busy";
  return null;
}

export const PROBLEM_TEXT: Record<Problem, string> = {
  no_date: "Vælg en dato.",
  past: "Tidspunktet ligger i fortiden.",
  too_short: "Salen lejes mindst 2 timer med klargøring og oprydning, og selve eventet varer mindst 1 time.",
  too_long: "Salen lejes højst 10 timer med klargøring og oprydning.",
  too_late: "Oprydningen skal være færdig senest kl. 24.00.",
  crosses_evening: "Med reduceret pris eller gratis leje kan en booking på en hverdag ikke gå hen over kl. 18.30 - klargøring og oprydning medregnet. Læg den helt før eller helt efter - eller vælg standardpris.",
  busy: "Tiden overlapper noget, der allerede er i salen - klargøring og oprydning medregnet."
};

export type Quote = { totalKr: number; lines: string[] } | null;
const kr = (n: number) => `${n.toLocaleString("da-DK")} kr.`;
/** The room's rent for one kind of rent for the time the room is taken, with what it is made of. Null when the time cannot be priced. */
export function quoteForPlan(plan: Plan, type: RentType): Quote {
  const room = windowOf(plan);
  if (!Number.isFinite(room.from) || !Number.isFinite(room.to) || room.from < 0 || room.to > 24 * 60) return null;
  return quoteFor(plan.date, clockOf(room.from), clockOrMidnight(room.to), type);
}
/** The room's rent for one kind of rent at the given time, with what it is made of. Null when the time cannot be priced. */
export function quoteFor(date: string, start: string, end: string, type: RentType): Quote {
  const day = weekdayOf(date), from = minutesOf(start), to = endMinutes(end);
  if (!Number.isFinite(day) || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const hours = (to - from) / 60;
  if (hours < 2 || hours > 10 || Math.round(hours * 2) !== hours * 2) return null;
  if (crossesBand({ day, start, hours, type })) return null;
  let result: CalcResult;
  try { result = calculate({ day, start, hours, type, memberPrice: null }); } catch { return null; }
  const lines: string[] = [];
  if (type === "standard") lines.push("Fast pakkepris for varigheden, samme pris hele døgnet.");
  else if (type === "reduced") {
    lines.push(`${kr(result.firstTwoKr ?? 0)} for de første 2 timer${result.extraHours ? ` + ${String(result.extraHours).replace(".", ",")} × ${kr(result.extraRateKr ?? 0)}` : ""} = ${kr(result.baseKr)}`);
    if (result.discountKr) lines.push(`Kampagnerabat ${result.discountPercent} %: −${kr(result.discountKr)}`);
    lines.push(result.band === "A" ? "Aftentakst (hverdage fra 18.30 og weekender)." : "Dagtakst (hverdage før 18.30).");
  } else lines.push("Hjerterum tager ikke betaling for salen; medlemmer deltager gratis.");
  return { totalKr: result.totalKr, lines };
}
export const priceText = (quote: Quote): string => quote ? (quote.totalKr === 0 ? "0 kr." : kr(quote.totalKr)) : "-";

export const RENT_TYPES: Array<{ id: RentType; name: string; text: string }> = [
  { id: "standard", name: "Standard", text: "Fast pris, ingen medlemsrabat" },
  { id: "reduced", name: "Reduceret", text: "Medlemmer betaler mindre end ikke-medlemmer" },
  { id: "free", name: "Gratis leje", text: "Medlemmer deltager gratis" }
];

/** A Plan from an existing booking's start and end (local time), for editing. */
export function planFromBooking(startsAt: string, endsAt: string, type: RentType, setup = 0, cleanup = 0): Plan {
  const s = new Date(startsAt), e = new Date(endsAt);
  const key = todayKey(s);
  const endKey = todayKey(e);
  const end = endKey > key ? "24:00" : clockOf(e.getHours() * 60 + e.getMinutes());
  return { date: key, start: clockOf(s.getHours() * 60 + s.getMinutes()), end, type, setup, cleanup };
}
/** The instants the server wants, from the plan's local date and times. */
export function planInstants(plan: Plan): { startsAt: string; endsAt: string } {
  return { startsAt: atLocal(plan.date, minutesOf(plan.start)).toISOString(), endsAt: atLocal(plan.date, endMinutes(plan.end)).toISOString() };
}
