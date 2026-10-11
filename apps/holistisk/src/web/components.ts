import { CATEGORIES, categoryBySlug } from "../categories.js";
import { areaBySlug, type Area } from "../geo.js";
import { priceLabel } from "../price.js";
import { capitalize, dateBadge, dayLabel, timeRangeLabel } from "../time.js";
import { PERIODS, PRICES, toQuery, type Filters } from "./filters.js";
import { html, raw, type SafeHtml } from "./html.js";
import type { EventRow } from "./queries.js";

export const eventPath = (e: Pick<EventRow, "slug">) => `/events/${e.slug}`;
const cats = (e: Pick<EventRow, "categories">) => (e.categories ?? "").split(",").filter(Boolean);

/** A soft colour field (by category) for events without a picture we may show. */
const TONES = ["sage", "clay", "sand", "mist", "dusk", "moss"];
const toneFor = (e: Pick<EventRow, "categories" | "id">) => {
  const c = cats(e)[0] ?? e.id;
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
};

export function placeLine(e: Pick<EventRow, "venue_name" | "city" | "area">): string {
  const area = e.area ? areaBySlug(e.area)?.name : null;
  const parts = [e.venue_name, e.city].filter((p): p is string => !!p);
  if (e.city && e.venue_name && e.venue_name.toLowerCase().includes(e.city.toLowerCase())) parts.pop();
  return parts.length ? parts.join(", ") : area ?? "";
}

export function eventCard(e: EventRow, now: number, options: { headingLevel?: 2 | 3 } = {}): SafeHtml {
  const badge = dateBadge(e.starts_at);
  const price = priceLabel(e);
  const categories = cats(e).slice(0, 2).map(c => categoryBySlug(c)?.short).filter(Boolean);
  const heading = options.headingLevel === 2 ? "h2" : "h3";
  return html`<article class="card${e.status === "cancelled" ? " is-cancelled" : ""}">
  <a class="card-link" href="${eventPath(e)}">
    <div class="card-media tone-${toneFor(e)}">
      ${e.image_url ? html`<img src="${e.image_url}" alt="" loading="lazy" decoding="async">` : html`<span class="card-motif" aria-hidden="true"></span>`}
      <span class="date-badge" aria-hidden="true"><span>${badge.weekday}</span><strong>${badge.day}</strong><span>${badge.month}</span></span>
      ${e.status === "cancelled" ? html`<span class="flag flag-cancelled">Aflyst</span>` : ""}
    </div>
    <div class="card-body">
      ${raw(`<${heading} class="card-title">`)}${e.title}${raw(`</${heading}>`)}
      <p class="card-when"><span class="visually-hidden">Tid: </span>${capitalize(dayLabel(e.starts_at, now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, now)}</p>
      <p class="card-where"><span class="visually-hidden">Sted: </span>${placeLine(e)}</p>
      <p class="card-meta">${categories.map(c => html`<span class="tag">${c}</span>`)}${price ? html`<span class="card-price">${price}</span>` : ""}</p>
    </div>
  </a>
</article>`;
}

export function cardGrid(events: EventRow[], now: number, headingLevel: 2 | 3 = 3): SafeHtml {
  return html`<div class="card-grid">${events.map(e => eventCard(e, now, { headingLevel }))}</div>`;
}

export function searchForm(areas: Area[], selected: { q?: string; area?: string | null }, options: { compact?: boolean } = {}): SafeHtml {
  return html`<form class="search${options.compact ? " search-compact" : ""}" action="/events" method="get" role="search">
  <label class="visually-hidden" for="s-q">Søg efter events</label>
  <input id="s-q" name="q" type="search" value="${selected.q ?? ""}" placeholder="Søg fx yoga, lydbad, kakao …" autocomplete="off" maxlength="80">
  <label class="visually-hidden" for="s-area">Område</label>
  <select id="s-area" name="omraade">
    <option value="">Hele området</option>
    ${areas.map(a => html`<option value="${a.slug}"${selected.area === a.slug ? raw(" selected") : ""}>${a.name}</option>`)}
  </select>
  <button type="submit">Find events</button>
</form>`;
}

/** The filter panel: a plain GET form (it works without JavaScript); the script only submits on change. */
export function filterPanel(f: Filters, areas: Area[], cityList: Array<{ city: string; n: number }>, categoryCounts: Map<string, number>, showPrice: boolean): SafeHtml {
  const checked = (on: boolean) => on ? raw(" checked") : "";
  const selected = (on: boolean) => on ? raw(" selected") : "";
  return html`<form class="filters" action="/events" method="get" data-autosubmit>
  <div class="filter-group">
    <label for="f-q">Søg</label>
    <input id="f-q" name="q" type="search" value="${f.q}" placeholder="Ord, underviser, sted …" maxlength="80">
  </div>
  <fieldset class="filter-group">
    <legend>Hvornår</legend>
    <div class="chips">
      <label class="chip"><input type="radio" name="periode" value=""${checked(!f.period)}><span>Alle kommende</span></label>
      ${PERIODS.map(p => html`<label class="chip"><input type="radio" name="periode" value="${p.value}"${checked(f.period === p.value)}><span>${p.label}</span></label>`)}
    </div>
    <div class="date-range">
      <label>Fra <input type="date" name="fra" value="${f.period ? "" : f.from ?? ""}"></label>
      <label>Til <input type="date" name="til" value="${f.period ? "" : f.to ?? ""}"></label>
    </div>
  </fieldset>
  <div class="filter-group">
    <label for="f-area">Område</label>
    <select id="f-area" name="omraade">
      <option value="">Alle områder</option>
      ${areas.map(a => html`<option value="${a.slug}"${selected(f.area === a.slug)}>${a.name}</option>`)}
    </select>
  </div>
  ${cityList.length > 1 || f.city ? html`<div class="filter-group">
    <label for="f-city">By</label>
    <select id="f-city" name="by">
      <option value="">Alle byer</option>
      ${cityList.map(c => html`<option value="${c.city}"${selected(f.city === c.city)}>${c.city} (${c.n})</option>`)}
      ${f.city && !cityList.some(c => c.city === f.city) ? html`<option value="${f.city}" selected>${f.city}</option>` : ""}
    </select>
  </div>` : ""}
  <fieldset class="filter-group">
    <legend>Kategori</legend>
    <div class="checks">
      ${CATEGORIES.map(c => html`<label class="check"><input type="checkbox" name="kategori" value="${c.slug}"${checked(f.categories.includes(c.slug))}><span>${c.name}</span><span class="count">${categoryCounts.get(c.slug) ?? 0}</span></label>`)}
    </div>
  </fieldset>
  ${showPrice || f.price ? html`<fieldset class="filter-group">
    <legend>Pris</legend>
    <div class="chips">
      <label class="chip"><input type="radio" name="pris" value=""${checked(!f.price)}><span>Alle</span></label>
      ${PRICES.map(p => html`<label class="chip"><input type="radio" name="pris" value="${p.value}"${checked(f.price === p.value)}><span>${p.label}</span></label>`)}
    </div>
    <p class="hint">Kun events med en kendt pris tæller med.</p>
  </fieldset>` : ""}
  <div class="filter-actions">
    <button type="submit">Vis events</button>
    <a class="reset" href="/events">Nulstil filtre</a>
  </div>
</form>`;
}

/** The active filters as removable chips. */
export function activeFilterChips(f: Filters): SafeHtml {
  const chips: Array<{ label: string; href: string }> = [];
  if (f.q) chips.push({ label: `“${f.q}”`, href: "/events" + toQuery(f, { q: "", page: 1 }) });
  if (f.period) chips.push({ label: PERIODS.find(p => p.value === f.period)!.label, href: "/events" + toQuery(f, { period: null, page: 1 }) });
  if (!f.period && (f.from || f.to)) chips.push({ label: `${f.from ?? "nu"} – ${f.to ?? ""}`, href: "/events" + toQuery(f, { from: null, to: null, page: 1 }) });
  for (const c of f.categories) chips.push({ label: categoryBySlug(c)?.name ?? c, href: "/events" + toQuery(f, { categories: f.categories.filter(x => x !== c), page: 1 }) });
  if (f.area) chips.push({ label: areaBySlug(f.area)?.name ?? f.area, href: "/events" + toQuery(f, { area: null, city: null, page: 1 }) });
  if (f.city) chips.push({ label: f.city, href: "/events" + toQuery(f, { city: null, page: 1 }) });
  if (f.price) chips.push({ label: PRICES.find(p => p.value === f.price)!.label, href: "/events" + toQuery(f, { price: null, page: 1 }) });
  if (!chips.length) return html``;
  return html`<ul class="active-filters" aria-label="Valgte filtre">
  ${chips.map(c => html`<li><a href="${c.href}" aria-label="Fjern filter: ${c.label}">${c.label}<span aria-hidden="true"> ×</span></a></li>`)}
  <li><a class="reset" href="/events">Nulstil alle</a></li>
</ul>`;
}

export function pagination(f: Filters, total: number, pageSize: number, basePath: string): SafeHtml {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return html``;
  const link = (p: number) => basePath + toQuery(f, { page: p });
  return html`<nav class="pagination" aria-label="Sider">
  ${f.page > 1 ? html`<a href="${link(f.page - 1)}" rel="prev">← Forrige</a>` : html`<span></span>`}
  <span>Side ${f.page} af ${pages}</span>
  ${f.page < pages ? html`<a href="${link(f.page + 1)}" rel="next">Næste →</a>` : html`<span></span>`}
</nav>`;
}

export function categoryTiles(counts: Map<string, number>): SafeHtml {
  return html`<ul class="category-tiles">
  ${CATEGORIES.map(c => html`<li><a href="/kategori/${c.slug}" class="tile cat-${c.slug}"><span class="tile-name">${c.name}</span><span class="tile-count">${countLabel(counts.get(c.slug) ?? 0)}</span></a></li>`)}
</ul>`;
}

export const countLabel = (n: number): string => n === 0 ? "Ingen lige nu" : n === 1 ? "1 kommende event" : `${n} kommende events`;
