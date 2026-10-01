import type { BoardPicture } from "../saga/picture.js";
import type { ApprovedMinutes, Decision, Meeting, Task } from "./data.js";

/** The board cockpit's pages, written on the server as plain HTML: quick on a phone, nothing to
 * install, and nothing of the board's in a script. Every value from the database is escaped. */

export const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const DANISH_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const DANISH_SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "torsdag den 8. oktober 2026" - the weekday from the date itself, never guessed. */
export const longDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_DAY.format(new Date(`${iso}T12:00:00Z`)) : iso;
export const shortDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_SHORT.format(new Date(`${iso}T12:00:00Z`)) : iso;

const STYLE = `
:root{--bg:#f6f4f1;--card:#fff;--ink:#1f1d1a;--muted:#6b665f;--line:#e4dfd8;--accent:#8a3b5c;--accent-ink:#fff;--soft:#f1ebe6;--good:#2f7a4a;--warn:#a8551b}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--card:#201f1d;--ink:#eeebe6;--muted:#a49e95;--line:#34312d;--accent:#d68aab;--accent-ink:#1b1214;--soft:#2a2724;--good:#7cc796;--warn:#e6a06a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}header{background:var(--card);border-bottom:1px solid var(--line)}
.top{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;letter-spacing:.01em;text-decoration:none;color:var(--ink)}.brand span{color:var(--accent)}
nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}nav a{padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--muted);font-weight:600;font-size:14px}
nav a.on{background:var(--soft);color:var(--ink)}.who{font-size:13px;color:var(--muted)}.who a{color:var(--muted)}
main{max-width:1040px;margin:0 auto;padding:20px 16px 48px;display:grid;gap:16px}
h1{font-size:24px;margin:4px 0 0;letter-spacing:-.01em}h2{font-size:16px;margin:0 0 10px}h3{font-size:15px;margin:14px 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;min-width:0}
.muted{color:var(--muted)}.small{font-size:13px}.pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--soft);color:var(--muted)}
ul.plain{list-style:none;margin:0;padding:0;display:grid;gap:8px}ul.plain li{padding:8px 10px;border-radius:10px;background:var(--soft)}
ol.agenda{margin:0;padding-left:20px}ol.agenda li{margin:2px 0}
.doc h1{font-size:20px}.doc h2{font-size:16px;margin-top:18px}.doc h3{font-size:15px}.doc ul{padding-left:20px}
form.stack{display:grid;gap:10px}label{display:grid;gap:4px;font-size:13px;font-weight:600}
input,textarea,select{font:inherit;font-weight:400;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px;width:100%}
textarea{min-height:150px;resize:vertical}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1 1 160px}
button,.button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 14px;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none;display:inline-block}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
.notice{padding:10px 14px;border-radius:10px;background:var(--soft)}.notice.good{color:var(--good)}.notice.warn{color:var(--warn)}
details{border-top:1px solid var(--line);padding:8px 0}details>summary{cursor:pointer;font-weight:600}
.center{max-width:420px;margin:12vh auto;padding:0 16px}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}th{font-size:12px;color:var(--muted)}
`;

export function layout(base: string, title: string, body: string, options: { section?: string; who?: string | null } = {}): string {
  const nav = [["", "Overblik"], ["/moder", "Møder"], ["/beslutninger", "Beslutninger"], ["/arkiv", "Arkiv"]]
    .map(([path, label]) => `<a href="${base}${path || "/"}"${options.section === (path || "/") ? ' class="on"' : ""}>${label}</a>`).join("");
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Hjerterum bestyrelse</title><style>${STYLE}</style></head><body>
${options.section === undefined ? "" : `<header><div class="top"><a class="brand" href="${base}/">Hjerterum <span>bestyrelse</span></a><nav>${nav}</nav>
<div class="who">${options.who ? `${esc(options.who)} · <a href="${base}/hvem">skift</a> · ` : ""}<form method="post" action="${base}/logout" style="display:inline"><button class="ghost" style="padding:2px 8px;font-size:12px">Log ud</button></form></div></div></header>`}
${body}</body></html>`;
}

export function loginPage(base: string, message: string, configured: boolean): string {
  return layout(base, "Log ind", `<div class="center"><div class="card"><h1>Hjerterum bestyrelse</h1>
<p class="muted">Bestyrelsens cockpit med møder, referater og beslutninger.</p>
${configured ? `<form class="stack" method="post" action="${base}/login"><label>Fælles adgangskode<input type="password" name="password" autocomplete="current-password" required autofocus></label>
${message ? `<p class="notice warn">${esc(message)}</p>` : ""}<button>Log ind</button></form>`
    : `<p class="notice warn">Cockpittet er ikke sat op endnu: formanden mangler at vælge den fælles adgangskode.</p>`}</div></div>`);
}

export function whoPage(base: string, names: string[], current: string | null): string {
  return layout(base, "Hvem er du?", `<main><div class="card" style="max-width:520px"><h1>Hvem er du?</h1>
<p class="muted">Så viser overblikket dine egne opgaver. Valget huskes på denne enhed.</p>
<form class="stack" method="post" action="${base}/hvem">${names.length ? names.map(name => `<label style="flex-direction:row;display:flex;align-items:center;gap:8px;font-weight:500">
<input type="radio" name="who" value="${esc(name)}" style="width:auto"${name === current ? " checked" : ""} required> ${esc(name)}</label>`).join("")
    : `<label>Dit navn<input name="who" required maxlength="60" value="${esc(current ?? "")}"></label>`}
<button>Fortsæt</button></form></div></main>`, { section: "", who: current });
}

const taskLine = (task: Task) => `<li>${task.who ? `<strong>${esc(task.who)}</strong> · ` : ""}${esc(task.what)}${task.due ? ` <span class="pill">${esc(task.due)}</span>` : ""}
${task.meeting ? `<div class="small muted">${task.source === "referat" ? "Fra referatet" : "Fra referatdokumentet"} ${esc(/^\d{4}-/.test(task.meeting) ? shortDay(task.meeting) : task.meeting)}</div>` : ""}</li>`;

function meetingSummary(base: string, m: Meeting): string {
  const items = m.agenda.split("\n").filter(Boolean);
  return `<p><strong>${esc(longDay(m.meeting_date))}</strong>${m.start_time ? ` kl. ${esc(m.start_time)}` : ""}${m.place ? ` · ${esc(m.place)}` : ""}</p>
${items.length ? `<ol class="agenda">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ol>` : `<p class="muted small">Ingen dagsorden endnu.</p>`}
<p class="small"><a href="${base}/moder/${m.id}">Ret dagsorden</a></p>`;
}

export function overviewPage(base: string, data: { who: string | null; isChair: boolean; mine: Task[]; forChair: BoardPicture["forJacob"]; next: Meeting | null;
  picture: BoardPicture | null; summary: string | null; at: number | null; progress: { working: number; waiting: number }; today: string }): string {
  const p = data.picture;
  const dates = (p?.document.dates ?? []).filter(d => d.date >= data.today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const mine = `<div class="card"><h2>${data.who ? `Mine opgaver` : "Opgaver"}</h2>
${data.isChair && data.forChair.length ? `<h3>Til dig som formand</h3><ul class="plain">${data.forChair.map(f => `<li>${esc(f.text)}<div class="small muted">${esc(f.kind)} · ${esc(f.from || f.source)}</div></li>`).join("")}</ul><h3>Fra referaterne</h3>` : ""}
${data.mine.length ? `<ul class="plain">${data.mine.map(taskLine).join("")}</ul>` : `<p class="muted">${data.who ? "Ingen opgaver står på dig i referaterne lige nu." : `<a href="${base}/hvem">Vælg hvem du er</a> for at se dine opgaver.`}</p>`}</div>`;
  const next = `<div class="card"><h2>Næste møde</h2>${data.next ? meetingSummary(base, data.next) : `<p class="muted">Intet møde er sat i kalenderen.</p><p><a class="button" href="${base}/moder#nyt">Planlæg et møde</a></p>`}</div>`;
  const saga = `<div class="card"><h2>Bestyrelsen lige nu</h2>${p?.temperature ? `<p><span class="pill">${esc(p.temperature.level)}</span> ${esc(p.temperature.why)}</p>` : ""}
${data.summary ? `<p>${esc(data.summary)}</p>` : `<p class="muted">Saga har ikke lavet et overblik endnu.</p>`}
${data.at ? `<p class="small muted">Sagas overblik fra ${esc(new Date(data.at).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "medium", timeStyle: "short" }))}</p>` : ""}</div>`;
  const topics = p?.topics.length ? `<div class="card"><h2>Emner</h2><ul class="plain">${p.topics.map(t => `<li><strong>${esc(t.title)}</strong> <span class="pill">${esc(t.status)}</span>${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ""}</li>`).join("")}</ul></div>` : "";
  const when = dates.length ? `<div class="card"><h2>Datoer</h2><ul class="plain">${dates.map(d => `<li><strong>${esc(shortDay(d.date))}</strong> · ${esc(d.what)}</li>`).join("")}</ul></div>` : "";
  const minutesNote = data.progress.working || data.progress.waiting ? `<p class="notice">${[data.progress.working ? `${data.progress.working} optagelse${data.progress.working === 1 ? "" : "r"} bliver til referat` : "",
    data.progress.waiting ? `${data.progress.waiting} referat${data.progress.waiting === 1 ? "" : "er"} venter på formandens godkendelse` : ""].filter(Boolean).join(" · ")}.</p>` : "";
  return layout(base, "Overblik", `<main><h1>${data.who ? `Hej ${esc(data.who.split(/\s+/)[0])}` : "Overblik"}</h1>${minutesNote}
<div class="grid">${mine}${next}</div><div class="grid">${saga}${topics}${when}</div></main>`, { section: "/", who: data.who });
}

export function meetingsPage(base: string, data: { upcoming: Meeting[]; past: Array<{ meeting: Meeting | null; minutes: ApprovedMinutes | null; date: string }>; today: string;
  who: string | null; notice: string; uploads: boolean }): string {
  const form = `<form class="stack" method="post" action="${base}/moder"><div class="row"><label>Dato<input type="date" name="meeting_date" required min="${esc(data.today)}"></label>
<label>Tid<input type="time" name="start_time"></label><label>Sted<input name="place" maxlength="200" placeholder="Fx Hjerterum, Valby"></label></div>
<label>Dagsorden (ét punkt pr. linje)<textarea name="agenda" placeholder="Godkendelse af referat&#10;Økonomi&#10;Eventuelt"></textarea></label><button>Gem møde</button></form>`;
  const upload = `<form class="stack" method="post" action="${base}/upload" enctype="multipart/form-data">
<label>Optagelse (mp3, m4a, wav, ogg - højst 60 MB)<input type="file" name="recording" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" required></label>
<label>Mødedato<input type="date" name="meeting_date" required max="${esc(data.today)}" value="${esc(data.today)}"></label>
<button>Upload og lav referat</button><p class="small muted">Saga skriver referatet ud fra optagelsen. Formanden godkender det, og så står det her under mødet.</p></form>`;
  return layout(base, "Møder", `<main><h1>Møder</h1>${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}
<div class="grid"><div class="card"><h2>Kommende møder</h2>${data.upcoming.length ? data.upcoming.map(m => `<div style="margin-bottom:14px">${meetingSummary(base, m)}</div>`).join("") : `<p class="muted">Ingen møder planlagt.</p>`}</div>
<div class="card" id="nyt"><h2>Planlæg et møde</h2>${form}</div></div>
<div class="grid"><div class="card"><h2>Holdte møder</h2>${data.past.length ? `<table><tr><th>Dato</th><th>Dagsorden</th><th>Referat</th></tr>${data.past.map(row => `<tr><td>${esc(shortDay(row.date))}</td>
<td>${row.meeting ? `<a href="${base}/moder/${row.meeting.id}">${row.meeting.agenda.split("\n").filter(Boolean).length} punkter</a>` : `<span class="muted">-</span>`}</td>
<td>${row.minutes ? `<a href="${base}/referat/${row.minutes.id}">Læs referat</a>` : `<span class="muted">Mangler</span>`}</td></tr>`).join("")}</table>` : `<p class="muted">Ingen holdte møder endnu.</p>`}</div>
<div class="card"><h2>Upload mødeoptagelse</h2>${data.uploads ? upload : `<p class="muted">Upload er ikke sat op endnu (lageret til optagelser mangler).</p>`}</div></div></main>`, { section: "/moder", who: data.who });
}

export function meetingPage(base: string, m: Meeting, minutes: ApprovedMinutes | null, who: string | null, notice: string): string {
  return layout(base, `Møde ${shortDay(m.meeting_date)}`, `<main><p class="small"><a href="${base}/moder">← Møder</a></p><h1>${esc(longDay(m.meeting_date))}</h1>
${notice ? `<p class="notice good">${esc(notice)}</p>` : ""}<div class="grid"><div class="card"><h2>Dagsorden</h2>
<form class="stack" method="post" action="${base}/moder/${m.id}"><div class="row"><label>Dato<input type="date" name="meeting_date" required value="${esc(m.meeting_date)}"></label>
<label>Tid<input type="time" name="start_time" value="${esc(m.start_time ?? "")}"></label><label>Sted<input name="place" maxlength="200" value="${esc(m.place ?? "")}"></label></div>
<label>Dagsorden (ét punkt pr. linje)<textarea name="agenda">${esc(m.agenda)}</textarea></label><button>Gem</button></form>
${m.updated_by ? `<p class="small muted">Sidst rettet af ${esc(m.updated_by)}.</p>` : ""}
<form method="post" action="${base}/moder/${m.id}/slet" onsubmit="return confirm('Slette mødet og dets dagsorden?')"><button class="ghost">Slet møde</button></form></div>
<div class="card"><h2>Referat</h2>${minutes ? `<p><a class="button" href="${base}/referat/${minutes.id}">Læs referatet</a></p>` : `<p class="muted">Intet godkendt referat endnu.</p>`}</div></div></main>`, { section: "/moder", who });
}

export function minutesPage(base: string, minutes: ApprovedMinutes, html: string, who: string | null): string {
  return layout(base, `Referat ${minutes.meeting_date ?? ""}`, `<main><p class="small"><a href="${base}/moder">← Møder</a></p>
<div class="card doc">${html}${minutes.drive_document_url ? `<p class="small"><a href="${esc(minutes.drive_document_url)}" target="_blank" rel="noopener">Åbn i referatdokumentet</a></p>` : ""}</div></main>`, { section: "/moder", who });
}

export function decisionsPage(base: string, decisions: Decision[], who: string | null): string {
  return layout(base, "Beslutninger", `<main><h1>Beslutninger</h1><div class="card"><label>Søg<input id="q" type="search" placeholder="Fx medlemskab, budget, Open"></label>
${decisions.length ? `<table id="list"><tr><th>Dato</th><th>Beslutning</th><th>Kilde</th></tr>${decisions.map(d => `<tr><td>${esc(/^\d{4}-/.test(d.date) ? shortDay(d.date) : d.date || "-")}</td>
<td>${d.topic ? `<strong>${esc(d.topic)}:</strong> ` : ""}${esc(d.text)}</td><td>${d.minutesId ? `<a href="${base}/referat/${d.minutesId}">Referat</a>` : `<span class="muted">Dokumentet</span>`}</td></tr>`).join("")}</table>`
    : `<p class="muted">Ingen beslutninger endnu.</p>`}</div></main>
<script>document.getElementById("q").addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("#list tr").forEach((r,i)=>{if(i)r.hidden=q&&!r.textContent.toLowerCase().includes(q)})})</script>`, { section: "/beslutninger", who });
}

export function archivePage(base: string, data: { minutes: ApprovedMinutes[]; history: Array<{ day: string; label: string; text: string }>; docUrl: string | null; docError: string | null; who: string | null }): string {
  return layout(base, "Arkiv", `<main><h1>Arkiv</h1><div class="grid"><div class="card"><h2>Referater fra Saga</h2>
${data.minutes.length ? `<ul class="plain">${data.minutes.map(m => `<li><a href="${base}/referat/${m.id}">Referat ${esc(m.meeting_date ? longDay(m.meeting_date) : "")}</a></li>`).join("")}</ul>` : `<p class="muted">Ingen endnu.</p>`}</div>
<div class="card"><h2>Tidligere referater</h2>${data.docUrl ? `<p class="small"><a href="${esc(data.docUrl)}" target="_blank" rel="noopener">Åbn referatdokumentet</a></p>` : ""}
${data.docError ? `<p class="muted">${esc(data.docError)}</p>` : data.history.length ? data.history.map(h => `<details><summary>${esc(longDay(h.day))}</summary><div style="white-space:pre-wrap" class="small">${esc(h.text)}</div></details>`).join("")
    : `<p class="muted">Ingen referater fundet i dokumentet.</p>`}</div></div></main>`, { section: "/arkiv", who: data.who });
}
