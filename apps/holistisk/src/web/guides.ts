import type { D1Database } from "../db.js";
import { activeAreas } from "../geo.js";
import { GROUPS } from "../groups.js";
import { FREE_OUTINGS } from "../flokken/profile.js";
import { flockCards, howItWorks } from "../flokken/pages.js";
import { upcomingFlocks } from "../flokken/store.js";
import { cardGrid, chipLinks, eventPath, section } from "./components.js";
import { html, type SafeHtml } from "./html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "./layout.js";
import { emptyFilters, type View } from "./pages.js";
import { listEvents, type EventRow } from "./queries.js";
import type { Filters } from "./filters.js";

/** Guide pages for what people search for when they want to get out in Aarhus: "mød nye mennesker i Aarhus",
 * "ny i Aarhus", "ting at lave i Aarhus". Each answers the question in plain words and then shows live events, so
 * the page is never just text. Written in the association's soft tone (no prices or offers named for the outings). */

export const GUIDES = [
  { path: "/moed-nye-mennesker", name: "Mød nye mennesker" },
  { path: "/ny-i-aarhus", name: "Ny i Aarhus" },
  { path: "/ting-at-lave-i-aarhus", name: "Ting at lave i Aarhus" }
] as const;

/** Aarhus's broad offer (src/mainstream.ts) first; everything when there is none of it. */
async function aarhusEvents(db: D1Database, ctx: PageContext, regions: string[], over: Partial<Filters>, size: number): Promise<{ events: EventRow[]; total: number }> {
  const f = emptyFilters({ area: "aarhus", ...over });
  const broad = await listEvents(db, { ...f, broad: true }, regions, ctx.now, size * 3);
  const list = broad.total ? broad : await listEvents(db, f, regions, ctx.now, size * 3);
  // One card per production: a show played three nights should not fill three places.
  const events = list.events.filter((e, i, all) => all.findIndex(x => x.title === e.title) === i).slice(0, size);
  return { events, total: list.total };
}

function itemList(events: EventRow[], ctx: PageContext) {
  return { "@context": "https://schema.org", "@type": "ItemList", itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: i + 1, url: ctx.origin + eventPath(e), name: e.title })) };
}

/** Questions and answers, as plain headings and paragraphs (read by people first, search engines second). */
function faq(id: string, title: string, items: Array<[string, SafeHtml | string]>): SafeHtml {
  return html`<section class="section prose guide-faq" aria-labelledby="${id}">
  <h2 id="${id}">${title}</h2>
  ${items.map(([q, a]) => html`<h3>${q}</h3><p>${a}</p>`)}
</section>`;
}

/** The other guides, for the bottom of each. */
const otherGuides = (current: string): SafeHtml => section("h-guides", "Læs også", chipLinks(GUIDES.filter(g => g.path !== current).map(g => ({ href: g.path, label: g.name }))));

const MEET_FAQ: Array<[string, SafeHtml | string]> = [
  ["Er det mærkeligt at gå alene til et event?", "Slet ikke – og med Flokken behøver du ikke. Du viser interesse for et event, og når I er nogle stykker, samler vi en lille flok. I mødes udenfor før eventet og går ind sammen."],
  ["Hvor mødes flokken?", "Altid udenfor, foran et kendt sted i byen – fx foran Domkirken, på Klostertorvet eller på Lille Torv. Aldrig hjemme hos nogen."],
  ["Hvem er med i en flok?", "Folk i alle aldre, som har lyst til det samme event som dig. Når du er med i en flok, kan du se de andres aldersgruppe og en kort linje om dem."],
  ["Hvad koster det?", html`Billet eller tilmelding klarer du selv hos arrangøren. Du kan være med de første ${FREE_OUTINGS} gange uden at være medlem af foreningen. <a href="/bliv-medlem">Læs om medlemskab</a>.`],
  ["Hvad hvis jeg fortryder?", html`Det er helt i orden. Du siger først ja, når flokken er samlet, og du kan altid forlade en flok igen. <a href="/tryghed">Læs om tryghed</a>.`]
];

/** /moed-nye-mennesker: "mød nye mennesker i Aarhus", "nye venner Aarhus". */
export async function meetPeoplePage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const path = "/moed-nye-mennesker";
  const [week, flocks] = await Promise.all([aarhusEvents(db, ctx, regions, { period: "uge" }, 6), upcomingFlocks(db, regions, ctx.now, 6)]);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Mød nye mennesker", path }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Mød nye mennesker i Aarhus</h1>
    <p class="standfirst">Det kan være svært at finde nye venner som voksen. Det bliver lettere, når man laver noget sammen – og når man ikke skal gå ind ad døren alene. Det er derfor, Flokken findes.</p>
  </header>
  <div class="prose guide-text">
    <h2>Gør noget sammen – så kommer snakken af sig selv</h2>
    <p>De fleste nye venskaber starter ikke med en samtale, men med en fælles oplevelse: en koncert, en quiz, et foredrag eller en tur i naturen. Når man har oplevet noget sammen, har man noget at tale om bagefter.</p>
    <p>Flokken samler små grupper, der følges ad til byens events. Du vælger selv, hvad du har lyst til – resten klarer vi sammen.</p>
  </div>
  ${section("h-how", "Sådan virker Flokken", howItWorks, { href: "/find-en-flok", label: "Vil du med? →" })}
  ${flocks.length ? section("h-flocks", "Flokke med plads lige nu", flockCards(flocks, ctx.now)) : ""}
  ${week.events.length ? section("h-week", "Gode steder at starte de næste 7 dage", cardGrid(week.events, ctx.now), { href: "/kalender?periode=uge", label: "Hele ugen →" }) : ""}
  ${faq("h-faq", "Spørgsmål og svar", MEET_FAQ)}
  ${otherGuides(path)}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: "Mød nye mennesker i Aarhus",
      description: "Svært at møde nye mennesker i Aarhus? Find en koncert, et foredrag eller en quiz, og følg med en lille flok. Mød hinanden udenfor og gå ind sammen.",
      canonical: path,
      breadcrumbs: crumbs,
      jsonLd: week.events.length ? [itemList(week.events, ctx)] : []
    }, body)
  };
}

/** /ny-i-aarhus: "ny i Aarhus", "flyttet til Aarhus", and international newcomers. */
export async function newInTownPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const path = "/ny-i-aarhus";
  const weekend = await aarhusEvents(db, ctx, regions, { period: "weekend" }, 6);
  const areas = activeAreas(regions);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ny i Aarhus", path }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Ny i Aarhus? Sådan finder du fællesskaber og oplevelser</h1>
    <p class="standfirst">Velkommen til byen! Aarhus er fuld af koncerter, teater, foredrag, foreninger og fællesskaber – men det kan tage tid at finde dem, og endnu længere at finde nogen at gå med. Her er en god måde at komme i gang på.</p>
  </header>
  <div class="prose guide-text">
    <h2>Fem gode første skridt</h2>
    <ol>
      <li><strong>Se, hvad der sker.</strong> <a href="/kalender">Kalenderen</a> samler events fra byens scener, spillesteder, biblioteker og foreninger – opdateret hver nat. Start med <a href="/i-dag">det sker i dag</a> eller <a href="/weekend">i weekenden</a>.</li>
      <li><strong>Vælg det, du har lyst til.</strong> Tryk <strong>Jeg er interesseret</strong> ved et event, så samler vi en lille flok, du kan følges med.</li>
      <li><strong>Find noget fast.</strong> En ugentlig aktivitet giver de samme ansigter igen og igen – og så kommer venskaberne lettere. Se <a href="/arrangoerer">byens arrangører</a> og deres faste tilbud.</li>
      <li><strong>Det skal ikke koste en formue.</strong> Der sker meget i Aarhus, som er <a href="/gratis-og-billigt">gratis eller billigt</a>.</li>
      <li><strong>Kig ud over midtbyen.</strong> Der sker også meget uden for centrum – se listen over byer nedenfor.</li>
    </ol>
  </div>
  ${weekend.events.length ? section("h-weekend", "Det sker i weekenden", cardGrid(weekend.events, ctx.now), { href: "/weekend", label: "Hele weekenden →" }) : ""}
  ${section("h-how", "Sådan virker Flokken", howItWorks)}
  <section class="section prose guide-text" aria-labelledby="h-en" lang="en">
    <h2 id="h-en">New in Aarhus?</h2>
    <p>Welcome! Flokken is a social club for anyone who wants to get out, meet new people and share an experience. Pick an event, tap <strong>Jeg er interesseret</strong> (I'm interested), and we gather a small group you can go with. You meet outside in front of a well-known spot and walk in together. Plenty of concerts, workshops and walks need no Danish at all, and you are always welcome to write in English in your group.</p>
  </section>
  ${section("h-cities", "Events i din by", chipLinks(areas.map(a => ({ href: `/${a.slug}`, label: a.place }))))}
  ${otherGuides(path)}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: "Ny i Aarhus? Find fællesskaber og nye venner",
      description: "Ny i Aarhus? Find koncerter, foredrag, foreninger og fællesskaber – og en lille flok at følges med, så du ikke skal gå alene. Also in English.",
      canonical: path,
      breadcrumbs: crumbs,
      jsonLd: weekend.events.length ? [itemList(weekend.events, ctx)] : []
    }, body)
  };
}

/** /ting-at-lave-i-aarhus: "ting at lave i Aarhus", "hvad kan man lave i Aarhus", by the four main kinds. */
export async function thingsToDoPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const path = "/ting-at-lave-i-aarhus";
  const perGroup = await Promise.all(GROUPS.map(g => aarhusEvents(db, ctx, regions, { period: "14-dage", group: g.slug }, 3)));
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ting at lave i Aarhus", path }];
  const shown = perGroup.flatMap(p => p.events);
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Ting at lave i Aarhus</h1>
    <p class="standfirst">Leder du efter noget at lave i Aarhus? Her er idéer fra byens scener, spillesteder, biblioteker og foreninger de næste to uger – fra koncerter og comedy til foredrag, kunst og ture i naturen.</p>
    <ul class="quick-links" aria-label="Genveje"><li><a href="/i-dag">I dag</a></li><li><a href="/weekend">I weekenden</a></li><li><a href="/gratis-og-billigt">Gratis og billigt</a></li><li><a href="/kort">På kortet</a></li></ul>
  </header>
  ${GROUPS.map((g, i) => {
    const list = perGroup[i]!;
    return list.events.length ? section(`h-${g.slug}`, `${g.name}: ${g.line.toLowerCase()}`, cardGrid(list.events, ctx.now), { href: `/kalender?gruppe=${g.slug}`, label: "Se alle →" }) : html``;
  })}
  <div class="prose guide-text">
    <h2>Mere sjovt sammen</h2>
    <p>Det er nemmere at tage afsted, når man ved, at andre venter på en. Tryk <strong>Jeg er interesseret</strong> ved et event, så samler vi en lille flok, der mødes udenfor og går ind sammen. <a href="/moed-nye-mennesker">Læs, hvordan det virker</a>.</p>
  </div>
  ${otherGuides(path)}
</div>`;
  return {
    status: 200,
    body: page(ctx, {
      title: "Ting at lave i Aarhus – i dag, i weekenden og ugen",
      description: "Hvad kan man lave i Aarhus? Koncerter, teater, comedy, foredrag, kunst, natur og fællesskaber de næste to uger – samlet ét sted. Find en flok at følges med.",
      canonical: path,
      breadcrumbs: crumbs,
      jsonLd: shown.length ? [itemList(shown, ctx)] : []
    }, body)
  };
}
