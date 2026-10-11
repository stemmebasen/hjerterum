import type { Env } from "./env.js";
import { isProduction } from "./env.js";
import { activeAreas, activeRegions, areaBySlug, regionBySlug } from "./geo.js";
import { categoryBySlug } from "./categories.js";
import { ingestStatus, runIngest, scheduledRun } from "./ingest/run.js";
import { parseFilters, type Filters } from "./web/filters.js";
import type { PageContext } from "./web/layout.js";
import { aboutPage, categoriesPage, eventPage, homePage, listPage, notFoundPage, type View } from "./web/pages.js";
import { eventBySlug, sitemapEvents } from "./web/queries.js";
import { eventIcs, robotsTxt, sitemapXml } from "./web/seo.js";

/** holistisk.org: the public event portal (server-rendered pages) and its daily collector (the cron). */

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
const view = (env: Env, v: View) => respond(env, v.body, { status: v.status, ...(v.headers ? { headers: v.headers } : {}), ...(v.status !== 200 ? { cache: "no-store" } : {}) });

function context(env: Env, url: URL, now: number, regions: string[]): PageContext {
  const configured = env.PUBLIC_BASE_URL && /^https:\/\/[^/]+$/.test(env.PUBLIC_BASE_URL.replace(/\/$/, "")) ? env.PUBLIC_BASE_URL.replace(/\/$/, "") : null;
  return {
    origin: configured ?? url.origin,
    environment: env.ENVIRONMENT ?? "local",
    path: url.pathname,
    now,
    regionLabel: regions.map(r => regionBySlug(r)?.name ?? r).join(" og "),
    contactEmail: env.CONTACT_EMAIL && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(env.CONTACT_EMAIL) ? env.CONTACT_EMAIL : null
  };
}

/** Constant-time comparison for the manual-run token. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
  const regions = activeRegions(env.ACTIVE_REGIONS);
  const pc = context(env, url, now, regions);

  if (path === "/api/health") {
    const db = env.DB;
    if (!db) return json(env, { status: "error", error: "database_unbound", environment: pc.environment }, 503);
    const status = await ingestStatus(db, now);
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
    const outcome = await runIngest(env, { trigger: "manual", now });
    return json(env, outcome, outcome.status === "failed" ? 502 : 200);
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

  if (path === "/sitemap.xml") return respond(env, sitemapXml(pc.origin, regions, await sitemapEvents(db, regions, now)), { type: "application/xml; charset=utf-8", cache: "public, max-age=3600" });
  if (path === "/") return view(env, await homePage(db, pc, regions));
  if (path === "/events") return view(env, await listPage(db, pc, regions, parseFilters(url.searchParams, regions), null));
  if (path === "/kategorier") return view(env, await categoriesPage(db, pc, regions));
  if (path === "/om") return view(env, await aboutPage(db, pc, regions, activeAreas(regions)));

  const category = /^\/kategori\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (category && categoryBySlug(category)) {
    const f: Filters = { ...parseFilters(url.searchParams, regions), categories: [category] };
    return view(env, await listPage(db, pc, regions, f, { kind: "category", slug: category }));
  }
  const area = /^\/omraade\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (area && areaBySlug(area) && regions.includes(areaBySlug(area)!.region)) {
    const f: Filters = { ...parseFilters(url.searchParams, regions), area };
    return view(env, await listPage(db, pc, regions, f, { kind: "area", slug: area }));
  }
  const ics = /^\/events\/([a-z0-9-]{1,90})\.ics$/.exec(path)?.[1];
  if (ics) {
    const e = await eventBySlug(db, ics);
    if (!e || !e.region || !regions.includes(e.region)) return view(env, notFoundPage(pc));
    return respond(env, eventIcs(e, pc.origin, now), { type: "text/calendar; charset=utf-8", headers: { "content-disposition": `attachment; filename="${ics}.ics"` } });
  }
  const slug = /^\/events\/([a-z0-9-]{1,90})$/.exec(path)?.[1];
  if (slug) {
    const v = await eventPage(db, pc, regions, slug);
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
