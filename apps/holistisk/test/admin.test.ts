import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import worker, { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { countable, countedPath, funnelSteps, funnelSummary, recordVisit, rollUpFunnel, rollUpVisits, sourceOf, sourceOfLink, visitSummary } from "../src/stats.js";
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
    await recordVisit(db, new Request("https://socialklubben.dk/kalender", { headers: { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9", "cf-connecting-ip": "1.2.3.4", referer: "https://www.google.dk/" } }), NOW);

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
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://socialklubben.dk${path}`, { headers: { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9", ...headers } });
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

  it("sorts out scrapers dressed up as a browser (19 November 2026)", async () => {
    // No language, or not fetching a page, or from a data centre: not a person.
    expect(countable(new Request("https://socialklubben.dk/", { headers: { "user-agent": BROWSER } }), page)).toBe(false);
    expect(countable(req("/", { "sec-fetch-dest": "empty" }), page)).toBe(false);
    expect(countable(req("/", { "sec-fetch-dest": "document" }), page)).toBe(true);
    const cloud = req("/kalender");
    Object.defineProperty(cloud, "cf", { value: { asOrganization: "Amazon.com, Inc." } });
    expect(countable(cloud, page)).toBe(false);
    const home = req("/kalender");
    Object.defineProperty(home, "cf", { value: { asOrganization: "TDC Holding A/S" } });
    expect(countable(home, page)).toBe(true);
    // They are counted apart, as a number per day.
    const d = testDb();
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
    const e: Env = { DB: d, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
    await worker.fetch(new Request("https://socialklubben.dk/om", { headers: { "user-agent": BROWSER } }), e, ctx);
    await worker.fetch(req("/om"), e, ctx);
    await Promise.all(waits);
    const s = await visitSummary(d, Date.now());
    expect(s.robots.today).toBe(1);
    expect(s.days.at(-1)!.views).toBe(1);
  });

  it("names sources and paths plainly", () => {
    expect(sourceOf("https://www.google.dk/", "socialklubben.dk")).toBe("google");
    expect(sourceOf("https://l.facebook.com/l.php?u=x", "socialklubben.dk")).toBe("facebook");
    expect(sourceOf("https://socialklubben.dk/kalender", "socialklubben.dk")).toBeNull();
    expect(sourceOf("https://www.aarhus.dk/kultur", "socialklubben.dk")).toBe("aarhus.dk");
    expect(sourceOf(null, "socialklubben.dk")).toBeNull();
    expect(countedPath("/kalender/")).toBe("/kalender");
    // Apps often leave out the referrer; the link itself may still say where it was shared.
    expect(sourceOfLink(new URL("https://socialklubben.dk/?fbclid=abc"))).toBe("facebook");
    expect(sourceOfLink(new URL("https://socialklubben.dk/?utm_source=IG_story"))).toBe("instagram");
    expect(sourceOfLink(new URL("https://socialklubben.dk/?utm_source=radio24syv"))).toBe("radio24syv");
    expect(sourceOfLink(new URL("https://socialklubben.dk/"))).toBeNull();
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
    await worker.fetch(new Request("https://holistisk-portal-staging.example.workers.dev/om", { headers: { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9" } }), e, ctx);
    await Promise.all(waits);
    expect(d.raw.prepare("SELECT path, views FROM visit_pages").all()).toEqual([{ path: "/om", views: 1 }]);
  });
});

describe("admin member pages", () => {
  const SESSION = "S".repeat(43);
  let admin = "";
  let event: { id: string; slug: string; title: string };
  beforeAll(async () => {
    const { sha256 } = await import("../src/flokken/auth.js");
    db.raw.prepare("INSERT INTO admin_tokens (token_hash, kind, created_at, expires_at) VALUES (?, 'session', ?, ?)").run(await sha256(SESSION), NOW, NOW + 86_400_000);
    admin = `sk_admin=${SESSION}`;
    event = db.raw.prepare("SELECT id, slug, title FROM events WHERE status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 1 OFFSET 1").all(NOW + 86_400_000)[0] as typeof event;
    const add = db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, email, age_group, intro) VALUES (?, ?, ?, ?, ?, ?, '40-49', 'Glad for musik')");
    add.run("11111111-1111-4111-8111-111111111111", "Henrik", "hh", NOW - 86_400_000, NOW, "henrik@example.dk");
    add.run("22222222-2222-4222-8222-222222222222", "Tove", "ht", NOW - 86_400_000, NOW, "tove@example.dk");
    db.raw.prepare("INSERT INTO member_photos (member_id, id, type, data, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'p1', 'image/png', ?, ?)").run(new Uint8Array([137, 80, 78, 71]), NOW);
    db.raw.prepare("INSERT INTO membership_signups (id, name, email, created_at) VALUES ('33333333-3333-4333-8333-333333333333', 'Henrik Hansen', 'HENRIK@example.dk', ?), ('44444444-4444-4444-8444-444444444444', 'Uden Profil', 'uden@example.dk', ?)").run(NOW, NOW);
    for (const m of ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]) db.raw.prepare("INSERT INTO event_interests (member_id, event_id, status, created_at, updated_at) VALUES (?, ?, 'invited', ?, ?)").run(m, event.id, NOW, NOW);
    // Henrik started a flock that Tove is in, and one he is alone in.
    db.raw.prepare("INSERT INTO flocks (id, event_id, created_by, meeting_place, meeting_at, max_size, status, created_at, updated_at) VALUES ('fa', ?, '11111111-1111-4111-8111-111111111111', 'Lille Torv', ?, 6, 'open', ?, ?), ('fb', ?, '11111111-1111-4111-8111-111111111111', 'Klostertorvet', ?, 6, 'open', ?, ?)").run(event.id, NOW + 86_400_000, NOW, NOW, event.id, NOW + 86_400_000, NOW, NOW);
    db.raw.prepare("INSERT INTO flock_members (flock_id, member_id, joined_at) VALUES ('fa', '11111111-1111-4111-8111-111111111111', ?), ('fa', '22222222-2222-4222-8222-222222222222', ?), ('fb', '11111111-1111-4111-8111-111111111111', ?)").run(NOW, NOW + 1, NOW);
    db.raw.prepare("INSERT INTO flock_messages (id, flock_id, member_id, body, created_at) VALUES ('c1', 'fa', '11111111-1111-4111-8111-111111111111', 'Hej alle', ?)").run(NOW);
    db.raw.prepare("UPDATE event_interests SET flock_id = 'fb' WHERE member_id = '11111111-1111-4111-8111-111111111111'").run();
  });

  it("is closed to others", async () => {
    for (const p of ["/admin/medlemmer", "/admin/medlemmer/11111111-1111-4111-8111-111111111111", "/admin/medlemmer/11111111-1111-4111-8111-111111111111/foto", `/admin/interesse/${event.slug}`]) {
      const r = await call(p);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/admin");
    }
    expect((await call("/admin/medlemmer/11111111-1111-4111-8111-111111111111/slet", { form: { bekraeft: "ja" } })).status).toBe(303);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members WHERE first_name = 'Henrik'").all()[0]).toEqual({ n: 1 });
  });

  it("lists members and sign-ups, and searches", async () => {
    const r = await call("/admin/medlemmer", { cookie: admin });
    expect(r.body).toContain("Henrik");
    expect(r.body).toContain("Uden Profil");
    expect(r.body).not.toContain("Henrik Hansen");
    expect(r.body).not.toContain("Samfolkmedlem");
    const s = await call("/admin/medlemmer?q=tove", { cookie: admin });
    expect(s.body).toContain("Tove");
    expect(s.body).not.toContain(">Henrik<");
  });

  it("shows a whole profile with photo, flocks and interests", async () => {
    const r = await call("/admin/medlemmer/11111111-1111-4111-8111-111111111111", { cookie: admin });
    expect(r.status).toBe(200);
    expect(r.body).toContain("Glad for musik");
    expect(r.body).toContain("henrik@example.dk");
    expect(r.body).toContain("Lille Torv");
    expect(r.body).toContain("startede den");
    expect(r.body).toContain("inviteret");
    expect(r.body).toContain("/admin/medlemmer/11111111-1111-4111-8111-111111111111/foto");
    const photo = await handle(new Request(`${ORIGIN}/admin/medlemmer/11111111-1111-4111-8111-111111111111/foto`, { headers: { cookie: admin } }), env, NOW);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(photo.headers.get("cache-control")).toContain("no-store");
  });

  it("shows who wants to go to an arrangement", async () => {
    const r = await call(`/admin/interesse/${event.slug}`, { cookie: admin });
    expect(r.body).toContain("2 har trykket");
    expect(r.body).toContain("Henrik");
    expect(r.body).toContain("Tove");
    expect(r.body).toContain("tove@example.dk");
  });

  it("deletes a member only when confirmed, with everything about them", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const unconfirmed = await call(`/admin/medlemmer/${id}/slet`, { form: {}, cookie: admin });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body).toContain("Sæt flueben");
    expect((await call(`/admin/medlemmer/${id}/slet`, { form: { bekraeft: "ja" }, cookie: admin, origin: "https://evil.example" })).status).toBe(403);
    const done = await call(`/admin/medlemmer/${id}/slet`, { form: { bekraeft: "ja" }, cookie: admin });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toContain("slettet=Henrik");
    const count = (sql: string) => (db.raw.prepare(sql).all(id)[0] as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM members WHERE id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM member_photos WHERE member_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM event_interests WHERE member_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM flock_members WHERE member_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM flock_messages WHERE member_id = ?")).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM membership_signups WHERE lower(email) = 'henrik@example.dk'").all()[0]).toEqual({ n: 0 });
    // The flock with Tove in it lives on with her as its starter; the one Henrik was alone in is gone.
    expect(db.raw.prepare("SELECT id, created_by FROM flocks WHERE id IN ('fa', 'fb')").all()).toEqual([{ id: "fa", created_by: "22222222-2222-4222-8222-222222222222" }]);
    expect((await call(`/admin/medlemmer/${id}`, { cookie: admin })).status).toBe(404);
  });

  it("deletes a sign-up when confirmed, and never a Samfolk member", async () => {
    expect((await call("/admin/indmeldelser/44444444-4444-4444-8444-444444444444/slet", { form: {}, cookie: admin })).headers.get("location")).toContain("fejl=bekraeft");
    expect((await call("/admin/indmeldelser/44444444-4444-4444-8444-444444444444/slet", { form: { bekraeft: "ja" }, cookie: admin })).headers.get("location")).toContain("slettet=Uden");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM membership_signups WHERE email = 'uden@example.dk'").all()[0]).toEqual({ n: 0 });
    expect((await call("/admin/medlemmer/m2/slet", { form: { bekraeft: "ja" }, cookie: admin })).status).toBe(404);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members WHERE id = 'm2'").all()[0]).toEqual({ n: 1 });
  });
});

describe("the way to becoming a member", () => {
  const SITE = "https://socialklubben.dk";
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
  let jar: Record<string, string> = {};
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  /** A visitor's browser on socialklubben.dk: keeps cookies, sends forms from the site itself. */
  async function visit(path: string, form?: Record<string, string>, ip = "9.9.9.9"): Promise<Response> {
    const headers: Record<string, string> = { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9", "cf-connecting-ip": ip, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") };
    if (form) { headers.origin = SITE; headers["content-type"] = "application/x-www-form-urlencoded"; }
    const r = await worker.fetch(new Request(SITE + path, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form) : null }), env, ctx);
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair!.indexOf("="); jar[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return r;
  }
  const at = (r: Response) => new URL(r.headers.get("location")!, SITE).pathname + new URL(r.headers.get("location")!, SITE).search;

  it("counts each step once per person and day, without cookies of its own", async () => {
    const event = db.raw.prepare("SELECT slug FROM events WHERE status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW + 4 * 86_400_000)[0] as { slug: string };
    jar = {};
    expect((await visit(`/events/${event.slug}`)).status).toBe(200);
    await visit(`/events/${event.slug}`);
    const tick = await visit(`/events/${event.slug}/interesse`, {});
    expect(at(tick)).toMatch(/^\/log-ind\?naeste=/);
    expect((await visit(at(tick))).status).toBe(200);
    const made = await visit("/bliv-medlem", { fornavn: "Tove", naeste: `/events/${event.slug}/interesse` });
    expect(at(made)).toMatch(/^\/bliv-medlem\/velkommen/);
    const profile = await visit(`/profil?naeste=${encodeURIComponent(`/events/${event.slug}/interesse`)}&mail=1`, { fornavn: "Tove", alder: "30-39", om_mig: "Glæder mig", email: "tragt@example.dk" });
    expect(profile.status).toBe(303);
    const back = await visit(at(profile));
    expect(back.headers.get("location")).toContain("besked=interesse_her");
    // Someone else only looks.
    await visit(`/events/${event.slug}`, undefined, "8.8.8.8");
    await Promise.all(waits);

    const rows = Object.fromEntries((await funnelSummary(db, NOW)).map(r => [r.key, r.today]));
    expect(rows).toMatchObject({ arrangement: 2, vil_med: 1, log_ind: 1, profil_oprettet: 1, profil_udfyldt: 1, paa_listen: 1, meldt_ind: 0 });
    // The tables hold no cookie, name or address: only the day, the step and a hash that goes the next night.
    expect(Object.keys(jar).some(k => /funnel|tragt|stat/.test(k))).toBe(false);
    await rollUpFunnel(db, NOW + 86_400_000);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM funnel_people").all()[0]).toEqual({ n: 0 });
    const later = Object.fromEntries((await funnelSummary(db, NOW + 86_400_000)).map(r => [r.key, r.yesterday]));
    expect(later).toMatchObject({ arrangement: 2, paa_listen: 1 });
  });

  it("does not count robots or the admin, and a member's direct tick is two steps", () => {
    const post = (headers: Record<string, string> = {}) => new Request(`${SITE}/events/x/interesse`, { method: "POST", headers: { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9", ...headers } });
    const thanks = new Response(null, { status: 303, headers: { location: "/events/x?besked=interesse_her#besked" } });
    expect(funnelSteps(post(), thanks, "/events/x/interesse")).toEqual(["vil_med", "paa_listen"]);
    expect(funnelSteps(post({ "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }), thanks, "/events/x/interesse")).toEqual([]);
    expect(funnelSteps(post({ cookie: "sk_admin=x" }), thanks, "/events/x/interesse")).toEqual([]);
    const nothing = new Response(null, { status: 303, headers: { location: "/kom-godt-i-gang?besked=intet_valgt" } });
    expect(funnelSteps(new Request(`${SITE}/kom-godt-i-gang`, { method: "POST", headers: { "user-agent": BROWSER, "accept-language": "da-DK,da;q=0.9" } }), nothing, "/kom-godt-i-gang")).toEqual([]);
  });

  it("shows the steps on the overview", async () => {
    sent.length = 0;
    await call("/admin/log-ind", { form: {} });
    const used = await call("/admin/link", { form: { t: tokenIn(sent[0]!) } });
    const cookie = /sk_admin=[^;]+/.exec(used.headers.get("set-cookie") ?? "")![0];
    const r = await call("/admin", { cookie }, NOW + 86_400_000);
    expect(r.body).toContain("Vejen til medlem");
    expect(r.body).toContain("Oprettede en profil");
  });
});

describe("the information meeting (Jake 2026-11-24)", () => {
  const SESSION = "I".repeat(43);
  let admin = "";
  beforeAll(async () => {
    const { sha256 } = await import("../src/flokken/auth.js");
    db.raw.prepare("INSERT INTO admin_tokens (token_hash, kind, created_at, expires_at) VALUES (?, 'session', ?, ?)").run(await sha256(SESSION), NOW, NOW + 86_400_000);
    admin = `sk_admin=${SESSION}`;
  });

  it("has its own page with the time, the place and a sign-up form, and a box and a line on the front page", async () => {
    const r = await call("/informationsmoede");
    expect(r.status).toBe(200);
    expect(r.body).toContain("Tirsdag den 12. januar 2027, kl. 19.30–20.45");
    expect(r.body).toContain("Guldsmedgade 26B, 8000 Aarhus C");
    expect(r.body).toContain("komme med i styregruppen");
    expect(r.body).toContain('<form class="form-card" method="post" action="/informationsmoede#tilmelding"');
    expect(r.body).toContain("Du er aldrig forpligtet til noget");
    // The house rules: no "gratis", no gift or discount.
    const words = r.body.slice(r.body.indexOf('<div class="wrap narrow prose">'), r.body.indexOf("</main>")).replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/gratis|gave|rabat/i);
    const front = (await call("/")).body;
    expect(front).toContain('<aside class="info-teaser" aria-labelledby="h-info">');
    // The meeting is in the green band at the top (Jake 2026-11-24), not in a box in the hero.
    expect(front).toContain('<a class="startup-banner-item" href="/informationsmoede">');
    expect(front).toContain("Informationsmøde 12. januar");
    // Gone from the front page once the meeting has started; the page then says so after it ends.
    const start = Date.parse("2027-01-12T19:30:00+01:00");
    expect((await call("/", {}, start)).body).not.toContain("info-teaser");
    expect((await call("/informationsmoede", {}, start + 2 * 3600_000)).body).toContain("Mødet er holdt.");
    expect((await call("/en/information-meeting")).body).toContain("Tuesday 12 January 2027, 7.30–8.45 pm");
    // The welcome mail (PR #677) links to /en/informationsmoede: it moves on to the English address.
    const old = await call("/en/informationsmoede");
    expect(old.status).toBeGreaterThanOrEqual(301);
    expect(old.headers.get("location")).toContain("/en/information-meeting");
  });

  it("saves a sign-up, mails a confirmation once, and lists it in /admin", async () => {
    const before = sent.length;
    const bad = await call("/informationsmoede", { form: { navn: "A", email: "nope" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain("Skriv dit navn.");
    const r = await call("/informationsmoede", { form: { navn: "Birgit Holm", email: "birgit@example.dk", styregruppe: "ja" } });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/informationsmoede?besked=tak#tilmelding");
    expect((await call("/informationsmoede?besked=tak")).body).toContain("Tak, du er tilmeldt!");
    expect(sent.length).toBe(before + 1);
    const mail = sent[sent.length - 1]!;
    expect(mail.to).toBe("birgit@example.dk");
    expect(mail.subject).toBe("Du er tilmeldt informationsmødet 12. januar");
    expect(mail.text).toContain("tirsdag den 12. januar 2027, kl. 19.30–20.45 på Guldsmedgade 26B, 8000 Aarhus C");
    expect(mail.text).toContain("styregruppen");
    expect(mail.text).toContain("uforpligtende");
    // Kept in "Sendt post" too.
    expect(db.raw.prepare("SELECT kind, to_email FROM sent_mails WHERE kind = 'informationsmoede'").all()).toEqual([{ kind: "informationsmoede", to_email: "birgit@example.dk" }]);
    // The same e-mail again: no second row and no second mail.
    await call("/informationsmoede", { form: { navn: "Birgit H.", email: "BIRGIT@example.dk" } });
    expect(sent.length).toBe(before + 1);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM info_meeting_signups").all()[0]).toEqual({ n: 1 });
    // A robot filling in the hidden field is thanked, and nothing is saved.
    await call("/informationsmoede", { form: { navn: "Robot", email: "robot@example.dk", website_url: "x" } });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM info_meeting_signups").all()[0]).toEqual({ n: 1 });
    // Closed once the meeting has started.
    await call("/informationsmoede", { form: { navn: "Sen Ankomst", email: "sen@example.dk" } }, Date.parse("2027-01-12T20:00:00+01:00"));
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM info_meeting_signups").all()[0]).toEqual({ n: 1 });

    expect((await call("/admin/informationsmoede")).status).toBe(303);
    const overview = (await call("/admin", { cookie: admin })).body;
    expect(overview).toContain("Informationsmøde 12. januar");
    expect(overview).toContain("Birgit H.");
    const list = (await call("/admin/informationsmoede", { cookie: admin })).body;
    expect(list).toContain("Tilmeldte (1)");
    expect(list).toContain("styregruppe?");
    expect(list).toContain("birgit@example.dk");
    const id = (db.raw.prepare("SELECT id FROM info_meeting_signups").all()[0] as { id: string }).id;
    expect((await call(`/admin/informationsmoede/${id}/slet`, { form: {}, cookie: admin })).headers.get("location")).toBe("/admin/informationsmoede?fejl=bekraeft");
    expect((await call(`/admin/informationsmoede/${id}/slet`, { form: { bekraeft: "ja" }, cookie: admin })).headers.get("location")).toBe("/admin/informationsmoede?slettet=Birgit%20H.");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM info_meeting_signups").all()[0]).toEqual({ n: 0 });
  });
});
