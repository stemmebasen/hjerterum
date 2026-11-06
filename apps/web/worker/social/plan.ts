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
/** The slots a single event's post may go out in (Danish time). First (3 Nov 2026) 15.00-17.00, from Gitta: what she shares "omkring 3-4-5 sidst på
 * eftermiddagen" gets the most views, though Meta recommends later in the evening. Then the chair: "Men hvad siger forskningen i forhold til de gode
 * tidspunkter? Jeg tænker sagtens, at vi kan strække os ud over de timer." The big studies disagree (Buffer 2025: weekday afternoons around 15; Buffer
 * 2026: 9, 12 and 18; Sprout Social: late morning to afternoon; all: never at night), so the day is spread over morning, lunch, Gitta's afternoon and
 * the evening - at most three a day, two and a half hours apart, spread evenly over the days (eventPostTimes). The insight page shows what works. */
export const POST_HOURS: Array<[number, number]> = [[9, 0], [12, 0], [15, 0], [17, 0], [19, 30]];
export const POSTS_PER_DAY = 3;
/** Within a day: Gitta's afternoon first, then lunch, then the evening (2.5 hours apart, so three a day fill 12, 15 and 19.30). */
const DAY_ORDER: Array<[number, number]> = [[15, 0], [12, 0], [19, 30], [9, 0], [17, 0]];
/** How many of the first possible days a post is spread over. */
export const BALANCE_DAYS = 4;
/** Three hours apart on a medium (the chair, 5 Nov 2026: "Det er muligt at skabe meget mere luft imellem tidspunkterne") - so a day's three are 9, 12 and 15, or
 * 12, 15 and 19.30, never 15 and 17. */
export const POST_GAP_MS = 3 * 3_600_000;
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

/** Requested (the chair, 5 Nov 2026): "Medlemscafeen promoveres ikke på selve dagen men senest dagen før. Det gælder for alle events." The last
 * moment an event's post may go out: the end of the day before (Danish time). */
export const lastPostMs = (startsMs: number) => Math.min(at(addDays(dateOf(startsMs), -1), 23, 59), startsMs - 2 * 3_600_000);

/** Requested (the chair, 3 Nov 2026): "Det er også helt forkert, at der først skal fortælles om eventet dagen før. Det bør optimalt set være hurtigst
 * muligt." When each event's post goes out: the first free slot (POST_HOURS) from `earliest[i]` (else `notBeforeMs`) on,
 * the events nearest in time first - never after it has begun (two hours before at the latest), never before `notBeforeMs`, and never two posts in one
 * slot. Returned in the order given. */
export function eventPostTimes(events: NewsletterEvent[], notBeforeMs: number, alreadyTaken: number[] = [], earliest: number[] = [], latest: number[] = [], strict: boolean[] = [], avoid: number[] = []): number[] {
  const taken = new Set<number>(alreadyTaken);
  // Times the other medium has (Instagram's post never at the same minute as another event's on Facebook).
  const busy = new Set<number>(avoid);
  const out: number[] = new Array(events.length);
  // The post that must go out first is placed first (a narrow window - "to shouts" - before a wide one), then by the event's time.
  const deadline = (i: number) => Math.min(lastPostMs(events[i]!.startsMs), latest[i] ?? Number.POSITIVE_INFINITY);
  const order = events.map((e, i) => i).sort((a, b) => deadline(a) - deadline(b) || events[a]!.startsMs - events[b]!.startsMs);
  for (const i of order) {
    const e = events[i]!, from = Math.max(notBeforeMs, earliest[i] ?? 0), last = deadline(i);
    // Asked: "Det virker heller ikke så balanceret, at der bliver udsendt fem på én dag, tre den næste og så kun én dagene efter." The first few days
    // the post could go out on, and of those the day with the fewest posts (the earliest of equals) - soon, and evenly.
    const candidates: Array<{ slot: number; count: number }> = [];
    for (let day = dateOf(from); candidates.length < BALANCE_DAYS && at(day, 0) <= last; day = addDays(day, 1)) {
      const same = [...taken].filter(t => dateOf(t) === day);
      if (same.length >= POSTS_PER_DAY) continue;
      const free = DAY_ORDER.map(([h, m]) => at(day, h, m)).find(t => t >= from && t <= last && !busy.has(t) && same.every(o => Math.abs(o - t) >= POST_GAP_MS));
      if (free !== undefined) candidates.push({ slot: free, count: same.length });
    }
    const slot = candidates.length ? candidates.reduce((best, c) => c.count < best.count ? c : best).slot : null;
    // No free slot by the day before: the first of the day's times that is still in time (even a fourth that day) - never a time in the night -
    // and only when there is none (an event put in the calendar on its own day), as soon as may be.
    // A time nobody has first (a narrow window - "to shouts" - can be full), else the first that is in time.
    const anyTime = (() => { let first: number | null = null; for (let day = dateOf(from); at(day, 0) <= last; day = addDays(day, 1))
      for (const [h, m] of POST_HOURS) { const t = at(day, h, m); if (t >= from && t <= last) { if (!taken.has(t)) return t; first ??= t; } } return first; })();
    // Strict (a first post that may give way to the reminder): no time inside the day's three, no time at all (NaN) - never an extra.
    if (strict[i] && slot === null) { out[i] = Number.NaN; continue; }
    // Reported (the chair, 5 Nov 2026): "Der er tre forskellige events, der bliver publiceret på samme tidspunkt ... 0:30" - the last way out is the next of the
    // day's times before the event, never a time in the night.
    const nextTime = (() => { for (let day = dateOf(from); at(day, 0) < e.startsMs; day = addDays(day, 1))
      for (const [h, m] of POST_HOURS) { const t = at(day, h, m); if (t >= from && t <= e.startsMs - 2 * 3_600_000) return t; } return null; })();
    out[i] = slot ?? anyTime ?? nextTime ?? Math.max(notBeforeMs, Math.min(e.startsMs - 3_600_000, from));
    taken.add(out[i]!);
  }
  return out;
}
/** Requested (the chair, 4 Nov 2026: "Og så kan man jo argumentere for, at et event publiceres på forskellige tidspunkter på de to medier." - asked
 * whether Saga should propose different times as a rule, "Ja"): each event's Instagram post at its own time, at least POST_GAP_MS after Facebook's,
 * spread over Instagram's own days the same way (alreadyTaken: Instagram's times). Where there is no such time before the event, the same as Facebook. */
export function instagramPostTimes(events: NewsletterEvent[], facebookTimes: number[], notBeforeMs: number, alreadyTaken: number[] = [], latest: number[] = [], facebookTaken: number[] = []): number[] {
  const avoid = [...facebookTimes, ...facebookTaken];
  // The chair (5 Nov 2026): "Et event må gerne komme på de forskellige platforme på forskellige dage, så det ikke alt sammen sker på nøjagtig samme dag" -
  // Instagram's from the day after Facebook's, when its window has room; else the same day, three hours after.
  const nextDay = facebookTimes.map(t => at(addDays(dateOf(t), 1), 0));
  const first = eventPostTimes(events, notBeforeMs, alreadyTaken, nextDay, latest, events.map(() => true), avoid);
  const sameDay = facebookTimes.map(t => t + POST_GAP_MS);
  const idx = events.map((_, i) => i).filter(i => Number.isNaN(first[i]!));
  const again = idx.length ? eventPostTimes(idx.map(i => events[i]!), notBeforeMs, [...alreadyTaken, ...first.filter(t => !Number.isNaN(t))], idx.map(i => sameDay[i]!), idx.map(i => latest[i] ?? Number.POSITIVE_INFINITY), [], avoid) : [];
  const times = [...first]; idx.forEach((i, k) => { times[i] = again[k]!; });
  return times.map((t, i) => t >= sameDay[i]! && t <= Math.min(lastPostMs(events[i]!.startsMs), latest[i] ?? Number.POSITIVE_INFINITY) && POST_HOURS.some(([h, m]) => at(dateOf(t), h, m) === t) ? t : facebookTimes[i]!);
}

/** Requested (the chair, 5 Nov 2026): "Hvert event får to shouts på hvert medie - 14-15 dage før og 7-8 dage før - altså i alt fire shouts (2 på insta og 2 på
 * facebook)". For an event put in the calendar later (asked, "Hurtigst muligt + 7 dage"): the first as soon as may be - at the latest ten days before, so the
 * two do not come together - and the second 7-9 days before; under that, one post as soon as may be. The windows an event's posts go out in, as seen now. */
export type ShoutWindow = { earliest: number; latest: number; late?: true };
export function shoutWindows(startsMs: number, nowMs: number): ShoutWindow[] {
  const day = dateOf(startsMs), from = nowMs + 30 * 60_000;
  const window = (first: number, last: number): ShoutWindow | null => { const latest = at(addDays(day, -last), 23, 59); return latest >= from ? { earliest: Math.max(from, at(addDays(day, -first), 0)), latest } : null; };
  // Widened by a day (the chair: "Det er også fint, hvis du udvider intervallerne med en dag"): 14-16 and 7-9 days before.
  const second = window(9, 7);
  const first = window(16, 14) ?? (second ? (() => { const latest = at(addDays(day, -10), 23, 59); return latest >= from ? { earliest: from, latest, late: true as const } : null; })() : null);
  if (first && second) return [first, second];
  if (second) return [second];
  return [{ earliest: from, latest: lastPostMs(startsMs) }];
}
/** Asked (the chair, 5 Nov 2026): "Hvorfor har du lagt så mange ind? Er det, fordi vi er i sidste øjeblik?" - the first post of an event that came late is only
 * made when there is room in the day's three; else the event has one post, a week before. The first posts' times (Facebook), and which events then
 * have only the one (their time in the reminder's window). */
export function placeFirsts(events: NewsletterEvent[], windows: ShoutWindow[][], notBeforeMs: number, taken: number[]): { times: number[]; single: boolean[]; latest: number[] } {
  // Every first post that has a reminder after it keeps to the day's three (found 6 Nov: the first plan put five on one day).
  const first = eventPostTimes(events, notBeforeMs, taken, windows.map(w => w[0]!.earliest), windows.map(w => w[0]!.latest), windows.map(w => w.length === 2));
  const single = first.map(t => Number.isNaN(t));
  if (!single.some(Boolean)) return { times: first, single, latest: windows.map(w => w[0]!.latest) };
  const idx = events.map((_, i) => i).filter(i => single[i]);
  const again = eventPostTimes(idx.map(i => events[i]!), notBeforeMs, [...taken, ...first.filter(t => !Number.isNaN(t))], idx.map(i => windows[i]![1]!.earliest), idx.map(i => windows[i]![1]!.latest));
  const times = [...first];
  idx.forEach((i, k) => { times[i] = again[k]!; });
  return { times, single, latest: windows.map((w, i) => single[i] ? w[1]!.latest : w[0]!.latest) };
}

/** "Faste hold" (asked how a weekly class should be told about: "Hver 4. uge"): a title told about in the three weeks around is only in "Ugens events". */
export const SERIES_GAP_MS = 21 * DAY;

/** A class that comes back (the same title in an earlier week) is told about in the week before each time, not all at once. */
export const REPEAT_LEAD_MS = 7 * DAY;

export const weekPostTime = (monday: string, notBeforeMs: number) => Math.max(notBeforeMs, at(monday, ...WEEK_POST_AT));

// ---- Words without Saga ----

const DAYS = ["", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
const SHORT = ["", "MAN.", "TIRS.", "ONS.", "TORS.", "FRE.", "LØR.", "SØN."];
export const clock = (ms: number) => { const p = parts(ms); return `${p.hour}.${p.minute}`; };
export const dayName = (ms: number) => DAYS[weekdayOf(ms)]!;
const dayMonth = (ms: number) => { const p = parts(ms); return `${Number(p.day)}/${Number(p.month)}`; };

const MONTH_NAMES = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
/** "lørdag d. 21. november" */
export const dayDate = (ms: number) => { const p = parts(ms); return `${dayName(ms)} d. ${Number(p.day)}. ${MONTH_NAMES[Number(p.month) - 1]}`; };
/** "lørdag d. 21. november kl. 10.30" */
export const longWhen = (ms: number) => `${dayDate(ms)} kl. ${clock(ms)}`;

/** Reported (the chair, 6 Nov 2026): "Det er en fejl, at der bare står lørdag klokken 10:30, da det først er lørdagen efter." An event's post goes out one
 * or two weeks before, so the day is always told with its date: the event's weekday in the text ("Lørdag kl. 10.30", "på lørdag") gets it, where it has
 * none already. */
export function withEventDate(text: string, startsMs: number): string {
  const day = dayName(startsMs), date = dayDate(startsMs).slice(day.length);
  // Told already ("lørdag d. 21. november", "lørdag den 21.", "lørdag 21/11").
  if (new RegExp(`${day}\\s*(?:d\\.|den)?\\s*\\d{1,2}\\s*[./]`, "iu").test(text)) return text;
  return text.replace(new RegExp(`(?<!\\p{L})(${day})(?!\\p{L})`, "iu"), (word: string) => `${word}${date}`);
}

/** "Workshop: Indre barn med Steven - torsdag d. 12. november kl. 19.00. Læs mere og tilmeld dig via linket." */
export function plainEventText(e: NewsletterEvent): string {
  return `${listTitle(e.title)}${e.host ? ` med ${e.host}` : ""} - ${longWhen(e.startsMs)}. Læs mere og tilmeld dig via linket.`;
}
export const PLAIN_WEEK_INTRO = "Her er ugens events i Hjerterum. Vi glæder os til at se dig.";

/** The list under "Ugens events": one line per event, as the newsletter writes them ("TORS. 12/11 · 19.00 · Indre barn (Steven)"). */
export function weekList(events: NewsletterEvent[]): string {
  return events.map(e => `${SHORT[weekdayOf(e.startsMs)]} ${dayMonth(e.startsMs)} · ${clock(e.startsMs)} · ${listTitle(e.title)}${e.host ? ` (${e.host})` : ""}`).join("\n");
}

/** "Ugens events" in full: Saga's words, the week's list and where to read more (Instagram has no links in the text, so it points to the bio). */
export function weekText(key: string, intro: string, events: NewsletterEvent[], network: "facebook" | "instagram"): string {
  return `Ugens events i Hjerterum · uge ${weekNumber(key)}\n\n${intro.trim()}\n\n${weekList(events)}\n\n${network === "facebook" ? `Se alle events og tilmeld dig: ${SITE}/events` : "Se alle events og tilmeld dig via linket i bio."}`;
}
