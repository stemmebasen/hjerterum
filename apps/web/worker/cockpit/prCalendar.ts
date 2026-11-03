import type { D1Database } from "../db.js";
import { esc } from "./page.js";
import { socialAccount, socialPosts, type SocialPost } from "../social/social.js";
import { clock, dateOf, mondayOf, nextMonday, weekKey, weekNumber, weekStart } from "../social/plan.js";
import { studioIdOf } from "./posterStudio.js";

/** Requested (the chair, 3 Nov 2026): "Jeg synes, vi bør have en kalender til PR, hvor vi kan se, hvad der er planlagt hvornår, og Saga kommer med
 * forslag til samtlige events, der bliver skeduleret." PR og SoMe → Kalender (/pr/kalender): every post of this week and the next six, on the day and
 * at the time it goes out - Saga's proposals (waiting for the chair), the approved, the sent and the failed. Each opens where it is read and approved. */

export const CALENDAR_WEEKS = 7;
export type CalendarData = { mondays: string[]; posts: SocialPost[]; nowMs: number; instagram?: boolean };

/** Requested: "Det er også vigtigt, at jeg kan se tilbage historisk på, hvad vi har sendt ud. Så det skal gemmes." Every post is kept (nothing deletes
 * social_posts), and the calendar can start at any earlier Monday (?start=YYYY-MM-DD) - seven weeks at a time. */
export async function prCalendarData(db: D1Database, nowMs: number, start?: string | null): Promise<CalendarData> {
  const first = start && /^\d{4}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(Date.parse(`${start}T12:00:00Z`)) ? mondayOf(Date.parse(`${start}T12:00:00Z`)) : mondayOf(nowMs);
  const mondays: string[] = [];
  for (let i = 0, m = first; i < CALENDAR_WEEKS; i++, m = nextMonday(weekStart(m))) mondays.push(m);
  const from = weekStart(mondays[0]!), to = weekStart(nextMonday(weekStart(mondays.at(-1)!)));
  const posts = await socialPosts(db, "publish_at_ms >= ? AND publish_at_ms < ? AND status <> 'skipped'", [from, to], "publish_at_ms, id", 500);
  const instagram = Boolean((await socialAccount(db).catch(() => null))?.ig_user_id);
  return { mondays, posts, nowMs, instagram };
}

const DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
// Asked: "Hvorfor er der stort set ingen farveforskel mellem godkendt og sendt? Og kan sendt ikke hedde publiceret?"
const TONE: Record<SocialPost["status"], [string, string]> = {
  draft: ["is-draft", "Forslag"], approved: ["is-approved", "Godkendt"], publishing: ["is-approved", "Publiceres"], published: ["is-sent", "Publiceret"], failed: ["is-failed", "Fejlet"], skipped: ["is-removed", "Sprunget over"]
};
const toneOf = (p: SocialPost): [string, string] => p.source.removed ? ["is-removed", "Slettet igen"] : TONE[p.status];
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (date: string) => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;

/** Where a post is read, changed and approved: an event's in Plakater og opslag (the picture, then the finished post), the week's on Ugens opslag. */
export function calendarHref(base: string, p: SocialPost): string {
  const back = encodeURIComponent("/pr/kalender");
  const studio = p.kind === "event" && p.source.key ? studioIdOf(p.source.key) : null;
  if (studio && !["published", "publishing"].includes(p.status)) return `${base}/plakater/${esc(studio)}?fra=${back}`;
  if (p.kind === "share") return `${base}/pr/tagget`;
  const monday = p.kind === "event" && p.source.startsMs ? mondayOf(p.source.startsMs) : mondayOf(p.publish_at_ms ?? 0);
  return `${base}/pr/uge?uge=${monday}#opslag-${p.id}`;
}

const label = (p: SocialPost) => p.kind === "week" ? (p.source.format === "reel" ? "Ugens reel" : "Ugens events") : p.kind === "share" ? `Deling: ${p.source.author ?? "opslag"}` : p.source.title ?? "Event";
const where = (p: SocialPost) => p.channels.map(c => c === "instagram" ? "IG" : "FB").join(" + ");

export function prCalendarSection(base: string, d: CalendarData): string {
  const today = dateOf(d.nowMs);
  const byDay = new Map<string, SocialPost[]>();
  for (const p of d.posts) { const day = dateOf(p.publish_at_ms!); byDay.set(day, [...(byDay.get(day) ?? []), p]); }
  const waiting = d.posts.filter(p => p.status === "draft").length;
  const thisMonday = mondayOf(d.nowMs), first = d.mondays[0]!;
  const earlier = addDays(first, -7 * CALENDAR_WEEKS), later = addDays(first, 7 * CALENDAR_WEEKS);
  const nav = `<nav class="pr-tabs cal-nav" aria-label="Uger"><a href="${base}/pr/kalender?start=${earlier}">← Tidligere uger</a>${first !== thisMonday ? `<a href="${base}/pr/kalender">I dag</a>` : ""}
<a href="${base}/pr/kalender?start=${later}">Senere uger →</a></nav>`;
  // Asked: "hvorfor bliver Instagram stort set ikke inkluderet?" - Instagram takes only posts with a picture; an event without one goes on Facebook
  // until a design is made for it (Plakater og opslag), which brings Instagram in.
  const noPicture = (p: SocialPost) => Boolean(d.instagram) && p.kind === "event" && !p.images.length && !p.channels.includes("instagram") && ["draft", "approved", "failed"].includes(p.status);
  const item = (p: SocialPost) => {
    const [tone, text] = toneOf(p);
    return `<li><a class="cal-item ${tone}" href="${calendarHref(base, p)}"><span class="cal-time">${clock(p.publish_at_ms!)}</span><b>${esc(label(p))}</b>
<small>${text}${p.channels.length ? ` · ${where(p)}` : ""}${noPicture(p) ? " · IG kræver et billede: lav et design" : ""}</small></a></li>`;
  };
  const weeks = d.mondays.map(monday => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const day = addDays(monday, i), posts = byDay.get(day) ?? [];
      return `<div class="cal-day${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}${posts.length ? "" : " is-empty"}"><h4>${DAYS[i]} ${dayLabel(day)}</h4>
${posts.length ? `<ul>${posts.map(item).join("")}</ul>` : ""}</div>`;
    }).join("");
    return `<section class="cal-week"><h3>Uge ${weekNumber(weekKey(monday))}</h3><div class="cal-grid">${days}</div></section>`;
  }).join("");
  return `<section class="panel" id="kalender"><header><h2>Kalender</h2>
<p>Alt, der er planlagt, på den dag og det tidspunkt, det går ud. Saga laver et forslag til hvert event, så snart det er i kalenderen, og sætter det til første ledige tid. Tryk på et forslag for at se billedet og det færdige opslag, vælge tidspunkt og publicere.</p></header>
${nav}
<p class="cal-legend"><span class="cal-item is-draft">Forslag${waiting ? ` (${waiting})` : ""}: venter på dit ja</span><span class="cal-item is-approved">Godkendt</span><span class="cal-item is-sent">Publiceret</span><span class="cal-item is-removed">Slettet igen</span><span class="cal-item is-failed">Fejlet</span></p>
${weeks}</section>`;
}

export const PR_CALENDAR_STYLE = `.cal-legend{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.cal-legend .cal-item{display:inline-block;font-size:13px;padding:4px 10px}
.cal-week h3{font-size:15px;margin:18px 0 8px}.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal-day{background:var(--soft);border-radius:12px;padding:8px;min-height:90px;min-width:0}.cal-day h4{margin:0 0 6px;font-size:12.5px;color:var(--muted);font-weight:600}
.cal-day.is-today{outline:2px solid var(--accent)}.cal-day.is-past{opacity:.6}.cal-day ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.cal-item{display:block;border-radius:9px;padding:6px 8px;text-decoration:none;color:var(--ink);background:var(--card);border-left:4px solid var(--line);font-size:13px;line-height:1.3;overflow-wrap:anywhere}
.cal-item b{display:block;font-weight:600}.cal-item small{display:block;color:var(--muted);font-size:11.5px}.cal-time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)}
.cal-item.is-draft{border-left-color:#d9822b;background:rgba(217,130,43,.16)}.cal-item.is-approved{border-left-color:#4c6fff;background:rgba(76,111,255,.18)}.cal-item.is-sent{border-left-color:#2e9d5b;background:rgba(46,157,91,.2)}
.cal-item.is-failed{border-left-color:#d93025;background:rgba(217,48,37,.18)}.cal-item.is-removed{border-left-color:var(--faint);background:transparent;color:var(--muted)}.cal-item.is-removed b{text-decoration:line-through}
@media (max-width:900px){.cal-grid{grid-template-columns:1fr}.cal-day{min-height:0}.cal-day.is-empty{display:none}}`;
