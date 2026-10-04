import { SITE_PAGES } from "../../site/pages.js";
import { KEEP_MONTHS, STATS_PERIODS, type Ranked, type SiteStats } from "../site-stats.js";
import { esc, layout } from "./page.js";
import { enquiryTopic } from "../../site/enquiries.js";

/** Requested: "I admin skal vi også have en statistik side på som den vi bruger i Matrix" - and then "Byg en statistikside
 * i jeres admin over besøg på jeres offentlige hjemmeside": unique visitors and page views for the last 7, 30 or 90 days
 * against the days before, visitors per day (also as a table), and the pages, entry pages, sources, campaigns, devices
 * and countries behind them - the same numbers GET /api/stats/site gives the outside overview (worker/site-stats.ts).
 * In Lys, written on the server like the rest of the cockpit. */

const number = (value: number) => new Intl.NumberFormat("da-DK").format(value);
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (day: string, long = false) => (long ? LONG_DAY : DAY).format(new Date(`${day}T12:00:00Z`));
const percent = (part: number, whole: number) => whole ? `${String(Math.round(part / whole * 1000) / 10).replace(".", ",")} %` : "–";
const pageTitle = (path: string) => path === "/" ? "Forsiden" : SITE_PAGES.find(page => page.path === path)?.card.title ?? "";
const DEVICES: Record<string, string> = { mobile: "Mobil", desktop: "Computer", tablet: "Tablet" };
const countryName = (code: string) => { try { return new Intl.DisplayNames(["da"], { type: "region" }).of(code) ?? code; } catch { return code; } };
const decimal = (value: number) => value.toLocaleString("da-DK", { maximumFractionDigits: 1 });

export const STATS_STYLE = `
.st-head{display:flex;justify-content:space-between;align-items:end;gap:16px;flex-wrap:wrap}
.st-periods{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.st-periods a{padding:7px 15px;border-radius:999px;text-decoration:none;color:var(--muted);font-weight:600;font-size:14px}
.st-periods a[aria-current]{background:var(--accent);color:var(--accent-ink)}
.st-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.st-tile{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;display:grid;gap:4px;box-shadow:var(--shadow);align-content:start}
.st-tile>span:first-child{font-size:13px;color:var(--muted);font-weight:550}.st-tile strong{font:400 34px/1.1 var(--serif);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.st-delta{font-size:12.5px;color:var(--faint)}.st-delta b{font-weight:650}.st-delta b.up{color:var(--good)}.st-delta b.down{color:var(--warn)}
.st-chart{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 10px;margin-top:4px}
.st-axis{display:flex;flex-direction:column;justify-content:space-between;font-size:11.5px;line-height:14px;color:var(--faint);text-align:right;font-variant-numeric:tabular-nums;height:200px;margin-top:-7px}
.st-plot{position:relative;height:186px;display:flex;align-items:flex-end;gap:var(--gap,4px);border-bottom:1px solid var(--line);
 background:linear-gradient(var(--line),var(--line)) 0 0/100% 1px no-repeat,linear-gradient(var(--line),var(--line)) 0 50%/100% 1px no-repeat}
.st-col{flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;outline:none;border-radius:4px}
.st-col i{display:block;width:100%;max-width:22px;background:var(--lys-terra);border-radius:4px 4px 0 0;min-height:0}
.st-col:hover i,.st-col:focus i{opacity:.75}.st-col:focus-visible{box-shadow:0 0 0 2px var(--accent)}
.st-tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:2;background:var(--card);border:1px solid var(--line);border-radius:10px;
 padding:8px 11px;font-size:12.5px;line-height:1.5;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.14);pointer-events:none;text-align:left}
.st-tip b{display:block}.st-col:hover .st-tip,.st-col:focus .st-tip{display:block}
.st-col:first-child .st-tip,.st-col:nth-child(2) .st-tip{left:0;transform:none}.st-col:last-child .st-tip,.st-col:nth-last-child(2) .st-tip{left:auto;right:0;transform:none}
.st-dates{grid-column:2;display:flex;gap:var(--gap,4px);font-size:11.5px;color:var(--faint);margin-top:6px}
.st-dates span{flex:1;min-width:0;display:flex;justify-content:center;white-space:nowrap}.st-dates span:first-child{justify-content:flex-start}.st-dates span:last-child{justify-content:flex-end}.st-dates span:not(.d){visibility:hidden}
.st-note{font-size:13px;color:var(--faint);margin:12px 0 0}
.st-lists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
table.st-table td,table.st-table th{padding:7px 6px;font-size:14px}table.st-table th{font-size:11.5px}table.st-table .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:1%}
table.st-table td.k{max-width:0;width:100%}.st-bar{position:relative;padding:3px 8px;border-radius:6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.st-bar i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--lys-terra) 14%,transparent);border-radius:6px}.st-bar span{position:relative}.st-bar small{position:relative;color:var(--faint);margin-left:6px}
.st-empty{display:grid;gap:8px;max-width:620px}
@media (max-width:860px){.st-lists{grid-template-columns:1fr}.st-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.st-tile:last-child:nth-child(odd){grid-column:1/-1}.st-tile strong{font-size:28px}}
@media (max-width:760px){.st-axis{height:156px}.st-plot{height:142px}.st-dates span.d:not(.m){visibility:hidden}.st-dates span.m{visibility:visible}table.st-table .v{display:none}.st-bar small{display:none}}
`;

/** A change against the period before: the arrow and the sign carry it, not only the colour. */
function delta(now: number, before: number): string {
  if (!before) return `<span class="st-delta">${now ? "Ny i perioden" : "Ingen at sammenligne med"}</span>`;
  const change = Math.round((now - before) / before * 100);
  return `<span class="st-delta"><b class="${change > 0 ? "up" : change < 0 ? "down" : ""}">${change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}${change} %</b> mod forrige periode</span>`;
}

function tiles(stats: SiteStats): string {
  const t = stats.totals, p = stats.previous;
  const tile = (label: string, value: string, after: string, kpi: string) => `<div class="st-tile"><span>${label}</span><strong data-kpi="${kpi}">${value}</strong>${after}</div>`;
  const perVisitor = (views: number, visitors: number) => visitors ? decimal(views / visitors) : "–";
  // Henvendelser and konvertering only where the site counts enquiries from its own forms (site/enquiries.ts).
  return `<div class="st-tiles">${tile("Unikke besøgende", number(t.visitors), delta(t.visitors, p.visitors), "visitors")}${tile("Sidevisninger", number(t.pageViews), delta(t.pageViews, p.pageViews), "pageViews")}
${stats.tracksEnquiries ? `${tile("Henvendelser", number(t.enquiries), delta(t.enquiries, p.enquiries), "enquiries")}${tile("Konvertering", t.conversionRate === null ? "–" : `${decimal(t.conversionRate)} %`,
    `<span class="st-delta">henvendelser pr. besøgende${p.visitors ? ` · før ${percent(p.enquiries, p.visitors)}` : ""}</span>`, "conversion")}` : ""}
${tile("Sider pr. besøgende", perVisitor(t.pageViews, t.visitors), `<span class="st-delta">før ${perVisitor(p.pageViews, p.visitors)}</span>`, "pagesPerVisitor")}</div>`;
}

/** Visitors per day: one series, so no legend - the heading names it. Each column shows its numbers on hover or focus. */
function chart(series: SiteStats["series"], withEnquiries: boolean): string {
  const max = Math.max(1, ...series.map(d => d.visitors));
  const step = 10 ** Math.floor(Math.log10(max)), top = Math.ceil(max / step) * step;
  const every = Math.ceil(series.length / 10), gap = series.length > 40 ? 1 : series.length > 14 ? 3 : 8;
  // As many dates as there is room for; the last day always, and never one crowding it.
  const shown = (i: number, step: number) => i === series.length - 1 || (i % step === 0 && series.length - 1 - i >= step * 0.7);
  const phone = Math.ceil(series.length / 4);
  const columns = series.map(d => `<div class="st-col" tabindex="0" aria-label="${esc(dayLabel(d.day, true))}: ${d.visitors} besøgende"><i style="height:${(d.visitors / top * 100).toFixed(1)}%"></i>
<span class="st-tip"><b>${esc(dayLabel(d.day, true))}</b>${number(d.visitors)} besøgende<br>${number(d.pageViews)} sidevisninger${withEnquiries ? `<br>${number(d.enquiries)} henvendelser` : ""}</span></div>`).join("");
  return `<div class="st-chart" style="--gap:${gap}px"><div class="st-axis" aria-hidden="true"><span>${number(top)}</span><span>${number(top / 2)}</span><span>0</span></div>
<div class="st-plot" role="img" aria-label="Unikke besøgende pr. dag">${columns}</div>
<div class="st-dates" aria-hidden="true">${series.map((d, i) => {
    const marks = [shown(i, every) ? "d" : "", shown(i, phone) ? "m" : ""].filter(Boolean).join(" ");
    return `<span${marks ? ` class="${marks}"` : ""}>${marks ? esc(dayLabel(d.day)) : ""}</span>`;
  }).join("")}</div></div>`;
}

function dayTable(series: SiteStats["series"], withEnquiries: boolean): string {
  return `<table class="st-table"><tr><th>Dag</th><th class="n">Besøgende</th><th class="n">Sidevisninger</th>${withEnquiries ? '<th class="n">Henvendelser</th>' : ""}</tr>
${series.slice().reverse().map(d => `<tr><td>${esc(dayLabel(d.day, true))}</td><td class="n">${number(d.visitors)}</td><td class="n">${number(d.pageViews)}</td>${withEnquiries ? `<td class="n">${number(d.enquiries)}</td>` : ""}</tr>`).join("")}</table>`;
}

function list(title: string, unit: string, items: Ranked[], label: (key: string) => { text: string; small?: string }): string {
  const max = Math.max(1, ...items.map(i => i.visitors));
  const rows = items.map(item => {
    const { text, small } = label(item.key);
    return `<tr><td class="k"><div class="st-bar" title="${esc(small ? `${text} · ${small}` : text)}"><i style="width:${Math.round(item.visitors / max * 100)}%"></i><span>${esc(text)}</span>${small ? `<small>${esc(small)}</small>` : ""}</div></td>
<td class="n">${number(item.visitors)}</td><td class="n v">${number(item.views)}</td></tr>`;
  }).join("");
  return `<section class="panel"><header><h2>${title}</h2></header>${items.length
    ? `<table class="st-table"><tr><th>${unit}</th><th class="n">Besøgende</th><th class="n v">Visninger</th></tr>${rows}</table>`
    : `<p class="empty">Intet i perioden.</p>`}</section>`;
}

const page = (key: string) => ({ text: key || "/", small: pageTitle(key) });

/** The enquiries by topic, for the board: the counted forms (site/enquiries.ts). */
function topicList(topics: Array<{ key: string; count: number }>): string {
  const max = Math.max(1, ...topics.map(t => t.count));
  return `<section class="panel"><header><h2>Henvendelser efter emne</h2></header>${topics.length ? `<table class="st-table"><tr><th>Emne</th><th class="n">Henvendelser</th></tr>${topics.map(t => {
    const label = enquiryTopic(t.key)?.label.da ?? t.key;
    return `<tr><td class="k"><div class="st-bar" title="${esc(label)}"><i style="width:${Math.round(t.count / max * 100)}%"></i><span>${esc(label)}</span></div></td><td class="n">${number(t.count)}</td></tr>`;
  }).join("")}</table>` : `<p class="empty">Ingen henvendelser i perioden.</p>`}</section>`;
}

export function statsPage(base: string, who: string | null, stats: SiteStats, counting = true, topics: Array<{ key: string; count: number }> = []): string {
  const periods = STATS_PERIODS.map(days => `<a href="${base}/statistik?dage=${days}"${days === stats.days ? ' aria-current="page"' : ""}>${days} dage</a>`).join("");
  const head = `<div class="st-head"><div class="hero"><h1>Statistik</h1><p>Hjemmesidens besøg de seneste ${stats.days} dage, ${esc(dayLabel(stats.from, true))} – ${esc(dayLabel(stats.to, true))}</p></div>
<nav class="st-periods" aria-label="Periode">${periods}</nav></div>`;
  const how = `En besøgende tælles én gang pr. dag. Der bruges ingen cookies, og ingen adresser gemmes, så ingen kan følges fra dag til dag. Besøg fra browsere med Global Privacy Control tælles ikke, og besøgene slettes efter ${KEEP_MONTHS} måneder.`;
  const off = counting ? "" : `<p class="notice warn">Tællingen er ikke slået til: hemmeligheden STATS_API_SECRET er ikke sat på serveren.</p>`;
  const t = stats.totals;
  if (!t.visitors && !t.pageViews && !stats.previous.visitors) {
    return layout(base, "Statistik", `<main>${head}${off}${tiles(stats)}<section class="panel st-empty"><h2>Ingen besøg registreret endnu</h2>
<p class="muted">Tællingen starter med det første besøg på hjemmesiden${counting ? "" : ", når STATS_API_SECRET er sat"}. ${how}</p></section></main>`, { section: "/statistik", who, style: STATS_STYLE });
  }
  return layout(base, "Statistik", `<main>${head}${off}${tiles(stats)}
<section class="panel"><header><h2>Unikke besøgende pr. dag</h2></header>${chart(stats.series, stats.tracksEnquiries)}
<details><summary>Vis som tabel</summary>${dayTable(stats.series, stats.tracksEnquiries)}</details>
<p class="st-note">${how}${stats.tracksEnquiries ? " Henvendelser er dem, der er sendt med hjemmesidens formularer; konvertering er henvendelser pr. besøgende." : ""}</p></section>
<div class="st-lists">
${list("Mest besøgte sider", "Side", stats.pages, page)}
${list("Indgangssider", "Første side", stats.entryPages, page)}
${list("Kilder", "Kom fra", stats.referrers, key => ({ text: key || "Direkte eller ukendt" }))}
${list("Kampagner (UTM)", "Kilde · medie · kampagne", stats.campaigns, key => ({ text: key.split("|").filter(Boolean).join(" · ") || "–" }))}
${list("Enheder", "Enhed", stats.devices, key => ({ text: DEVICES[key] ?? (key || "Ukendt") }))}
${list("Lande", "Land", stats.countries, key => key ? { text: countryName(key), small: key } : { text: "Ukendt" })}
${stats.tracksEnquiries ? topicList(topics) : ""}
</div></main>`, { section: "/statistik", who, style: STATS_STYLE });
}
