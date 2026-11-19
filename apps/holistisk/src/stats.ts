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

/** Where a visitor came from when the browser does not say (apps such as Facebook's and Instagram's often leave the
 * referrer out): the link's own utm_source, or the click id Facebook and Google add to links. */
export function sourceOfLink(url: URL): string | null {
  const utm = (url.searchParams.get("utm_source") ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  if (utm) return /^(fb|facebook)/.test(utm) ? "facebook" : /^(ig|instagram)/.test(utm) ? "instagram" : utm;
  if (url.searchParams.has("fbclid")) return "facebook";
  if (url.searchParams.has("gclid")) return "google";
  return null;
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
  const source = sourceOf(request.headers.get("referer"), url.hostname) ?? sourceOfLink(url);
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

// ————————————————————————————————————————— The way to becoming a member (Jake 2026-11-19)

/** The steps from a visit to a member, in order. Each is counted once per person per day, the same cookie-free way as
 * visitors (the day's salt, IP address and browser, hashed; the hashes go the next night and only the number stays). */
export const FUNNEL_STEPS = [
  { key: "arrangement", label: "Så et arrangement", hint: "åbnede en arrangementsside" },
  { key: "vil_med", label: "Trykkede „Jeg vil gerne med!“", hint: "på et arrangement eller i velkomst-listen" },
  { key: "log_ind", label: "Så siden „Opret dig“", hint: "/log-ind, hvor nye skriver fornavn" },
  { key: "profil_oprettet", label: "Oprettede en profil", hint: "skrev fornavn og trykkede „Opret profil“" },
  { key: "profil_udfyldt", label: "Udfyldte profilen", hint: "alder, en linje om sig selv og e-mail" },
  { key: "paa_listen", label: "Kom på listen til et arrangement", hint: "„Tak! Du har vist interesse“" },
  { key: "meldt_ind", label: "Meldte sig ind uden profil", hint: "navn og e-mail på /bliv-medlem" },
  { key: "login_mail", label: "Bad om en mail på /log-ind", hint: "skrev sin e-mail i login-feltet" },
  { key: "login_link", label: "Loggede ind med link fra mail", hint: "trykkede på knappen fra mailen" }
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number]["key"];

/** Whether a request is from a person to count (not a robot, a prefetch or the admin), whatever its method. */
function fromPerson(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || ua.length < 20 || BOT.test(ua)) return false;
  const purpose = (request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "").toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  return !new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=`).test(request.headers.get("cookie") ?? "");
}

/** The steps a request and its answer are (often none). `path` is the Danish path (an English /en/... page made
 * Danish). A tick by someone with a full profile is both "vil_med" and "paa_listen" at once. */
export function funnelSteps(request: Request, response: Response, path: string): FunnelStep[] {
  if (!fromPerson(request)) return [];
  const status = response.status;
  const redirect = status >= 300 && status <= 399;
  const to = response.headers.get("location") ?? "";
  const listed = redirect && /besked=(interesse_her|interesser_gemt)/.test(to);
  if (request.method === "GET") {
    // The way back after making a profile saves the waiting tick, with a redirect to the thank-you.
    if (listed) return ["paa_listen"];
    if (status !== 200 || !(response.headers.get("content-type") ?? "").startsWith("text/html")) return [];
    if (/^\/events\/[a-z0-9-]+\/?$/.test(path)) return ["arrangement"];
    if (path === "/log-ind") return ["log_ind"];
    return [];
  }
  if (request.method !== "POST" || !redirect) return [];
  const steps: FunnelStep[] = [];
  if (/^\/events\/[a-z0-9-]+\/interesse$/.test(path) || (path === "/kom-godt-i-gang" && !/intet_valgt/.test(to))) steps.push("vil_med");
  else if (path === "/bliv-medlem" && to.includes("/bliv-medlem/velkommen")) steps.push("profil_oprettet");
  else if (path === "/profil") steps.push("profil_udfyldt");
  else if (path === "/bliv-medlem/meld-ind" && /besked=tak/.test(to)) steps.push("meldt_ind");
  else if (path === "/log-ind/mail") steps.push("login_mail");
  else if (path === "/log-ind/link") steps.push("login_link");
  if (listed) steps.push("paa_listen");
  return steps;
}

export async function recordStep(db: D1Database, request: Request, step: FunnelStep, now: number): Promise<void> {
  const day = localDate(now);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const person = (await sha256(`${await saltFor(db, day)}|${ip}|${request.headers.get("user-agent") ?? ""}`)).slice(0, 24);
  await db.prepare("INSERT OR IGNORE INTO funnel_people (day, step, visitor) VALUES (?, ?, ?)").bind(day, step, person).run();
}

/** Nightly, with rollUpVisits: the people of each past day and step become a number, and the hashes go. */
export async function rollUpFunnel(db: D1Database, now: number): Promise<void> {
  const today = localDate(now);
  await db.batch([
    db.prepare(`INSERT INTO funnel_days (day, step, people) SELECT day, step, COUNT(*) FROM funnel_people WHERE day < ? GROUP BY day, step
      ON CONFLICT (day, step) DO UPDATE SET people = excluded.people`).bind(today),
    db.prepare("DELETE FROM funnel_people WHERE day < ?").bind(today),
    db.prepare("DELETE FROM funnel_days WHERE day < ?").bind(addDays(today, -400))
  ]);
}

export type FunnelRow = { key: FunnelStep; label: string; hint: string; today: number; yesterday: number; week: number; month: number };

/** People per step: today, yesterday, the last 7 and the last 30 days (today included). */
export async function funnelSummary(db: D1Database, now: number): Promise<FunnelRow[]> {
  const today = localDate(now);
  const yesterday = addDays(today, -1), week = addDays(today, -6), month = addDays(today, -29);
  const [done, live] = await Promise.all([
    db.prepare("SELECT day, step, people FROM funnel_days WHERE day >= ?").bind(month).all<{ day: string; step: string; people: number }>(),
    db.prepare("SELECT day, step, COUNT(*) AS people FROM funnel_people WHERE day >= ? GROUP BY day, step").bind(month).all<{ day: string; step: string; people: number }>()
  ]);
  // A day not yet rolled up (the cron has not run) is counted from the hashes.
  const byKey = new Map<string, number>();
  for (const r of live.results) byKey.set(`${r.day}|${r.step}`, r.people);
  for (const r of done.results) if (!byKey.has(`${r.day}|${r.step}`)) byKey.set(`${r.day}|${r.step}`, r.people);
  const total = (step: string, from: string, to = today) => {
    let n = 0;
    for (const [k, v] of byKey) { const [d, s] = k.split("|"); if (s === step && d! >= from && d! <= to) n += v; }
    return n;
  };
  return FUNNEL_STEPS.map(s => ({ ...s, today: total(s.key, today), yesterday: total(s.key, yesterday, yesterday), week: total(s.key, week), month: total(s.key, month) }));
}
