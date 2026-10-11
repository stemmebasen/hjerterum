import { CATEGORIES } from "../categories.js";
import { TOPICS } from "../activities.js";
import { capitalize, wallClock, weekdayIndex, localDate, monthName } from "../time.js";
import type { Area } from "../geo.js";
import { html, jsonScript, raw, type SafeHtml } from "./html.js";

export type PageContext = {
  /** The portal's own origin (PUBLIC_BASE_URL or the request's), without a trailing slash. */
  origin: string;
  environment: string;
  path: string;
  now: number;
  regionLabel: string;
  contactEmail: string | null;
  /** The areas shown on the portal, for the footer's "Events i din by". */
  areas: Area[];
};

export type Crumb = { name: string; path: string };

export type PageMeta = {
  /** The full <title>. Kept short and led by the search words ("Meditation og mindfulness i Aarhus ✨"). */
  title: string;
  description: string;
  /** Path (or absolute URL, when a source's terms require its own page as canonical). */
  canonical: string;
  image?: string | null;
  noindex?: boolean;
  type?: "website" | "article";
  jsonLd?: unknown[];
  /** The page's place in the site, shown as a breadcrumb and given to search engines as a BreadcrumbList. */
  breadcrumbs?: Crumb[];
};

const SITE = "holistisk.org";

/** The section line under the masthead, as a newspaper's: the most searched activities. */
const SECTIONS: Array<[string, string]> = [["/kalender", "Kalender"], ["/meditation", "Meditation"], ["/yoga", "Yoga"], ["/spiritualitet", "Spiritualitet"], ["/healing", "Healing"], ["/retreat", "Retreats"]];
const WEEKDAY_NAMES = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
/** "Søndag den 11. oktober" */
export const todayLine = (now: number): string => {
  const w = wallClock(now);
  return `${capitalize(WEEKDAY_NAMES[weekdayIndex(localDate(now))]!)} den ${w.day}. ${monthName(w.month)}`;
};
/** The default picture for links shared on social media (public/assets/og.jpg, 1200×630). */
export const SHARE_IMAGE = "/assets/og.jpg";

/** The visible breadcrumb; the last crumb is the page itself. */
export function crumbsNav(crumbs: Crumb[]): SafeHtml {
  return html`<nav class="crumbs" aria-label="Brødkrumme">${crumbs.map((c, i) => i === crumbs.length - 1
    ? html`<span aria-current="page">${c.name}</span>`
    : html`<a href="${c.path}">${c.name}</a> / `)}</nav>`;
}

function breadcrumbJsonLd(crumbs: Crumb[], origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: origin + c.path }))
  };
}

export function page(ctx: PageContext, meta: PageMeta, body: SafeHtml): string {
  const canonical = /^https?:\/\//.test(meta.canonical) ? meta.canonical : ctx.origin + meta.canonical;
  const robots = meta.noindex || ctx.environment !== "production" ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  const image = meta.image ?? ctx.origin + SHARE_IMAGE;
  const jsonLd = [...(meta.jsonLd ?? []), ...(meta.breadcrumbs && meta.breadcrumbs.length > 1 ? [breadcrumbJsonLd(meta.breadcrumbs, ctx.origin)] : [])];
  return "<!doctype html>" + html`<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="da-DK" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="da_DK">
<meta property="og:type" content="${meta.type ?? "website"}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.description}">
<meta name="twitter:image" content="${image}">
<meta name="theme-color" content="#f4f4f4">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=3">
<script src="/assets/site.js?v=3" defer></script>
${jsonLd.map(data => html`<script type="application/ld+json">${jsonScript(data)}</script>`)}
</head>
<body>
<a class="skip" href="#indhold">Spring til indhold</a>
${ctx.environment !== "production" ? html`<div class="env-banner" role="note">Testversion (${ctx.environment}) – ikke offentlig endnu</div>` : ""}
<header class="masthead">
  <div class="wrap masthead-inner">
    <div class="masthead-side">
      <a class="pill" href="/om#arrangoerer">Er du arrangør?</a>
    </div>
    <a class="wordmark" href="/" aria-label="holistisk.org – forsiden">holistisk<span>.org</span></a>
    <div class="masthead-side masthead-right">
      <a class="pill" href="/kalender#soeg"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2"/></svg>Søg</a>
      <details class="menu">
        <summary>Menu <span class="burger" aria-hidden="true"></span></summary>
        <div class="menu-panel">
          <div><p class="menu-head">Kalender</p><ul><li><a href="/i-dag">Det sker i dag</a></li><li><a href="/weekend">I weekenden</a></li><li><a href="/kalender">Hele kalenderen</a></li><li><a href="/arrangoerer">Arrangører</a></li></ul></div>
          <div><p class="menu-head">Aktiviteter</p><ul>${CATEGORIES.map(c => html`<li><a href="/${c.path}">${c.name}</a></li>`)}</ul></div>
          <div><p class="menu-head">Emner</p><ul>${TOPICS.map(t => html`<li><a href="/${t.slug}">${t.name}</a></li>`)}</ul></div>
          <div><p class="menu-head">Byer</p><ul>${ctx.areas.map(a => html`<li><a href="/${a.slug}">${a.place}</a></li>`)}</ul></div>
        </div>
      </details>
    </div>
  </div>
</header>
<nav class="sections" aria-label="Sektioner">
  <div class="wrap sections-inner">
    <span class="today">${todayLine(ctx.now)}</span>
    <ul>
      ${SECTIONS.map(([href, label]) => html`<li><a href="${href}"${ctx.path === href ? raw(' aria-current="page"') : ""}>${label}</a></li>`)}
    </ul>
    <a class="sections-right" href="/weekend">Det sker i weekenden</a>
  </div>
</nav>
<main id="indhold">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-about">
      <p class="footer-brand">holistisk<span>.org</span></p>
      <p>Spirituel og holistisk kalender for ${ctx.regionLabel}. Events fra mange arrangører, samlet ét sted og opdateret hver nat. Tilmelding sker altid hos arrangøren.</p>
      <p><a href="/om">Om portalen og kilderne</a> · <a href="/om#arrangoerer">Er du arrangør?</a></p>
    </div>
    <nav aria-labelledby="f-cities"><p class="footer-head" id="f-cities">Events i din by</p>
      <ul>${ctx.areas.map(a => html`<li><a href="/${a.slug}">Events i ${a.place}</a></li>`)}</ul></nav>
    <nav aria-labelledby="f-cats"><p class="footer-head" id="f-cats">Aktiviteter</p>
      <ul>${CATEGORIES.map(c => html`<li><a href="/${c.path}">${c.name}</a></li>`)}</ul></nav>
    <nav aria-labelledby="f-topics"><p class="footer-head" id="f-topics">Populære emner</p>
      <ul>${TOPICS.map(t => html`<li><a href="/${t.slug}">${t.name}</a></li>`)}</ul></nav>
  </div>
</footer>
</body>
</html>`.value;
}
