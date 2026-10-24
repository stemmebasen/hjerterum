import { ACTIVITIES, TOPICS, activityBySlug, headingFor, type Activity } from "../activities.js";
import { categoryBySlug } from "../categories.js";
import type { D1Database } from "../db.js";
import { activeAreas, areaBySlug, type Area } from "../geo.js";
import { ORGANIZERS, organizerBySlug, organizersFor, type OrganizerProfile } from "../organizers.js";
import { priceLabel } from "../price.js";
import { sourceById } from "../sources/registry.js";
import { capitalize, dayLabel, hhmm, timeRangeLabel } from "../time.js";
import type { Member } from "../flokken/auth.js";
import { flash, flockCards, flockPanel, howItWorks } from "../flokken/pages.js";
import { KIND_LABELS, offersBlock, offersFor, PARTNER_OFFERS } from "../flokken/partners.js";
import { upcomingFlocks, type FlockRow } from "../flokken/store.js";
import { activeFilterChips, cardGrid, chipLinks, HERO_ART, dayList, eventPath, filterPanel, linkList, pagination, placeLine, searchForm, section } from "./components.js";
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

/** The regular offerings of a set of organisers. */
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

/** How many of the coming week's events the front page lists before pointing to the calendar. */
const FRONT_WEEK_LIMIT = 80;

export async function homePage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const areas = activeAreas(regions);
  const [featured, byArea, week, flocks, freeWeek] = await Promise.all([
    featuredEvents(db, regions, ctx.now, 4), areaCounts(db, regions, ctx.now),
    listEvents(db, emptyFilters({ period: "uge" }), regions, ctx.now, FRONT_WEEK_LIMIT),
    upcomingFlocks(db, regions, ctx.now, 6),
    listEvents(db, emptyFilters({ period: "uge", price: "gratis" }), regions, ctx.now, 4)
  ]);
  const activityCounts = await Promise.all(ACTIVITIES.map(a => countEvents(db, activityFilters(a), regions, ctx.now)));
  const total = [...byArea.values()].reduce((a, b) => a + b, 0);
  const areaData = JSON.stringify(areas.map(a => ({ slug: a.slug, lat: a.centre.lat, lon: a.centre.lon })));
  const activityChips = (list: Activity[]) => chipLinks(list.map(a => ({ href: `/${a.slug}`, label: a.name, count: activityCounts[ACTIVITIES.indexOf(a)] ?? 0 })));
  // The strip names only the kinds of events there are right now.
  const kinds = ACTIVITIES.filter(a => a.category && (activityCounts[ACTIVITIES.indexOf(a)] ?? 0) > 0).map(a => a.name);
  const strip = [...kinds, ...(freeWeek.total ? ["Gratis events"] : [])];
  const body = html`
<div class="hero">
  <div class="wrap hero-inner">
    <div class="hero-text">
      <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Nyt i Aarhus · under udvikling</p>
      <h1>Find et event – <span class="accent-line">og en flok at følges med.</span></h1>
      <p class="standfirst">Flokken samler lokale events i Aarhus og omegn. Find en flok, der skal det samme som dig – eller opret din egen – og spar på billetten med gratis og billige events og medlemsfordele, efterhånden som spillesteder og foreninger bliver partnere.</p>
      ${searchForm(areas, {})}
      <ul class="quick-links" aria-label="Genveje">
        <li><a href="/find-en-flok">Find en flok</a></li><li><a href="/spar-paa-billetten">Spar på billetten</a></li><li><a href="/i-dag">I dag</a></li><li><a href="/weekend">I weekenden</a></li><li><a href="/kalender?pris=gratis">Gratis</a></li>
      </ul>
    </div>
    <div class="hero-visual">${HERO_ART}</div>
  </div>
</div>
${strip.length ? html`<div class="word-strip" aria-hidden="true"><div class="word-strip-track">${[0, 1].map(() => html`<span class="word-strip-set">${strip.map((w, i) => html`<span class="word${i % 3 === 1 ? " word-outline" : ""}">${w}</span><span class="word-dot word-dot-${i % 4}"></span>`)}</span>`)}</div></div>` : ""}
<div class="wrap">
  ${section("h-how", "Sådan virker Flokken", howItWorks)}
  <section class="section savings" aria-labelledby="h-save">
    <div class="section-head"><div><p class="section-kicker">Spar på billetten</p><h2 id="h-save">Gratis de næste 7 dage</h2></div><a class="more" href="/spar-paa-billetten">Gratis og billigt →</a></div>
    ${freeWeek.events.length ? cardGrid(freeWeek.events.slice(0, 4), ctx.now) : html`<p class="empty">Ingen gratis events med kendt pris de næste 7 dage lige nu. <a href="/spar-paa-billetten">Se gratis og billige events</a>.</p>`}
    <p class="savings-note">Som medlem af Flokken får du billetfordele hos vores partnere, når de er aftalt – de vises på eventet. <a href="/spar-paa-billetten">Sådan sparer du</a></p>
  </section>
  ${flocks.length ? section("h-flocks", "Flokke på vej", flockCards(flocks, ctx.now), { href: "/find-en-flok", label: "Alle åbne flokke →" }) : ""}
  ${featured.length ? section("h-featured", "Snart i kalenderen", cardGrid(featured, ctx.now)) : ""}
  ${section("h-week", "De næste 7 dage", week.events.length
    ? html`${dayList(week.events, ctx.now)}${week.total > week.events.length ? html`<p class="more-line"><a class="button-secondary" href="/kalender?periode=uge">Se alle ${week.total} events de næste 7 dage</a></p>` : ""}`
    : html`<p class="empty">Der er ingen events de næste 7 dage endnu. <a href="/kalender">Se hele kalenderen</a>.</p>`,
    { href: "/kalender", label: "Hele kalenderen →" })}
  <p class="more-line"><a class="button" href="/kalender">Se hele kalenderen – ${eventsLabel(total)}</a></p>
  ${section("h-activities", "Find din aktivitet", activityChips(ACTIVITIES.filter(a => a.category)), { href: "/kategorier", label: "Alle aktiviteter og emner →" })}
  ${section("h-cities", "Events i din by", html`${chipLinks(areas.map(a => ({ href: `/${a.slug}`, label: a.place, count: byArea.get(a.slug) ?? 0 })))}
    <p><button class="pill near-me" type="button" data-near-me data-areas="${areaData}" hidden>Brug min placering</button> <span class="near-status meta-muted" data-near-status aria-live="polite"></span></p>`)}
  <aside class="partner-teaser" aria-labelledby="h-partner">
    <div><p class="hero-kicker">For foreninger og kultursteder</p><h2 id="h-partner">Vil I have flere med?</h2>
    <p>Tilbyd Flokkens medlemmer en billetfordel og få synlighed på Flokken – og mulighed for radioomtale.</p></div>
    <p><a class="button button-alt" href="/samarbejde">Læs om samarbejde</a></p>
  </aside>
  ${section("h-topics", "Populære emner", activityChips(TOPICS))}
  ${section("h-regular", "Faste ugentlige tilbud", offeringsBlock(ORGANIZERS.filter(o => areas.some(a => a.slug === o.area))), { href: "/arrangoerer", label: "Alle arrangører →" })}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `Flokken – find events i Aarhus og nogen at følges med`,
      description: `Find lokale events i ${ctx.regionLabel} – og en flok at følges med. ${total} kommende events fra mange arrangører. Opret en flok eller bliv en del af en.`,
      canonical: "/",
      jsonLd: [
        {
          "@context": "https://schema.org", "@type": "WebSite", name: "Flokken", url: ctx.origin + "/", inLanguage: "da-DK",
          potentialAction: { "@type": "SearchAction", target: `${ctx.origin}/kalender?q={search_term_string}`, "query-input": "required name=search_term_string" }
        },
        { "@context": "https://schema.org", "@type": "Organization", name: "Flokken", url: ctx.origin + "/", logo: ctx.origin + "/favicon.svg" }
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
    <p class="standfirst">Alle kommende events i ${ctx.regionLabel}, dag for dag. Filtrér efter dato, by, aktivitet og pris – og find en flok at følges med.${topic ? html` Viser emnet <a href="/${topic.slug}">${topic.name}</a>.` : ""}</p>
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
      title: f.page > 1 ? `Kalender – side ${f.page}` : `Kalender – events i ${ctx.regionLabel}`,
      description: `Kalender for ${ctx.regionLabel}: ${total} kommende events fra lokale arrangører – dag for dag. Find en flok at følges med.`,
      canonical: "/kalender" + (f.page > 1 ? toQuery({ page: f.page }) : ""),
      breadcrumbs: crumbs,
      noindex: filtered || total === 0,
      jsonLd: events.length ? [itemList(events, ctx, (f.page - 1) * PAGE_SIZE)] : []
    }, body)
  };
}

/** /i-dag and /weekend: "hvad sker der i dag", "hvad sker der i weekenden". */
export async function periodPage(db: D1Database, ctx: PageContext, regions: string[], period: "idag" | "weekend"): Promise<View> {
  const { events, total } = await listEvents(db, emptyFilters({ period }), regions, ctx.now);
  const path = period === "idag" ? "/i-dag" : "/weekend";
  const name = period === "idag" ? "Det sker i dag" : "I weekenden";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name, path }];
  const heading = period === "idag" ? `Det sker i dag i ${ctx.regionLabel}` : `Det sker i weekenden i ${ctx.regionLabel}`;
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
      title: period === "idag" ? `Hvad sker der i dag? Events i ${ctx.regionLabel}` : `Hvad sker der i weekenden? Events i ${ctx.regionLabel}`,
      description: period === "idag" ? `Det sker i dag i ${ctx.regionLabel}: ${total} events. Find en flok at følges med.` : `Det sker i weekenden i ${ctx.regionLabel}: ${total} events. Find en flok at følges med.`,
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
      title: `${heading}`,
      description: `Oplev ${activity.phrase} i ${place}. ${activity.promise} – og find en flok at følges med.`,
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
    <h1>Events i ${area.place}</h1>
    <p class="standfirst">Hvad sker der i ${area.place}? Events fra lokale arrangører, opdateret hver nat – find en flok at følges med, eller opret din egen.</p>
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
      title: `Hvad sker der i ${area.place}? Events og flokke`,
      description: `Det sker i ${area.place}: ${upcoming.total} kommende events fra lokale arrangører. Find en flok at følges med.`,
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
    <h1>Arrangører</h1>
    <p class="standfirst">Foreninger, huse og studier i ${ctx.regionLabel}, hvis events du finder på Flokken – med deres faste tilbud og kommende events. <a href="/samarbejde">Vil I være med?</a></p>
  </header>
  ${byArea.map(x => section(`h-${x.a.slug}`, x.a.place, html`<ul class="org-list">${x.list.map(o => html`<li>
    <h3><a href="/arrangoerer/${o.slug}">${o.name}</a></h3>
    <p>${o.about}</p>
    <p class="meta meta-muted">${[o.address, [o.postalCode, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
  </li>`)}</ul>`))}
</div>`;
  return { status: 200, body: page(ctx, { title: `Arrangører i ${ctx.regionLabel}`, description: `Foreninger, huse og studier i ${ctx.regionLabel} – med faste tilbud og kommende events.`, canonical: "/arrangoerer", breadcrumbs: crumbs }, body) };
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

export type EventPageExtras = {
  member: Member | null;
  message: string | null;
  flocks: (eventId: string) => Promise<FlockRow[]>;
  myFlock: (eventId: string) => Promise<string | null>;
};

export async function eventPage(db: D1Database, ctx: PageContext, regions: string[], slug: string, extras?: EventPageExtras): Promise<View | null> {
  const e = await eventBySlug(db, slug);
  if (!e || !e.region || !regions.includes(e.region)) return null;
  const [related, flocks, myFlockId] = await Promise.all([
    relatedEvents(db, e, regions, ctx.now),
    extras ? extras.flocks(e.id) : Promise.resolve([] as FlockRow[]),
    extras ? extras.myFlock(e.id) : Promise.resolve(null)
  ]);
  const offers = offersFor(e);
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
    ${flash(extras?.message ?? null)}
    <div class="event-actions">
      ${e.signup_url && e.status !== "cancelled" && !over ? html`<a class="button" href="${e.signup_url}" rel="noopener" target="_blank">Tilmeld hos arrangøren<span class="visually-hidden"> (åbner i nyt vindue)</span></a>` : ""}
      ${!over && e.status !== "withdrawn" ? html`<a class="button-secondary" href="${eventPath(e)}.ics" download>Tilføj til kalender</a>` : ""}
      ${e.status !== "withdrawn" ? html`<a class="button-secondary" href="#flokke">Find en flok</a>` : ""}
    </div>
  </header>
  ${offersBlock(offers)}
  ${e.status !== "withdrawn" ? flockPanel(e, flocks, extras?.member ?? null, myFlockId, ctx.now) : ""}
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
    // The flocks and the viewer's own place in them change all the time, so the page is never cached.
    headers: { "cache-control": "private, no-store", ...(source?.canonicalToSource && e.source_url ? { link: `<${e.source_url}>; rel="canonical"` } : {}) }
  };
}

// ————————————————————————————————————————— Spar på billetten

/** Free and cheap events, and the member benefits partners have confirmed. Everything on it comes from the events'
 * own prices and from PARTNER_OFFERS; nothing is promised that has not been agreed. */
export async function savingsPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const [free, cheap] = await Promise.all([
    listEvents(db, emptyFilters({ price: "gratis", period: "maaned" }), regions, ctx.now, 40),
    listEvents(db, emptyFilters({ price: "under-100", period: "maaned" }), regions, ctx.now, 80)
  ]);
  const cheapPaid = cheap.events.filter(e => e.is_free !== 1).slice(0, 30);
  const offers = PARTNER_OFFERS.filter(o => o.confirmedBy.trim() && /^\d{4}-\d{2}-\d{2}$/.test(o.confirmedOn));
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Spar på billetten", path: "/spar-paa-billetten" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="section-kicker">Spar på billetten</p>
    <h1>Det skal ikke koste en formue <span class="accent-line">at komme ud.</span></h1>
    <p class="standfirst">Gratis og billige events i ${ctx.regionLabel} den næste måned – og billetfordele for Flokkens medlemmer, så snart vores partnere tilbyder dem.</p>
    <ul class="quick-links" aria-label="Genveje"><li><a href="/kalender?pris=gratis">Alle gratis events</a></li><li><a href="/kalender?pris=under-100">Op til 100 kr.</a></li><li><a href="/kalender?pris=under-200">Op til 200 kr.</a></li></ul>
  </header>
  <section class="section savings-offers" aria-labelledby="h-member">
    <div class="section-head"><h2 id="h-member">Medlemsfordele</h2></div>
    ${offers.length ? html`<ul class="offer-list">${offers.map(o => html`<li><strong>${organizerBySlug(o.organizerSlug)?.name ?? o.organizerSlug}</strong> · ${KIND_LABELS[o.kind]}: ${o.text}</li>`)}</ul>`
      : html`<p>Vi er ved at aftale billetfordele med spillesteder, caféer og foreninger i Aarhus. Når en arrangør har bekræftet en fordel, står den her og på eventet – og du får den som medlem af Flokken.</p>
      <p><a class="button button-alt" href="/samarbejde">Er du arrangør? Bliv partner</a></p>`}
  </section>
  ${section("h-free", `Gratis – ${eventsLabel(free.total)} den næste måned`, free.events.length ? html`${dayList(free.events, ctx.now)}${free.total > free.events.length ? html`<p class="more-line"><a class="button-secondary" href="/kalender?pris=gratis&periode=maaned">Se alle ${free.total}</a></p>` : ""}` : html`<p class="empty">Ingen gratis events med kendt pris den næste måned lige nu.</p>`, { href: "/kalender?pris=gratis", label: "Alle gratis →" })}
  ${cheapPaid.length ? section("h-cheap", "Op til 100 kr.", dayList(cheapPaid, ctx.now), { href: "/kalender?pris=under-100", label: "Alle op til 100 kr. →" }) : ""}
  <p class="meta-muted small">Priserne er arrangørernes egne og hentes hver nat. Events uden oplyst pris er ikke med her.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: `Spar på billetten – gratis og billige events i ${ctx.regionLabel}`, description: `Gratis og billige events i ${ctx.regionLabel} den næste måned – og billetfordele for Flokkens medlemmer.`, canonical: "/spar-paa-billetten", breadcrumbs: crumbs }, body) };
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
  return { status: 200, body: page(ctx, { title: `Aktiviteter og emner – events i ${ctx.regionLabel}`, description: `Meditation, yoga, breathwork, healing, klarsyn, soundbath, kakaoceremoni, MBSR og retreats i ${ctx.regionLabel}.`, canonical: "/kategorier", breadcrumbs: crumbs }, body) };
}

export async function aboutPage(db: D1Database, ctx: PageContext, areas: Area[]): Promise<View> {
  const sources = (await sourcesForAbout(db)).filter(s => s.enabled === 1);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Om Flokken", path: "/om" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Om Flokken</h1>
    <p class="standfirst">Flokken hjælper folk i Aarhus med at finde lokale events – og andre, der gerne vil opleve det samme. Eventet er udgangspunktet for at mødes.</p>
  </header>
  <h2>Hvad er en flok?</h2>
  <p>En flok er en lille, uformel gruppe, der følges til et bestemt event. I mødes et offentligt sted før eventet, og bagefter vælger hver især, om de vil finde på noget sammen igen – det kalder vi Eftermødet. Deltagelse er frivillig fra event til event. <a href="/tryghed">Læs om tryghed</a>.</p>
  <h2>Hvor finder du events?</h2>
  <p>Vi starter i ${ctx.regionLabel} (${areas.map(a => a.place).join(", ")}). Hver nat henter Flokken events fra arrangørernes egne kalendere og fra tjenester, der tillader det. Vi opfinder aldrig events eller oplysninger, og hvert event viser, hvor det kommer fra.</p>
  <ul class="source-list">
    ${sources.map(s => html`<li><strong>${s.homepage_url ? html`<a href="${s.homepage_url}" rel="noopener">${s.name}</a>` : s.name}</strong><br><span class="meta-muted small">${s.permission_basis}</span></li>`)}
  </ul>
  <h2>Billet og tilmelding</h2>
  <p>Du køber billet eller tilmelder dig altid hos arrangøren. Flokken sælger ikke billetter og håndterer ikke betaling. Datoer, priser og aflysninger kan ændre sig – arrangørens egen side er den gældende.</p>
  <h2 id="arrangoerer">For arrangører</h2>
  <p>Vil I samarbejde med Flokken – eller have jeres events med? <a href="/samarbejde">Læs om samarbejde og skriv til os</a>. Ser I en fejl ved et af jeres events, så ret det i jeres egen kalender – Flokken henter ændringen ved næste opdatering. Vil I ikke være med, fjerner vi jeres events.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om Flokken – sådan virker det", description: "Hvad Flokken er, hvordan en flok virker, hvor eventsene kommer fra, og hvordan arrangører kommer med.", canonical: "/om", breadcrumbs: crumbs }, body) };
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
  return { status: 404, body: page(ctx, { title: "Siden findes ikke", description: "Siden findes ikke.", canonical: ctx.path, noindex: true }, body) };
}
