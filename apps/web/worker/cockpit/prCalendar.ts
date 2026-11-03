import type { D1Database } from "../db.js";
import { esc } from "./page.js";
import { socialPosts, type SocialPost } from "../social/social.js";
import { clock, dateOf, mondayOf, nextMonday, weekKey, weekNumber, weekStart } from "../social/plan.js";
import { studioIdOf } from "./posterStudio.js";

/** Requested (the chair, 3 Nov 2026): "Jeg synes, vi bør have en kalender til PR, hvor vi kan se, hvad der er planlagt hvornår, og Saga kommer med
 * forslag til samtlige events, der bliver skeduleret." PR og SoMe → Kalender (/pr/kalender): every post of this week and the next six, on the day and
 * at the time it goes out - Saga's proposals (waiting for the chair), the approved, the sent and the failed. Each opens where it is read and approved. */

export const CALENDAR_WEEKS = 7;
export type CalendarData = { mondays: string[]; posts: SocialPost[]; nowMs: number };

export async function prCalendarData(db: D1Database, nowMs: number): Promise<CalendarData> {
  const mondays: string[] = [];
  for (let i = 0, m = mondayOf(nowMs); i < CALENDAR_WEEKS; i++, m = nextMonday(weekStart(m))) mondays.push(m);
  const from = weekStart(mondays[0]!), to = weekStart(nextMonday(weekStart(mondays.at(-1)!)));
  const posts = await socialPosts(db, "publish_at_ms >= ? AND publish_at_ms < ? AND status <> 'skipped'", [from, to], "publish_at_ms, id", 500);
  return { mondays, posts, nowMs };
}

const DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const TONE: Record<SocialPost["status"], [string, string]> = {
  draft: ["is-draft", "Forslag"], approved: ["is-approved", "Godkendt"], publishing: ["is-approved", "Sendes"], published: ["is-sent", "Sendt"], failed: ["is-failed", "Fejlet"], skipped: ["is-sent", "Sprunget over"]
};
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
  const item = (p: SocialPost) => {
    const [tone, text] = TONE[p.status];
    return `<li><a class="cal-item ${tone}" href="${calendarHref(base, p)}"><span class="cal-time">${clock(p.publish_at_ms!)}</span><b>${esc(label(p))}</b>
<small>${text}${p.channels.length ? ` · ${where(p)}` : ""}</small></a></li>`;
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
<p class="cal-legend"><span class="cal-item is-draft">Forslag${waiting ? ` (${waiting})` : ""}: venter på dit ja</span><span class="cal-item is-approved">Godkendt</span><span class="cal-item is-sent">Sendt</span><span class="cal-item is-failed">Fejlet</span></p>
${weeks}</section>`;
}

export const PR_CALENDAR_STYLE = `.cal-legend{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.cal-legend .cal-item{display:inline-block;font-size:13px;padding:4px 10px}
.cal-week h3{font-size:15px;margin:18px 0 8px}.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal-day{background:var(--soft);border-radius:12px;padding:8px;min-height:90px;min-width:0}.cal-day h4{margin:0 0 6px;font-size:12.5px;color:var(--muted);font-weight:600}
.cal-day.is-today{outline:2px solid var(--accent)}.cal-day.is-past{opacity:.6}.cal-day ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.cal-item{display:block;border-radius:9px;padding:6px 8px;text-decoration:none;color:var(--ink);background:var(--card);border-left:4px solid var(--line);font-size:13px;line-height:1.3;overflow-wrap:anywhere}
.cal-item b{display:block;font-weight:600}.cal-item small{display:block;color:var(--muted);font-size:11.5px}.cal-time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)}
.cal-item.is-draft{border-left-color:var(--warn);background:var(--warn-soft)}.cal-item.is-approved{border-left-color:var(--accent)}.cal-item.is-sent{border-left-color:var(--good,#3f6b3a)}.cal-item.is-failed{border-left-color:#b3261e}
@media (max-width:900px){.cal-grid{grid-template-columns:1fr}.cal-day{min-height:0}.cal-day.is-empty{display:none}}`;
