import { CATEGORIES } from "../categories.js";
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
  const nav = (href: string, label: string) => html`<a href="${href}"${ctx.path === href || (href !== "/" && ctx.path.startsWith(href)) ? raw(' aria-current="page"') : ""}>${label}</a>`;
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
<meta name="theme-color" content="#f6f2ea" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151a18" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css?v=2">
<script src="/assets/site.js?v=2" defer></script>
${jsonLd.map(data => html`<script type="application/ld+json">${jsonScript(data)}</script>`)}
</head>
<body>
<a class="skip" href="#indhold">Spring til indhold</a>
${ctx.environment !== "production" ? html`<div class="env-banner" role="note">Testversion (${ctx.environment}) – ikke offentlig endnu</div>` : ""}
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="holistisk.org – forsiden">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 6c3.5 4 3.5 16 0 20M16 6c-3.5 4-3.5 16 0 20M6.5 13h19M6.5 19h19" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/></svg>
      <span>holistisk<span class="brand-dot">.org</span></span>
    </a>
    <nav class="site-nav" aria-label="Hovedmenu">
      ${nav("/events", "Events")}
      ${nav("/kategorier", "Kategorier")}
      ${nav("/om", "Om portalen")}
    </nav>
  </div>
</header>
<main id="indhold">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="footer-brand">holistisk.org</p>
      <p>Holistiske events fra mange arrangører, samlet ét sted. Tilmelding sker altid hos arrangøren.</p>
      <p><a href="/om#arrangoerer">Er du arrangør?</a> · <a href="/om">Om portalen og kilderne</a></p>
    </div>
    <nav aria-labelledby="f-cities">
      <p class="footer-head" id="f-cities">Events i din by</p>
      <ul>${ctx.areas.map(a => html`<li><a href="/${a.slug}">Events i ${a.place}</a></li>`)}</ul>
    </nav>
    <nav aria-labelledby="f-cats">
      <p class="footer-head" id="f-cats">Populære kategorier</p>
      <ul>${CATEGORIES.slice(0, 8).map(c => html`<li><a href="/kategori/${c.path}">${c.name}</a></li>`)}</ul>
    </nav>
    <nav aria-labelledby="f-more">
      <p class="footer-head" id="f-more">Flere eventtyper</p>
      <ul>${CATEGORIES.slice(8).map(c => html`<li><a href="/kategori/${c.path}">${c.name}</a></li>`)}</ul>
    </nav>
  </div>
</footer>
</body>
</html>`.value;
}
