import { CATEGORIES } from "../categories.js";
import { TOPICS } from "../activities.js";
import type { Area } from "../geo.js";
import { html, jsonScript, raw, type SafeHtml } from "./html.js";
import { FLOKK_MARK } from "../forening/brand.js";

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
  /** The path prefix when served under another site (e.g. "/flokken"), or "". Links are prefixed after rendering. */
  base: string;
  /** "forening": Flokk (Udflugter, interest list); "portal": the event portal. */
  edition: "forening" | "portal";
};

export type Crumb = { name: string; path: string };

export type PageMeta = {
  /** The full <title>. Kept short and led by the search words ("Meditation og mindfulness i Aarhus"). */
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
  /** Extra stylesheets and scripts (site paths), e.g. the map's. */
  styles?: string[];
  scripts?: string[];
  /** Hide the footer (a page that fills the screen, like the map). */
  bare?: boolean;
};

export const SITE = "Flokken";

/** The main navigation in the header. */
const NAV: Array<[string, string]> = [["/kalender", "Kalender"], ["/kort", "Kort"], ["/find-en-flok", "Find en flok"], ["/spar-paa-billetten", "Spar på billetten"], ["/samarbejde", "For arrangører"]];
/** The site's mark: two friends side by side on a butter tile. */
export const MARK = raw('<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="12" fill="#ffe08a" stroke="#17332d" stroke-width="2"/><path d="M5.5 35c0-6.5 3.6-10 8.5-10s8.5 3.5 8.5 10z" fill="#b3164f" stroke="#17332d" stroke-width="2" stroke-linejoin="round"/><path d="M17.5 35c0-6.5 3.6-10 8.5-10s8.5 3.5 8.5 10z" fill="#1e6b56" stroke="#17332d" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="15.5" r="5.5" fill="#fffdf8" stroke="#17332d" stroke-width="2"/><circle cx="26" cy="15.5" r="5.5" fill="#fffdf8" stroke="#17332d" stroke-width="2"/></svg>');
/** The default picture for links shared on social media (public/assets/og.jpg, 1200×630). */
export const SHARE_IMAGE = "/assets/og.jpg";
export const FLOKK_SHARE_IMAGE = "/assets/og-flokk.jpg";
/** The same picture with the name the portal goes by under another address (see MOUNTS in src/index.ts). */
export const SHARE_IMAGES: Record<string, string> = { Socialklubben: "/assets/og-socialklubben.jpg" };

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

/** The name a page goes by: Flokk for the association, Flokken for the event portal (renamed again under a mount). */
export const siteName = (ctx: Pick<PageContext, "edition">): string => ctx.edition === "forening" ? "Flokk" : SITE;

export function page(ctx: PageContext, meta: PageMeta, body: SafeHtml): string {
  const name = siteName(ctx);
  const forening = ctx.edition === "forening";
  // Every title names the site, at the end so the search words come first.
  const title = meta.title.includes(name) ? meta.title : `${meta.title} – ${name}`;
  const canonical = /^https?:\/\//.test(meta.canonical) ? meta.canonical : ctx.origin + meta.canonical;
  const robots = meta.noindex || ctx.environment !== "production" ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  const image = meta.image ?? ctx.origin + (forening ? FLOKK_SHARE_IMAGE : SHARE_IMAGE);
  const jsonLd = [...(meta.jsonLd ?? []), ...(meta.breadcrumbs && meta.breadcrumbs.length > 1 ? [breadcrumbJsonLd(meta.breadcrumbs, ctx.origin)] : [])];
  return "<!doctype html>" + html`<html lang="da" data-base="/" data-edition="${ctx.edition}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${meta.description}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="da-DK" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta property="og:site_name" content="${name}">
<meta property="og:locale" content="da_DK">
<meta property="og:type" content="${meta.type ?? "website"}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${meta.description}">
<meta name="twitter:image" content="${image}">
<meta name="theme-color" content="#f6efe2">
${forening ? html`<link rel="icon" href="/assets/flokk-icon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/atkinson-400-latin.woff2" as="font" type="font/woff2" crossorigin>` : html`<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/fredoka-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/nunito-latin.woff2" as="font" type="font/woff2" crossorigin>`}
<link rel="stylesheet" href="/assets/site.css?v=14">
<script src="/assets/site.js?v=7" defer></script>
${(meta.styles ?? []).map(href => html`<link rel="stylesheet" href="${href}">`)}
${(meta.scripts ?? []).map(src => html`<script src="${src}" defer></script>`)}
${jsonLd.map(data => html`<script type="application/ld+json">${jsonScript(data)}</script>`)}
</head>
<body${meta.bare ? raw(' class="is-bare"') : ""}>
<a class="skip" href="#indhold">Spring til indhold</a>
${ctx.environment !== "production" ? html`<div class="env-banner" role="note">Testversion – ${name} er under udvikling</div>` : ""}
${ctx.edition === "forening" ? foreningHeader(ctx) : portalHeader(ctx)}
<main id="indhold">
${body}
</main>
${meta.bare ? "" : ctx.edition === "forening" ? foreningFooter(ctx) : portalFooter(ctx)}
</body>
</html>`.value;
}

function portalHeader(ctx: PageContext): SafeHtml {
  return html`<header class="masthead">
  <div class="wrap masthead-inner">
    <a class="wordmark" href="/" aria-label="Flokken – forsiden">${MARK}<span>Flokken</span></a>
    <nav class="nav" aria-label="Hovedmenu">
      <ul>${NAV.map(([href, label]) => html`<li><a href="${href}"${ctx.path === href ? raw(' aria-current="page"') : ""}>${label}</a></li>`)}</ul>
    </nav>
    <div class="masthead-tools">
      <a class="my-flocks" href="/flokke"${ctx.path === "/flokke" ? raw(' aria-current="page"') : ""}>Mine flokke</a>
      <a class="icon-button" href="/kalender#soeg" aria-label="Søg i kalenderen"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
      <details class="menu">
        <summary><span class="menu-label">Menu</span> <span class="burger" aria-hidden="true"></span></summary>
        <div class="menu-panel">
          <div><p class="menu-head">Flokken</p><ul><li><a href="/find-en-flok">Find en flok</a></li><li><a href="/spar-paa-billetten">Spar på billetten</a></li><li><a href="/flokke">Mine flokke</a></li><li><a href="/tryghed">Tryghed</a></li><li><a href="/om">Om Flokken</a></li></ul></div>
          <div><p class="menu-head">Kalender</p><ul><li><a href="/i-dag">Det sker i dag</a></li><li><a href="/weekend">I weekenden</a></li><li><a href="/kalender">Hele kalenderen</a></li><li><a href="/kort">Kortet</a></li><li><a href="/arrangoerer">Arrangører</a></li><li><a href="/samarbejde">For foreninger og kultursteder</a></li></ul></div>
          <div><p class="menu-head">Aktiviteter</p><ul>${CATEGORIES.map(c => html`<li><a href="/${c.path}">${c.name}</a></li>`)}</ul></div>
          <div><p class="menu-head">Emner</p><ul>${TOPICS.map(t => html`<li><a href="/${t.slug}">${t.name}</a></li>`)}</ul></div>
          <div><p class="menu-head">Byer</p><ul>${ctx.areas.map(a => html`<li><a href="/${a.slug}">${a.place}</a></li>`)}</ul></div>
        </div>
      </details>
    </div>
  </div>
</header>`;
}

function portalFooter(ctx: PageContext): SafeHtml {
  return html`<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-about">
      <p class="footer-brand">${MARK}<span>Flokken</span></p>
      <p>Find lokale events i ${ctx.regionLabel} – og nogen at følges med. Events fra mange arrangører, opdateret hver nat. Billet og tilmelding sker altid hos arrangøren.</p>
      <p><a href="/find-en-flok">Find en flok</a> · <a href="/spar-paa-billetten">Spar på billetten</a> · <a href="/tryghed">Tryghed</a> · <a href="/samarbejde">For arrangører</a> · <a href="/om">Om Flokken</a></p>
    </div>
    <nav aria-labelledby="f-cities"><p class="footer-head" id="f-cities">Events i din by</p>
      <ul>${ctx.areas.map(a => html`<li><a href="/${a.slug}">Events i ${a.place}</a></li>`)}</ul></nav>
    <nav aria-labelledby="f-cats"><p class="footer-head" id="f-cats">Aktiviteter</p>
      <ul>${CATEGORIES.map(c => html`<li><a href="/${c.path}">${c.name}</a></li>`)}</ul></nav>
    <nav aria-labelledby="f-topics"><p class="footer-head" id="f-topics">Populære emner</p>
      <ul>${TOPICS.map(t => html`<li><a href="/${t.slug}">${t.name}</a></li>`)}</ul></nav>
  </div>
</footer>`;
}

/** Flokk, the association: a few calm links, and the interest list as the one thing to do. */
const FORENING_NAV: Array<[string, string]> = [["/udflugter", "Udflugter"], ["/saadan-fungerer-det", "Sådan fungerer det"], ["/for-arrangoerer", "For arrangører"], ["/om", "Om Flokk"]];

function foreningHeader(ctx: PageContext): SafeHtml {
  return html`<header class="masthead">
  <div class="wrap masthead-inner">
    <a class="wordmark wordmark-flokk" href="/" aria-label="Flokk – forsiden">${FLOKK_MARK}<span>flokk</span></a>
    <nav class="nav" aria-label="Hovedmenu">
      <ul>${FORENING_NAV.map(([href, label]) => html`<li><a href="${href}"${ctx.path === href ? raw(' aria-current="page"') : ""}>${label}</a></li>`)}</ul>
    </nav>
    <div class="masthead-tools">
      <a class="my-flocks" href="/skriv-dig-op"${ctx.path === "/skriv-dig-op" ? raw(' aria-current="page"') : ""}>Skriv dig op</a>
      <details class="menu">
        <summary><span class="menu-label">Menu</span> <span class="burger" aria-hidden="true"></span></summary>
        <div class="menu-panel menu-panel-small">
          <ul>${FORENING_NAV.map(([href, label]) => html`<li><a href="${href}">${label}</a></li>`)}<li><a href="/skriv-dig-op">Skriv dig op</a></li><li><a href="/privatliv">Privatliv</a></li></ul>
        </div>
      </details>
    </div>
  </div>
</header>`;
}

function foreningFooter(ctx: PageContext): SafeHtml {
  return html`<footer class="site-footer">
  <div class="wrap footer-inner footer-forening">
    <div class="footer-about">
      <p class="footer-brand wordmark-flokk">${FLOKK_MARK}<span>flokk</span></p>
      <p>Flokk gør det lettere at opleve mere sammen med andre: Udflugter til udvalgte koncerter, foredrag og andre oplevelser i ${ctx.regionLabel} – i en lille flok, på din egen måde. Flokk er et koncept under udvikling.</p>
    </div>
    <nav aria-label="Flokk"><ul class="footer-links">${[...FORENING_NAV, ["/skriv-dig-op", "Skriv dig op"], ["/privatliv", "Privatliv"]].map(([href, label]) => html`<li><a href="${href}">${label}</a></li>`)}</ul></nav>
  </div>
</footer>`;
}
