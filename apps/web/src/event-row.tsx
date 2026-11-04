import type { ReactNode } from "react";
import { calendarText } from "./event-card";

/** The calendar as a list (Douglas' notes: "Event overwhelm - simple (see MembershipWorks) - have 'see more events' option. Page 1,2,3"):
 * a row per event - the date, a picture, the title, when and with whom - EVENTS_PER_PAGE at a time with the pages below. Shared by the
 * website's calendar (main.tsx) and the member pages' (workspaces.tsx MemberCalendar) - "you have not changed the calendar within the member's portal". */
export const EVENTS_PER_PAGE = 15;
const ROW_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", timeZone: "Europe/Copenhagen" });
const ROW_MONTH = new Intl.DateTimeFormat("da-DK", { month: "short", timeZone: "Europe/Copenhagen" });
const ROW_WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const ROW_END = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

/** "Tirsdag 19.00–22.00". */
export function rowWhen(startsAt: string, endsAt: string | null | undefined): string {
  const start = new Date(startsAt);
  return `${ROW_WHEN.format(start).replace(/^\p{L}/u, c => c.toLocaleUpperCase("da-DK"))}${endsAt ? `–${ROW_END.format(new Date(endsAt))}` : ""}`.replace(/(\d{2}):(\d{2})/g, "$1.$2");
}

export function RowDate({ startsAt }: { startsAt: string }) {
  const start = new Date(startsAt);
  return <span className="event-row-date"><b>{ROW_DAY.format(start)}</b>{ROW_MONTH.format(start).replace(".", "")}</span>;
}

export function RowPhoto({ src }: { src: string | null | undefined }) {
  return src ? <img className="event-row-photo" src={src} alt="" loading="lazy" /> : <span className="event-row-photo is-empty" aria-hidden="true" />;
}

/** The text in the middle of a row. */
export function RowText({ category, title, startsAt, endsAt, host, children }: { category?: string | null | undefined; title: ReactNode; startsAt: string; endsAt?: string | null | undefined; host?: string | null | undefined; children?: ReactNode }) {
  return <span className="event-row-text">
    {category && <small>{calendarText(category)}</small>}
    <strong>{typeof title === "string" ? calendarText(title) : title}</strong>
    <span>{rowWhen(startsAt, endsAt)}{host ? ` · ${calendarText(host)}` : ""}</span>
    {children}
  </span>;
}

/** The page asked for in the address (?side=2), kept in the address when it changes. */
export function initialPage(): number {
  const asked = typeof window !== "undefined" ? Number(new URLSearchParams(window.location.search).get("side")) : 1;
  return Number.isInteger(asked) && asked > 1 ? asked : 1;
}
export function rememberPage(next: number, scrollTo: string) {
  const url = new URL(window.location.href);
  if (next > 1) url.searchParams.set("side", String(next)); else url.searchParams.delete("side");
  window.history.replaceState(window.history.state, "", url.pathname + url.search);
  document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** "← Forrige 1 2 3 Se flere events →". */
export function Pager({ pages, current, go }: { pages: number; current: number; go: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="event-pages" aria-label="Sider i kalenderen">
    {current > 1 && <button type="button" onClick={() => go(current - 1)}>← Forrige</button>}
    {Array.from({ length: pages }, (_, i) => i + 1).map(n => <button key={n} type="button" aria-current={n === current ? "page" : undefined} onClick={() => go(n)}>{n}</button>)}
    {current < pages && <button type="button" className="event-pages-more" onClick={() => go(current + 1)}>Se flere events →</button>}
  </nav>;
}
