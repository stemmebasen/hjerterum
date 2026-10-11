import { html, jsonScript, raw, type SafeHtml } from "./html.js";

export type PageContext = {
  /** The portal's own origin (PUBLIC_BASE_URL or the request's), without a trailing slash. */
  origin: string;
  environment: string;
  path: string;
  now: number;
  regionLabel: string;
  contactEmail: string | null;
};

export type PageMeta = {
  title: string;
  description: string;
  /** Path (or absolute URL, when a source's terms require its own page as canonical). */
  canonical: string;
  image?: string | null;
  noindex?: boolean;
  type?: "website" | "article";
  jsonLd?: unknown[];
};

const SITE = "holistisk.org";

export function page(ctx: PageContext, meta: PageMeta, body: SafeHtml): string {
  const canonical = /^https?:\/\//.test(meta.canonical) ? meta.canonical : ctx.origin + meta.canonical;
  const fullTitle = meta.title === SITE ? `${SITE} – holistiske events i ${ctx.regionLabel}` : `${meta.title} · ${SITE}`;
  const robots = meta.noindex || ctx.environment !== "production" ? "noindex, nofollow" : "index, follow";
  const nav = (href: string, label: string) => html`<a href="${href}"${ctx.path === href || (href !== "/" && ctx.path.startsWith(href)) ? raw(' aria-current="page"') : ""}>${label}</a>`;
  return "<!doctype html>" + html`<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${meta.description}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="da_DK">
<meta property="og:type" content="${meta.type ?? "website"}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
${meta.image ? html`<meta property="og:image" content="${meta.image}">` : ""}
<meta name="theme-color" content="#f6f2ea" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151a18" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css?v=1">
<script src="/assets/site.js?v=1" defer></script>
${(meta.jsonLd ?? []).map(data => html`<script type="application/ld+json">${jsonScript(data)}</script>`)}
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
    </div>
    <div>
      <p class="footer-head">Find vej</p>
      <ul>
        <li><a href="/events">Alle events</a></li>
        <li><a href="/kategorier">Kategorier</a></li>
        <li><a href="/om">Om portalen og kilderne</a></li>
      </ul>
    </div>
    <div>
      <p class="footer-head">For arrangører</p>
      <p>Vil du have dine events med? Læs <a href="/om#arrangoerer">hvordan</a>.</p>
    </div>
  </div>
</footer>
</body>
</html>`.value;
}
