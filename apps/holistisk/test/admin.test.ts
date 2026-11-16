import { beforeAll, describe, expect, it } from "vitest";
import worker, { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { countable, countedPath, recordVisit, rollUpVisits, sourceOf, visitSummary } from "../src/stats.js";
import { ago } from "../src/admin.js";
import type { EmailBinding } from "../src/mail.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ORIGIN = "https://portal.example";
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
type Sent = { to: string; subject: string; text: string };
const sent: Sent[] = [];
const binding: EmailBinding = { send: async m => { sent.push({ to: m.to, subject: m.subject, text: m.text }); return {}; } };
let env: Env;
let db: ReturnType<typeof testDb>;

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") } });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === "hjerterum") });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal", EMAIL: binding, ADMIN_EMAIL: "chef@example.dk" };
});

type Res = { status: number; body: string; headers: Headers };
async function call(path: string, init: { form?: Record<string, string>; cookie?: string; origin?: string } = {}, now = NOW): Promise<Res> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.form) { headers.origin = init.origin ?? ORIGIN; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request(ORIGIN + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env, now);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const tokenIn = (m: Sent) => /\/admin\/link\?t=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

describe("admin overview", () => {
  let cookie = "";

  it("shows only a login button to someone not logged in", async () => {
    const r = await call("/admin");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.body).toContain("Send mig et login-link");
    expect(r.body).toContain("ch••@example.dk");
    expect(r.body).not.toContain("Besøgende");
  });

  it("sends the link to the admin address only, and refuses a form from another site", async () => {
    expect((await call("/admin/log-ind", { form: { email: "someone@else.dk" }, origin: "https://evil.example" })).status).toBe(403);
    expect(sent).toHaveLength(0);
    const r = await call("/admin/log-ind", { form: { email: "someone@else.dk" } });
    expect(r.body).toContain("Linket er sendt");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("chef@example.dk");
  });

  it("logs in with the link once, behind a button", async () => {
    const token = tokenIn(sent[0]!);
    const page = await call(`/admin/link?t=${token}`);
    expect(page.body).toContain("Åbn overblikket");
    expect(page.headers.get("set-cookie")).toBeNull();
    const used = await call("/admin/link", { form: { t: token } });
    expect(used.status).toBe(303);
    expect(used.headers.get("location")).toBe("/admin");
    cookie = /sk_admin=[^;]+/.exec(used.headers.get("set-cookie") ?? "")![0];
    expect(used.headers.get("set-cookie")).toContain("HttpOnly");
    const again = await call("/admin/link", { form: { t: token } });
    expect(again.status).toBe(400);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("shows visits, members, interest, flocks, activity and mails", async () => {
    const event = db.raw.prepare("SELECT id, slug, title FROM events WHERE status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW + 86_400_000)[0] as { id: string; slug: string; title: string };
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, email, age_group) VALUES ('m1', 'Sofie', 'h1', ?, ?, 'sofie@example.dk', '30-39')").run(NOW - 3600_000, NOW);
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, flokk_joined_at) VALUES ('m2', 'Samfolkmedlem', 'h2', ?, ?, ?)").run(NOW, NOW, NOW);
    db.raw.prepare("INSERT INTO membership_signups (id, name, email, created_at) VALUES ('s1', 'Mads Jensen', 'mads@example.dk', ?)").run(NOW - 7200_000);
    db.raw.prepare("INSERT INTO event_interests (member_id, event_id, status, created_at, updated_at) VALUES ('m1', ?, 'waiting', ?, ?)").run(event.id, NOW - 600_000, NOW);
    db.raw.prepare("INSERT INTO flocks (id, event_id, created_by, meeting_place, meeting_at, max_size, status, created_at, updated_at) VALUES ('f1', ?, 'm1', 'Foran Domkirken', ?, 6, 'open', ?, ?)").run(event.id, NOW + 86_400_000, NOW, NOW);
    db.raw.prepare("INSERT INTO flock_members (flock_id, member_id, joined_at) VALUES ('f1', 'm1', ?)").run(NOW - 300_000);
    await recordVisit(db, new Request("https://socialklubben.dk/kalender", { headers: { "user-agent": BROWSER, "cf-connecting-ip": "1.2.3.4", referer: "https://www.google.dk/" } }), NOW);

    const r = await call("/admin", { cookie });
    expect(r.status).toBe(200);
    expect(r.body).toContain("Besøg");
    expect(r.body).toContain("/kalender");
    expect(r.body).toContain("google");
    expect(r.body).toContain("Sofie");
    expect(r.body).toContain("sofie@example.dk");
    expect(r.body).toContain("Mads Jensen");
    expect(r.body).not.toContain("Samfolkmedlem");
    expect(r.body).toContain(event.title.replace(/&/g, "&amp;"));
    expect(r.body).toContain("1 venter");
    expect(r.body).toContain("Foran Domkirken");
    expect(r.body).toContain("Sofie vil gerne med til");
    expect(r.body).toContain("Login-links");
  });

  it("does not let a made-up cookie in, and logs out", async () => {
    expect((await call("/admin", { cookie: `sk_admin=${"A".repeat(43)}` })).body).not.toContain("Besøgende");
    const out = await call("/admin/log-ud", { form: {}, cookie });
    expect(out.status).toBe(303);
    expect((await call("/admin", { cookie })).body).toContain("Send mig et login-link");
  });

  it("says ago as a person would", () => {
    expect(ago(NOW - 30_000, NOW)).toBe("lige nu");
    expect(ago(NOW - 5 * 60_000, NOW)).toBe("for 5 min. siden");
    expect(ago(NOW - 2 * 3600_000, NOW)).toBe("for 2 t. siden");
  });
});

describe("visitor statistics", () => {
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://socialklubben.dk${path}`, { headers: { "user-agent": BROWSER, ...headers } });
  const page = new Response("<p>hej</p>", { headers: { "content-type": "text/html; charset=utf-8" } });

  it("counts people reading pages, not robots, files, prefetches or the admin", () => {
    expect(countable(req("/"), page)).toBe(true);
    expect(countable(req("/", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), page)).toBe(false);
    expect(countable(req("/", { "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" }), page)).toBe(false);
    expect(countable(req("/", { "sec-purpose": "prefetch" }), page)).toBe(false);
    expect(countable(req("/", { cookie: "sk_admin=x" }), page)).toBe(false);
    expect(countable(req("/admin"), page)).toBe(false);
    expect(countable(req("/sitemap.xml"), page)).toBe(false);
    expect(countable(req("/"), new Response("x", { status: 404, headers: { "content-type": "text/html" } }))).toBe(false);
    expect(countable(req("/events/x.ics"), new Response("x", { headers: { "content-type": "text/calendar" } }))).toBe(false);
  });

  it("names sources and paths plainly", () => {
    expect(sourceOf("https://www.google.dk/", "socialklubben.dk")).toBe("google");
    expect(sourceOf("https://l.facebook.com/l.php?u=x", "socialklubben.dk")).toBe("facebook");
    expect(sourceOf("https://socialklubben.dk/kalender", "socialklubben.dk")).toBeNull();
    expect(sourceOf("https://www.aarhus.dk/kultur", "socialklubben.dk")).toBe("aarhus.dk");
    expect(sourceOf(null, "socialklubben.dk")).toBeNull();
    expect(countedPath("/kalender/")).toBe("/kalender");
  });

  it("counts visitors per day, then keeps only the number", async () => {
    const d = testDb();
    const day1 = Date.parse("2026-11-01T10:00:00Z");
    await recordVisit(d, req("/", { "cf-connecting-ip": "1.1.1.1" }), day1);
    await recordVisit(d, req("/kalender", { "cf-connecting-ip": "1.1.1.1" }), day1 + 60_000);
    await recordVisit(d, req("/", { "cf-connecting-ip": "2.2.2.2" }), day1 + 120_000);
    let s = await visitSummary(d, day1 + 3600_000);
    expect(s.days.at(-1)).toEqual({ day: "2026-11-01", views: 3, visitors: 2 });
    expect(s.topPages[0]).toEqual({ path: "/", views: 2 });
    const night = Date.parse("2026-11-02T03:17:00Z");
    await rollUpVisits(d, night);
    expect(d.raw.prepare("SELECT COUNT(*) AS n FROM visit_visitors").all()[0]).toEqual({ n: 0 });
    expect(d.raw.prepare("SELECT COUNT(*) AS n FROM visit_salts").all()[0]).toEqual({ n: 0 });
    s = await visitSummary(d, night);
    expect(s.days.at(-2)).toEqual({ day: "2026-11-01", views: 3, visitors: 2 });
    expect(s.days.at(-1)).toEqual({ day: "2026-11-02", views: 0, visitors: 0 });
    expect(s.days).toHaveLength(30);
  });

  it("counts visits on socialklubben.dk after answering, not on the test address", async () => {
    const d = testDb();
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
    const e: Env = { DB: d, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
    await worker.fetch(req("/om"), e, ctx);
    await worker.fetch(new Request("https://holistisk-portal-staging.example.workers.dev/om", { headers: { "user-agent": BROWSER } }), e, ctx);
    await Promise.all(waits);
    expect(d.raw.prepare("SELECT path, views FROM visit_pages").all()).toEqual([{ path: "/om", views: 1 }]);
  });
});
