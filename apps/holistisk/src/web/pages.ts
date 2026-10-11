import { ACTIVITIES, TOPICS, activityBySlug, headingFor, type Activity } from "../activities.js";
import { categoryBySlug } from "../categories.js";
import type { D1Database } from "../db.js";
import { activeAreas, areaBySlug, type Area } from "../geo.js";
import { ORGANIZERS, organizerBySlug, organizersFor, type OrganizerProfile } from "../organizers.js";
import { priceLabel } from "../price.js";
import { sourceById } from "../sources/registry.js";
import { capitalize, dayLabel, hhmm, timeRangeLabel } from "../time.js";
import { activeFilterChips, cardGrid, dayList, eventPath, filterPanel, leadStory, linkList, pagination, placeLine, searchForm, section } from "./components.js";
import { hasFilters, toQuery, type Filters } from "./filters.js";
import { html, type SafeHtml } from "./html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "./layout.js";
import { areaCounts, categoryCounts, cities, countByArea, countEvents, eventBySlug, featuredEvents, hasPrices, listEvents, PAGE_SIZE, relatedEvents, sourcesForAbout, type EventRow } from "./queries.js";
import { eventJsonLd } from "./seo.js";

/** Plain text with its web addresses as links (only http/https; the text itself stays escaped). */
export function linkify(text: string): SafeHtml[] {
  const out: SafeHtml[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    const at = m.index ?? 0;
    out.push(html`${text.slice(last, at)}`, html`<a href="${url}" rel="nofollow ugc noopener">${url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>`);
    last = at + url.length;
  }
  out.push(html`${text.slice(last)}`);
  return out;
}

export type View = { status: number; body: string; headers?: Record<string, string> };

/** Text cut at a word boundary, for titles and descriptions. */
export const clip = (text: string, max: number): string => text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";

export const emptyFilters = (over: Partial<Filters> = {}): Filters => ({ q: "", from: null, to: null, period: null, categories: [], area: null, city: null, price: null, page: 1, topic: null, organizer: null, ...over });

/** The filters an activity's page lists: its category, or its topic's words. */
export const activityFilters = (a: Activity, over: Partial<Filters> = {}): Filters =>
  emptyFilters({ ...(a.category ? { categories: [a.category] } : { topic: a.slug }), ...over });

/** schema.org ItemList of the events on a page, so search engines see the page as a list of events. */
function itemList(events: EventRow[], ctx: PageContext, offset = 0) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: offset + i + 1, url: ctx.origin + eventPath(e), name: e.title }))
  };
}

const eventsLabel = (n: number) => n === 1 ? "1 event" : `${n} events`;

/** The regular offerings of a set of organisers, as a newspaper's standing listings. */
function offeringsBlock(profiles: OrganizerProfile[]): SafeHtml {
  const withOfferings = profiles.filter(p => p.offerings.length);
  if (!withOfferings.length) return html``;
  return html`<ul class="offerings">${withOfferings.map(p => html`<li>
    <p class="kicker">${areaBySlug(p.area)?.place ?? ""}</p>
    <h3 class="offering-org"><a href="/arrangoerer/${p.slug}">${p.name}</a></h3>
    <ul>${p.offerings.map(o => html`<li>${o.text}</li>`)}</ul>
    <p class="meta meta-muted">${[p.address, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
  </li>`)}</ul>`;
}

function organizerList(profiles: OrganizerProfile[]): SafeHtml {
  return linkList(profiles.map(p => ({ href: `/arrangoerer/${p.slug}`, label: p.name, note: [p.address, p.city].filter(Boolean).join(", ") })), { columns: false });
}

// ————————————————————————————————————————— Front page

export async function homePage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const areas = activeAreas(regions);
  const [featured, byArea, today, weekend] = await Promise.all([
    featuredEvents(db, regions, ctx.now, 7), areaCounts(db, regions, ctx.now),
    listEvents(db, emptyFilters({ period: "idag" }), regions, ctx.now), listEvents(db, emptyFilters({ period: "weekend" }), regions, ctx.now)
  ]);
  const activityCounts = await Promise.all(ACTIVITIES.map(a => countEvents(db, activityFilters(a), regions, ctx.now)));
  const total = [...byArea.values()].reduce((a, b) => a + b, 0);
  const [lead, ...rest] = featured;
  const areaData = JSON.stringify(areas.map(a => ({ slug: a.slug, lat: a.centre.lat, lon: a.centre.lon })));
  const activityLinks = (list: Activity[]) => linkList(list.map(a => ({ href: `/${a.slug}`, label: a.name, count: activityCounts[ACTIVITIES.indexOf(a)] ?? 0 })));
  const body = html`
<div class="wrap">
  <header class="front-head">
    <h1>Spirituelle og holistiske events i ${ctx.regionLabel}</h1>
    <p class="standfirst">Meditation, yoga, breathwork, healing, klarsyn, foredrag, cirkler og retreats fra mange arrangører – samlet i én kalender og opdateret hver nat.</p>
    ${searchForm(areas, {})}
  </header>
  ${lead ? html`<div class="front-grid">
    ${leadStory(lead, ctx.now)}
    <div class="front-side">${cardGrid(rest.slice(0, 2), ctx.now)}</div>
  </div>
  ${rest.length > 2 ? cardGrid(rest.slice(2, 6), ctx.now) : ""}` : html`<p class="empty">Der er ingen kommende events lige nu. Kalenderen opdateres hver nat.</p>`}
  <p class="more-line"><a class="button" href="/kalender">Se hele kalenderen – ${eventsLabel(total)}</a></p>
  <div class="two-col">
    ${section("h-today", "Det sker i dag", today.events.length ? dayList(today.events.slice(0, 6), ctx.now) : html`<p class="meta-muted">Ingen events i dag. Se <a href="/weekend">weekenden</a> eller <a href="/kalender">hele kalenderen</a>.</p>`, { href: "/i-dag", label: "Alle i dag →" })}
    ${weekend.total !== today.total ? section("h-weekend", "I weekenden", weekend.events.length ? dayList(weekend.events.slice(0, 6), ctx.now) : html`<p class="meta-muted">Intet i kalenderen for weekenden endnu.</p>`, { href: "/weekend", label: "Hele weekenden →" }) : html``}
  </div>
  ${section("h-cities", "Events i din by", html`${linkList(areas.map(a => ({ href: `/${a.slug}`, label: `Events i ${a.place}`, count: byArea.get(a.slug) ?? 0 })))}
    <p><button class="pill near-me" type="button" data-near-me data-areas="${areaData}" hidden>Brug min placering</button> <span class="near-status meta-muted" data-near-status aria-live="polite"></span></p>`)}
  ${section("h-activities", "Aktiviteter", activityLinks(ACTIVITIES.filter(a => a.category)), { href: "/kategorier", label: "Alle aktiviteter og emner →" })}
  ${section("h-topics", "Populære emner", activityLinks(TOPICS))}
  ${section("h-regular", "Faste ugentlige tilbud", offeringsBlock(ORGANIZERS.filter(o => areas.some(a => a.slug === o.area))), { href: "/arrangoerer", label: "Alle arrangører →" })}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `Spirituelle og holistiske events i ${ctx.regionLabel} – kalender ✨`,
      description: `Spirituel og holistisk kalender for ${ctx.regionLabel}: meditation, yoga, breathwork, healing, klarsyn, foredrag og retreats. ${total} kommende events fra mange arrangører ✨`,
      canonical: "/",
      jsonLd: [
        {
          "@context": "https://schema.org", "@type": "WebSite", name: "holistisk.org", url: ctx.origin + "/", inLanguage: "da-DK",
          potentialAction: { "@type": "SearchAction", target: `${ctx.origin}/kalender?q={search_term_string}`, "query-input": "required name=search_term_string" }
        },
        { "@context": "https://schema.org", "@type": "Organization", name: "holistisk.org", url: ctx.origin + "/", logo: ctx.origin + "/favicon.svg" }
      ]
    }, body)
  };
}

// ————————————————————————————————————————— The calendar, today, the weekend

export async function calendarPage(db: D1Database, ctx: PageContext, regions: string[], f: Filters): Promise<View> {
  const areas = activeAreas(regions);
  const [{ events, total }, cats, cityList, prices] = await Promise.all([
    listEvents(db, f, regions, ctx.now), categoryCounts(db, regions, ctx.now), cities(db, regions, ctx.now, f.area), hasPrices(db, regions, ctx.now)
  ]);
  const topic = f.topic ? activityBySlug(f.topic) : null;
  const heading = f.q ? `Søgning: “${f.q}”` : `Kalender – ${ctx.regionLabel}`;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Kalender", path: "/kalender" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${heading}</h1>
    <p class="standfirst">Spirituel og holistisk kalender: alle kommende events i ${ctx.regionLabel}, dag for dag. Filtrér efter dato, by, aktivitet og pris.${topic ? html` Viser emnet <a href="/${topic.slug}">${topic.name}</a>.` : ""}</p>
  </header>
  <div class="list-layout" id="soeg">
    <aside class="list-filters">
      <details class="filter-toggle" data-collapse-mobile open>
        <summary>Søg og filtrér${hasFilters(f) ? html` <span class="count">aktive</span>` : ""}</summary>
        ${filterPanel(f, areas, cityList, cats, prices)}
      </details>
    </aside>
    <section class="list-results" aria-labelledby="h-results">
      <div class="results-head">
        <h2 id="h-results" class="results-count" aria-live="polite">${eventsLabel(total)}</h2>
        ${activeFilterChips(f)}
      </div>
      ${events.length ? dayList(events, ctx.now) : html`<div class="empty"><p><strong>Ingen events matcher.</strong> Prøv et bredere tidsrum, en anden by eller færre aktiviteter.</p><p><a class="button-secondary" href="/kalender">Nulstil filtre</a></p></div>`}
      ${pagination(f, total, PAGE_SIZE, "/kalender")}
    </section>
  </div>
</div>`;
  const filtered = hasFilters(f);
  return {
    status: 200,
    body: page(ctx, {
      title: f.page > 1 ? `Spirituel og holistisk kalender – side ${f.page}` : `Spirituel og holistisk kalender for ${ctx.regionLabel} ✨`,
      description: `Alternativ og spirituel kalender for ${ctx.regionLabel}: meditation, yoga, breathwork, healing, klarsyn, foredrag og retreats – dag for dag. ${total} kommende events ✨`,
      canonical: "/kalender" + (f.page > 1 ? toQuery({ page: f.page }) : ""),
      breadcrumbs: crumbs,
      noindex: filtered || total === 0,
      jsonLd: events.length ? [itemList(events, ctx, (f.page - 1) * PAGE_SIZE)] : []
    }, body)
  };
}

/** /i-dag and /weekend: "hvad sker der i dag", "spirituel weekend". */
export async function periodPage(db: D1Database, ctx: PageContext, regions: string[], period: "idag" | "weekend"): Promise<View> {
  const { events, total } = await listEvents(db, emptyFilters({ period }), regions, ctx.now);
  const path = period === "idag" ? "/i-dag" : "/weekend";
  const name = period === "idag" ? "Det sker i dag" : "I weekenden";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name, path }];
  const heading = period === "idag" ? `Det sker i dag i ${ctx.regionLabel}` : `Spirituel weekend i ${ctx.regionLabel}`;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${heading}</h1>
    <p class="standfirst">${period === "idag" ? "Meditation, yoga, healing, foredrag og fællesskaber i dag" : "Retreats, workshops, ceremonier, meditation og foredrag fra fredag til søndag"} – fra arrangører i hele ${ctx.regionLabel}.</p>
  </header>
  <h2 class="results-count">${eventsLabel(total)}</h2>
  ${events.length ? dayList(events, ctx.now) : html`<div class="empty"><p>Intet i kalenderen ${period === "idag" ? "i dag" : "i weekenden"} endnu.</p><p><a class="button-secondary" href="/kalender">Se hele kalenderen</a></p></div>`}
  ${total > events.length ? html`<p class="more-line"><a class="button-secondary" href="/kalender?periode=${period}">Se alle ${total}</a></p>` : ""}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: period === "idag" ? `Hvad sker der i dag? Spirituelle og holistiske events i ${ctx.regionLabel}` : `Spirituel weekend – holistiske events i weekenden i ${ctx.regionLabel} ✨`,
      description: period === "idag" ? `Det sker i dag i ${ctx.regionLabel}: meditation, yoga, healing, foredrag og fællesskaber. ${total} events i dag ✨` : `Spirituelle og holistiske events i weekenden i ${ctx.regionLabel}: retreats, workshops, ceremonier og meditation. ${total} events ✨`,
      canonical: path,
      breadcrumbs: crumbs,
      jsonLd: events.length ? [itemList(events, ctx)] : []
    }, body)
  };
}

// ————————————————————————————————————————— Activities: /meditation, /meditation/aarhus

export async function activityPage(db: D1Database, ctx: PageContext, regions: string[], activity: Activity, area: Area | null, pageNo = 1): Promise<View> {
  const areas = activeAreas(regions);
  const place = area?.place ?? ctx.regionLabel;
  const f = activityFilters(activity, { area: area?.slug ?? null, page: pageNo });
  const [{ events, total }, byArea] = await Promise.all([listEvents(db, f, regions, ctx.now), countByArea(db, activityFilters(activity), regions, ctx.now)]);
  const profiles = organizersFor(activity.slug, area?.slug ?? null).filter(o => areas.some(a => a.slug === o.area));
  const basePath = area ? `/${activity.slug}/${area.slug}` : `/${activity.slug}`;
  const heading = headingFor(activity, place);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: activity.name, path: `/${activity.slug}` }, ...(area ? [{ name: heading, path: basePath }] : [])];
  const related = activity.related.map(s => activityBySlug(s)).filter((a): a is Activity => !!a);
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${heading}</h1>
    <p class="standfirst">Oplev ${activity.phrase} i ${place}. Uanset om du søger ${activity.need}, finder du her events fra lokale arrangører – opdateret hver nat. Tilmelding sker direkte hos arrangøren.</p>
  </header>
  <div class="main-aside">
    <div>
      <h2 class="results-count">${eventsLabel(total)}</h2>
      ${events.length ? dayList(events, ctx.now) : html`<div class="empty"><p>Der er ingen kommende events i ${activity.name.toLowerCase()} i ${place} lige nu. Kalenderen opdateres hver nat.</p>
        <p>${area ? html`<a class="button-secondary" href="/${activity.slug}">${activity.name} i hele ${ctx.regionLabel}</a> ` : ""}<a class="button-secondary" href="/kalender">Hele kalenderen</a></p></div>`}
      ${pagination(emptyFilters({ page: pageNo }), total, PAGE_SIZE, basePath)}
      ${profiles.some(p => p.offerings.length) ? section("h-regular", `Faste tilbud${area ? ` i ${area.place}` : ""}`, offeringsBlock(profiles)) : html``}
    </div>
    <aside class="aside">
      ${section("h-cities", `${activity.name} i din by`, linkList(areas.map(a => ({ href: `/${activity.slug}/${a.slug}`, label: `${activity.name} i ${a.place}`, count: byArea.get(a.slug) ?? 0 })), { columns: false }))}
      ${profiles.length ? section("h-orgs", "Arrangører", organizerList(profiles)) : html``}
      ${related.length ? section("h-related", "Relaterede emner", linkList(related.map(r => ({ href: area ? `/${r.slug}/${area.slug}` : `/${r.slug}`, label: area ? `${r.name} i ${area.place}` : r.name })), { columns: false })) : html``}
    </aside>
  </div>
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `${heading} ✨`,
      description: `Oplev ${activity.phrase} i ${place}. ${activity.promise} ✨ Find events nu.`,
      canonical: basePath + (pageNo > 1 ? `?side=${pageNo}` : ""),
      breadcrumbs: crumbs,
      // A page with neither events nor organisers to show has nothing for a search engine.
      noindex: total === 0 && profiles.length === 0,
      jsonLd: events.length ? [itemList(events, ctx, (pageNo - 1) * PAGE_SIZE)] : []
    }, body)
  };
}

// ————————————————————————————————————————— Cities: /aarhus

export async function areaPage(db: D1Database, ctx: PageContext, regions: string[], area: Area): Promise<View> {
  const areas = activeAreas(regions);
  const base = emptyFilters({ area: area.slug });
  const [today, weekend, upcoming, byArea] = await Promise.all([
    listEvents(db, { ...base, period: "idag" }, regions, ctx.now), listEvents(db, { ...base, period: "weekend" }, regions, ctx.now),
    listEvents(db, base, regions, ctx.now), areaCounts(db, regions, ctx.now)
  ]);
  const activityCounts = await Promise.all(ACTIVITIES.map(a => countEvents(db, activityFilters(a, { area: area.slug }), regions, ctx.now)));
  const profiles = ORGANIZERS.filter(o => o.area === area.slug);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: `Events i ${area.place}`, path: `/${area.slug}` }];
  const activityLinks = ACTIVITIES.map((a, i) => ({ a, n: activityCounts[i] ?? 0 })).filter(x => x.n > 0 || profiles.some(p => p.activities.includes(x.a.slug)));
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Spirituelle og holistiske events i ${area.place}</h1>
    <p class="standfirst">Hvad sker der i ${area.place}? Meditation, yoga, breathwork, healing, klarsyn, spirituelle foredrag og fællesskaber – fra lokale arrangører, opdateret hver nat.</p>
  </header>
  <div class="main-aside">
    <div>
      ${today.events.length ? section("h-today", `I dag i ${area.place}`, dayList(today.events.slice(0, 8), ctx.now)) : html``}
      ${weekend.events.length && weekend.total !== today.total ? section("h-weekend", `I weekenden i ${area.place}`, dayList(weekend.events.slice(0, 8), ctx.now)) : html``}
      ${section("h-upcoming", `Kommende events i ${area.place}`, upcoming.events.length ? dayList(upcoming.events.slice(0, 20), ctx.now)
        : html`<div class="empty"><p>Der er ingen kommende events i ${area.place} lige nu. Kalenderen opdateres hver nat.</p></div>`,
        upcoming.total > 20 ? { href: `/kalender?omraade=${area.slug}`, label: `Alle ${upcoming.total} →` } : undefined)}
      ${profiles.some(p => p.offerings.length) ? section("h-regular", `Faste tilbud i ${area.place}`, offeringsBlock(profiles)) : html``}
    </div>
    <aside class="aside">
      ${activityLinks.length ? section("h-acts", `Aktiviteter i ${area.place}`, linkList(activityLinks.map(x => ({ href: `/${x.a.slug}/${area.slug}`, label: `${x.a.name} i ${area.place}`, count: x.n })), { columns: false })) : html``}
      ${profiles.length ? section("h-orgs", `Arrangører i ${area.place}`, organizerList(profiles)) : html``}
      ${section("h-other", "Andre byer", linkList(areas.filter(a => a.slug !== area.slug).map(a => ({ href: `/${a.slug}`, label: `Events i ${a.place}`, count: byArea.get(a.slug) ?? 0 })), { columns: false }))}
    </aside>
  </div>
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `Hvad sker der i ${area.place}? Spirituelle og holistiske events ✨`,
      description: `Det sker i ${area.place}: meditation, yoga, breathwork, healing, klarsyn, spirituelle foredrag og fællesskaber. ${upcoming.total} kommende events – find dit næste ✨`,
      canonical: `/${area.slug}`,
      breadcrumbs: crumbs,
      noindex: upcoming.total === 0 && profiles.length === 0,
      jsonLd: upcoming.events.length ? [itemList(upcoming.events.slice(0, 20), ctx)] : []
    }, body)
  };
}

// ————————————————————————————————————————— Organisers

export function organizersPage(ctx: PageContext, regions: string[]): View {
  const areas = activeAreas(regions);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Arrangører", path: "/arrangoerer" }];
  const byArea = areas.map(a => ({ a, list: ORGANIZERS.filter(o => o.area === a.slug).sort((x, y) => x.name.localeCompare(y.name, "da")) })).filter(x => x.list.length);
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Arrangører af spirituelle og holistiske events</h1>
    <p class="standfirst">Centre, foreninger og huse i ${ctx.regionLabel}, der holder meditation, yoga, healing, foredrag, retreats og fællesskaber – med deres faste tilbud og kommende events.</p>
  </header>
  ${byArea.map(x => section(`h-${x.a.slug}`, x.a.place, html`<ul class="org-list">${x.list.map(o => html`<li>
    <h3><a href="/arrangoerer/${o.slug}">${o.name}</a></h3>
    <p>${o.about}</p>
    <p class="meta meta-muted">${[o.address, [o.postalCode, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
  </li>`)}</ul>`))}
</div>`;
  return { status: 200, body: page(ctx, { title: `Arrangører – spirituelle og holistiske centre i ${ctx.regionLabel}`, description: `Meditationscentre, spirituelle foreninger, yogastudier og retreatsteder i ${ctx.regionLabel} – med faste tilbud og kommende events.`, canonical: "/arrangoerer", breadcrumbs: crumbs }, body) };
}

export async function organizerPage(db: D1Database, ctx: PageContext, regions: string[], profile: OrganizerProfile): Promise<View | null> {
  const area = areaBySlug(profile.area);
  if (!area || !regions.includes(area.region)) return null;
  const { events, total } = await listEvents(db, emptyFilters({ organizer: profile.slug }), regions, ctx.now);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Arrangører", path: "/arrangoerer" }, { name: profile.name, path: `/arrangoerer/${profile.slug}` }];
  const activities = profile.activities.map(s => activityBySlug(s)).filter((a): a is Activity => !!a);
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">${area.place}</p>
    <h1>${profile.name}</h1>
    <p class="standfirst">${profile.about}</p>
  </header>
  <div class="main-aside">
    <div>
      ${profile.offerings.length ? section("h-regular", "Faste tilbud", html`<ul class="plain-list">${profile.offerings.map(o => html`<li>${o.text}</li>`)}</ul><p class="meta meta-muted">Kilde: <a href="${profile.offerings[0]!.source}" rel="noopener">${profile.name}</a>. Tjek altid arrangørens side, før du tager afsted.</p>`) : html``}
      ${section("h-events", `Kommende events hos ${profile.name}`, events.length ? dayList(events, ctx.now) : html`<p class="meta-muted">${profile.eventsNote}</p>`)}
      ${total > events.length ? html`<p class="more-line">Viser de første ${events.length} af ${total}.</p>` : ""}
    </div>
    <aside class="aside">
      ${section("h-facts", "Fakta", html`<dl class="facts-list">
        <dt>Adresse</dt><dd>${profile.address ? html`${profile.address}<br>` : ""}${[profile.postalCode, profile.city].filter(Boolean).join(" ")}</dd>
        <dt>Hjemmeside</dt><dd><a href="${profile.website}" rel="noopener">${profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></dd>
        <dt>Om kalenderen</dt><dd>${profile.eventsNote}</dd>
      </dl>`)}
      ${activities.length ? section("h-acts", "Aktiviteter", linkList(activities.map(a => ({ href: `/${a.slug}/${area.slug}`, label: `${a.name} i ${area.place}` })), { columns: false })) : html``}
    </aside>
  </div>
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `${profile.name} – ${area.place} · events og faste tilbud`,
      description: clip(`${profile.about} Se kommende events og faste tilbud hos ${profile.name} i ${area.place}.`, 158),
      canonical: `/arrangoerer/${profile.slug}`,
      breadcrumbs: crumbs,
      jsonLd: [{
        "@context": "https://schema.org", "@type": "Organization", name: profile.name, url: profile.website, description: profile.about,
        address: { "@type": "PostalAddress", ...(profile.address ? { streetAddress: profile.address } : {}), ...(profile.postalCode ? { postalCode: profile.postalCode } : {}), ...(profile.city ? { addressLocality: profile.city } : {}), addressCountry: "DK" },
        ...(profile.lat !== null && profile.lon !== null ? { location: { "@type": "Place", name: profile.name, geo: { "@type": "GeoCoordinates", latitude: profile.lat, longitude: profile.lon } } } : {})
      }, ...(events.length ? [itemList(events, ctx)] : [])]
    }, body)
  };
}

// ————————————————————————————————————————— An event

export async function eventPage(db: D1Database, ctx: PageContext, regions: string[], slug: string): Promise<View | null> {
  const e = await eventBySlug(db, slug);
  if (!e || !e.region || !regions.includes(e.region)) return null;
  const related = await relatedEvents(db, e, regions, ctx.now);
  const source = sourceById(e.primary_source_id);
  const categories = (e.categories ?? "").split(",").filter(Boolean);
  const price = priceLabel(e);
  const paragraphs = (e.description ?? "").split(/\n+/).filter(Boolean);
  const over = (e.ends_at ?? e.starts_at + 3 * 3600_000) < ctx.now;
  const notice = e.status === "cancelled" ? html`<p class="notice notice-cancelled" role="status"><strong>Aflyst.</strong> Arrangøren har meldt dette event aflyst.</p>`
    : e.status === "withdrawn" ? html`<p class="notice" role="status">Dette event er ikke længere annonceret hos arrangøren. Tjek arrangørens egen side.</p>`
    : over ? html`<p class="notice" role="status">Dette event er afholdt.</p>` : "";
  const mapUrl = e.lat !== null && e.lon !== null
    ? `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lon}#map=16/${e.lat}/${e.lon}`
    : e.address || e.city ? `https://www.openstreetmap.org/search?query=${encodeURIComponent([e.address, e.postal_code, e.city].filter(Boolean).join(" "))}` : null;
  const firstCategory = categories[0] ? categoryBySlug(categories[0]) : null;
  const firstActivity = firstCategory ? activityBySlug(firstCategory.path) : undefined;
  const area = e.area ? areaBySlug(e.area) ?? null : null;
  const profile = e.organizer_id ? organizerBySlug(e.organizer_id) : undefined;
  const crumbs: Crumb[] = [
    { name: "Forside", path: "/" },
    ...(firstActivity ? [{ name: firstActivity.name, path: `/${firstActivity.slug}` }] : [{ name: "Kalender", path: "/kalender" }]),
    ...(firstActivity && area ? [{ name: headingFor(firstActivity, area.place), path: `/${firstActivity.slug}/${area.slug}` }] : []),
    { name: e.title, path: eventPath(e) }
  ];
  const categoryLink = (slug: string) => {
    const c = categoryBySlug(slug);
    return c ? (area ? `/${c.path}/${area.slug}` : `/${c.path}`) : "/kategorier";
  };
  const placeName = e.city?.replace(/\s+[A-ZÆØÅ]{1,2}$/, "") ?? area?.place ?? ctx.regionLabel;
  const body = html`
<article class="event wrap">
  ${crumbsNav(crumbs)}
  <header class="event-head">
    <p class="kicker">${[firstCategory?.name, area?.place].filter(Boolean).join(" · ")}</p>
    <h1>${e.title}</h1>
    <p class="event-when">${capitalize(dayLabel(e.starts_at, ctx.now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, ctx.now)}</p>
    <p class="event-where">${placeLine(e)}${price ? ` · ${price}` : ""}</p>
    ${notice}
    <div class="event-actions">
      ${e.signup_url && e.status !== "cancelled" && !over ? html`<a class="button" href="${e.signup_url}" rel="noopener" target="_blank">Tilmeld hos arrangøren<span class="visually-hidden"> (åbner i nyt vindue)</span></a>` : ""}
      ${!over && e.status !== "withdrawn" ? html`<a class="button-secondary" href="${eventPath(e)}.ics" download>Tilføj til kalender</a>` : ""}
    </div>
  </header>
  ${e.image_url ? html`<figure class="event-image"><img src="${e.image_url}" alt="" decoding="async">${e.image_credit ? html`<figcaption>Billede: ${e.image_credit}</figcaption>` : ""}</figure>` : ""}
  <div class="main-aside">
    <div class="event-text">
      ${paragraphs.length ? html`<h2 class="visually-hidden">Beskrivelse</h2>${paragraphs.map(p => /^•\s/.test(p) ? html`<p class="bullet">${linkify(p)}</p>` : html`<p>${linkify(p)}</p>`)}`
        : e.summary ? html`<p>${e.summary}</p>` : html`<p class="meta-muted">Arrangøren har ikke givet en beskrivelse her. Læs mere hos arrangøren.</p>`}
      ${source?.descriptionPolicy === "excerpt" && e.source_url ? html`<p><a href="${e.source_url}" rel="noopener">Læs hele beskrivelsen hos ${e.source_name} →</a></p>` : ""}
    </div>
    <aside class="aside facts" aria-label="Fakta">
      <dl class="facts-list">
        <dt>Hvornår</dt><dd>${capitalize(dayLabel(e.starts_at, ctx.now))}<br>${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, ctx.now)}</dd>
        <dt>Hvor</dt><dd>${e.venue_name ? html`${e.venue_name}<br>` : ""}${e.address ? html`${e.address}<br>` : ""}${[e.postal_code, e.city].filter(Boolean).join(" ")}${mapUrl ? html`<br><a href="${mapUrl}" rel="noopener" target="_blank">Vis på kort</a>` : ""}${area ? html`<br><a href="/${area.slug}">Flere events i ${area.place}</a>` : ""}</dd>
        ${e.organizer_name ? html`<dt>Arrangør</dt><dd>${profile ? html`<a href="/arrangoerer/${profile.slug}">${e.organizer_name}</a>` : e.organizer_url ? html`<a href="${e.organizer_url}" rel="noopener">${e.organizer_name}</a>` : e.organizer_name}</dd>` : ""}
        ${e.host_name ? html`<dt>Underviser / vært</dt><dd>${e.host_name}</dd>` : ""}
        <dt>Pris</dt><dd>${price ?? "Se arrangørens side"}${e.price_text ? html`<br><span class="meta-muted small">Ifølge beskrivelsen: ${e.price_text}</span>` : ""}</dd>
        ${categories.length ? html`<dt>Aktivitet</dt><dd>${categories.map((c, i) => html`${i ? ", " : ""}<a href="${categoryLink(c)}">${categoryBySlug(c)?.name ?? c}</a>`)}</dd>` : ""}
      </dl>
      <p class="source">Kilde: ${e.source_url ? html`<a href="${e.source_url}" rel="noopener">${e.source_attribution}</a>` : e.source_attribution}<br>
      <span class="meta-muted small">Sidst kontrolleret ${dayLabel(e.last_checked_at, ctx.now)}. Ret eller aflys altid hos arrangøren.</span></p>
    </aside>
  </div>
  ${related.length ? section("h-related", "Måske også", cardGrid(related, ctx.now)) : ""}
</article>`;
  // A source whose terms require it (Billetto) is named as the canonical home of the event.
  const canonical = source?.canonicalToSource && e.source_url ? e.source_url : eventPath(e);
  return {
    status: 200,
    body: page(ctx, {
      title: `${clip(e.title, 58)} – ${dayLabel(e.starts_at, ctx.now)} i ${placeName}`,
      description: clip(`${capitalize(dayLabel(e.starts_at, ctx.now))}${e.all_day ? "" : ` kl. ${hhmm(e.starts_at)}`} i ${[e.venue_name, placeName].filter(Boolean).join(", ")}${price ? ` · ${price.replace(/\.$/, "")}` : ""}. ${e.summary ?? ""}`.trim(), 158),
      canonical,
      breadcrumbs: crumbs,
      image: e.image_url,
      type: "article",
      noindex: e.status === "withdrawn" || over,
      jsonLd: [eventJsonLd(e, ctx.origin)]
    }, body),
    ...(source?.canonicalToSource && e.source_url ? { headers: { link: `<${e.source_url}>; rel="canonical"` } } : {})
  };
}

// ————————————————————————————————————————— Index pages

export async function categoriesPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const counts = await Promise.all(ACTIVITIES.map(a => countEvents(db, activityFilters(a), regions, ctx.now)));
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Aktiviteter og emner", path: "/kategorier" }];
  const list = (subset: Activity[]) => linkList(subset.map(a => ({ href: `/${a.slug}`, label: a.name, count: counts[ACTIVITIES.indexOf(a)] ?? 0 })));
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Aktiviteter og emner</h1>
    <p class="standfirst">Fra meditation og yoga til klarsyn, soundbath, kakaoceremonier og stilhedsretreats. Vælg en aktivitet for at se, hvad der sker i ${ctx.regionLabel} – eller i din by.</p>
  </header>
  ${section("h-acts", "Aktiviteter", list(ACTIVITIES.filter(a => a.category)))}
  ${section("h-topics", "Emner", list(TOPICS))}
</div>`;
  return { status: 200, body: page(ctx, { title: `Aktiviteter og emner – spirituelle og holistiske events i ${ctx.regionLabel}`, description: `Meditation, yoga, breathwork, healing, klarsyn, soundbath, kakaoceremoni, MBSR og retreats i ${ctx.regionLabel} ✨`, canonical: "/kategorier", breadcrumbs: crumbs }, body) };
}

export async function aboutPage(db: D1Database, ctx: PageContext, areas: Area[]): Promise<View> {
  const sources = (await sourcesForAbout(db)).filter(s => s.enabled === 1);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Om portalen", path: "/om" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Om holistisk.org</h1>
    <p class="standfirst">holistisk.org samler spirituelle og holistiske events fra mange arrangører, så du nemt kan finde oplevelser i dit nærområde.</p>
  </header>
  <h2>Hvad finder du her?</h2>
  <p>Meditation og mindfulness, yoga, breathwork, lydhealing, dans og bevægelse, kvinde- og mandegrupper, samtalegrupper, workshops, retreats, healing, spirituelle foredrag, naturaktiviteter og fællesskaber. Vi starter i ${ctx.regionLabel} (${areas.map(a => a.place).join(", ")}) og udvider til resten af Danmark.</p>
  <h2>Hvor kommer eventsene fra?</h2>
  <p>Hver nat henter portalen events fra arrangørernes egne kalendere og fra tjenester, der tillader det. Vi tilføjer kun kilder, hvor vi har lov, og vi opfinder aldrig events eller oplysninger. Hvert event viser, hvor det kommer fra.</p>
  <ul class="source-list">
    ${sources.map(s => html`<li><strong>${s.homepage_url ? html`<a href="${s.homepage_url}" rel="noopener">${s.name}</a>` : s.name}</strong><br><span class="meta-muted small">${s.permission_basis}</span></li>`)}
  </ul>
  <h2>Tilmelding</h2>
  <p>Du tilmelder dig altid hos arrangøren. holistisk.org sælger ikke billetter og håndterer ikke betaling. Datoer, priser og aflysninger kan ændre sig – arrangørens egen side er den gældende.</p>
  <h2 id="arrangoerer">For arrangører</h2>
  <p>Vil du have dine events med? Det letteste er en offentlig kalender (fx en delt Google-kalender som iCal-link), et RSS-feed eller strukturerede eventdata (schema.org) på din hjemmeside – sammen med dit samtykke til, at vi viser titel, tidspunkt, sted, beskrivelse og eventuelt billede med henvisning til dig.${ctx.contactEmail ? html` Skriv til <a href="mailto:${ctx.contactEmail}">${ctx.contactEmail}</a>.` : ""}</p>
  <p>Ser du en fejl ved et af dine events, så ret det i din egen kalender – portalen henter ændringen ved næste opdatering. Vil du ikke være med, fjerner vi dine events.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om holistisk.org – kilder og arrangører", description: "Hvad holistisk.org er, hvor eventsene kommer fra, og hvordan arrangører får deres events med.", canonical: "/om", breadcrumbs: crumbs }, body) };
}

export function notFoundPage(ctx: PageContext): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Siden findes ikke</h1>
    <p class="standfirst">Eventet kan være afholdt eller fjernet af arrangøren.</p>
    <p><a class="button" href="/kalender">Se kalenderen</a></p>
  </header>
</div>`;
  return { status: 404, body: page(ctx, { title: "Siden findes ikke · holistisk.org", description: "Siden findes ikke.", canonical: ctx.path, noindex: true }, body) };
}
