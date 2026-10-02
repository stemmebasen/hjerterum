import type { EventStats, HouseEvent } from "./events.js";
import { esc, layout } from "./page.js";
import { DESK_STYLE } from "./eventDesk.js";

/** Hjerterum's events in the cockpit: what is coming, the history since 2019, and a search. */

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
const when = (e: HouseEvent) => `${WHEN.format(e.starts_at_ms)} · kl. ${CLOCK.format(e.starts_at_ms)}${e.ends_at_ms ? `-${CLOCK.format(e.ends_at_ms)}` : ""}`;
const IMAGE_HOST = /^https:\/\/d1tif55lvfk8gc\.cloudfront\.net\//;

const STYLE = `
.ev-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.ev-stats div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.ev-stats b{display:block;font-size:24px;letter-spacing:-.01em}.ev-stats span{font-size:13px;color:var(--muted)}
.ev-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.ev-card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.ev-card img{width:100%;aspect-ratio:16/7;object-fit:cover;background:var(--soft);display:block}.ev-card div{padding:10px 12px 12px;display:grid;gap:3px}
.ev-card strong{font-size:15px;line-height:1.3}.ev-list li{display:grid;gap:2px}.ev-gone{text-decoration:line-through;color:var(--muted)}
.ev-bars{display:grid;gap:6px}.ev-bar{display:grid;grid-template-columns:44px 1fr 44px;gap:8px;align-items:center;font-size:13px}.ev-bar i{display:block;height:14px;border-radius:0 4px 4px 0;background:var(--accent);min-width:2px}
.ev-bar span:last-child{text-align:right;color:var(--muted)}form.search{display:flex;gap:8px;flex-wrap:wrap}form.search input{flex:1 1 220px}form.search select{flex:0 0 120px}`;

const card = (e: HouseEvent) => `<article class="ev-card">${e.image_url && IMAGE_HOST.test(e.image_url) ? `<img src="${esc(e.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
<div><span class="small muted">${esc(when(e))}</span><strong>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</strong>
${e.host ? `<span class="small">${esc(e.host)}</span>` : ""}${e.category ? `<span class="small muted">${esc(e.category)}</span>` : ""}</div></article>`;

const line = (e: HouseEvent) => `<li><span class="small muted">${esc(when(e))}${e.category ? ` · ${esc(e.category)}` : ""}</span>
<span class="${e.removed_at_ms ? "ev-gone" : ""}">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}${e.host ? ` · ${esc(e.host)}` : ""}</span>
${e.removed_at_ms ? `<span class="small muted">Fjernet fra kalenderen</span>` : ""}</li>`;

export function eventsPage(base: string, data: { stats: EventStats; coming: HouseEvent[]; recent: HouseEvent[]; results: HouseEvent[] | null; query: string; year: number | null;
  thisYear: number; syncing: boolean; who: string | null; desk?: string }): string {
  const s = data.stats, count = (y: number) => s.byYear.find(b => b.year === String(y))?.n ?? 0, max = Math.max(1, ...s.byYear.map(b => b.n));
  const years = s.byYear.map(b => Number(b.year)).filter(Boolean).sort((a, b) => b - a);
  const search = `<form class="search" method="get" action="${base}/arrangementer"><input type="search" name="q" value="${esc(data.query)}" placeholder="Søg fx yoga, lydhealing, et navn" aria-label="Søg i arrangementer">
<select name="aar" aria-label="År"><option value="">Alle år</option>${years.map(y => `<option${y === data.year ? " selected" : ""}>${y}</option>`).join("")}</select><button>Søg</button></form>`;
  const results = data.results ? `<div class="card"><h2>${data.results.length === 100 ? "Over 100" : data.results.length} arrangement${data.results.length === 1 ? "" : "er"}${data.query ? ` med "${esc(data.query)}"` : ""}${data.year ? ` i ${data.year}` : ""}</h2>
${data.results.length ? `<ul class="plain ev-list">${data.results.map(line).join("")}</ul>` : `<p class="muted">Ingen arrangementer fundet.</p>`}</div>` : "";
  const overview = data.results ? "" : `<h2 style="margin:8px 0 0">Kommende</h2>${data.coming.length ? `<div class="ev-cards">${data.coming.map(card).join("")}</div>` : `<p class="muted">Ingen kommende arrangementer i kalenderen.</p>`}
<div class="grid"><div class="card"><h2>Arrangementer pr. år</h2><div class="ev-bars" role="img" aria-label="Antal arrangementer pr. år">${s.byYear.map(b => `<div class="ev-bar"><span>${esc(b.year)}</span><i style="width:${Math.round(b.n / max * 100)}%"></i><span>${b.n}${Number(b.year) === data.thisYear ? "*" : ""}</span></div>`).join("")}</div>
<p class="small muted">* indtil nu, inkl. planlagte.</p></div>
<div class="card"><h2>Mest aktive det seneste år</h2>${s.hosts.length ? `<table>${s.hosts.map(h => `<tr><td>${esc(h.host)}</td><td style="text-align:right">${h.n}</td></tr>`).join("")}</table>` : `<p class="muted small">Underviserne står ikke i kalenderen.</p>`}
<h3>Kategorier</h3><table>${s.categories.map(c => `<tr><td>${esc(c.category)}</td><td style="text-align:right">${c.n}</td></tr>`).join("")}</table></div></div>
<div class="card"><h2>Seneste afholdte</h2><ul class="plain ev-list">${data.recent.map(line).join("")}</ul></div>`;
  return layout(base, "Arrangementer", `<main><h1>Arrangementer</h1>${data.syncing ? `<p class="notice">Saga henter stadig hele historikken fra kalenderen. Den er klar inden for en time.</p>` : ""}
<div class="ev-stats"><div><b>${s.coming30}</b><span>de næste 30 dage</span></div><div><b>${count(data.thisYear)}</b><span>i ${data.thisYear}</span></div>
<div><b>${count(data.thisYear - 1)}</b><span>i ${data.thisYear - 1}</span></div><div><b>${s.total}</b><span>i alt${s.first ? ` siden ${new Date(s.first).getUTCFullYear()}` : ""}</span></div></div>
${data.desk ?? ""}${search}${results}${overview}</main>`, { section: "/arrangementer", who: data.who, style: STYLE + DESK_STYLE });
}
