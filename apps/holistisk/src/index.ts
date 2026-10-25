import type { Env } from "./env.js";
import { isProduction } from "./env.js";
import { activeAreas, activeRegions, areaBySlug, regionBySlug } from "./geo.js";
import { activityBySlug } from "./activities.js";
import { organizerBySlug } from "./organizers.js";
import { ingestStatus, runIngest, scheduledRun } from "./ingest/run.js";
import { parseFilters } from "./web/filters.js";
import { SHARE_IMAGE, SHARE_IMAGES, SITE, type PageContext } from "./web/layout.js";
import { aboutPage, activityPage, areaPage, calendarPage, categoriesPage, eventPage, homePage, notFoundPage, organizerPage, organizersPage, periodPage, savingsPage, type View } from "./web/pages.js";
import { sitemapPages } from "./web/sitemap.js";
import { mapPage } from "./web/map.js";
import { foreningRoute } from "./forening/routes.js";
import { notFound as foreningNotFound } from "./forening/pages.js";
import { eventBySlug, sitemapEvents } from "./web/queries.js";
import { eventIcs, robotsTxt, sitemapXml } from "./web/seo.js";
import { currentMember, sameOrigin, sameSecret } from "./flokken/auth.js";
import { flokkenRoute } from "./flokken/routes.js";
import { flocksForEvent, memberFlockForEvent } from "./flokken/store.js";

/** Flokken: the public event portal (server-rendered pages), its flocks, and its daily collector (the cron). */

interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void }
interface ScheduledControllerLike { cron: string; scheduledTime: number }

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), camera=(), microphone=()"
};

function respond(env: Env, body: string, init: { status?: number; type?: string; cache?: string; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers({ "content-type": init.type ?? "text/html; charset=utf-8", "cache-control": init.cache ?? "public, max-age=300", ...SECURITY_HEADERS, ...init.headers });
  // Nothing outside production may end up in a search index.
  if (!isProduction(env)) headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(body, { status: init.status ?? 200, headers });
}

const json = (env: Env, data: unknown, status = 200, cache = "no-store") => respond(env, JSON.stringify(data, null, 2), { status, type: "application/json; charset=utf-8", cache });
const redirect = (location: string) => new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=86400" } });
const view = (env: Env, v: View) => respond(env, v.body, { status: v.status, ...(v.headers ? { headers: v.headers } : {}), ...(v.status !== 200 ? { cache: "no-store" } : {}) });

function context(env: Env, url: URL, now: number, regions: string[], mount: Mount | null): PageContext {
  if (mount) return { ...context(env, url, now, regions, null), origin: mount.origin + mount.base, base: mount.base, edition: mount.edition };
  const configured = env.PUBLIC_BASE_URL && /^https:\/\/[^/]+$/.test(env.PUBLIC_BASE_URL.replace(/\/$/, "")) ? env.PUBLIC_BASE_URL.replace(/\/$/, "") : null;
  return {
    origin: configured ?? url.origin,
    environment: env.ENVIRONMENT ?? "local",
    path: url.pathname,
    now,
    regionLabel: regions.map(r => regionBySlug(r)?.name ?? r).join(" og "),
    contactEmail: env.CONTACT_EMAIL && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(env.CONTACT_EMAIL) ? env.CONTACT_EMAIL : null,
    areas: activeAreas(regions),
    base: "",
    // Without a mount: EDITION, else Flokken as an association.
    edition: env.EDITION === "portal" ? "portal" : "forening"
  };
}

/** Addresses the portal may also be served under, through a proxy that strips the path prefix and names the address in
 * the x-flokken-mount header (see docs/holistisk/README.md), with the name the portal goes by there. PUBLIC_MOUNTS adds
 * more ("address" or "address=Name"). */
const MOUNTS: Record<string, { name: string; edition: "forening" | "portal" }> = {
  "https://www.jacobhauge.com/flokk": { name: "Flokk", edition: "forening" },
  // The earlier address of Flokk; www.jacobhauge.com sends it on to /flokk.
  "https://www.jacobhauge.com/flokken": { name: "Flokk", edition: "forening" },
  // Socialklubben keeps the event portal.
  "https://www.jacobhauge.com/socialklubben": { name: "Socialklubben", edition: "portal" }
};

type Mount = { origin: string; base: string; name: string; edition: "forening" | "portal" };

function mountOf(request: Request, env: Env): Mount | null {
  const given = request.headers.get("x-flokken-mount");
  if (!given) return null;
  const extra = (env.PUBLIC_MOUNTS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(s => s.split("=").map(p => p.trim()));
  const allowed: Record<string, { name: string; edition: "forening" | "portal" }> = { ...MOUNTS, ...Object.fromEntries(extra.map(([address, name]) => [address!, { name: name || SITE, edition: "forening" as const }])) };
  const mount = allowed[given];
  const m = /^(https:\/\/[a-z0-9.-]+)(\/[a-z0-9-]+)$/.exec(given);
  return mount && m ? { origin: m[1]!, base: m[2]!, ...mount } : null;
}

/** Under a mount, every link, form, redirect and cookie of the page gets the path prefix, and pages and messages carry
 * the name the portal goes by there (the share image too). */
async function underMount(response: Response, { base, name }: Mount): Promise<Response> {
  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location && /^\/(?!\/)/.test(location)) headers.set("location", base + location);
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length) {
    headers.delete("set-cookie");
    for (const c of cookies) headers.append("set-cookie", c.replace(/; Path=\/(?=;|$)/, `; Path=${base}`));
  }
  const type = headers.get("content-type") ?? "";
  const rename = name !== SITE && type.startsWith("text/");
  if ((!type.startsWith("text/html") && !rename) || !response.body) return new Response(response.body, { status: response.status, headers });
  let text = await response.text();
  if (type.startsWith("text/html")) text = text.replace(/(\s(?:href|src|action|data-base)=")\/(?!\/)/g, `$1${base}/`);
  // The name only ever appears capitalised ("Flokken", "Flokkens"); paths, classes and "flokken" as a word are untouched.
  if (rename) text = text.replace(/Flokken/g, name).replaceAll(SHARE_IMAGE, SHARE_IMAGES[name] ?? SHARE_IMAGE);
  headers.delete("content-length");
  return new Response(text, { status: response.status, headers });
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const mount = mountOf(request, env);
  const response = await route(request, env, now, mount);
  return mount ? underMount(response, mount) : response;
}

async function route(request: Request, env: Env, now: number, mount: Mount | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
  const regions = activeRegions(env.ACTIVE_REGIONS);
  const pc = context(env, url, now, regions, mount);

  if (path === "/api/health") {
    const db = env.DB;
    if (!db) return json(env, { status: "error", error: "database_unbound", environment: pc.environment }, 503);
    const status = await ingestStatus(db, now, false);
    return json(env, { status: "ok", environment: pc.environment, regions, ingest: { healthy: status.healthy, lastRun: status.lastRun, lastSuccessAt: status.lastSuccessAt }, events: status.events });
  }
  if (path === "/api/status") {
    if (!env.DB) return json(env, { error: "database_unbound" }, 503);
    return json(env, await ingestStatus(env.DB, now));
  }
  if (path === "/api/ingest/run") {
    if (request.method !== "POST") return json(env, { error: "method_not_allowed" }, 405);
    const token = env.INGEST_TOKEN;
    const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!token || token.length < 24 || !sameSecret(given, token)) return json(env, { error: "unauthorized" }, 401);
    // The sources that are due, a failed one included; ?alle=1 takes every source (stalest first, as far as the budget goes).
    const outcome = await runIngest(env, { trigger: "manual", now, onlyDue: url.searchParams.get("alle") !== "1", retryFailed: true });
    return json(env, outcome, outcome.status === "failed" ? 502 : 200);
  }
  // Flokk, the association, has its own pages; the event portal's are not shown there.
  if (pc.edition === "forening" && !path.startsWith("/assets/") && path !== "/favicon.svg" && path !== "/robots.txt") {
    if (request.method === "POST" && !sameOrigin(request, new URL(pc.origin).origin)) return respond(env, "Formularen skal sendes fra Flokks egne sider.", { status: 403, type: "text/plain; charset=utf-8", cache: "no-store" });
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") return respond(env, "Method not allowed", { status: 405, type: "text/plain; charset=utf-8", cache: "no-store" });
    if (!env.DB) return respond(env, "Databasen er ikke forbundet.", { status: 503, type: "text/plain; charset=utf-8", cache: "no-store" });
    const result = await foreningRoute(request, env, env.DB, pc, regions, path, url, now);
    if (!result) return view(env, foreningNotFound(pc));
    if ("xml" in result) return respond(env, result.xml, { type: "application/xml; charset=utf-8", cache: "public, max-age=3600" });
    if ("file" in result) return respond(env, result.file.body, { type: result.file.type, cache: "no-store", headers: { "content-disposition": `attachment; filename="${result.file.name}"` } });
    const cookie = "cookie" in result && result.cookie ? { "set-cookie": result.cookie } : {};
    if ("redirect" in result) return new Response(null, { status: 303, headers: { location: result.redirect, "cache-control": "no-store", ...cookie } });
    // A minute at most: an event the volunteers approve shows up right away.
    return respond(env, result.view.body, { status: result.view.status, cache: result.view.status !== 200 ? "no-store" : "public, max-age=60", headers: { ...result.view.headers, ...cookie } });
  }
  const flokkenPaths = /^\/(log-ind|log-ud|bliv-medlem|flokke|find-en-flok|tryghed|samarbejde|api\/samarbejde)(\/|$)|^\/events\/[a-z0-9-]+\/opret-flok$/;
  if (flokkenPaths.test(path)) {
    if (request.method === "POST" && !sameOrigin(request, new URL(pc.origin).origin)) return respond(env, "Formularen skal sendes fra Flokkens egne sider.", { status: 403, type: "text/plain; charset=utf-8", cache: "no-store" });
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") return respond(env, "Method not allowed", { status: 405, type: "text/plain; charset=utf-8", cache: "no-store" });
    if (!env.DB) return respond(env, "Databasen er ikke forbundet.", { status: 503, type: "text/plain; charset=utf-8", cache: "no-store" });
    const result = await flokkenRoute(request, env, env.DB, pc, regions, path, url, now, () => notFoundPage(pc));
    if (result) {
      const cookie = "cookie" in result && result.cookie ? { "set-cookie": result.cookie } : {};
      if ("json" in result) return json(env, result.json, result.status);
      if ("redirect" in result) return new Response(null, { status: 303, headers: { location: result.redirect, "cache-control": "no-store", ...cookie } });
      return respond(env, result.view.body, { status: result.view.status, cache: "no-store", headers: { ...result.view.headers, ...cookie } });
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") return respond(env, "Method not allowed", { status: 405, type: "text/plain; charset=utf-8", cache: "no-store" });

  // Static files (public/): stylesheet, script, icon.
  if (path.startsWith("/assets/") || path === "/favicon.svg") {
    if (!env.ASSETS) return respond(env, "Not found", { status: 404, type: "text/plain" });
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("cache-control", "public, max-age=86400");
    headers.set("x-content-type-options", "nosniff");
    return new Response(asset.body, { status: asset.status, headers });
  }
  if (path === "/robots.txt") return respond(env, robotsTxt(pc.origin, isProduction(env)), { type: "text/plain; charset=utf-8", cache: "public, max-age=3600" });

  const db = env.DB;
  if (!db) return respond(env, "Databasen er ikke forbundet.", { status: 503, type: "text/plain; charset=utf-8", cache: "no-store" });

  if (path === "/sitemap.xml") {
    const pages = await sitemapPages(db, regions, now);
    return respond(env, sitemapXml(pc.origin, pages, await sitemapEvents(db, regions, now)), { type: "application/xml; charset=utf-8", cache: "public, max-age=3600" });
  }
  if (path === "/") return view(env, await homePage(db, pc, regions));
  if (path === "/kalender") return view(env, await calendarPage(db, pc, regions, parseFilters(url.searchParams, regions)));
  // The calendar moved from /events to /kalender (the word people search for); event pages stay under /events/.
  if (path === "/events") return redirect(`/kalender${url.search}`);
  if (path === "/i-dag") return view(env, await periodPage(db, pc, regions, "idag"));
  if (path === "/weekend") return view(env, await periodPage(db, pc, regions, "weekend"));
  if (path === "/spar-paa-billetten") return view(env, await savingsPage(db, pc, regions));
  if (path === "/kort") return view(env, await mapPage(db, pc, regions));
  if (path === "/kategorier") return view(env, await categoriesPage(db, pc, regions));
  if (path === "/arrangoerer") return view(env, organizersPage(pc, regions));
  if (path === "/om") return view(env, await aboutPage(db, pc, activeAreas(regions)));
  const organizerSlug = /^\/arrangoerer\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (organizerSlug) {
    const profile = organizerBySlug(organizerSlug);
    const v = profile ? await organizerPage(db, pc, regions, profile) : null;
    return view(env, v ?? notFoundPage(pc));
  }

  // Old addresses move permanently: /kategori/<x> -> /<activity>, /omraade/<city> -> /<city>.
  const oldCategory = /^\/kategori\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (oldCategory) {
    const activity = activityBySlug(oldCategory);
    return activity ? redirect(`/${activity.slug}${url.search}`) : view(env, notFoundPage(pc));
  }
  const oldArea = /^\/omraade\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (oldArea && areaBySlug(oldArea)) return redirect(`/${oldArea}${url.search}`);

  // Landing pages, activity first as people search: /meditation, /meditation/aarhus, and the city's own /aarhus.
  const two = /^\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path);
  if (two) {
    const [, first, second] = two as unknown as [string, string, string | undefined];
    const pageNo = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("side") ?? "1", 10) || 1));
    const cityOf = (slug: string) => { const a = areaBySlug(slug); return a && regions.includes(a.region) ? a : undefined; };
    const firstCity = cityOf(first);
    const firstActivity = activityBySlug(first);
    if (!second) {
      if (firstCity) return view(env, await areaPage(db, pc, regions, firstCity));
      if (firstActivity) return firstActivity.slug !== first ? redirect(`/${firstActivity.slug}`) : view(env, await activityPage(db, pc, regions, firstActivity, null, pageNo));
    } else {
      // The earlier city-first addresses (/aarhus/meditation) move to activity-first.
      const secondActivity = activityBySlug(second);
      if (firstCity && secondActivity) return redirect(`/${secondActivity.slug}/${firstCity.slug}`);
      const secondCity = cityOf(second);
      if (firstActivity && secondCity) {
        if (firstActivity.slug !== first) return redirect(`/${firstActivity.slug}/${secondCity.slug}`);
        return view(env, await activityPage(db, pc, regions, firstActivity, secondCity, pageNo));
      }
    }
  }
  const ics = /^\/events\/([a-z0-9-]{1,90})\.ics$/.exec(path)?.[1];
  if (ics) {
    const e = await eventBySlug(db, ics);
    if (!e || !e.region || !regions.includes(e.region)) return view(env, notFoundPage(pc));
    return respond(env, eventIcs(e, pc.origin, now), { type: "text/calendar; charset=utf-8", headers: { "content-disposition": `attachment; filename="${ics}.ics"` } });
  }
  const slug = /^\/events\/([a-z0-9-]{1,90})$/.exec(path)?.[1];
  if (slug) {
    const member = await currentMember(db, request, now);
    const v = await eventPage(db, pc, regions, slug, {
      member, message: url.searchParams.get("besked"),
      flocks: (eventId: string) => flocksForEvent(db, eventId, member?.id ?? null),
      myFlock: (eventId: string) => member ? memberFlockForEvent(db, eventId, member.id) : Promise.resolve(null)
    });
    return view(env, v ?? notFoundPage(pc));
  }
  return view(env, notFoundPage(pc));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env, Date.now());
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname, error: error instanceof Error ? error.message : String(error) }));
      return new Response("Der skete en fejl. Prøv igen om lidt.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
  },

  async scheduled(controller: ScheduledControllerLike, env: Env, ctx?: ExecutionContextLike): Promise<void> {
    const work = scheduledRun(env, controller.cron, { now: controller.scheduledTime || Date.now() })
      .then(outcome => console.log(JSON.stringify({ event: "cron", cron: controller.cron, status: outcome.status, reason: outcome.reason ?? null })))
      .catch(error => console.error(JSON.stringify({ event: "cron_failed", cron: controller.cron, error: error instanceof Error ? error.message : String(error) })));
    if (ctx) ctx.waitUntil(work);
    await work;
  }
};
