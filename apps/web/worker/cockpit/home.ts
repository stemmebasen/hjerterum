import type { BoardPicture } from "../saga/picture.js";
import { TASKS_SINCE, taskDay, type ApprovedMinutes, type Meeting, type Task } from "./data.js";
import type { HouseEvent } from "./events.js";
import { membersPanel, MEMBERS_STYLE, type MemberStats } from "./members.js";
import { esc, layout, longDay, shortDay } from "./page.js";

/** Requested: "det er vigtigt, at vi får et meget veltænkt og gennemtænkt overblik på forsiden, gerne med en
 * lille følgebeskrivelse" - "lav en moderne og pæn forside, som giver overblik over det vigtigste på alle de
 * vigtige områder" - and "Hav kontakt med tribes / indsamle billeder ... giver ikke rigtig mening i sig selv.
 * Desuden er de også gamle". The front page answers five questions, each block with one line saying what it
 * is: what waits on me, when do we meet next, what did we decide last, how is the board doing, and what
 * happens in the house. Every item carries where it comes from; nothing from before 1 October 2026. */

export type HomeData = {
  who: string | null; isChair: boolean; today: string;
  toSign: ApprovedMinutes[];
  tasks: Task[]; todos: Array<{ text: string; due: string | null; created_by: string }>;
  forChair: BoardPicture["forJacob"];
  next: Meeting | null; found: Array<{ date: string; what: string }>;
  latest: { id: number; date: string; decisions: string[]; approved: number; members: number } | null;
  picture: BoardPicture | null; summary: string | null; at: number | null;
  events: HouseEvent[]; eventsMonth: number;
  progress: { working: number; waiting: number };
  memberStats?: MemberStats[];
};

export const HOME_STYLE = `
.home{gap:26px}
.welcome{display:grid;gap:8px;padding:6px 0 2px}.welcome .eyebrow{font-size:13px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0}
.welcome h1{font-size:clamp(40px,5.6vw,68px)}.welcome .lead{font-size:18px;line-height:1.55;color:var(--muted);max-width:68ch;margin:4px 0 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.tile{display:grid;gap:4px;padding:18px 20px;border-radius:var(--radius);background:var(--card);border:1px solid color-mix(in srgb,var(--line) 60%,transparent);box-shadow:var(--shadow);text-decoration:none;color:var(--ink);min-width:0}
.tile:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}.tile .label{font-size:12.5px;font-weight:650;color:var(--muted)}
.tile b{font-size:32px;font-weight:700;line-height:1.1;letter-spacing:-.03em}.tile .sub{font-size:13px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.hot{background:var(--warn-soft);border-color:transparent}.tile.hot b,.tile.hot .label{color:var(--warn)}
.panels{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;align-items:start}.panels>div{display:grid;gap:18px;min-width:0}
.when{display:flex;gap:16px;align-items:center}.date{flex:none;width:58px;height:62px;border-radius:14px;background:var(--tint);display:grid;place-items:center;text-align:center;line-height:1}
.date b{font-size:26px;font-weight:700;color:var(--accent);letter-spacing:-.02em}.date span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.meter{height:6px;border-radius:999px;background:var(--soft);overflow:hidden;margin:6px 0 2px}.meter i{display:block;height:100%;background:var(--accent);border-radius:999px}
.mood{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:650;padding:4px 11px;border-radius:999px;background:var(--tint);color:var(--accent);margin-bottom:10px}
.event{display:grid;grid-template-columns:52px 1fr;gap:12px;align-items:center}.event img{width:52px;height:52px;border-radius:12px;object-fit:cover;background:var(--soft)}
.event .t{font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (max-width:900px){.tiles{grid-template-columns:repeat(2,1fr)}.panels{grid-template-columns:1fr}}
@media (max-width:760px){.welcome h1{font-size:40px}.welcome .lead{font-size:16px}.panel{padding:20px}.tile{padding:15px 16px}.tile b{font-size:26px}}
`;

const MONTH = new Intl.DateTimeFormat("da-DK", { month: "short", timeZone: "UTC" });
const EVENT_TIME = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
const inDays = (n: number) => n <= 0 ? "i dag" : n === 1 ? "i morgen" : `om ${n} dage`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
const inline = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const SOURCE: Record<string, string> = { telegram: "Fra gruppen", dokument: "Fra referatdokumentet", mail: "Fra team@" };

/** Saga's summary in a sentence or two: its first lines, without headings. */
function lead(summary: string | null): string {
  // Only the running text: the bullet points are shown under "Bestyrelsen lige nu".
  const lines = (summary ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#/.test(l) && !/^temperatur:/i.test(l) && !/^[-*]\s+/.test(l));
  const text = lines.slice(0, 2).join(" ");
  return text.length > 280 ? `${text.slice(0, 277).replace(/\s+\S*$/, "")} …` : text;
}
function points(summary: string | null, max = 3): string[] {
  const lines = (summary ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => /^[-*]\s+/.test(l)).map(l => l.replace(/^[-*]\s+/, ""));
  return lines.slice(0, max);
}

/** What waits on the chair from Saga's picture - only what is current: from the group (it covers the last
 * weeks), or dated from 1 October on. Old, context-less lines from the minutes document stay out. */
export function currentForChair(items: BoardPicture["forJacob"]): BoardPicture["forJacob"] {
  return items.filter(item => {
    const day = taskDay({ who: "", what: "", due: "", meeting: item.since, source: "dokument" });
    return day ? day >= TASKS_SINCE : item.source !== "dokument";
  });
}

export function homePage(base: string, data: HomeData): string {
  const first = data.who?.split(/\s+/)[0];
  const open = data.todos.length + data.tasks.length + (data.isChair ? data.forChair.length : 0);
  const summary = lead(data.summary);
  const welcome = `<section class="welcome"><p class="eyebrow">${esc(longDay(data.today))}</p><h1>${first ? `Hej ${esc(first)}` : "Overblik"}</h1>
${summary ? `<p class="lead">${inline(summary)}</p>` : `<p class="lead">Her er det vigtigste i bestyrelsen lige nu.</p>`}</section>`;

  const days = data.next ? daysUntil(data.next.meeting_date, data.today) : null;
  const tiles = `<section class="tiles" aria-label="Kort fortalt">
<a class="tile" href="${base}/moder${data.next ? `/${data.next.id}` : ""}"><span class="label">Næste møde</span><b>${data.next ? esc(shortDay(data.next.meeting_date).replace(/\s\d{4}$/, "")) : "Ikke sat"}</b><span class="sub">${data.next ? `${inDays(days!)}${data.next.start_time ? ` · kl. ${esc(data.next.start_time)}` : ""}` : "Planlæg det under Møder"}</span></a>
<a class="tile" href="${base}/opgaver"><span class="label">Dine opgaver</span><b>${open}</b><span class="sub">${open ? "venter på dig" : "intet venter"}</span></a>
<a class="tile${data.toSign.length ? " hot" : ""}" href="${base}${data.toSign[0] ? `/referat/${data.toSign[0].id}` : "/moder"}"><span class="label">Til godkendelse</span><b>${data.toSign.length}</b><span class="sub">${data.toSign.length ? plural(data.toSign.length, "referat", "referater") : "du er ajour"}</span></a>
<a class="tile" href="${base}/arrangementer"><span class="label">Arrangementer</span><b>${data.eventsMonth}</b><span class="sub">de næste 30 dage</span></a></section>`;

  // What waits on me: minutes to approve, my own and written-to-me items, my tasks from the minutes, and (for the chair) Saga's list.
  const mine = [
    ...data.toSign.map(m => `<li><a href="${base}/referat/${m.id}"><strong>Godkend referatet</strong></a><span class="ctx">Møde ${esc(shortDay(m.meeting_date ?? ""))}</span></li>`),
    ...data.todos.map(t => `<li>${esc(sentence(t.text))}${t.due ? ` · <span class="ctx" style="display:inline">frist ${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due) ? shortDay(t.due) : t.due)}</span>` : ""}<span class="ctx">${t.created_by === data.who ? "Din egen opgave" : `Fra ${esc(t.created_by)}`}</span></li>`),
    ...data.tasks.map(t => `<li>${esc(sentence(t.what))}<span class="ctx">Fra referatet ${esc(/^\d{4}-/.test(t.meeting) ? shortDay(t.meeting) : t.meeting)}${t.due ? ` · frist ${esc(t.due)}` : ""}</span></li>`),
    ...(data.isChair ? data.forChair.map(f => `<li>${f.kind === "spørgsmål" ? "Svar på: " : ""}${esc(f.text)}<span class="ctx">${esc(SOURCE[f.source] ?? "")}${f.from ? ` · ${esc(f.from)}` : ""}</span></li>`) : [])
  ];
  const yours = `<article class="panel"><header><h2>Til dig</h2><p>Det, der venter på dig - fra referaterne, bestyrelsen og Saga.</p></header>
${!data.who ? `<p class="empty"><a href="${base}/hvem">Vælg hvem du er</a> for at se dine opgaver.</p>` : mine.length ? `<ul class="items">${mine.slice(0, 6).join("")}</ul>` : `<p class="empty">Intet venter på dig lige nu.</p>`}
<a class="more" href="${base}/opgaver">${mine.length > 6 ? `Se alle ${mine.length}` : "Åbn dine opgaver"} →</a></article>`;

  const m = data.next;
  const agenda = m ? m.agenda.split("\n").filter(Boolean) : [];
  const meeting = `<article class="panel"><header><h2>Næste møde</h2><p>Hvornår, hvor og hvad der er på dagsordenen.</p></header>
${m ? `<div class="when"><div class="date"><span>${esc(MONTH.format(new Date(`${m.meeting_date}T12:00:00Z`)).replace(".", ""))}</span><b>${Number(m.meeting_date.slice(8))}</b></div>
<div><strong>${esc(longDay(m.meeting_date).replace(/\s\d{4}$/, ""))}</strong><div class="muted small">${[m.start_time ? `kl. ${esc(m.start_time)}` : "", m.place ? esc(m.place) : "", inDays(days!)].filter(Boolean).join(" · ")}</div></div></div>
${agenda.length ? `<ol class="agenda" style="margin-top:14px">${agenda.slice(0, 5).map(a => `<li>${esc(a)}</li>`).join("")}</ol>${agenda.length > 5 ? `<p class="small muted">og ${agenda.length - 5} punkter mere</p>` : ""}` : `<p class="small muted" style="margin-top:12px">Ingen dagsorden endnu.</p>`}
<a class="more" href="${base}/moder/${m.id}">Åbn mødet og dagsordenen →</a>`
    : data.found.length ? `<p class="empty">Intet møde er sat i kalenderen, men Saga har set <strong>${esc(longDay(data.found[0]!.date))}</strong> nævnt${data.found[0]!.what ? ` (${esc(data.found[0]!.what)})` : ""}.</p>
<a class="more" href="${base}/moder?dato=${esc(data.found[0]!.date)}&amp;forslag=1#nyt">Sæt det i kalenderen →</a>`
    : `<p class="empty">Intet møde er sat i kalenderen.</p><a class="more" href="${base}/moder#nyt">Planlæg et møde →</a>`}</article>`;

  const l = data.latest;
  const minutes = l ? `<article class="panel"><header><h2>Seneste referat</h2><p>Hvad der blev besluttet sidst, og hvor mange der har godkendt.</p></header>
<p style="margin:0 0 10px"><strong>${esc(longDay(l.date))}</strong></p>
${l.decisions.length ? `<ul class="items">${l.decisions.slice(0, 3).map(d => `<li>${esc(sentence(d))}</li>`).join("")}</ul>${l.decisions.length > 3 ? `<p class="small muted">og ${plural(l.decisions.length - 3, "beslutning", "beslutninger")} mere</p>` : ""}` : `<p class="empty">Ingen beslutninger i referatet.</p>`}
${l.members ? `<div style="margin-top:14px"><div class="small"><strong>${l.approved} af ${l.members}</strong> har godkendt</div><div class="meter"><i style="width:${Math.round(100 * Math.min(l.approved, l.members) / l.members)}%"></i></div></div>` : ""}
<a class="more" href="${base}/referat/${l.id}">${data.toSign.some(m2 => m2.id === l.id) ? "Læs og godkend" : "Læs referatet"} →</a></article>` : "";

  const p = data.picture, keys = points(data.summary);
  const waiting = (p?.topics ?? []).filter(t => t.waitsOnJacob || t.status === "afventer").slice(0, 3);
  const board = `<article class="panel"><header><h2>Bestyrelsen lige nu</h2><p>Sagas korte overblik over gruppen og referaterne.</p></header>
${p?.temperature ? `<span class="mood">${esc(p.temperature.level)}</span><p style="margin:0 0 10px">${esc(p.temperature.why)}</p>` : ""}
${keys.length ? `<ul class="items">${keys.map(k => `<li>${inline(k)}</li>`).join("")}</ul>` : p ? "" : `<p class="empty">Saga har ikke lavet et overblik endnu.</p>`}
${waiting.length ? `<p class="small" style="margin:14px 0 4px"><strong>Venter på svar</strong></p><ul class="items">${waiting.map(t => `<li>${esc(t.title)}${t.waitsOnJacob ? ` <span class="warn small">· venter på ${data.isChair ? "dig" : "formanden"}</span>` : ""}${t.note ? `<span class="ctx">${esc(t.note)}</span>` : ""}</li>`).join("")}</ul>` : ""}
<a class="more" href="${base}/status">Sagas fulde overblik →</a></article>`;

  const events = `<article class="panel"><header><h2>I huset</h2><p>De næste arrangementer i Hjerterum.</p></header>
${data.events.length ? `<ul class="items">${data.events.map(e => `<li class="event">${e.image_url ? `<img src="${esc(e.image_url)}" alt="" loading="lazy">` : `<span class="date" style="width:52px;height:52px"><b style="font-size:20px">${new Date(e.starts_at_ms).getDate()}</b></span>`}
<div><span class="t">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</span><span class="ctx">${esc(EVENT_TIME.format(e.starts_at_ms))}${e.host ? ` · ${esc(e.host)}` : ""}</span></div></li>`).join("")}</ul>` : `<p class="empty">Ingen arrangementer de næste dage.</p>`}
<a class="more" href="${base}/arrangementer">Alle arrangementer →</a></article>`;

  const working = data.progress.working || data.progress.waiting ? `<p class="notice">${[data.progress.working ? `${plural(data.progress.working, "optagelse", "optagelser")} bliver til referat` : "",
    data.progress.waiting ? `${plural(data.progress.waiting, "referat", "referater")} lægges op om lidt` : ""].filter(Boolean).join(" · ")}.</p>` : "";

  return layout(base, "Overblik", `<main class="home">${welcome}${tiles}${working}
<div class="panels"><div>${yours}${minutes}${membersPanel(base, data.memberStats ?? [])}</div><div>${meeting}${board}${events}</div></div></main>`, { section: "/", who: data.who, style: HOME_STYLE + MEMBERS_STYLE });
}
