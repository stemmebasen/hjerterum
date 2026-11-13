import { renderMarkdown } from "../site/markdown.js";
import { ABOUT_WORDS, BENEFITS, LEGAL_LINKS, NAV, type SitePage } from "../site/pages.js";
import { sitePage } from "../site/redirects.js";
import { TEAM_MAIL } from "../site/mail.js";
import { membershipPlans } from "../membership.js";
import type { D1Database } from "./db.js";
import { EVENT_PAGE, eventMeta, type EventMeta } from "./event-meta.js";
import { eventIdOf } from "./event-detail.js";
import { getExternalEvents } from "./external-events.js";
import { isPartnerEvent } from "../partner-events.js";

/** Asked (the chair, 12 Nov 2026): "Er siden SEO optimeret efter nyeste og bedste standarder" - "Ja, og det hele bare så snart du kan".
 * The app draws the pages in the browser, so the HTML the server sent was the same empty page with the title "Hjerterum" at every address.
 * Now every public page arrives with its own title, description, canonical address, Open Graph, schema.org (JSON-LD) and its words and links -
 * for search engines and previews that do not run the app. The app draws over them as before (its words are the same). A page that does not
 * exist answers 404, and the login and member pages are kept out of the search results. /sitemap.xml lists the pages and the coming events. */

export const SITE = "https://www.hjerterum.info";
const ADDRESS = { "@type": "PostalAddress", streetAddress: "Guldsmedgade 26B", postalCode: "8000", addressLocality: "Aarhus C", addressCountry: "DK" };
const GEO = { "@type": "GeoCoordinates", latitude: 56.1593182, longitude: 10.2078481 };
const FACEBOOK = "https://www.facebook.com/hjerterumaarhus";
/** The account connected under PR og SoMe (social_account.ig_username). */
const INSTAGRAM = "https://www.instagram.com/hjerterum_aarhus/";
const ORG_ID = `${SITE}/#organisation`, PLACE_ID = `${SITE}/#huset`, SITE_ID = `${SITE}/#site`;
const SHARE_IMAGE = `${SITE}/media/hjerterum-deling.jpg`;

export const ORGANISATION = { "@type": "Organization", "@id": ORG_ID, name: "Hjerterum", legalName: "Hjerterum F.M.B.A.", url: SITE, logo: `${SITE}/logo.png`,
  email: TEAM_MAIL, address: ADDRESS, location: { "@id": PLACE_ID }, sameAs: [FACEBOOK, INSTAGRAM] };
export const PLACE = { "@type": "Place", "@id": PLACE_ID, name: "Hjerterum", address: ADDRESS, geo: GEO, url: SITE };
const WEBSITE = { "@type": "WebSite", "@id": SITE_ID, url: SITE, name: "Hjerterum", inLanguage: "da-DK", publisher: { "@id": ORG_ID } };

export type Seo = {
  status: number;
  title: string;
  description: string;
  /** The one address the page should be found at (always www.hjerterum.info); null for pages kept out of search. */
  canonical: string | null;
  image?: string | undefined;
  type?: "website" | "article";
  jsonLd: object[];
  /** The page's words and links, as plain HTML. */
  body: string;
  noindex?: boolean;
};

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const graph = (items: object[]) => ({ "@context": "https://schema.org", "@graph": items });

/** Paths the app answers itself (login, member pages, admin): kept out of search, never 404. */
const PRIVATE = /^\/(?:sign-in|login|sign-up|signup|admin|member-portal)(?:\/|$)/;
/** A teacher's page (/behandlere/<navn>): drawn by the app from the published profiles. */
const PROFILE = /^\/behandlere\/[a-z0-9-]+\/?$/;

const header = () => `<header><a href="/">Hjerterum</a><nav aria-label="Menu">${NAV.map(item => `<a href="${item.href}">${esc(item.label)}</a>`).join(" ")}</nav></header>`;
const footer = () => `<footer><p>Hjerterum F.M.B.A. · Guldsmedgade 26B, 8000 Aarhus C · <a href="mailto:${TEAM_MAIL}">${TEAM_MAIL}</a></p>`
  + `<nav aria-label="Sidefod"><a href="/om-os/foreningen">Foreningen</a> ${LEGAL_LINKS.map(l => `<a href="${l.href}">${esc(l.label)}</a>`).join(" ")}</nav></footer>`;
const shell = (main: string) => `${header()}<main>${main}</main>${footer()}`;

const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const when = (iso: string) => DAY.format(new Date(iso)).replace(/(\d{2})[.:](\d{2})$/, "kl. $1.$2");

type Coming = { title: string; startsAt: string; host: string | null; link: string };

/** The coming events of the house (own and from the calendar), with a page here; within 0.8 seconds, or none (the page must not wait). */
async function comingEvents(db: D1Database | undefined, fetcher: typeof fetch, nowMs: number): Promise<Coming[]> {
  if (!db) return [];
  const own = db.prepare(`SELECT id, title, teacher_name, starts_at_ms FROM room_bookings
      WHERE status = 'scheduled' AND COALESCE(review_status, 'approved') = 'approved' AND ends_at_ms >= ? ORDER BY starts_at_ms LIMIT 200`).bind(nowMs)
    .all<{ id: number; title: string; teacher_name: string; starts_at_ms: number }>()
    .then(r => (r.results ?? []).map(b => ({ title: b.title, startsAt: new Date(b.starts_at_ms).toISOString(), host: b.teacher_name, link: `/events/h${b.id}` })))
    .catch(() => [] as Coming[]);
  const calendar = (async () => (await getExternalEvents(false, fetcher).catch(() => []))
    .filter(e => Date.parse(e.endsAt ?? e.startsAt) >= nowMs && !isPartnerEvent(e) && eventIdOf(e))
    .map(e => ({ title: e.title, startsAt: e.startsAt, host: e.host, link: `/events/${eventIdOf(e)}` })))().catch(() => [] as Coming[]);
  const work = Promise.all([own, calendar]).then(([a, b]) => [...a, ...b].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt)));
  return Promise.race([work, new Promise<Coming[]>(resolve => setTimeout(() => resolve([]), 800))]);
}

const eventList = (events: Coming[], max: number) => events.length
  ? `<ul>${events.slice(0, max).map(e => `<li><a href="${esc(e.link)}">${esc(e.title)}</a> – ${esc(when(e.startsAt))}${e.host ? ` · med ${esc(e.host)}` : ""}</li>`).join("")}</ul>`
  : "";

function breadcrumbs(page: SitePage): object {
  const trail: Array<{ name: string; path: string }> = [{ name: "Forside", path: "/" }];
  const top = NAV.find(item => item.section === page.section && item.href !== page.path);
  if (top && page.path.startsWith(top.href)) trail.push({ name: top.label, path: top.href });
  trail.push({ name: page.menu ?? page.card.title, path: page.path });
  return { "@type": "BreadcrumbList", itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: SITE + (t.path === "/" ? "/" : t.path) })) };
}

function contentPage(page: SitePage, events: Coming[]): Seo {
  const url = SITE + page.path;
  // A line "{{name}}" places a live part of the page (the calendar, the plans …); here the plans and the calendar get their words, the rest is left to the app.
  const widgets: Record<string, string> = {
    events: eventList(events, 60),
    "membership-plans": `<ul>${Object.values(membershipPlans).map(p => `<li><strong>${esc(p.name)}</strong>: ${(p.month / 100).toLocaleString("da-DK")} kr. pr. måned eller ${(p.year / 100).toLocaleString("da-DK")} kr. pr. år. ${esc(p.description)}</li>`).join("")}</ul>`
  };
  const parts = page.body.split(/^\{\{([a-z-]+)\}\}$/m);
  const body = parts.map((part, i) => i % 2 ? widgets[part] ?? "" : renderMarkdown(part)).join("");
  const title = `${page.card.title} · Hjerterum`;
  const jsonLd = [
    { "@type": page.article ? "Article" : "WebPage", "@id": `${url}#side`, url, name: page.card.title, headline: page.title + (page.em ? ` ${page.em}` : ""), description: page.description,
      inLanguage: "da-DK", isPartOf: { "@id": SITE_ID }, publisher: { "@id": ORG_ID }, ...(page.image ? { image: SITE + page.image.src } : {}) },
    breadcrumbs(page), WEBSITE, ORGANISATION, ...(page.section === "kontakt" || page.path === "/brug-hjerterum" ? [PLACE] : [])
  ];
  return { status: 200, title, description: page.description, canonical: url, image: page.image ? SITE + page.image.src : undefined, type: page.article ? "article" : "website", jsonLd,
    body: shell(`<p>${esc(page.kicker)}</p><h1>${esc(page.title)}${page.em ? ` ${esc(page.em)}` : ""}</h1><p>${esc(page.lead)}</p>${body}`) };
}

function homePage(events: Coming[]): Seo {
  const description = ABOUT_WORDS.tagline.replace(/\s*♥️$/, "");
  return { status: 200, title: "Hjerterum – nærvær, oplevelser og fællesskab i Aarhus", description, canonical: `${SITE}/`, type: "website",
    jsonLd: [{ "@type": "WebPage", "@id": `${SITE}/#side`, url: `${SITE}/`, name: "Hjerterum", description, inLanguage: "da-DK", isPartOf: { "@id": SITE_ID }, about: { "@id": ORG_ID } }, WEBSITE, ORGANISATION, PLACE],
    body: shell(`<h1>Hjerterum – nærvær, oplevelser og fællesskab i Aarhus</h1><p>${esc(ABOUT_WORDS.intro)}</p><p>${esc(ABOUT_WORDS.welcome)}</p><p>${esc(ABOUT_WORDS.kinds)}</p>`
      + `<h2>Kommende events</h2>${eventList(events, 12)}<p><a href="/events">Se hele kalenderen</a></p>`
      + `<h2>Bliv en del af Hjerterum</h2><p>${esc(BENEFITS.front)}</p><p>${esc(ABOUT_WORDS.membership(membershipPlans.reduceret.month / 100))}</p><p><a href="/medlemskab">Fordele og vilkår</a></p>`
      + `<h2>Lej salen til dit event</h2><p>${esc(ABOUT_WORDS.teachers)}</p><p><a href="/brug-hjerterum">Brug Hjerterum</a></p>`) };
}

/** schema.org Event, as Google reads it for events in the search results. */
export function eventJsonLd(meta: EventMeta): object {
  const offers = meta.prices ? [
    { "@type": "Offer", name: "Medlemmer", price: meta.prices.memberKr, priceCurrency: "DKK", url: meta.url, availability: `https://schema.org/${meta.prices.full ? "SoldOut" : "InStock"}` },
    { "@type": "Offer", name: "Ikke-medlemmer", price: meta.prices.nonMemberKr, priceCurrency: "DKK", url: meta.url, availability: `https://schema.org/${meta.prices.full ? "SoldOut" : "InStock"}` }
  ] : undefined;
  return { "@type": "Event", "@id": `${meta.url}#event`, name: meta.title, description: meta.description, url: meta.url, image: [meta.image],
    ...(meta.startsAt ? { startDate: meta.startsAt } : {}), ...(meta.endsAt ? { endDate: meta.endsAt } : {}),
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: PLACE, organizer: { "@id": ORG_ID }, ...(meta.host ? { performer: { "@type": "Person", name: meta.host } } : {}), ...(offers ? { offers } : {}), inLanguage: "da-DK" };
}

function eventPage(meta: EventMeta): Seo {
  const path = meta.url.slice(SITE.length);
  return { status: 200, title: `${meta.title} · Hjerterum`, description: meta.description, canonical: meta.url, image: meta.image, type: "website",
    jsonLd: [eventJsonLd(meta), { "@type": "BreadcrumbList", itemListElement: [{ name: "Forside", item: `${SITE}/` }, { name: "Kalender", item: `${SITE}/events` }, { name: meta.title, item: SITE + path }]
      .map((t, i) => ({ "@type": "ListItem", position: i + 1, ...t })) }, ORGANISATION],
    body: shell(`<p><a href="/events">Kalenderen</a></p><h1>${esc(meta.title)}</h1>`
      + `<p>${meta.startsAt ? esc(when(meta.startsAt)) + " · " : ""}Hjerterum, Guldsmedgade 26B, 8000 Aarhus C${meta.host ? ` · med ${esc(meta.host)}` : ""}</p>`
      + (meta.prices ? `<p>Medlemmer: ${meta.prices.memberKr ? `${meta.prices.memberKr.toLocaleString("da-DK")} kr.` : "gratis"} · Ikke-medlemmer: ${meta.prices.nonMemberKr ? `${meta.prices.nonMemberKr.toLocaleString("da-DK")} kr.` : "gratis"}</p>` : "")
      + (meta.paragraphs ?? []).map(p => `<p>${esc(p)}</p>`).join("")) };
}

const NOT_FOUND: Seo = { status: 404, title: "Siden findes ikke · Hjerterum", description: "Siden findes ikke længere på hjerterum.info.", canonical: null, jsonLd: [], noindex: true,
  body: shell(`<h1>Siden findes ikke længere</h1><p>Måske er den flyttet, da vi samlede hjemmesiden. Prøv <a href="/">forsiden</a> eller <a href="/events">kalenderen</a>.</p>`) };

/** What the server should say about a page of the website, or null when the page is left as the app has it. */
export async function seoFor(path: string, ctx: { db: D1Database | undefined; fetcher: typeof fetch; nowMs: number }): Promise<Seo | null> {
  if (PRIVATE.test(path)) return { status: 200, title: "Hjerterum", description: "", canonical: null, jsonLd: [], body: "", noindex: true };
  if (path === "/" || path === "") return homePage(await comingEvents(ctx.db, ctx.fetcher, ctx.nowMs));
  const event = EVENT_PAGE.exec(path);
  if (event) {
    const meta = await eventMeta(ctx.db, event[1]!, ctx.fetcher, ctx.nowMs).catch(() => null);
    // An event of the house's own that is not there is gone; one from the calendar may only be out of reach for a moment.
    if (!meta) return event[1]!.startsWith("h") && ctx.db ? NOT_FOUND : null;
    return eventPage(meta);
  }
  if (PROFILE.test(path)) return null;
  const page = sitePage(path);
  if (page) return contentPage(page, page.body.includes("{{events}}") ? await comingEvents(ctx.db, ctx.fetcher, ctx.nowMs) : []);
  return NOT_FOUND;
}

/** The app's page with the page's own head and words in place of the site's. */
export function withSeo(html: string, seo: Seo): string {
  const a = esc;
  const extra: string[] = [];
  if (seo.noindex) extra.push(`<meta name="robots" content="noindex" />`);
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${a(seo.title)}</title>`);
  if (seo.description) out = out.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${a(seo.description)}" />`);
  if (seo.canonical) {
    const tags = [["og:site_name", "Hjerterum"], ["og:locale", "da_DK"], ["og:type", seo.type ?? "website"], ["og:title", seo.title.replace(/ · Hjerterum$/, "")], ["og:description", seo.description],
      ["og:url", seo.canonical], ["og:image", seo.image ?? SHARE_IMAGE]].map(([k, v]) => `<meta property="${k}" content="${a(v!)}" />`).join("\n    ")
      + (seo.image ? "" : `\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />`)
      + `\n    <meta name="twitter:card" content="summary_large_image" />\n    <link rel="canonical" href="${a(seo.canonical)}" />`;
    out = out.replace(/<!-- og:start[\s\S]*?<!-- og:end -->/, tags);
  }
  // "</" never ends the script early, whatever the words.
  if (seo.jsonLd.length) extra.push(`<script type="application/ld+json">${JSON.stringify(graph(seo.jsonLd)).replace(/</g, "\\u003c")}</script>`);
  // The words are for readers without the app (search engines, previews); the app draws the same page over them at once, so a browser shows them only without scripts.
  if (seo.body) extra.push(`<style>#root>[data-prerender]{opacity:0}@media (scripting:none){#root>[data-prerender]{opacity:1}}</style>`);
  if (extra.length) out = out.replace("</head>", `  ${extra.join("\n    ")}\n  </head>`);
  if (seo.body) out = out.replace(/<div id="root"><\/div>/, `<div id="root"><div data-prerender>${seo.body}</div></div>`);
  return out;
}

/** /sitemap.xml: the front page, every page of the website and the coming events. */
export async function sitemap(db: D1Database | undefined, fetcher: typeof fetch, nowMs: number, paths: string[]): Promise<string> {
  const events = await comingEvents(db, fetcher, nowMs);
  const urls = [...new Set(["/", ...paths, ...events.map(e => e.link)])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(p => `  <url><loc>${esc(SITE + (p === "/" ? "/" : p))}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
