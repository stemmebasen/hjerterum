import { CATEGORIES, categoryBySlug } from "../categories.js";
import type { D1Database } from "../db.js";
import { activeAreas, areaBySlug, type Area } from "../geo.js";
import { priceLabel } from "../price.js";
import { sourceById } from "../sources/registry.js";
import { capitalize, dayLabel, timeRangeLabel } from "../time.js";
import { activeFilterChips, cardGrid, categoryTiles, countLabel, eventPath, filterPanel, pagination, placeLine, searchForm } from "./components.js";
import { hasFilters, toQuery, type Filters } from "./filters.js";
import { html, raw, type SafeHtml } from "./html.js";
import { page, type PageContext } from "./layout.js";
import { areaCounts, categoryCounts, cities, eventBySlug, featuredEvents, hasPrices, listEvents, PAGE_SIZE, relatedEvents, sourcesForAbout } from "./queries.js";
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

export async function homePage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const areas = activeAreas(regions);
  const [featured, cats, byArea] = await Promise.all([featuredEvents(db, regions, ctx.now), categoryCounts(db, regions, ctx.now), areaCounts(db, regions, ctx.now)]);
  const total = [...byArea.values()].reduce((a, b) => a + b, 0);
  const areaData = JSON.stringify(areas.map(a => ({ slug: a.slug, lat: a.centre.lat, lon: a.centre.lon })));
  const body = html`
<section class="hero">
  <div class="wrap hero-inner">
    <p class="eyebrow">Holistiske oplevelser i ${ctx.regionLabel}</p>
    <h1>Find ro, nærvær og fællesskab – tæt på dig</h1>
    <p class="lead">Meditation, yoga, breathwork, lydhealing, cirkler, workshops og retræter fra mange arrangører, samlet ét sted og opdateret hver dag.</p>
    ${searchForm(areas, {})}
    <ul class="quick-links" aria-label="Genveje">
      <li><a href="/events?periode=idag">I dag</a></li>
      <li><a href="/events?periode=weekend">I weekenden</a></li>
      <li><a href="/events?periode=uge">Næste 7 dage</a></li>
      <li><a href="/events?pris=gratis">Gratis</a></li>
    </ul>
  </div>
</section>

<section class="section wrap" aria-labelledby="h-soon">
  <div class="section-head">
    <h2 id="h-soon">Snart</h2>
    <a class="more" href="/events">Se alle ${total} kommende events →</a>
  </div>
  ${featured.length ? cardGrid(featured, ctx.now) : html`<p class="empty">Der er ingen kommende events lige nu. Kig forbi igen – kalenderen opdateres hver dag.</p>`}
</section>

<section class="section section-tinted" aria-labelledby="h-near">
  <div class="wrap">
    <div class="section-head">
      <h2 id="h-near">I nærheden</h2>
      <button class="near-me" type="button" data-near-me data-areas="${areaData}" hidden>Brug min placering</button>
    </div>
    <ul class="area-list">
      ${areas.map(a => html`<li><a href="/omraade/${a.slug}"><span class="area-name">${a.name}</span><span class="area-count">${countLabel(byArea.get(a.slug) ?? 0)}</span></a></li>`)}
    </ul>
    <p class="near-status" data-near-status aria-live="polite"></p>
  </div>
</section>

<section class="section wrap" aria-labelledby="h-cats">
  <div class="section-head"><h2 id="h-cats">Gå på opdagelse</h2><a class="more" href="/kategorier">Alle kategorier →</a></div>
  ${categoryTiles(cats)}
</section>

<section class="section wrap about-strip" aria-labelledby="h-how">
  <h2 id="h-how">Sådan virker holistisk.org</h2>
  <ol class="steps">
    <li><strong>Vi samler</strong> events fra arrangørernes egne kalendere hver nat – kun fra kilder, der må bruges.</li>
    <li><strong>Du finder</strong> det, der passer dig, efter dato, område, kategori og pris.</li>
    <li><strong>Du tilmelder dig</strong> direkte hos arrangøren. Vi sælger ingen billetter.</li>
  </ol>
</section>`;
  return {
    status: 200,
    body: page(ctx, {
      title: "holistisk.org",
      description: `Find holistiske events i ${ctx.regionLabel}: meditation, yoga, breathwork, lydhealing, kvinde- og mandegrupper, workshops og retræter – samlet fra mange arrangører.`,
      canonical: "/",
      jsonLd: [{
        "@context": "https://schema.org", "@type": "WebSite", name: "holistisk.org", url: ctx.origin + "/",
        potentialAction: { "@type": "SearchAction", target: `${ctx.origin}/events?q={search_term_string}`, "query-input": "required name=search_term_string" }
      }]
    }, body)
  };
}

export type Landing = { kind: "category"; slug: string } | { kind: "area"; slug: string } | null;

export async function listPage(db: D1Database, ctx: PageContext, regions: string[], f: Filters, landing: Landing): Promise<View> {
  const areas = activeAreas(regions);
  const [{ events, total }, cats, cityList, prices] = await Promise.all([
    listEvents(db, f, regions, ctx.now), categoryCounts(db, regions, ctx.now), cities(db, regions, ctx.now, f.area), hasPrices(db, regions, ctx.now)
  ]);
  const category = landing?.kind === "category" ? categoryBySlug(landing.slug) : null;
  const area = landing?.kind === "area" ? areaBySlug(landing.slug) : null;
  const heading = category ? category.name : area ? `Holistiske events i ${area.name}` : f.q ? `Søgning: “${f.q}”` : "Kommende events";
  const basePath = landing ? ctx.path : "/events";
  // Landing pages carry their own filter in the path; the form and the chips work on /events.
  const intro = category ? html`<p class="lead">Kommende events i kategorien ${category.name.toLowerCase()} i ${ctx.regionLabel}.</p>`
    : area ? html`<p class="lead">Meditation, yoga, breathwork, cirkler og meget mere i ${area.name}.</p>` : html``;
  const body = html`
<section class="page-head wrap">
  <nav class="crumbs" aria-label="Brødkrumme"><a href="/">Forside</a> / ${landing ? html`<a href="/events">Events</a> / ` : ""}<span>${category?.name ?? area?.name ?? "Events"}</span></nav>
  <h1>${heading}</h1>
  ${intro}
</section>
<div class="wrap list-layout">
  <aside class="list-filters">
    <details class="filter-toggle" ${hasFilters(f) && !landing ? "" : raw("data-collapse-mobile")} open>
      <summary>Filtre${hasFilters(f) ? html` <span class="count">aktive</span>` : ""}</summary>
      ${filterPanel(f, areas, cityList, cats, prices)}
    </details>
  </aside>
  <section class="list-results" aria-labelledby="h-results">
    <div class="results-head">
      <h2 id="h-results" class="results-count" aria-live="polite">${total === 1 ? "1 event" : `${total} events`}</h2>
      ${landing ? html`` : activeFilterChips(f)}
    </div>
    ${events.length ? cardGrid(events, ctx.now) : html`<div class="empty">
      <p><strong>Ingen events matcher.</strong> Prøv et bredere tidsrum, et andet område eller færre kategorier.</p>
      <p><a class="button-secondary" href="/events">Nulstil filtre</a></p>
    </div>`}
    ${pagination(f, total, PAGE_SIZE, basePath)}
  </section>
</div>`;
  const filtered = !landing && hasFilters(f);
  return {
    status: 200,
    body: page(ctx, {
      title: heading,
      description: category ? `${category.name}: kommende events i ${ctx.regionLabel}, samlet fra mange arrangører på holistisk.org.`
        : area ? `Holistiske events i ${area.name}: meditation, yoga, breathwork, lydhealing, cirkler og retræter.`
        : `Alle kommende holistiske events i ${ctx.regionLabel}. Filtrér efter dato, område, kategori og pris.`,
      canonical: basePath + (f.page > 1 ? toQuery({ page: f.page }) : ""),
      // Filter combinations are endless: only the plain list and the landing pages are meant for search engines.
      noindex: filtered
    }, body)
  };
}

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
  const body = html`
<article class="event wrap">
  <nav class="crumbs" aria-label="Brødkrumme"><a href="/">Forside</a> / <a href="/events">Events</a>${firstCategory ? html` / <a href="/kategori/${firstCategory.slug}">${firstCategory.name}</a>` : ""}</nav>
  <div class="event-top">
    <div class="event-intro">
      <h1>${e.title}</h1>
      <p class="event-when">${capitalize(dayLabel(e.starts_at, ctx.now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, ctx.now)}</p>
      <p class="event-where">${placeLine(e)}</p>
      ${notice}
      <div class="event-actions">
        ${e.signup_url && e.status !== "cancelled" && !over ? html`<a class="button" href="${e.signup_url}" rel="noopener" target="_blank">Tilmeld hos arrangøren<span class="visually-hidden"> (åbner i nyt vindue)</span></a>` : ""}
        ${!over && e.status !== "withdrawn" ? html`<a class="button-secondary" href="${eventPath(e)}.ics" download>Tilføj til kalender</a>` : ""}
      </div>
    </div>
    ${e.image_url ? html`<figure class="event-image"><img src="${e.image_url}" alt="" decoding="async">${e.image_credit ? html`<figcaption>Billede: ${e.image_credit}</figcaption>` : ""}</figure>` : ""}
  </div>
  <div class="event-columns">
    <div class="event-text">
      ${paragraphs.length ? html`<h2 class="visually-hidden">Beskrivelse</h2>${paragraphs.map(p => /^•\s/.test(p) ? html`<p class="bullet">${linkify(p)}</p>` : html`<p>${linkify(p)}</p>`)}`
        : e.summary ? html`<p>${e.summary}</p>` : html`<p class="muted">Arrangøren har ikke givet en beskrivelse her. Læs mere hos arrangøren.</p>`}
      ${source?.descriptionPolicy === "excerpt" && e.source_url ? html`<p><a href="${e.source_url}" rel="noopener">Læs hele beskrivelsen hos ${e.source_name} →</a></p>` : ""}
    </div>
    <aside class="facts" aria-label="Fakta">
      <dl>
        <dt>Hvornår</dt><dd>${dayLabel(e.starts_at, ctx.now)}<br>${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, ctx.now)}</dd>
        <dt>Hvor</dt><dd>${e.venue_name ? html`${e.venue_name}<br>` : ""}${e.address ? html`${e.address}<br>` : ""}${[e.postal_code, e.city].filter(Boolean).join(" ")}${e.area ? html`<br><a href="/omraade/${e.area}">${areaBySlug(e.area)?.name ?? ""}</a>` : ""}${mapUrl ? html`<br><a href="${mapUrl}" rel="noopener" target="_blank">Vis på kort</a>` : ""}</dd>
        ${e.organizer_name ? html`<dt>Arrangør</dt><dd>${e.organizer_url ? html`<a href="${e.organizer_url}" rel="noopener">${e.organizer_name}</a>` : e.organizer_name}</dd>` : ""}
        ${e.host_name ? html`<dt>Underviser / vært</dt><dd>${e.host_name}</dd>` : ""}
        <dt>Pris</dt><dd>${price ?? "Se arrangørens side"}${e.price_text ? html`<br><span class="muted small">Ifølge beskrivelsen: ${e.price_text}</span>` : ""}</dd>
        ${categories.length ? html`<dt>Kategori</dt><dd class="tags">${categories.map(c => html`<a class="tag" href="/kategori/${c}">${categoryBySlug(c)?.name ?? c}</a>`)}</dd>` : ""}
      </dl>
      <p class="source">Kilde: ${e.source_url ? html`<a href="${e.source_url}" rel="noopener">${e.source_attribution}</a>` : e.source_attribution}<br>
      <span class="muted small">Sidst kontrolleret ${dayLabel(e.last_checked_at, ctx.now)}. Ret eller aflys altid hos arrangøren.</span></p>
    </aside>
  </div>
  ${related.length ? html`<section class="section" aria-labelledby="h-related"><div class="section-head"><h2 id="h-related">Måske også</h2></div>${cardGrid(related, ctx.now)}</section>` : ""}
</article>`;
  // A source whose terms require it (Billetto) is named as the canonical home of the event.
  const canonical = source?.canonicalToSource && e.source_url ? e.source_url : eventPath(e);
  return {
    status: 200,
    body: page(ctx, {
      title: `${e.title} – ${dayLabel(e.starts_at, ctx.now)}`,
      description: (e.summary ?? `${e.title} i ${e.city ?? "Østjylland"}`).slice(0, 180),
      canonical,
      image: e.image_url,
      type: "article",
      noindex: e.status === "withdrawn" || over,
      jsonLd: [eventJsonLd(e, ctx.origin)]
    }, body),
    ...(source?.canonicalToSource && e.source_url ? { headers: { link: `<${e.source_url}>; rel="canonical"` } } : {})
  };
}

export async function categoriesPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const cats = await categoryCounts(db, regions, ctx.now);
  const body = html`
<section class="page-head wrap">
  <nav class="crumbs" aria-label="Brødkrumme"><a href="/">Forside</a> / <span>Kategorier</span></nav>
  <h1>Kategorier</h1>
  <p class="lead">Et event kan høre til flere kategorier. Vælg en for at se, hvad der sker.</p>
</section>
<section class="section wrap">${categoryTiles(cats)}</section>`;
  return { status: 200, body: page(ctx, { title: "Kategorier", description: `Holistiske events efter kategori: ${CATEGORIES.map(c => c.name.toLowerCase()).slice(0, 6).join(", ")} og mere.`, canonical: "/kategorier" }, body) };
}

export async function aboutPage(db: D1Database, ctx: PageContext, regions: string[], areas: Area[]): Promise<View> {
  const sources = (await sourcesForAbout(db)).filter(s => s.enabled === 1);
  const body = html`
<section class="page-head wrap">
  <nav class="crumbs" aria-label="Brødkrumme"><a href="/">Forside</a> / <span>Om portalen</span></nav>
  <h1>Om holistisk.org</h1>
  <p class="lead">holistisk.org samler holistiske events fra mange arrangører, så du nemt kan finde oplevelser i dit nærområde.</p>
</section>
<div class="wrap prose">
  <h2>Hvad finder du her?</h2>
  <p>Meditation og mindfulness, yoga, breathwork, lydhealing, dans og bevægelse, kvinde- og mandegrupper, samtalegrupper, workshops, retræter, holistisk sundhed, naturaktiviteter og sociale fællesskaber. Vi starter i ${ctx.regionLabel} (${areas.map(a => a.name).join(", ")}) og udvider til resten af Danmark.</p>
  <h2>Hvor kommer eventsene fra?</h2>
  <p>Hver nat henter portalen events fra arrangørernes egne kalendere og fra tjenester, der tillader det. Vi tilføjer kun kilder, hvor vi har lov: arrangørens samtykke, en licens eller en aftale. Vi opfinder aldrig events eller oplysninger, og hvert event viser, hvor det kommer fra.</p>
  <ul class="source-list">
    ${sources.map(s => html`<li><strong>${s.homepage_url ? html`<a href="${s.homepage_url}" rel="noopener">${s.name}</a>` : s.name}</strong><br><span class="muted small">${s.permission_basis}</span></li>`)}
  </ul>
  <h2>Tilmelding</h2>
  <p>Du tilmelder dig altid hos arrangøren. holistisk.org sælger ikke billetter og håndterer ikke betaling. Datoer, priser og aflysninger kan ændre sig – arrangørens egen side er den gældende.</p>
  <h2 id="arrangoerer">For arrangører</h2>
  <p>Vil du have dine events med? Det letteste er en offentlig kalender (fx en delt Google-kalender som iCal-link), et RSS-feed eller strukturerede eventdata (schema.org) på din hjemmeside – sammen med dit samtykke til, at vi viser titel, tidspunkt, sted, beskrivelse og eventuelt billede med henvisning til dig.${ctx.contactEmail ? html` Skriv til <a href="mailto:${ctx.contactEmail}">${ctx.contactEmail}</a>.` : ""}</p>
  <p>Ser du en fejl ved et af dine events, så ret det i din egen kalender – portalen henter ændringen ved næste opdatering. Vil du ikke være med, fjerner vi dine events.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om portalen", description: "Hvad holistisk.org er, hvor eventsene kommer fra, og hvordan arrangører kommer med.", canonical: "/om" }, body) };
}

export function notFoundPage(ctx: PageContext): View {
  const body = html`
<section class="page-head wrap">
  <h1>Siden findes ikke</h1>
  <p class="lead">Eventet kan være afholdt eller fjernet af arrangøren.</p>
  <p><a class="button" href="/events">Se kommende events</a></p>
</section>`;
  return { status: 404, body: page(ctx, { title: "Ikke fundet", description: "Siden findes ikke.", canonical: ctx.path, noindex: true }, body) };
}

