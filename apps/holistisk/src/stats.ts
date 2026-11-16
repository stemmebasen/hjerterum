import type { D1Database } from "./db.js";
import { addDays, localDate } from "./time.js";
import { sha256 } from "./flokken/auth.js";

/** Socialklubben's own visitor statistics, counted on the server: no cookie, no script and nothing sent to anyone else,
 * so no cookie banner is needed. Each page view adds one to the day's and the page's count, and one to the source
 * (the site a visitor came from) when that is another site. A visitor is a hash of the day's random salt, the IP
 * address and the browser. The salt and the hashes are deleted the next night (rollUpVisits, in the daily cron),
 * leaving only the number of visitors that day. Robots, link previews, prefetches and the admin's own visits are not
 * counted. */

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|slack|linkedin|pinterest|headless|lighthouse|pagespeed|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|monitor|uptime|scan|feed|http-client|bingpreview|google-inspectiontool|chrome-lighthouse/i;
/** Paths that are not pages people read. */
const SKIP = /^\/(admin|api|assets|log-ind\/link|log-ud|favicon|robots\.txt|sitemap\.xml)(\/|$|\.)|\.(ics|xml|txt|json|png|jpe?g|webp|svg|ico)$/;

export const ADMIN_COOKIE = "sk_admin";

/** Whether a request and its answer is a page view to count. */
export function countable(request: Request, response: Response): boolean {
  if (request.method !== "GET" || response.status !== 200) return false;
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return false;
  const path = new URL(request.url).pathname;
  if (SKIP.test(path)) return false;
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || ua.length < 20 || BOT.test(ua)) return false;
  const purpose = (request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "").toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  if (new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=`).test(request.headers.get("cookie") ?? "")) return false;
  return true;
}

/** A page path as counted: no query, no trailing slash, at most 120 characters. */
export const countedPath = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/").slice(0, 120) || "/";

/** Where a visitor came from: another site's name ("google.com"), or null for the site itself and for none. */
export function sourceOf(referer: string | null, ownHost: string): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.replace(/^(www|m|l|lm)\./, "");
    if (!host || host === ownHost.replace(/^www\./, "")) return null;
    // Google's many country domains count as one, and so do Facebook's link wrappers.
    if (/^google\.[a-z.]+$/.test(host)) return "google";
    if (/(^|\.)facebook\.com$/.test(host) || host === "fb.com") return "facebook";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    if (/^bing\.com$/.test(host)) return "bing";
    return host.slice(0, 80);
  } catch { return null; }
}

/** The salt of the day (made the first time it is needed), kept in memory for the rest of the day. */
const salts = new Map<string, string>();
async function saltFor(db: D1Database, day: string): Promise<string> {
  const known = salts.get(day);
  if (known) return known;
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT OR IGNORE INTO visit_salts (day, salt) VALUES (?, ?)").bind(day, fresh).run();
  const row = await db.prepare("SELECT salt FROM visit_salts WHERE day = ?").bind(day).first<{ salt: string }>();
  const salt = row?.salt ?? fresh;
  salts.clear();
  salts.set(day, salt);
  return salt;
}

export async function recordVisit(db: D1Database, request: Request, now: number): Promise<void> {
  const url = new URL(request.url);
  const day = localDate(now);
  const path = countedPath(url.pathname);
  const source = sourceOf(request.headers.get("referer"), url.hostname);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const visitor = (await sha256(`${await saltFor(db, day)}|${ip}|${request.headers.get("user-agent") ?? ""}`)).slice(0, 24);
  await db.batch([
    db.prepare("INSERT INTO visit_days (day, views) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET views = views + 1").bind(day),
    db.prepare("INSERT INTO visit_pages (day, path, views) VALUES (?, ?, 1) ON CONFLICT (day, path) DO UPDATE SET views = views + 1").bind(day, path),
    db.prepare("INSERT OR IGNORE INTO visit_visitors (day, visitor) VALUES (?, ?)").bind(day, visitor),
    ...(source ? [db.prepare("INSERT INTO visit_sources (day, source, views) VALUES (?, ?, 1) ON CONFLICT (day, source) DO UPDATE SET views = views + 1").bind(day, source)] : [])
  ]);
}

/** Nightly: the visitors of each past day become a number, and the hashes and salts behind it are deleted. Page and
 * source counts are kept for 400 days. */
export async function rollUpVisits(db: D1Database, now: number): Promise<void> {
  const today = localDate(now);
  await db.batch([
    db.prepare("UPDATE visit_days SET visitors = (SELECT COUNT(*) FROM visit_visitors v WHERE v.day = visit_days.day) WHERE day < ? AND visitors IS NULL").bind(today),
    db.prepare("DELETE FROM visit_visitors WHERE day < ?").bind(today),
    db.prepare("DELETE FROM visit_salts WHERE day < ?").bind(today),
    db.prepare("DELETE FROM visit_pages WHERE day < ?").bind(addDays(today, -400)),
    db.prepare("DELETE FROM visit_sources WHERE day < ?").bind(addDays(today, -400))
  ]);
}

export type DayCount = { day: string; views: number; visitors: number };
export type VisitSummary = {
  days: DayCount[];
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; views: number }>;
};

/** The last `span` days (today included), oldest first, with the top pages and sources of the last 7 days. */
export async function visitSummary(db: D1Database, now: number, span = 30): Promise<VisitSummary> {
  const today = localDate(now);
  const from = addDays(today, -(span - 1));
  const week = addDays(today, -6);
  const [rows, live, pages, sources] = await Promise.all([
    db.prepare("SELECT day, views, visitors FROM visit_days WHERE day >= ? ORDER BY day").bind(from).all<{ day: string; views: number; visitors: number | null }>(),
    db.prepare("SELECT day, COUNT(*) AS n FROM visit_visitors WHERE day >= ? GROUP BY day").bind(from).all<{ day: string; n: number }>(),
    db.prepare("SELECT path, SUM(views) AS views FROM visit_pages WHERE day >= ? GROUP BY path ORDER BY views DESC, path LIMIT 10").bind(week).all<{ path: string; views: number }>(),
    db.prepare("SELECT source, SUM(views) AS views FROM visit_sources WHERE day >= ? GROUP BY source ORDER BY views DESC, source LIMIT 8").bind(week).all<{ source: string; views: number }>()
  ]);
  const byDay = new Map(rows.results.map(r => [r.day, r]));
  const liveBy = new Map(live.results.map(r => [r.day, r.n]));
  const days: DayCount[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const r = byDay.get(d);
    days.push({ day: d, views: r?.views ?? 0, visitors: r?.visitors ?? liveBy.get(d) ?? 0 });
  }
  return { days, topPages: pages.results, topSources: sources.results };
}
