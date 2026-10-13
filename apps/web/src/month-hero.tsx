/** Requested: "Have a look at this PDF and come up with a suggestion on how we can make our web design a little bit more like it.
 * Especially this header picture is quite relevant" - "Prøv at deploye det". The front page opens like the monthly newsletter:
 * "Oktober / i Hjerterum" on a warm panel with three of the month's photos and a camel stripe, "Månedens events" and one line
 * about what not to miss; and under the next events, "Resten af oktober" as the newsletter's quiet list, week by week. */

export type MonthEvent = { key: string; title: string; startsAt: string; imageUrl: string | null; page?: string | null; link: string | null };

const ZONE = "Europe/Copenhagen";
const MONTH = new Intl.DateTimeFormat("da-DK", { month: "long", timeZone: ZONE });
const MONTH_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: ZONE });
const DAY_LINE = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "numeric", timeZone: ZONE });
const TIME = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });
const NOTE_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "numeric", timeZone: ZONE });

const capital = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
const monthKey = (ms: number) => MONTH_KEY.format(ms).slice(0, 7);
/** "TIRS. 13/10 · 15.00" - the newsletter's date line. */
export const dayLine = (iso: string) => {
  const ms = Date.parse(iso);
  const parts = DAY_LINE.formatToParts(ms);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("weekday").replace(/\.$/, "").toLocaleUpperCase("da-DK")}. ${get("day")}/${get("month")} · ${TIME.format(ms).replace(":", ".")}`;
};
/** ISO week number, in Copenhagen. */
export function isoWeek(iso: string): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(Date.parse(iso)).split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}

/** The month the front page is about: this month, or the next once only a few events are left in it. */
export function monthOf(events: MonthEvent[], now: number): { name: string; key: string; events: MonthEvent[] } {
  const upcoming = events.filter(e => Date.parse(e.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const thisKey = monthKey(now);
  const inThis = upcoming.filter(e => monthKey(Date.parse(e.startsAt)) === thisKey);
  const nextKey = upcoming.find(e => monthKey(Date.parse(e.startsAt)) !== thisKey);
  const useNext = inThis.length < 3 && nextKey;
  const key = useNext ? monthKey(Date.parse(nextKey.startsAt)) : thisKey;
  const ms = useNext ? Date.parse(nextKey.startsAt) : now;
  return { name: capital(MONTH.format(ms)), key, events: upcoming.filter(e => monthKey(Date.parse(e.startsAt)) === key) };
}

/** What is not to be missed, first: the general assembly ("Husk generalforsamling for medlemmer"), then the house's big evenings. */
const MUST = [/generalforsamling/i, /\bkoncert|\bconcert/i, /\bfest\b|jubilæum/i, /fællesspisning|åben scene/i, /\bforedrag|\btalk\b/i];

/** Three photos from different events of the month - one-off events before the weekly classes (whose pictures are often a logo) -
 * and the one line not to miss: the general assembly or a concert when there is one, else the month's first one-off event. */
export function monthHeader(events: MonthEvent[], now: number) {
  const month = monthOf(events, now);
  const name = (e: MonthEvent) => e.title.trim().toLocaleLowerCase("da-DK");
  const count = new Map<string, number>();
  for (const e of month.events) count.set(name(e), (count.get(name(e)) ?? 0) + 1);
  const isOnce = (e: MonthEvent) => count.get(name(e)) === 1;
  const seen = new Set<string>(), photos: MonthEvent[] = [];
  for (const e of [...month.events.filter(isOnce), ...month.events.filter(e => !isOnce(e))]) {
    if (!e.imageUrl || seen.has(name(e))) continue;
    seen.add(name(e)); photos.push(e);
    if (photos.length === 3) break;
  }
  photos.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const once = MUST.map(re => month.events.find(e => re.test(e.title))).find(Boolean) ?? month.events.find(isOnce) ?? month.events[0] ?? null;
  const note = once ? `${once.title.trim()} · ${NOTE_DAY.format(Date.parse(once.startsAt)).replace(/^(\p{L})/u, c => c.toLocaleUpperCase("da-DK"))} kl. ${TIME.format(Date.parse(once.startsAt)).replace(":", ".")}` : "";
  return { name: month.name, photos, note, highlight: once };
}

/** The rest of the month after the events already shown, week by week. */
export function restOfMonth(events: MonthEvent[], now: number, shown: Set<string>): { name: string; weeks: Array<{ week: number; events: MonthEvent[] }> } {
  const month = monthOf(events, now);
  const weeks: Array<{ week: number; events: MonthEvent[] }> = [];
  for (const e of month.events) {
    if (shown.has(e.key)) continue;
    const week = isoWeek(e.startsAt);
    const last = weeks[weeks.length - 1];
    if (last && last.week === week) last.events.push(e); else weeks.push({ week, events: [e] });
  }
  return { name: month.name.toLocaleLowerCase("da-DK"), weeks };
}

const href = (e: MonthEvent) => e.page ?? e.link ?? "/events";

export function MonthHero({ events, now }: { events: MonthEvent[]; now: number }) {
  const { name, photos, note, highlight } = monthHeader(events, now);
  return <section className="month-hero" aria-label={`${name} i Hjerterum`}>
    {photos.length > 0 && <div className="month-photos">{photos.map(e => <a key={e.key} href={href(e)}><img src={e.imageUrl!} alt={e.title} loading="eager" /></a>)}</div>}
    <div className="month-text">
      <p className="month-kicker">Hjerterum</p>
      <h1 className="month-title">{name}<em>i Hjerterum</em></h1>
      <span className="month-rule" aria-hidden="true" />
      <p className="month-kicker">Månedens events</p>
      {note && highlight && <p className="month-note"><a href={href(highlight)}>{note}</a></p>}
      <p className="lys-hero-actions"><a className="lys-btn" href="/events">Se hele kalenderen</a><a className="lys-btn ghost" href="/medlemskab">Bliv medlem</a></p>
    </div>
    <span className="month-stripe" aria-hidden="true" />
  </section>;
}

export function MonthRest({ events, now, shown }: { events: MonthEvent[]; now: number; shown: Set<string> }) {
  const { name, weeks } = restOfMonth(events, now, shown);
  if (!weeks.length) return null;
  return <section className="month-rest" aria-label={`Resten af ${name}`}>
    <h3>Resten af {name}</h3>
    {weeks.map(w => <div key={w.week}>
      <p className="month-week">Uge {w.week}</p>
      <ul>{w.events.map(e => <li key={e.key}><span className="month-when">{dayLine(e.startsAt)}</span><a href={href(e)}>{e.title}</a></li>)}</ul>
    </div>)}
  </section>;
}
