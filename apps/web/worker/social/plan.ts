import { listTitle, type NewsletterEvent } from "../newsletter.js";

/** Requested: "Dele 7-10 begivenheder pr uge direkte på fb, bare med et lille opslag" and "ugens events på SoMe". The week's plan, worked
 * out without AI: which events get their own little post on Facebook, when each goes out, and when "Ugens events" goes out. */

const TZ = "Europe/Copenhagen";
/** Requested (the chair, 3 Nov 2026): "Kan vi systematisk sørge for at alle events deles mindst én gang" - every event of the week gets its own post
 * (a class that runs several times a week, once a week). WEEK_MAX is no longer a limit; it is kept for the order of "Ugens events"' pictures. */
export const WEEK_MIN = 7;
export const WEEK_MAX = 10;
export const EVERY_EVENT = Number.POSITIVE_INFINITY;
export const SITE = "https://www.hjerterum.info";
/** The slots a single event's post may go out in (Danish time), at most three a day (now that every event gets one). Gitta (3 Nov 2026): what she shares "omkring 3-4-5 sidst på
 * eftermiddagen" gets the most views, though Meta recommends later in the evening - and the chair: "Ja" to posting between 15 and 17. */
export const POST_HOURS: Array<[number, number]> = [[15, 0], [16, 0], [17, 0]];
/** "Ugens events" goes out on the Monday afternoon of its week. */
export const WEEK_POST_AT: [number, number] = [15, 30];
/** The plan for next week is made on Thursday from 10.00, so the chair has days to read and approve it. */
export const PLAN_WEEKDAY = 4;
export const PLAN_FROM_HOUR = 10;

const DAY = 86_400_000;
const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
  .formatToParts(ms).map(p => [p.type, p.value])) as Record<string, string>;
/** "2026-11-09" for a moment's Danish date. */
export const dateOf = (ms: number) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
/** 1 (Monday) to 7 (Sunday), in Danish time. */
export const weekdayOf = (ms: number) => WEEKDAYS[parts(ms).weekday ?? "Mon"] ?? 1;
export const hourOf = (ms: number) => Number(parts(ms).hour) % 24;

/** A Danish clock time on a Danish date, as ms (the offset is +1 or +2). */
export function at(date: string, hour: number, minute = 0): number {
  const hh = String(hour).padStart(2, "0"), mm = String(minute).padStart(2, "0");
  for (const offset of [1, 2]) {
    const ms = Date.parse(`${date}T${hh}:${mm}:00+0${offset}:00`);
    const p = parts(ms);
    if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) % 24 === hour && Number(p.minute) === minute) return ms;
  }
  return Date.parse(`${date}T${hh}:${mm}:00Z`);
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The Monday (Danish date) of the week a moment lies in. */
export const mondayOf = (ms: number) => addDays(dateOf(ms), 1 - weekdayOf(ms));
/** The first moment of the week (Monday 00.00, Danish time). */
export const weekStart = (monday: string) => at(monday, 0);
/** "2026-W46": the ISO week of a Monday. */
export function weekKey(monday: string): string {
  const d = new Date(Date.parse(`${monday}T12:00:00Z`) + 3 * DAY); // that week's Thursday decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export const weekNumber = (key: string) => Number(key.slice(6));
/** The Monday of next week. */
export const nextMonday = (ms: number) => addDays(mondayOf(ms), 7);

/** Whether it is time to plan next week: Thursday from 10.00, or later in the week (Friday to Sunday) if the plan was not made then. */
export function planDue(nowMs: number): boolean {
  const day = weekdayOf(nowMs);
  return day > PLAN_WEEKDAY || (day === PLAN_WEEKDAY && hourOf(nowMs) >= PLAN_FROM_HOUR);
}

// ---- Which events ----

const sameTitle = (e: NewsletterEvent) => listTitle(e.title).toLocaleLowerCase("da-DK");

/** 7-10 of the week's events, each with its own post: one per title (a weekly class once, not every time), and the most worth telling
 * about first - those the board has wished PR for, then workshops and the like over the morning programme, then those with a picture and a teacher.
 * Fewer than seven only when the week has fewer. Returned in time order. */
export function pickWeekEvents(events: NewsletterEvent[], wished: Set<string>, max = WEEK_MAX): NewsletterEvent[] {
  const seen = new Set<string>();
  const distinct = [...events].sort((a, b) => a.startsMs - b.startsMs).filter(e => { const t = sameTitle(e); if (seen.has(t)) return false; seen.add(t); return true; });
  const score = (e: NewsletterEvent) => (wished.has(e.key) ? 8 : 0) + (e.mornings ? 0 : 4) + (e.imageUrl ? 2 : 0) + (e.host ? 1 : 0);
  return distinct.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map(x => x.e).sort((a, b) => a.startsMs - b.startsMs);
}

// ---- When ----

/** When each event's post goes out: a free slot (15.00, 16.00 or 17.00) the day before, else two or three days before, else the morning of the day -
 * never after the event has begun, never before `notBeforeMs`, and never two posts in one slot. */
export function eventPostTimes(events: NewsletterEvent[], notBeforeMs: number, alreadyTaken: number[] = []): number[] {
  const taken = new Set<number>(alreadyTaken);
  return events.map(e => {
    const day = dateOf(e.startsMs);
    for (const back of [1, 2, 3, 0]) {
      for (const [h, m] of POST_HOURS) {
        const slot = at(addDays(day, -back), h, m);
        if (slot < notBeforeMs || slot > e.startsMs - 2 * 3_600_000 || taken.has(slot)) continue;
        taken.add(slot);
        return slot;
      }
    }
    // No slot: as soon as may be, but before it begins.
    return Math.max(notBeforeMs, Math.min(e.startsMs - 3_600_000, at(day, 8)));
  });
}

export const weekPostTime = (monday: string, notBeforeMs: number) => Math.max(notBeforeMs, at(monday, ...WEEK_POST_AT));

// ---- Words without Saga ----

const DAYS = ["", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
const SHORT = ["", "MAN.", "TIRS.", "ONS.", "TORS.", "FRE.", "LØR.", "SØN."];
export const clock = (ms: number) => { const p = parts(ms); return `${p.hour}.${p.minute}`; };
export const dayName = (ms: number) => DAYS[weekdayOf(ms)]!;
const dayMonth = (ms: number) => { const p = parts(ms); return `${Number(p.day)}/${Number(p.month)}`; };

/** "Workshop: Indre barn med Steven - torsdag kl. 19.00. Læs mere og tilmeld dig via linket." */
export function plainEventText(e: NewsletterEvent): string {
  return `${listTitle(e.title)}${e.host ? ` med ${e.host}` : ""} - ${dayName(e.startsMs)} kl. ${clock(e.startsMs)}. Læs mere og tilmeld dig via linket.`;
}
export const PLAIN_WEEK_INTRO = "Her er ugens events i Hjerterum. Vi glæder os til at se dig.";

/** The list under "Ugens events": one line per event, as the newsletter writes them ("TORS. 12/11 · 19.00 · Indre barn (Steven)"). */
export function weekList(events: NewsletterEvent[]): string {
  return events.map(e => `${SHORT[weekdayOf(e.startsMs)]} ${dayMonth(e.startsMs)} · ${clock(e.startsMs)} · ${listTitle(e.title)}${e.host ? ` (${e.host})` : ""}`).join("\n");
}

/** "Ugens events" in full: Saga's words, the week's list and where to read more (Instagram has no links in the text, so it points to the bio). */
export function weekText(key: string, intro: string, events: NewsletterEvent[], network: "facebook" | "instagram"): string {
  return `Ugens events i Hjerterum · uge ${weekNumber(key)}\n\n${intro.trim()}\n\n${weekList(events)}\n\n${network === "facebook" ? `Se alle events og tilmeld dig: ${SITE}/events` : "Se alle events og tilmeld dig på hjerterum.info/events (link i bio)."}`;
}
