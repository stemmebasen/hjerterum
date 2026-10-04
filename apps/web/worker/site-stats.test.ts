import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { handleCockpitRequest } from "./cockpit/handler.js";
import { campaignOf, countedPath, deviceOf, handleStatsApi, handleVisit, pruneVisits, referrerHost, visitorOf } from "./site-stats.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./saga/test-support.js";
import type { D1Database } from "./db.js";

// Requested: "Byg en statistikside i jeres admin over besøg på jeres offentlige hjemmeside, og et read-only API, der
// leverer de samme tal til et eksternt overblik. Formatet ... skal følges præcist".

const SITE = "https://hjerterum.info";
const SECRET = "stats-secret-2026";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const at = (iso: string) => Date.parse(iso);

type Visit = { ip?: string; ua?: string; origin?: string; gpc?: boolean; country?: string; host?: string };
function visit(db: D1Database, now: number, body: Record<string, unknown>, o: Visit = {}, secret: string | undefined = SECRET) {
  const host = o.host ?? SITE;
  return handleVisit(new Request(`${host}/api/besog`, { method: "POST", body: JSON.stringify(body), headers: {
    origin: o.origin ?? host, "user-agent": o.ua ?? PHONE, "cf-connecting-ip": o.ip ?? "203.0.113.7",
    ...(o.gpc ? { "sec-gpc": "1" } : {}), ...(o.country ? { "cf-ipcountry": o.country } : {}) } }), { DB: db, STATS_API_SECRET: secret }, now);
}
const rows = (db: D1Database) => db.prepare("SELECT * FROM site_visits ORDER BY id").all<Record<string, unknown>>().then(r => r.results ?? []);

describe("counting the website's visits", () => {
  it("recognises a visitor within one Danish day only, keeps no address, and sets no cookie", async () => {
    const db = testDatabase();
    const morning = at("2026-10-04T05:00:00Z");
    const first = await visit(db, morning, { p: "/", r: "https://www.google.com", q: "utm_source=nyhedsbrev&utm_medium=email&utm_campaign=oktober" }, { country: "DK" });
    expect(first.status).toBe(204);
    expect(first.headers.get("set-cookie")).toBeNull();
    await visit(db, morning + 60_000, { p: "/medlemskab", r: SITE, q: "utm_source=igen" }, { country: "DK" });
    await visit(db, morning + 120_000, { p: "/events", r: "https://www.facebook.com" });
    await visit(db, morning, { p: "/events" }, { ip: "198.51.100.4", ua: MAC, country: "XX" });
    const today = await rows(db);
    expect(today).toHaveLength(4);
    expect(new Set(today.slice(0, 3).map(r => r.visitor)).size).toBe(1);
    expect(today[3]!.visitor).not.toBe(today[0]!.visitor);
    // The first page of the day is the entry page, and only it keeps the source and the campaign.
    expect(today[0]).toMatchObject({ day: "2026-10-04", path: "/", entry: 1, referrer: "google.com", campaign: "nyhedsbrev|email|oktober", device: "mobile", country: "DK" });
    expect(today[1]).toMatchObject({ path: "/medlemskab", entry: 0, referrer: null, campaign: null });
    expect(today[2]).toMatchObject({ path: "/events", entry: 0, referrer: null });
    expect(today[3]).toMatchObject({ entry: 1, referrer: null, device: "desktop", country: null });
    const stored = JSON.stringify(today);
    expect(stored).not.toContain("203.0.113.7");
    expect(stored).not.toContain("iPhone");

    // Midnight in Copenhagen (22:00 UTC in October) starts a new day: the same person is someone new, and enters again.
    await visit(db, at("2026-10-04T21:59:00Z"), { p: "/kontakt" });
    await visit(db, at("2026-10-04T22:01:00Z"), { p: "/kontakt" });
    const [late, next] = (await rows(db)).slice(4);
    expect(late).toMatchObject({ day: "2026-10-04", visitor: today[0]!.visitor, entry: 0 });
    expect(next).toMatchObject({ day: "2026-10-05", entry: 1 });
    expect(next!.visitor).not.toBe(today[0]!.visitor);
  });

  it("salts with a secret that changes every day, and counts the host in", async () => {
    const same = await visitorOf(SECRET, "2026-10-04", "203.0.113.7", PHONE, "hjerterum.info");
    expect(await visitorOf(SECRET, "2026-10-04", "203.0.113.7", PHONE, "hjerterum.info")).toBe(same);
    expect(await visitorOf(SECRET, "2026-10-05", "203.0.113.7", PHONE, "hjerterum.info")).not.toBe(same);
    expect(await visitorOf(SECRET, "2026-10-04", "203.0.113.7", PHONE, "medlem.hjerterum.info")).not.toBe(same);
    expect(await visitorOf("another-secret", "2026-10-04", "203.0.113.7", PHONE, "hjerterum.info")).not.toBe(same);
    expect(same).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not count bots, Global Privacy Control, login, member and admin pages, API calls or other sites", async () => {
    const db = testDatabase();
    const now = at("2026-10-04T07:00:00Z");
    await visit(db, now, { p: "/" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    await visit(db, now, { p: "/" }, { ua: "Mozilla/5.0 (compatible; AhrefsBot/7.0)" });
    await visit(db, now, { p: "/" }, { ua: "" });
    await visit(db, now, { p: "/" }, { gpc: true });
    for (const p of ["/sign-in", "/sign-up", "/login", "/member-portal", "/member-portal/profil", "/admin", "/admin/members", "/cockpit", "/api/events/external", "/wp-login.php"]) await visit(db, now, { p });
    await visit(db, now, { p: "/" }, { origin: "https://evil.example" });
    await visit(db, now, { p: "/" }, {}, "");
    expect(await handleVisit(new Request(`${SITE}/api/besog`, { method: "POST", body: "not json", headers: { origin: SITE, "user-agent": MAC } }), { DB: db, STATS_API_SECRET: SECRET }, now)).toHaveProperty("status", 204);
    expect((await rows(db)).map(r => r.path)).toEqual([]);
    // The worker takes the signal on every address of the website.
    const response = await config.fetch(new Request(`${SITE}/api/besog`, { method: "POST", body: JSON.stringify({ p: "/" }), headers: { origin: SITE, "user-agent": MAC } }), { DB: db, STATS_API_SECRET: SECRET } as never);
    expect(response.status).toBe(204);
    expect(await rows(db)).toHaveLength(1);
  });

  it("reads paths, sources, campaigns and devices plainly", () => {
    expect(countedPath("/Medlemskab/")).toBe("/medlemskab");
    expect(countedPath("/en/membership")).toBe("/en/membership");
    expect(countedPath("https://hjerterum.info/")).toBeNull();
    expect(referrerHost("https://medlem.hjerterum.info", "hjerterum.info")).toBeNull();
    expect(referrerHost("https://www.facebook.com", "hjerterum.info")).toBe("facebook.com");
    expect(referrerHost("android-app://com.google.android.gm", "hjerterum.info")).toBe("com.google.android.gm");
    expect(campaignOf("utm_source=instagram")).toBe("instagram||");
    expect(campaignOf("utm_medium=email&utm_campaign=oktober")).toBeNull();
    expect(campaignOf("side=2")).toBeNull();
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; SM-X710) Safari/537.36")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36")).toBe("mobile");
    expect(deviceOf(MAC)).toBe("desktop");
  });

  it("deletes visits after six months", async () => {
    const db = testDatabase();
    await visit(db, at("2026-04-03T10:00:00Z"), { p: "/" });
    await visit(db, at("2026-04-04T10:00:00Z"), { p: "/" });
    await pruneVisits(db, at("2026-10-04T10:00:00Z"));
    expect((await rows(db)).map(r => r.day)).toEqual(["2026-04-04"]);
  });
});

async function seeded() {
  const db = testDatabase();
  // The period before (7 days): two visitors. This period: four visitors over three days, one of them twice.
  await visit(db, at("2026-09-24T09:00:00Z"), { p: "/" }, { ip: "1" });
  await visit(db, at("2026-09-25T09:00:00Z"), { p: "/" }, { ip: "2" });
  await visit(db, at("2026-10-01T09:00:00Z"), { p: "/", r: "https://www.instagram.com" }, { ip: "3", country: "DK" });
  await visit(db, at("2026-10-01T09:01:00Z"), { p: "/medlemskab", r: SITE }, { ip: "3", country: "DK" });
  await visit(db, at("2026-10-03T09:00:00Z"), { p: "/events" }, { ip: "4", ua: MAC, country: "SE" });
  await visit(db, at("2026-10-04T09:00:00Z"), { p: "/", q: "utm_source=nyhedsbrev&utm_campaign=oktober" }, { ip: "3", country: "DK" });
  await visit(db, at("2026-10-04T09:05:00Z"), { p: "/medlemskab" }, { ip: "5" });
  return db;
}
const NOW = at("2026-10-04T12:00:00Z");
const api = (db: D1Database, query = "?days=7", headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, method = "GET") =>
  handleStatsApi(new Request(`${SITE}/api/stats/site${query}`, { method, headers }), { DB: db, STATS_API_SECRET: SECRET }, NOW);

describe("GET /api/stats/site", () => {
  it("answers only the bearer of STATS_API_SECRET", async () => {
    const db = await seeded();
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: `Basic ${SECRET}` }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }]) {
      const response = await api(db, "?days=7", headers);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("visitors");
    }
    const unset = await handleStatsApi(new Request(`${SITE}/api/stats/site`, { headers: { authorization: "Bearer " } }), { DB: db }, NOW);
    expect(unset.status).toBe(401);
    const noSecret = await handleStatsApi(new Request(`${SITE}/api/stats/site`, { headers: { authorization: `Bearer ${SECRET}` } }), { DB: db }, NOW);
    expect(noSecret.status).toBe(401);
    expect((await api(db, "?days=7", { authorization: `Bearer ${SECRET}` }, "POST")).status).toBe(405);
    // Through the worker, on the website's address and on the member area's.
    for (const host of [SITE, "https://medlem.hjerterum.info"]) {
      expect((await config.fetch(new Request(`${host}/api/stats/site`), { DB: db, STATS_API_SECRET: SECRET } as never)).status).toBe(401);
      expect((await config.fetch(new Request(`${host}/api/stats/site`, { headers: { authorization: `Bearer ${SECRET}` } }), { DB: db, STATS_API_SECRET: SECRET } as never)).status).toBe(200);
    }
  });

  it("gives the shared format exactly", async () => {
    const response = await api(await seeded());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["site", "days", "from", "to", "tracksEnquiries", "totals", "previous", "series", "pages", "entryPages", "referrers", "campaigns", "devices", "countries"]);
    expect(body).toMatchObject({ site: "hjerterum", days: 7, from: "2026-09-28", to: "2026-10-04", tracksEnquiries: false });
    // Visitors are distinct (day, visitor): visitor 3 on two days counts twice.
    expect(body.totals).toEqual({ visitors: 4, pageViews: 5, enquiries: 0, conversionRate: null });
    expect(Object.keys(body.totals as object)).toEqual(["visitors", "pageViews", "enquiries", "conversionRate"]);
    expect(body.previous).toEqual({ visitors: 2, pageViews: 2, enquiries: 0 });
    const series = body.series as Array<Record<string, unknown>>;
    expect(series.map(d => d.day)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(series[0]).toEqual({ day: "2026-09-28", visitors: 0, pageViews: 0, enquiries: 0 });
    expect(series[3]).toEqual({ day: "2026-10-01", visitors: 1, pageViews: 2, enquiries: 0 });
    expect(series[6]).toEqual({ day: "2026-10-04", visitors: 2, pageViews: 2, enquiries: 0 });
    expect(body.pages).toEqual([{ key: "/", visitors: 2, views: 2 }, { key: "/medlemskab", visitors: 2, views: 2 }, { key: "/events", visitors: 1, views: 1 }]);
    expect(body.entryPages).toEqual([{ key: "/", visitors: 2, views: 2 }, { key: "/events", visitors: 1, views: 1 }, { key: "/medlemskab", visitors: 1, views: 1 }]);
    expect(body.referrers).toEqual([{ key: "", visitors: 3, views: 3 }, { key: "instagram.com", visitors: 1, views: 1 }]);
    expect(body.campaigns).toEqual([{ key: "nyhedsbrev||oktober", visitors: 1, views: 1 }]);
    expect(body.devices).toEqual([{ key: "mobile", visitors: 3, views: 4 }, { key: "desktop", visitors: 1, views: 1 }]);
    expect(body.countries).toEqual([{ key: "DK", visitors: 2, views: 3 }, { key: "", visitors: 1, views: 1 }, { key: "SE", visitors: 1, views: 1 }]);
  });

  it("takes 7, 30 or 90 days, and anything else as 30", async () => {
    const db = testDatabase();
    for (const [query, days] of [["?days=7", 7], ["?days=30", 30], ["?days=90", 90], ["", 30], ["?days=365", 30], ["?days=abc", 30], ["?days=07", 30], ["?days=7.0", 30]] as const) {
      const body = await (await api(db, query)).json() as { days: number; series: unknown[]; from: string; to: string };
      expect(body.days).toBe(days);
      expect(body.series).toHaveLength(days);
      expect(body.to).toBe("2026-10-04");
    }
    const empty = await (await api(db, "?days=30")).json() as Record<string, unknown>;
    expect(empty).toMatchObject({ from: "2026-09-05", totals: { visitors: 0, pageViews: 0, enquiries: 0, conversionRate: null }, pages: [], countries: [] });
  });

  it("keeps the lists to their lengths, sorted by visitors and then views", async () => {
    const db = testDatabase();
    const paths = ["/", "/events", "/behandling", "/behandling/breathwork", "/behandlere", "/medlemskab", "/medlemskab/vilkaar", "/lej-hjerterum", "/lej-hjerterum/praktisk",
      "/lej-hjerterum/vilkaar", "/lej-hjerterum/markedsfoering", "/lej-hjerterum/dine-events", "/om-os", "/om-os/teamet", "/om-os/historien", "/om-os/tribes", "/om-os/foreningen", "/kontakt"];
    for (const [i, p] of paths.entries()) {
      for (let v = 0; v <= i; v++) await visit(db, at("2026-10-04T08:00:00Z"), { p, r: `https://site${i}.example` }, { ip: `${i}.${v}`, country: ["DK", "SE", "NO", "DE", "NL", "GB", "US", "FR", "ES", "IT", "PL", "FI"][i % 12]! });
    }
    const uas = ["Mozilla/5.0 (iPad; CPU OS 18_0)", MAC, PHONE];
    for (const [i, ua] of uas.entries()) await visit(db, at("2026-10-04T09:00:00Z"), { p: "/" }, { ip: `ua${i}`, ua });
    const body = await (await api(db)).json() as Record<string, Array<{ key: string; visitors: number; views: number }>>;
    expect(body.pages).toHaveLength(15);
    for (const list of ["entryPages", "referrers", "countries"]) expect(body[list]).toHaveLength(10);
    expect(body.devices!.length).toBeLessThanOrEqual(5);
    for (const list of ["pages", "entryPages", "referrers", "campaigns", "devices", "countries"]) {
      const items = body[list]!;
      expect(items).toEqual([...items].sort((a, b) => b.visitors - a.visitors || b.views - a.views || (a.key < b.key ? -1 : 1)));
    }
    expect(body.pages![0]).toEqual({ key: "/kontakt", visitors: 18, views: 18 });
  });
});

describe("admin → Statistik", () => {
  it("shows the same numbers to the board, and only to the board", async () => {
    const db = await seeded();
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", STATS_API_SECRET: SECRET });
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(`https://admin.hjerterum.info${path}`, init), env, deps(fakeServices().fetcher, NOW));
    expect((await call("/statistik")).status).toBe(401);
    const form = new FormData(); form.append("password", "hjerte-2026");
    const login = await call("/login", { method: "POST", body: form, headers: { origin: "https://admin.hjerterum.info" } });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const page = await call("/statistik?dage=7", { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<h1>Statistik</h1>");
    expect(html).toMatch(/data-kpi="visitors">4</);
    expect(html).toMatch(/data-kpi="pageViews">5</);
    expect(html).toContain("▲ +100 %");
    expect(html).not.toContain('data-kpi="enquiries"');
    expect(html).toContain('aria-current="page">7 dage');
    for (const text of ["Mest besøgte sider", "Indgangssider", "Kilder", "Kampagner (UTM)", "Enheder", "Lande", "instagram.com", "nyhedsbrev · oktober", "Sverige",
      "<span>/medlemskab</span><small>Bliv en del af Hjerterum</small>", 'href="/statistik" class="on"', "slettes efter 6 måneder"]) expect(html).toContain(text);
    expect(html).not.toContain("Tællingen er ikke slået til");
    const off = await handleCockpitRequest(new Request("https://admin.hjerterum.info/statistik?dage=90", { headers: { cookie } }),
      sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "hjerte-2026" }), deps(fakeServices().fetcher, NOW));
    const offHtml = await off.text();
    expect(offHtml).toContain("Ingen besøg registreret endnu");
    expect(offHtml).toContain("Tællingen er ikke slået til");
  });
});
