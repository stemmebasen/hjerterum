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
  const posts = await socialPosts(db, "((publish_at_ms >= ? AND publish_at_ms < ?) OR (json_extract(source, '$.instagramAtMs') >= ? AND json_extract(source, '$.instagramAtMs') < ?)) AND status <> 'skipped'",
    [from, to, from, to], "publish_at_ms, id", 500);
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

const label = (p: SocialPost) => p.kind === "week" ? (p.source.format === "reel" ? "Ugens reel" : "Ugens events") : p.kind === "share" ? `Deling: ${p.source.author ?? "opslag"}`
  : `${p.source.title ?? "Event"}${p.source.shout === 2 ? " · påmindelse" : ""}`;
const where = (p: SocialPost) => p.channels.map(c => c === "instagram" ? (p.kind === "event" && p.source.video && !p.source.noVideo ? "IG ▶" : "IG") : "FB").join(" + ");

export function prCalendarSection(base: string, d: CalendarData): string {
  const today = dateOf(d.nowMs);
  const byDay = new Map<string, SocialPost[]>();
  // An event on Facebook and Instagram at different times ("forskellige tidspunkter på de to medier"): one entry for each, at its own time.
  const entries = d.posts.flatMap((p): SocialPost[] => {
    const ig = p.source.instagramAtMs;
    if (!ig || ig === p.publish_at_ms || !p.channels.includes("instagram")) return [p];
    const each = (c: "facebook" | "instagram", at: number | null): SocialPost => ({ ...p, channels: [c], publish_at_ms: at, status: p.published[c] ? "published" : p.status === "published" ? "approved" : p.status, source: { ...p.source, moveChannel: c } as SocialPost["source"] });
    // Only on Instagram: it goes out at Instagram's own time (social.ts dueAt), and stands there in the calendar.
    if (!p.channels.includes("facebook")) return [each("instagram", ig)];
    return [each("facebook", p.publish_at_ms), each("instagram", ig)];
  }).sort((a, b) => (a.publish_at_ms ?? 0) - (b.publish_at_ms ?? 0));
  for (const p of entries) { const day = dateOf(p.publish_at_ms!); byDay.set(day, [...(byDay.get(day) ?? []), p]); }
  const waiting = d.posts.filter(p => p.status === "draft").length;
  const thisMonday = mondayOf(d.nowMs), first = d.mondays[0]!;
  const earlier = addDays(first, -7 * CALENDAR_WEEKS), later = addDays(first, 7 * CALENDAR_WEEKS);
  const nav = `<nav class="pr-tabs cal-nav" aria-label="Uger"><a href="${base}/pr/kalender?start=${earlier}">← Tidligere uger</a>${first !== thisMonday ? `<a href="${base}/pr/kalender">I dag</a>` : ""}
<a href="${base}/pr/kalender?start=${later}">Senere uger →</a></nav>`;
  // Asked: "hvorfor bliver Instagram stort set ikke inkluderet?" - Instagram takes only posts with a picture; an event without one goes on Facebook
  // until a design is made for it (Plakater og opslag), which brings Instagram in.
  const noPicture = (p: SocialPost) => Boolean(d.instagram) && p.kind === "event" && !p.images.length && !p.channels.includes("instagram") && ["draft", "approved", "failed"].includes(p.status);
  // Requested (5 Nov 2026): "På pr kalenderen må du gerne markere 'x dag til eventet'" and "det skal være muligt at jeg selv kan flytte entries rundt".
  const until = (p: SocialPost) => {
    if (p.kind !== "event" || !p.source.startsMs) return "";
    const days = Math.round((Date.parse(`${dateOf(p.source.startsMs)}T12:00:00Z`) - Date.parse(`${dateOf(p.publish_at_ms!)}T12:00:00Z`)) / 86_400_000);
    return days > 1 ? `<span class="cal-until">${days} dage til eventet</span>` : days === 1 ? `<span class="cal-until">1 dag til eventet</span>` : days === 0 ? `<span class="cal-until is-day">Samme dag som eventet</span>` : "";
  };
  const movable = (p: SocialPost) => ["draft", "approved", "failed"].includes(p.status) && !p.source.removed;
  const item = (p: SocialPost) => {
    const [tone, text] = toneOf(p);
    const channel = (p.source as { moveChannel?: string }).moveChannel ?? "both";
    const move = movable(p) ? `<details class="cal-move"><summary>Flyt</summary><form method="post" action="${base}/pr/kalender/flyt"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="channel" value="${channel}">
<input type="hidden" name="start" value="${esc(d.mondays[0]!)}"><input type="hidden" name="at" value=""><input type="datetime-local" required value="${localValue(p.publish_at_ms!)}" aria-label="Nyt tidspunkt"><button>Flyt</button></form></details>` : "";
    return `<li${movable(p) ? ` draggable="true" data-id="${p.id}" data-channel="${channel}" data-time="${clock(p.publish_at_ms!)}"` : ""}><a class="cal-item ${tone}" href="${calendarHref(base, p)}"><span class="cal-time">${clock(p.publish_at_ms!)}</span><b>${p.status === "approved" || p.status === "publishing" ? `<span class="cal-ok" title="Godkendt og klar til afsendelse">✓</span> ` : ""}${esc(label(p))}</b>
<small>${text}${p.channels.length ? ` · ${where(p)}` : ""}${noPicture(p) ? " · IG kræver et billede: lav et design" : ""}</small>${until(p)}</a>${move}</li>`;
  };
  const weeks = d.mondays.map(monday => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const day = addDays(monday, i), posts = byDay.get(day) ?? [];
      return `<div class="cal-day${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}${posts.length ? "" : " is-empty"}" data-day="${day}" id="dag-${day}"><h4>${DAYS[i]} ${dayLabel(day)}</h4>
${posts.length ? `<ul>${posts.map(item).join("")}</ul>` : ""}</div>`;
    }).join("");
    return `<section class="cal-week"><h3>Uge ${weekNumber(weekKey(monday))}</h3><div class="cal-grid">${days}</div></section>`;
  }).join("");
  return `<section class="panel" id="kalender"><header><h2>Kalender</h2>
<p>Alt, der er planlagt, på den dag og det tidspunkt, det går ud. Saga laver et forslag til hvert event, så snart det er i kalenderen, og sætter det til første ledige tid. Tryk på et forslag for at se billedet og det færdige opslag, vælge tidspunkt og publicere. Træk et opslag over på en anden dag for at flytte det (samme klokkeslæt), eller tryk "Flyt" og vælg dag og tid.</p></header>
${nav}
<p class="cal-legend"><span class="cal-item is-draft">Forslag${waiting ? ` (${waiting})` : ""}: venter på dit ja</span><span class="cal-item is-approved"><span class="cal-ok">✓</span> Godkendt og klar</span><span class="cal-item is-sent">Publiceret</span><span class="cal-item is-removed">Slettet igen</span><span class="cal-item is-failed">Fejlet</span></p>
${weeks}${MOVE_SCRIPT(base)}</section>`;
}

/** "2026-11-20T15:00" in Danish time, for the datetime-local field (the chair is in Denmark). */
function localValue(ms: number): string { const day = dateOf(ms), [h, m] = clock(ms).split("."); return `${day}T${h}:${m}`; }

/** Drag an entry to another day (it keeps its time), or "Flyt" with a day and a time. The field's Danish time is sent as an instant. */
const MOVE_SCRIPT = (base: string) => `<script>(()=>{const url=${JSON.stringify(`${base}/pr/kalender/flyt`)};
document.querySelectorAll(".cal-move form").forEach(f=>f.addEventListener("submit",()=>{const v=f.querySelector('input[type=datetime-local]').value;f.querySelector('input[name=at]').value=String(new Date(v).getTime())}));
let dragged=null;document.querySelectorAll("li[draggable]").forEach(li=>{li.addEventListener("dragstart",e=>{dragged=li;li.classList.add("is-dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",li.dataset.id)});li.addEventListener("dragend",()=>{li.classList.remove("is-dragging");document.querySelectorAll(".cal-day.is-over").forEach(d=>d.classList.remove("is-over"))})});
document.querySelectorAll(".cal-day[data-day]").forEach(day=>{day.addEventListener("dragover",e=>{if(!dragged)return;e.preventDefault();day.classList.add("is-over")});day.addEventListener("dragleave",()=>day.classList.remove("is-over"));
day.addEventListener("drop",async e=>{e.preventDefault();day.classList.remove("is-over");if(!dragged)return;const li=dragged;dragged=null;const at=new Date(day.dataset.day+"T"+li.dataset.time.replace(".",":")).getTime();
const body=new URLSearchParams({id:li.dataset.id,channel:li.dataset.channel,at:String(at)});const r=await fetch(url,{method:"POST",headers:{"accept":"application/json"},body}).catch(()=>null);const j=r?await r.json().catch(()=>null):null;
if(j&&j.ok)location.reload();else alert(j&&j.error==="time"?"Det tidspunkt kan opslaget ikke flyttes til: det skal ligge efter nu og senest en time før eventet.":j&&j.error==="sent"?"Opslaget er allerede sendt.":"Opslaget kunne ikke flyttes.")})})})()</script>`;

export const PR_CALENDAR_STYLE = `.cal-legend{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.cal-legend .cal-item{display:inline-block;font-size:13px;padding:4px 10px}
.cal-week h3{font-size:15px;margin:18px 0 8px}.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal-day{background:var(--soft);border-radius:12px;padding:8px;min-height:90px;min-width:0}.cal-day h4{margin:0 0 6px;font-size:12.5px;color:var(--muted);font-weight:600}
.cal-day.is-today{outline:2px solid var(--accent)}.cal-day:target{outline:3px solid var(--accent);scroll-margin-top:80px}.cal-day.is-past{opacity:.6}.cal-day ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.cal-item{display:block;border-radius:9px;padding:6px 8px;text-decoration:none;color:var(--ink);background:var(--card);border-left:4px solid var(--line);font-size:13px;line-height:1.3;overflow-wrap:anywhere}
.cal-item b{display:block;font-weight:600}.cal-item small{display:block;color:var(--muted);font-size:11.5px}.cal-time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)}
.cal-ok{color:#2e9d5b;font-weight:800}.cal-item.is-draft{border-left-color:#d9822b;background:rgba(217,130,43,.16)}.cal-item.is-approved{border-left-color:#4c6fff;background:rgba(76,111,255,.18)}.cal-item.is-sent{border-left-color:#2e9d5b;background:rgba(46,157,91,.2)}
.cal-item.is-failed{border-left-color:#d93025;background:rgba(217,48,37,.18)}.cal-item.is-removed{border-left-color:var(--faint);background:transparent;color:var(--muted)}.cal-item.is-removed b{text-decoration:line-through}
.cal-until{display:inline-block;margin-top:4px;font-size:11px;font-weight:600;color:var(--accent);background:var(--tint);border-radius:999px;padding:1px 7px}.cal-until.is-day{color:var(--warn);background:var(--warn-soft)}
li[draggable]{cursor:grab}li.is-dragging{opacity:.45}.cal-day.is-over{outline:2px dashed var(--accent)}
.cal-move{margin:3px 0 0 4px;font-size:11.5px}.cal-move summary{cursor:pointer;color:var(--muted);list-style:none}.cal-move summary::-webkit-details-marker{display:none}.cal-move summary::before{content:"↔ "}
.cal-move form{display:grid;gap:6px;margin:6px 0 2px}.cal-move input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);min-width:0}.cal-move button{padding:6px 12px;font-size:13px;min-height:0}
@media (max-width:900px){.cal-grid{grid-template-columns:1fr}.cal-day{min-height:0}.cal-day.is-empty{display:none}}`;
