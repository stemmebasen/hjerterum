import type { D1Database } from "./db.js";
import { sitePage } from "../site/redirects.js";

/** Requested: "Byg en statistikside i jeres admin over besøg på jeres offentlige hjemmeside, og et read-only API, der
 * leverer de samme tal til et eksternt overblik. Formatet ... er fælles for flere sites og skal følges præcist".
 * Every page the website shows sends one small signal (src/visits.ts); admin → Statistik (cockpit/statsPage.ts) and
 * GET /api/stats/site read the same numbers from siteStats() below.
 * No cookies, nothing kept in the browser, no address stored: a visitor is an HMAC of address, browser and host with a
 * secret that changes every day (an HMAC of "site-stats:<day>"), so a visitor is recognised within one Danish day only. */

export const VISIT_PATH = "/api/besog";
export const STATS_API_PATH = "/api/stats/site";
export const SITE_NAME = "hjerterum";
/** The website has no enquiry forms of its own: contact is by mail, the newsletter is Mailchimp's, sign-up is on holistisk.org. */
export const TRACKS_ENQUIRIES = false;
export const STATS_PERIODS = [7, 30, 90] as const;
/** Visits are deleted after six months (the privacy text on /privatliv says so). */
export const KEEP_MONTHS = 6;
/** More than this from one visitor in a day is not a person reading the site. */
const DAILY_LIMIT = 300;
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|prerender|facebookexternalhit|embedly|python|curl|wget|httpclient|okhttp|phantom|scrapy|go-http|java\/|monitor|uptime/i;
/** The site's own addresses: arriving from one of them is moving around the site, not a source. */
const OWN_HOST = /(^|\.)hjerterum\.info$|(^|\.)workers\.dev$|^localhost$/i;

export type StatsEnv = { DB?: D1Database; STATS_API_SECRET?: string };

const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthsBefore = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const encode = (text: string) => new TextEncoder().encode(text);

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, message: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encode(message));
}

/** The day's secret, HMAC(secret, "site-stats:<YYYY-MM-DD>"), and with it the visitor: HMAC of address, browser and host. */
export async function visitorOf(secret: string, day: string, address: string, userAgent: string, host: string): Promise<string> {
  const daySecret = await hmac(encode(secret), `site-stats:${day}`);
  return hex(await hmac(daySecret, `${address}\n${userAgent}\n${host.toLowerCase()}`)).slice(0, 32);
}

export function deviceOf(userAgent: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** Only the website's public pages: login, member, admin and API addresses are never pages of the site, so never counted. */
export function countedPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200 || !raw.startsWith("/")) return null;
  const path = (raw.replace(/\/+$/, "") || "/").toLowerCase();
  return path === "/" || sitePage(path) ? path : null;
}

/** Another site's name, or null when arriving directly or from the site itself. */
export function referrerHost(raw: unknown, ownHost: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  if (!host || host === ownHost.toLowerCase() || OWN_HOST.test(host)) return null;
  return host.replace(/^www\./, "").slice(0, 100);
}

/** "utm_source|utm_medium|utm_campaign", empty parts as "" - and only with a utm_source. */
export function campaignOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const params = new URLSearchParams(raw.slice(0, 500));
  const [source, medium, campaign] = ["utm_source", "utm_medium", "utm_campaign"].map(name => (params.get(name) ?? "").trim().slice(0, 60).replace(/\|/g, " "));
  return source ? `${source}|${medium}|${campaign}` : null;
}

const countryOf = (raw: string | null) => raw && /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;

/** POST /api/besog from the website's own pages. Always answers 204: there is nothing to learn from it. */
export async function handleVisit(request: Request, env: StatsEnv, now: number): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  const url = new URL(request.url);
  if (request.method !== "POST" || !env.DB || !env.STATS_API_SECRET) return done;
  if (request.headers.get("origin") !== url.origin) return done;
  // Global Privacy Control: not counted at all.
  if (request.headers.get("sec-gpc") === "1") return done;
  const userAgent = request.headers.get("user-agent") ?? "";
  if (!userAgent || BOTS.test(userAgent)) return done;
  const text = await request.text().catch(() => "");
  if (!text || text.length > 2000) return done;
  let sent: Record<string, unknown>;
  try { sent = JSON.parse(text) as Record<string, unknown>; } catch { return done; }
  const path = countedPath(sent.p);
  if (!path) return done;
  try {
    const db = env.DB, day = copenhagenDay(now);
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
    const visitor = await visitorOf(env.STATS_API_SECRET, day, address, userAgent, url.hostname);
    const seen = Number((await db.prepare("SELECT COUNT(*) AS n FROM site_visits WHERE day = ? AND visitor = ?").bind(day, visitor).first<{ n: number }>())?.n ?? 0);
    if (seen >= DAILY_LIMIT) return done;
    // The first page a visitor sees on a day is the entry page; only it keeps where the visitor came from.
    const entry = seen === 0;
    await db.prepare("INSERT INTO site_visits (day, at_ms, visitor, path, entry, referrer, campaign, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(day, now, visitor, path, entry ? 1 : 0, entry ? referrerHost(sent.r, url.hostname) : null, entry ? campaignOf(sent.q) : null,
        deviceOf(userAgent), countryOf(request.headers.get("cf-ipcountry"))).run();
  } catch (error) {
    console.warn("site_visit_failed", error instanceof Error ? error.message : error);
  }
  return done;
}

/** Visits older than six months are deleted (run with the five-minute jobs; it touches nothing on most runs). */
export async function pruneVisits(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM site_visits WHERE day < ?").bind(monthsBefore(copenhagenDay(now), KEEP_MONTHS)).run();
}

export type Ranked = { key: string; visitors: number; views: number };
export type SiteStats = {
  site: string; days: number; from: string; to: string; tracksEnquiries: boolean;
  totals: { visitors: number; pageViews: number; enquiries: number; conversionRate: number | null };
  previous: { visitors: number; pageViews: number; enquiries: number };
  series: Array<{ day: string; visitors: number; pageViews: number; enquiries: number }>;
  pages: Ranked[]; entryPages: Ranked[]; referrers: Ranked[]; campaigns: Ranked[]; devices: Ranked[]; countries: Ranked[];
};

/** 7, 30 or 90; anything else is 30. */
export const periodOf = (raw: string | null) => (STATS_PERIODS as readonly number[]).map(String).includes(raw ?? "") ? Number(raw) : 30;

// A visitor is one (day, visitor): the sum of each day's unique visitors.
const VISITORS = "COUNT(DISTINCT day || '|' || visitor)";

async function totals(db: D1Database, from: string, to: string) {
  const row = await db.prepare(`SELECT ${VISITORS} AS visitors, COUNT(*) AS pageViews FROM site_visits WHERE day BETWEEN ? AND ?`).bind(from, to).first<{ visitors: number; pageViews: number }>();
  return { visitors: Number(row?.visitors ?? 0), pageViews: Number(row?.pageViews ?? 0), enquiries: 0 };
}

async function ranked(db: D1Database, from: string, to: string, column: "path" | "referrer" | "campaign" | "device" | "country", limit: number, where = ""): Promise<Ranked[]> {
  const { results } = await db.prepare(`SELECT COALESCE(${column}, '') AS key, ${VISITORS} AS visitors, COUNT(*) AS views FROM site_visits
    WHERE day BETWEEN ? AND ?${where} GROUP BY key ORDER BY visitors DESC, views DESC, key LIMIT ?`).bind(from, to, limit).all<Ranked>();
  return (results ?? []).map(r => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) }));
}

/** The last 7, 30 or 90 days (today included, Danish time) against the same number of days just before them. */
export async function siteStats(db: D1Database, days: number, now: number): Promise<SiteStats> {
  const to = copenhagenDay(now), from = addDays(to, -(days - 1));
  const [current, previous, perDay, pages, entryPages, referrers, campaigns, devices, countries] = await Promise.all([
    totals(db, from, to), totals(db, addDays(from, -days), addDays(from, -1)),
    db.prepare(`SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS pageViews FROM site_visits WHERE day BETWEEN ? AND ? GROUP BY day`).bind(from, to)
      .all<{ day: string; visitors: number; pageViews: number }>(),
    ranked(db, from, to, "path", 15), ranked(db, from, to, "path", 10, " AND entry = 1"), ranked(db, from, to, "referrer", 10, " AND entry = 1"),
    ranked(db, from, to, "campaign", 10, " AND entry = 1 AND campaign IS NOT NULL"), ranked(db, from, to, "device", 5), ranked(db, from, to, "country", 10)
  ]);
  const byDay = new Map((perDay.results ?? []).map(r => [r.day, r]));
  const series = Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i), r = byDay.get(day);
    return { day, visitors: Number(r?.visitors ?? 0), pageViews: Number(r?.pageViews ?? 0), enquiries: 0 };
  });
  const conversionRate = TRACKS_ENQUIRIES && current.visitors ? Math.round(current.enquiries / current.visitors * 1000) / 10 : null;
  return { site: SITE_NAME, days, from, to, tracksEnquiries: TRACKS_ENQUIRIES, totals: { ...current, conversionRate }, previous, series,
    pages, entryPages, referrers, campaigns, devices, countries };
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra } });

/** Compared as digests, so the time taken says nothing about how much of the secret was right. */
async function sameSecret(given: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encode(given)), crypto.subtle.digest("SHA-256", encode(secret))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}

/** GET /api/stats/site?days=7|30|90 with "Authorization: Bearer <STATS_API_SECRET>"; everything else is 401. */
export async function handleStatsApi(request: Request, env: StatsEnv, now: number): Promise<Response> {
  const given = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!env.STATS_API_SECRET || !given || !(await sameSecret(given, env.STATS_API_SECRET))) return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  return json(await siteStats(env.DB, periodOf(new URL(request.url).searchParams.get("days")), now));
}
