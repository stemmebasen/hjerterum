/** Requested: "Have a look at this PDF and come up with a suggestion on how we can make our web design a little bit more like it" - then:
 * "It just looks like a business card at the top ... just take the design of the heading, the fonts, and the colors from the PDF and adapt
 * that to our website" - and, of the sketch, "Er dit forslag, at oktober i hjerterum skal være forsidens hero?" - "Ja" (to moving it down) -
 * "Ja den er godt". The front page's calendar section reads like the monthly newsletter: "Det sker / i Hjerterum", three highlighted events,
 * the general assembly in a blush box, the coming weeks week by week in columns, and the Mornings banner. */

export type MonthEvent = { key: string; title: string; startsAt: string; imageUrl: string | null; page?: string | null; link: string | null;
  description?: string | null; location?: string | null; category?: string | null };

const ZONE = "Europe/Copenhagen";
const MONTH = new Intl.DateTimeFormat("da-DK", { month: "long", timeZone: ZONE });
const DAY_LINE = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "numeric", timeZone: ZONE });
const TIME = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });

const capital = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
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

/** Asked: "Nu står der 'Resten af oktober' på forsiden. Men hvad hvis det er den 28. oktober?" - and then: "Er det ikke bedre at undlade
 * månedsnavne?" The front page shows the coming four weeks, across the turn of the month, without naming a month. */
const WINDOW_DAYS = 28;
export function comingWeeks(events: MonthEvent[], now: number): MonthEvent[] {
  const until = now + WINDOW_DAYS * 86_400_000;
  return events.filter(e => Date.parse(e.startsAt) > now && Date.parse(e.startsAt) <= until).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

const href = (e: MonthEvent) => e.page ?? e.link ?? "/events";

/** Requested: "Over hero billedet bør være en flot kasse - announcement om næste arrangement: Coming up i Hjerterum / EVENT TITEL / DATO OG TIDSPUNKT /
 * Læs mere". Then: "Der står at næste event er Healing med slægt. Men der er også ... fri-morgendans" - simply the next event, whatever it is. */
export function comingUp(events: MonthEvent[], now: number): MonthEvent | null {
  return events.filter(e => Date.parse(e.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

export function ComingUp({ event }: { event: MonthEvent | null }) {
  if (!event) return null;
  return <a className="nl-coming" href={href(event)}>
    <span className="lys-kicker">Coming up i Hjerterum</span>
    <strong>{event.title}</strong>
    <span className="nl-coming-when">{featureLine(event.startsAt)}</span>
    <span className="nl-more">Læs mere →</span>
  </a>;
}
const LONG_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: ZONE });
const WEEKDAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", timeZone: ZONE });
const DAY_NUM = new Intl.DateTimeFormat("da-DK", { day: "numeric", timeZone: ZONE });
/** "LØRDAG 24. OKTOBER · KL. 20.00" - the newsletter's line over a highlighted event. */
export const featureLine = (iso: string) => `${LONG_DAY.format(Date.parse(iso)).replace(/^(\p{L}+) den /u, "$1 ")} · kl. ${TIME.format(Date.parse(iso)).replace(":", ".")}`.toLocaleUpperCase("da-DK");
const plain = (html: string | null | undefined, max = 150) => {
  const text = (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")} …` : text;
};
const ASSOC = /generalforsamling|medlemsmøde|stormøde|informationsmøde|årsmøde/i;
const WEEK_SHOWN = 6;

/** The coming weeks' sections: the gathering for members, three highlighted events (one-off events with a picture first), the rest week by
 * week (at most six a week, then "+ n flere"), and the Mornings when the weeks have them. */
export function monthSections(events: MonthEvent[], now: number) {
  const month = { events: comingWeeks(events, now) };
  const name = (e: MonthEvent) => e.title.trim().toLocaleLowerCase("da-DK");
  const count = new Map<string, number>();
  for (const e of month.events) count.set(name(e), (count.get(name(e)) ?? 0) + 1);
  const announce = month.events.find(e => ASSOC.test(e.title)) ?? null;
  const mornings = month.events.filter(e => /mornings/i.test(`${e.title} ${e.category ?? ""}`));
  const candidates = month.events.filter(e => e !== announce && e.imageUrl && !mornings.includes(e));
  const seen = new Set<string>(), featured: MonthEvent[] = [];
  for (const e of [...candidates.filter(e => count.get(name(e)) === 1), ...candidates.filter(e => count.get(name(e))! > 1)]) {
    if (seen.has(name(e))) continue;
    seen.add(name(e)); featured.push(e);
    if (featured.length === 3) break;
  }
  featured.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const shown = new Set([...featured.map(e => e.key), ...(announce ? [announce.key] : [])]);
  const weeks: Array<{ week: number; events: MonthEvent[]; more: number }> = [];
  for (const e of month.events) {
    if (shown.has(e.key)) continue;
    const week = isoWeek(e.startsAt), last = weeks[weeks.length - 1];
    const into = last && last.week === week ? last : (weeks.push({ week, events: [], more: 0 }), weeks[weeks.length - 1]!);
    if (into.events.length < WEEK_SHOWN) into.events.push(e); else into.more++;
  }
  return { featured, announce, weeks, mornings: mornings.find(e => e.imageUrl) ?? mornings[0] ?? null };
}

export function MonthSection({ events, now, reachable }: { events: MonthEvent[]; now: number; reachable: boolean }) {
  const { featured, announce, weeks, mornings } = monthSections(events, now);
  return <section className="nl-month" aria-label="Det sker i Hjerterum">
    <div className="nl-head"><p className="lys-kicker">Kalender</p><h2 className="nl-big">Det sker<em>i Hjerterum</em></h2><span className="nl-rule" aria-hidden="true" /></div>
    {/* While the calendar is on its way, nothing is said; only a calendar that came back empty says so. */}
    {!featured.length && !weeks.length && reachable && <p className="nl-empty">Kalenderen for de kommende uger kommer snart.</p>}
    {featured.length > 0 && <div className="nl-featured">{featured.map(e => <article key={e.key} className="nl-feat"><a href={href(e)}>
      {e.imageUrl && <img src={e.imageUrl} alt="" loading="lazy" />}
      <p className="nl-when">{featureLine(e.startsAt)}</p><h3>{e.title}</h3>{plain(e.description) && <p className="nl-text">{plain(e.description)}</p>}<span className="nl-more">Læs mere →</span></a></article>)}</div>}
    {announce && <div className="nl-announce"><div className="nl-date">{DAY_NUM.format(Date.parse(announce.startsAt)).replace(".", "")}<small>{MONTH.format(Date.parse(announce.startsAt))}</small></div>
      <div><b>{announce.title}</b>{capital(WEEKDAY.format(Date.parse(announce.startsAt)))} kl. {TIME.format(Date.parse(announce.startsAt)).replace(":", ".")}{announce.location ? ` i ${announce.location}` : ""}. Alle medlemmer er hjerteligt velkomne.</div>
      <a className="lys-btn" href={href(announce)}>Læs mere</a></div>}
    {weeks.length > 0 && <>
      <h3 className="nl-sub">De kommende uger</h3>
      <div className="nl-weeks">{weeks.map(w => <div key={w.week} className="nl-week"><h4>Uge {w.week}</h4><ul>
        {w.events.map(e => <li key={e.key}><span className="nl-d">{dayLine(e.startsAt)}</span><a href={href(e)}>{e.title}</a></li>)}
        {w.more > 0 && <li className="nl-flere"><a href="/events">+ {w.more} flere</a></li>}</ul></div>)}</div>
    </>}
    <p className="nl-center"><a className="lys-btn ghost" href="/events">Se hele kalenderen</a></p>
    {mornings && <a className="nl-series" href={href(mornings)}>
      {mornings.imageUrl && <img src={mornings.imageUrl} alt="" loading="lazy" />}
      <div className="nl-series-mid"><p className="lys-kicker">Hjerterum</p><b>Mornings</b><span className="nl-rule" aria-hidden="true" /><p>yoga · meditation · breathwork · qi gong · sound journey · dans</p></div>
      <div className="nl-series-right"><p className="lys-kicker">Hver hverdag</p><p>kl. 10.30 – 11.30<br />nogle dage kl. 9 – 10</p><em>Gratis for medlemmer<br />50 kr. for andre</em></div></a>}
  </section>;
}
