import { CATEGORIES, categoryBySlug } from "../categories.js";
import { areaBySlug, type Area } from "../geo.js";
import { priceLabel } from "../price.js";
import { capitalize, dayLabel, hhmm, localDate, timeRangeLabel } from "../time.js";
import { PERIODS, PRICES, toQuery, type Filters } from "./filters.js";
import { html, raw, type SafeHtml } from "./html.js";
import type { EventRow } from "./queries.js";
import { offersFor } from "../flokken/partners.js";

export const eventPath = (e: Pick<EventRow, "slug">) => `/events/${e.slug}`;
const cats = (e: Pick<EventRow, "categories">) => (e.categories ?? "").split(",").filter(Boolean);

export function placeLine(e: Pick<EventRow, "venue_name" | "city" | "area">): string {
  const area = e.area ? areaBySlug(e.area)?.name : null;
  const parts = [e.venue_name, e.city].filter((p): p is string => !!p);
  if (e.city && e.venue_name && e.venue_name.toLowerCase().includes(e.city.toLowerCase())) parts.pop();
  return parts.length ? parts.join(", ") : area ?? "";
}

/** The small label above a title: "Meditation · Aarhus". */
export function kicker(e: Pick<EventRow, "categories" | "area" | "status" | "city">): SafeHtml {
  const category = categoryBySlug(cats(e)[0] ?? "")?.short;
  // The town itself ("Nørre Snede"), not the area it belongs to, when the two differ.
  const town = e.city?.replace(/\s+[A-ZÆØÅ]{1,2}$/, "") ?? null;
  const area = e.area ? areaBySlug(e.area) : null;
  const place = town && area && !area.towns.includes(town.toLowerCase()) && town.toLowerCase() !== area.place.toLowerCase() ? town : area?.place ?? town;
  return html`<p class="kicker">${e.status === "cancelled" ? html`<span class="kicker-alert">Aflyst</span> · ` : ""}${[category, place].filter(Boolean).join(" · ")}</p>`;
}

/** The flock line on cards and calendar rows: how many flocks are going, or an invitation to start one. Nothing for
 * events that have started or are cancelled. */
export function flockBadge(e: Pick<EventRow, "flock_count" | "status" | "starts_at">, now: number): SafeHtml {
  if (e.status !== "scheduled" || e.starts_at <= now) return html``;
  const n = e.flock_count ?? 0;
  return n ? html`<span class="flock-badge"><span aria-hidden="true">●●●</span> ${n === 1 ? "1 flok" : `${n} flokke`} · Find en flok</span>`
    : html`<span class="flock-badge flock-badge-new">Opret en flok</span>`;
}

/** The chips under a card or row: free, a confirmed member benefit, and the flock line. */
export function eventChips(e: EventRow, now: number): SafeHtml {
  const free = e.is_free === 1;
  const benefit = offersFor(e).length > 0;
  return html`<span class="chip-row">${free ? html`<span class="price-chip">Gratis</span>` : ""}${benefit ? html`<span class="price-chip price-chip-member">Medlemsfordel</span>` : ""}${flockBadge(e, now)}</span>`;
}

const when = (e: EventRow, now: number) => `${capitalize(dayLabel(e.starts_at, now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, now)}`;

/** A picture, or for events without one we may show, a quiet typographic stand-in with the date. */
function media(e: EventRow): SafeHtml {
  if (e.image_url) return html`<figure class="media"><img src="${e.image_url}" alt="" loading="lazy" decoding="async"></figure>`;
  const [, m, day] = localDate(e.starts_at).split("-");
  const months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return html`<figure class="media media-plain" aria-hidden="true"><span class="plain-day">${String(Number(day))}</span><span class="plain-month">${months[Number(m) - 1]}</span></figure>`;
}

export function eventCard(e: EventRow, now: number, options: { headingLevel?: 2 | 3 } = {}): SafeHtml {
  const price = priceLabel(e);
  const heading = options.headingLevel === 2 ? "h2" : "h3";
  return html`<article class="card${e.status === "cancelled" ? " is-cancelled" : ""}">
  <a class="card-link" href="${eventPath(e)}">
    ${media(e)}
    ${kicker(e)}
    ${raw(`<${heading} class="card-title">`)}${e.title}${raw(`</${heading}>`)}
    <p class="meta"><span class="visually-hidden">Tid: </span>${when(e, now)}</p>
    <p class="meta meta-muted"><span class="visually-hidden">Sted: </span>${placeLine(e)}${price ? ` · ${price}` : ""}</p>
    ${eventChips(e, now)}
  </a>
</article>`;
}

export function cardGrid(events: EventRow[], now: number, headingLevel: 2 | 3 = 3): SafeHtml {
  return html`<div class="card-grid">${events.map(e => eventCard(e, now, { headingLevel }))}</div>`;
}

/** The calendar: events grouped under their day, one line each. */
export function dayList(events: EventRow[], now: number): SafeHtml {
  const days: Array<{ date: string; label: string; events: EventRow[] }> = [];
  for (const e of events) {
    const date = localDate(e.starts_at);
    const last = days[days.length - 1];
    if (last && last.date === date) last.events.push(e);
    else days.push({ date, label: capitalize(dayLabel(e.starts_at, now)), events: [e] });
  }
  return html`<div class="day-list">${days.map(d => html`<section class="day" aria-label="${d.label}">
  <h3 class="day-head"><time datetime="${d.date}">${d.label}</time></h3>
  <ol class="rows">${d.events.map(e => {
    const price = priceLabel(e);
    return html`<li class="row${e.status === "cancelled" ? " is-cancelled" : ""}"><a href="${eventPath(e)}">
      <span class="row-time">${e.all_day ? "Hele dagen" : hhmm(e.starts_at)}</span>
      <span class="row-body">${kicker(e)}<span class="row-title">${e.title}</span><span class="meta meta-muted">${placeLine(e)}${price ? ` · ${price}` : ""}${e.ends_at && !e.all_day && localDate(e.ends_at) === d.date ? ` · til ${hhmm(e.ends_at)}` : ""}</span>${eventChips(e, now)}</span>
      ${e.image_url ? html`<img class="row-img" src="${e.image_url}" alt="" loading="lazy" decoding="async">` : ""}
    </a></li>`;
  })}</ol>
</section>`)}</div>`;
}

export function searchForm(areas: Area[], selected: { q?: string; area?: string | null }, options: { compact?: boolean } = {}): SafeHtml {
  return html`<form class="search${options.compact ? " search-compact" : ""}" action="/kalender" method="get" role="search">
  <label class="visually-hidden" for="s-q">Søg i kalenderen</label>
  <input id="s-q" name="q" type="search" value="${selected.q ?? ""}" placeholder="Søg: workshop, yoga, foredrag …" autocomplete="off" maxlength="80">
  <label class="visually-hidden" for="s-area">By</label>
  <select id="s-area" name="omraade">
    <option value="">Hele Østjylland</option>
    ${areas.map(a => html`<option value="${a.slug}"${selected.area === a.slug ? raw(" selected") : ""}>${a.place}</option>`)}
  </select>
  <button type="submit">Søg</button>
</form>`;
}

/** A list of links with counts: "Meditation i Aarhus 12". */
export function linkList(items: Array<{ href: string; label: string; count?: number | null; note?: string | null }>, options: { columns?: boolean } = {}): SafeHtml {
  return html`<ul class="link-list${options.columns === false ? "" : " link-columns"}">${items.map(i => html`<li><a href="${i.href}"><span>${i.label}</span>${i.count !== undefined && i.count !== null ? html`<span class="count">${i.count}</span>` : ""}</a>${i.note ? html`<span class="link-note">${i.note}</span>` : ""}</li>`)}</ul>`;
}

/** Links as rounded chips, for activities, topics and towns: "Meditation 12". */
export function chipLinks(items: Array<{ href: string; label: string; count?: number | null }>): SafeHtml {
  return html`<ul class="chip-links">${items.map(i => html`<li><a href="${i.href}">${i.label}${i.count ? html` <span class="count">${i.count}</span>` : ""}</a></li>`)}</ul>`;
}

/** A section with a heading and an optional "more" link. */
export function section(id: string, title: string, body: SafeHtml, more?: { href: string; label: string }): SafeHtml {
  return html`<section class="section" aria-labelledby="${id}">
  <div class="section-head"><h2 id="${id}">${title}</h2>${more ? html`<a class="more" href="${more.href}">${more.label}</a>` : ""}</div>
  ${body}
</section>`;
}

/** The filter panel: a plain GET form (it works without JavaScript); the script only submits on change. */
export function filterPanel(f: Filters, areas: Area[], cityList: Array<{ city: string; n: number }>, categoryCounts: Map<string, number>, showPrice: boolean): SafeHtml {
  const checked = (on: boolean) => on ? raw(" checked") : "";
  const selected = (on: boolean) => on ? raw(" selected") : "";
  return html`<form class="filters" action="/kalender" method="get" data-autosubmit>
  ${f.topic ? html`<input type="hidden" name="emne" value="${f.topic}">` : ""}
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
    <a class="reset" href="/kalender">Nulstil filtre</a>
  </div>
</form>`;
}

/** The active filters as removable chips. */
export function activeFilterChips(f: Filters): SafeHtml {
  const chips: Array<{ label: string; href: string }> = [];
  if (f.q) chips.push({ label: `“${f.q}”`, href: "/kalender" + toQuery(f, { q: "", page: 1 }) });
  if (f.period) chips.push({ label: PERIODS.find(p => p.value === f.period)!.label, href: "/kalender" + toQuery(f, { period: null, page: 1 }) });
  if (!f.period && (f.from || f.to)) chips.push({ label: `${f.from ?? "nu"} – ${f.to ?? ""}`, href: "/kalender" + toQuery(f, { from: null, to: null, page: 1 }) });
  for (const c of f.categories) chips.push({ label: categoryBySlug(c)?.name ?? c, href: "/kalender" + toQuery(f, { categories: f.categories.filter(x => x !== c), page: 1 }) });
  if (f.area) chips.push({ label: areaBySlug(f.area)?.name ?? f.area, href: "/kalender" + toQuery(f, { area: null, city: null, page: 1 }) });
  if (f.city) chips.push({ label: f.city, href: "/kalender" + toQuery(f, { city: null, page: 1 }) });
  if (f.price) chips.push({ label: PRICES.find(p => p.value === f.price)!.label, href: "/kalender" + toQuery(f, { price: null, page: 1 }) });
  if (!chips.length) return html``;
  return html`<ul class="active-filters" aria-label="Valgte filtre">
  ${chips.map(c => html`<li><a href="${c.href}" aria-label="Fjern filter: ${c.label}">${c.label}<span aria-hidden="true"> ×</span></a></li>`)}
  <li><a class="reset" href="/kalender">Nulstil alle</a></li>
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


/** The front page's drawing: three friends on their way to a concert under the sun, in Flokken's colours. */
export const HERO_ART = raw(`<svg class="hero-art" viewBox="0 0 420 330" role="img" aria-label="Tre venner på vej til en koncert">
  <circle cx="318" cy="92" r="62" fill="#f4bd3a"/>
  <ellipse cx="96" cy="78" rx="52" ry="34" fill="#f6b3cf"/>
  <ellipse cx="210" cy="300" rx="176" ry="17" fill="#e6ddcf"/>
  <g fill="#d4452a"><path d="M62 150c0-4 3-7 7-7h2v-30l26-6v34c0 6-5 10-11 10s-10-4-10-9 4-9 9-9h3v-14l-14 3v24c0 6-5 10-11 10s-10-4-10-9z" transform="translate(-30 -40) scale(.8)"/><circle cx="384" cy="190" r="7"/><rect x="389" y="160" width="4" height="31" rx="2"/></g>
  <g class="friend">
    <rect x="96" y="226" width="12" height="66" rx="6" fill="#17172b"/><rect x="122" y="226" width="12" height="66" rx="6" fill="#17172b"/>
    <rect x="88" y="150" width="56" height="88" rx="28" fill="#3b8bd0"/>
    <rect x="132" y="120" width="12" height="52" rx="6" fill="#3b8bd0" transform="rotate(28 138 160)"/>
    <rect x="150" y="96" width="30" height="20" rx="4" fill="#ffffff" stroke="#17172b" stroke-width="3" transform="rotate(-14 165 106)"/>
    <circle cx="116" cy="124" r="24" fill="#8d5524"/><path d="M92 122c0-16 12-27 25-27s25 9 25 22c-8-6-22-8-33-3-6 3-12 6-17 8z" fill="#17172b"/>
  </g>
  <g class="friend">
    <rect x="190" y="222" width="12" height="70" rx="6" fill="#17172b"/><rect x="216" y="222" width="12" height="70" rx="6" fill="#17172b"/>
    <rect x="180" y="132" width="58" height="102" rx="29" fill="#8b4fb5"/>
    <rect x="166" y="86" width="12" height="60" rx="6" fill="#8b4fb5" transform="rotate(-24 172 140)"/><rect x="240" y="86" width="12" height="60" rx="6" fill="#8b4fb5" transform="rotate(24 246 140)"/>
    <circle cx="160" cy="86" r="8" fill="#f1c27d"/><circle cx="258" cy="86" r="8" fill="#f1c27d"/>
    <circle cx="209" cy="104" r="25" fill="#f1c27d"/><circle cx="209" cy="74" r="12" fill="#d4452a"/><path d="M184 100c2-15 13-23 25-23s23 8 25 23c-7-7-16-10-25-10s-18 3-25 10z" fill="#d4452a"/>
  </g>
  <g class="friend">
    <rect x="282" y="230" width="12" height="62" rx="6" fill="#17172b"/><rect x="306" y="230" width="12" height="62" rx="6" fill="#17172b"/>
    <rect x="274" y="156" width="52" height="84" rx="26" fill="#2e9a5f"/>
    <rect x="252" y="170" width="12" height="46" rx="6" fill="#2e9a5f" transform="rotate(52 258 172)"/>
    <circle cx="300" cy="130" r="23" fill="#c68642"/><path d="M277 128c0-14 10-25 23-25 14 0 24 10 24 24-3-5-9-9-15-10-10 6-22 9-32 11z" fill="#3a2418"/>
  </g>
  <g fill="#3b8bd0"><circle cx="40" cy="250" r="6"/></g><g fill="#2e9a5f"><circle cx="372" cy="262" r="5"/></g><g fill="#ef94b8"><circle cx="250" cy="30" r="5"/></g>
</svg>`);
