import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { normalizeCode } from "../src/flokken/auth.js";
import { toLocalInput } from "../src/flokken/forms.js";
import { offersFor, type PartnerOffer } from "../src/flokken/partners.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Saturday 10 October 2026, 14:00 in Aarhus.
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ORIGIN = "https://portal.example";
let env: Env;
let db: ReturnType<typeof testDb>;
let event: { id: string; slug: string; starts_at: number; title: string };
let later: { slug: string; starts_at: number };

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus"].includes(s.id)) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", INGEST_TOKEN: "x".repeat(32), EDITION: "portal" };
  const rows = db.raw.prepare("SELECT id, slug, starts_at, title FROM events WHERE status = 'scheduled' AND starts_at > ? AND venue_name IS NOT NULL ORDER BY starts_at").all(NOW + 86_400_000) as Array<typeof event>;
  event = rows[0]!;
  later = rows.find(r => r.starts_at > event.starts_at + 7 * 86_400_000)!;
});

type Res = { status: number; body: string; headers: Headers };
async function call(path: string, init: { method?: string; form?: Record<string, string>; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}, now = NOW): Promise<Res> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  const method = init.method ?? (init.form ? "POST" : "GET");
  if (method === "POST" && init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  const body = init.form ? new URLSearchParams(init.form) : undefined;
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  const r = await handle(new Request(ORIGIN + path, { method, headers, body: body ?? null }), env, now);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const cookieOf = (r: Res) => /flok_session=[^;]+/.exec(r.headers.get("set-cookie") ?? "")?.[0] ?? "";
const flockIdFrom = (location: string | null) => /\/flokke\/([0-9a-f-]{36})/.exec(location ?? "")?.[1] ?? "";
const meetAt = (ms: number) => toLocalInput(ms - 30 * 60_000);

async function join(name: string): Promise<{ cookie: string; code: string }> {
  const r = await call("/bliv-medlem", { form: { fornavn: name, naeste: "/flokke" } });
  expect(r.status).toBe(200);
  const code = /<p class="code">([A-Z0-9-]+)<\/p>/.exec(r.body)?.[1] ?? "";
  return { cookie: cookieOf(r), code };
}

async function startFlock(cookie: string, extra: Record<string, string> = {}, slug = event.slug, startsAt = event.starts_at): Promise<Res> {
  return call(`/events/${slug}/opret-flok`, { cookie, form: { moedested: "Ved indgangen til Hjerterum", tidspunkt: meetAt(startsAt), stoerrelse: "3", note: "Vi tager en kop kaffe først", offentligt: "ja", ...extra } });
}

describe("membership", () => {
  it("needs only a first name, shows the personal code once and logs in with it", async () => {
    const bad = await call("/bliv-medlem", { form: { fornavn: "<script>" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain("Skriv dit fornavn");
    const { cookie, code } = await join("Maria");
    expect(cookie).toMatch(/^flok_session=/);
    expect(normalizeCode(code)).toBe(code);
    expect((await call("/flokke", { cookie })).body).toContain("Hej Maria");
    const stored = db.raw.prepare("SELECT * FROM members WHERE first_name = 'Maria'").all()[0] as Record<string, unknown>;
    // Nothing else is stored for an event-portal member (the other columns are Flokk's).
    expect(Object.entries(stored).filter(([, v]) => v !== null).map(([k]) => k).sort()).toEqual(["code_hash", "created_at", "first_name", "id", "is_admin", "last_seen_at"]);
    expect(String(stored.code_hash)).not.toContain(code);
    const login = await call("/log-ind", { form: { kode: code.toLowerCase().replace(/-/g, " "), naeste: "/flokke" } });
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/flokke");
    expect(cookieOf(login)).toMatch(/^flok_session=/);
    const wrong = await call("/log-ind", { form: { kode: "AAAA-BBBB-CCCC" } });
    expect(wrong.status).toBe(400);
  });

  it("sends people to log in before they can see their flocks, and back afterwards", async () => {
    const r = await call("/flokke");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/log-ind?naeste=%2Fflokke");
    expect((await call(`/events/${event.slug}/opret-flok`)).headers.get("location")).toBe(`/log-ind?naeste=${encodeURIComponent(`/events/${event.slug}/opret-flok`)}`);
  });

  it("refuses forms posted from other sites", async () => {
    expect((await call("/bliv-medlem", { form: { fornavn: "Eve" }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/bliv-medlem", { form: { fornavn: "Eve" }, origin: null })).status).toBe(403);
  });
});

describe("flocks", () => {
  it("are found on the event page, created only by choice, joined, left and capped in size", async () => {
    const before = await call(`/events/${event.slug}`);
    expect(before.body).toContain("Find en flok");
    expect(before.body).toContain("Der er ingen flok til eventet endnu");
    expect(before.body).toContain(`href="/log-ind?naeste=${encodeURIComponent(`/events/${event.slug}/opret-flok`)}"`);
    expect(before.headers.get("cache-control")).toBe("private, no-store");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM flocks").all()[0]).toEqual({ n: 0 });

    const anna = await join("Anna");
    const notPublic = await startFlock(anna.cookie, { offentligt: "" });
    expect(notPublic.status).toBe(400);
    expect(notPublic.body).toContain("Flokke mødes altid et offentligt sted");
    const tooEarly = await startFlock(anna.cookie, { tidspunkt: meetAt(event.starts_at - 24 * 3600_000) });
    expect(tooEarly.body).toContain("Mød højst 6 timer før");

    const created = await startFlock(anna.cookie);
    expect(created.status).toBe(303);
    const id = flockIdFrom(created.headers.get("location"));
    expect(id).not.toBe("");
    const again = await startFlock(anna.cookie);
    expect(again.headers.get("location")).toContain("besked=already_in_flock");

    const page = await call(`/events/${event.slug}`);
    expect(page.body).toContain("Ved indgangen til Hjerterum");
    expect(page.body).toContain("1 af 3 · plads til 2 mere");
    expect(page.body).toContain("Bliv en del af flokken");
    expect(page.body).not.toContain("Anna");
    expect((await call("/kalender")).body).toContain("1 flok · Find en flok");

    const bo = await join("Bo");
    const outsider = await call(`/flokke/${id}`, { cookie: bo.cookie });
    expect(outsider.body).toContain("1 person er med");
    expect(outsider.body).not.toContain("Anna");
    const joined = await call(`/flokke/${id}/bliv-del-af`, { cookie: bo.cookie, form: {} });
    expect(joined.headers.get("location")).toBe(`/flokke/${id}?besked=tilsluttet`);
    const inside = await call(`/flokke/${id}`, { cookie: bo.cookie });
    expect(inside.body).toContain("Anna");
    expect(inside.body).toContain("Bo <span class=\"meta-muted\">(dig)</span>");
    expect(inside.body).toContain("Forlad flokken");

    const cleo = await join("Cleo");
    await call(`/flokke/${id}/bliv-del-af`, { cookie: cleo.cookie, form: {} });
    const dan = await join("Dan");
    const full = await call(`/flokke/${id}/bliv-del-af`, { cookie: dan.cookie, form: {} });
    expect(full.headers.get("location")).toContain("besked=full");
    expect((await call(`/events/${event.slug}`, { cookie: dan.cookie })).body).toContain("Flokken er fuld");

    const left = await call(`/flokke/${id}/forlad`, { cookie: cleo.cookie, form: {} });
    expect(left.headers.get("location")).toContain("besked=forladt");
    expect((await call(`/flokke/${id}/bliv-del-af`, { cookie: dan.cookie, form: {} })).headers.get("location")).toContain("besked=tilsluttet");
  });

  it("lets the one who started it change the meeting place, and nobody else", async () => {
    const eva = await join("Eva");
    const r = await startFlock(eva.cookie, {}, later.slug, later.starts_at);
    const id = flockIdFrom(r.headers.get("location"));
    const frank = await join("Frank");
    await call(`/flokke/${id}/bliv-del-af`, { cookie: frank.cookie, form: {} });
    expect((await call(`/flokke/${id}/ret`, { cookie: frank.cookie })).headers.get("location")).toContain("besked=not_host");
    const edit = await call(`/flokke/${id}/ret`, { cookie: eva.cookie, form: { moedested: "Caféen på hjørnet", tidspunkt: meetAt(later.starts_at), stoerrelse: "4", offentligt: "ja" } });
    expect(edit.headers.get("location")).toContain("besked=rettet");
    expect((await call(`/flokke/${id}`, { cookie: frank.cookie })).body).toContain("Caféen på hjørnet");
  });

  it("asks each member after the event whether to meet again, and a new flock from it is only offered, never joined for them", async () => {
    const gry = await join("Gry");
    const hans = await join("Hans");
    const ida = await join("Ida");
    const first = flockIdFrom((await startFlock(gry.cookie)).headers.get("location"));
    await call(`/flokke/${first}/bliv-del-af`, { cookie: hans.cookie, form: {} });
    await call(`/flokke/${first}/bliv-del-af`, { cookie: ida.cookie, form: {} });
    const after = event.starts_at + 5 * 3600_000;
    const page = await call(`/flokke/${first}`, { cookie: hans.cookie }, after);
    expect(page.body).toContain("Eftermødet");
    expect(page.body).toContain("Eventet er slut.");
    await call(`/flokke/${first}/eftermoedet`, { cookie: gry.cookie, form: { svar: "ja" } }, after);
    await call(`/flokke/${first}/eftermoedet`, { cookie: hans.cookie, form: { svar: "ja" } }, after);
    await call(`/flokke/${first}/eftermoedet`, { cookie: ida.cookie, form: { svar: "nej" } }, after);
    expect((await call(`/flokke/${first}/bliv-del-af`, { cookie: (await join("Jens")).cookie, form: {} }, after)).headers.get("location")).toContain("besked=event_closed");

    const form = await call(`/events/${later.slug}/opret-flok`, { cookie: gry.cookie }, after);
    expect(form.body).toContain("Fortsæt fra en tidligere flok");
    const next = await call(`/events/${later.slug}/opret-flok`, { cookie: gry.cookie, form: { moedested: "Ved indgangen", tidspunkt: meetAt(later.starts_at), stoerrelse: "6", offentligt: "ja", fra_flok: first } }, after);
    const nextId = flockIdFrom(next.headers.get("location"));
    expect(nextId).not.toBe("");

    const hansPage = await call("/flokke", { cookie: hans.cookie }, after);
    expect(hansPage.body).toContain("Fra dine Eftermøder");
    expect(hansPage.body).toContain(`/flokke/${nextId}`);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM flock_members WHERE flock_id = ? AND left_at IS NULL").all(nextId)[0]).toEqual({ n: 1 });
    expect((await call("/flokke", { cookie: ida.cookie }, after)).body).not.toContain("Fra dine Eftermøder");
  });
});

describe("partners", () => {
  it("explains the model and stores an inquiry, readable only with the token", async () => {
    const page = await call("/samarbejde");
    expect(page.body).toContain("billetfordel");
    expect(page.body).toContain("radioomtale");
    const bad = await call("/samarbejde", { form: { organisation: "X", navn: "", email: "nej" } });
    expect(bad.status).toBe(400);
    const ok = await call("/samarbejde", { form: { organisation: "Musikhuset", navn: "Sofie", email: "sofie@example.dk", besked: "Hej" } });
    expect(ok.headers.get("location")).toBe("/samarbejde?besked=tak#kontakt");
    expect((await call("/api/samarbejde")).status).toBe(401);
    const list = await call("/api/samarbejde", { headers: { authorization: `Bearer ${"x".repeat(32)}` } });
    expect(JSON.parse(list.body)[0]).toMatchObject({ organisation: "Musikhuset", email: "sofie@example.dk" });
  });

  it("shows an offer only when the organiser has confirmed it", () => {
    const e = { organizer_id: "hjerterum", slug: "x", starts_at: NOW };
    const offer: PartnerOffer = { organizerSlug: "hjerterum", kind: "member_discount", text: "Rabat", confirmedBy: "", confirmedOn: "2026-10-01" };
    expect(offersFor(e, [offer])).toEqual([]);
    expect(offersFor(e, [{ ...offer, confirmedBy: "Sofie" }])).toHaveLength(1);
    expect(offersFor(e, [{ ...offer, confirmedBy: "Sofie", validUntil: "2026-10-01" }])).toEqual([]);
    expect(offersFor({ ...e, organizer_id: "lysets-hus" }, [{ ...offer, confirmedBy: "Sofie" }])).toEqual([]);
  });
});

describe("served under www.jacobhauge.com", () => {
  const mount = { "x-flokken-mount": "https://www.jacobhauge.com/flokken" };
  const sk = { "x-flokken-mount": "https://www.jacobhauge.com/socialklubben" };
  it("prefixes links, forms, redirects and the login cookie, and checks forms against that site", async () => {
    const home = await call("/", { headers: sk });
    expect(home.body).toContain('href="/socialklubben/kalender"');
    expect(home.body).toContain('href="/socialklubben/assets/site.css');
    expect(home.body).toContain('action="/socialklubben/kalender"');
    expect(home.body).toContain('<link rel="canonical" href="https://www.jacobhauge.com/socialklubben/">');
    expect(home.body).not.toMatch(/\s(href|src|action)="\/(?!socialklubben\/|\/)/);
    const r = await call("/bliv-medlem", { form: { fornavn: "Kim", naeste: "/flokke" }, headers: sk, origin: "https://www.jacobhauge.com" });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Path=/socialklubben;");
    expect(r.body).toContain('href="/socialklubben/flokke"');
    expect((await call("/flokke", { headers: sk })).headers.get("location")).toBe("/socialklubben/log-ind?naeste=%2Fflokke");
    expect((await call("/bliv-medlem", { form: { fornavn: "Kim" }, headers: sk })).status).toBe(403);
    // Any other value of the header is ignored.
    expect((await call("/", { headers: { "x-flokken-mount": "https://evil.example/flokken" } })).body).toContain('href="/kalender"');
  });
  it("shows Flokk, the association, under /flokk (and its earlier /flokken), whatever the Worker's own edition", async () => {
    const flokk = await call("/", { headers: { "x-flokken-mount": "https://www.jacobhauge.com/flokk" } });
    expect(flokk.body).toContain('data-edition="forening"');
    expect(flokk.body).toContain('href="/flokk/bliv-medlem"');
    expect(flokk.body).toContain("<span>flokk</span>");
    expect(flokk.body).not.toContain("Flokken");
    const home = await call("/", { headers: mount });
    expect(home.body).toContain('data-edition="forening"');
    expect(home.body).toContain('href="/flokken/bliv-medlem"');
    expect(home.body).not.toMatch(/\s(href|src|action)="\/(?!flokken\/|\/)/);
    expect((await call("/kalender", { headers: mount })).status).toBe(404);
  });
  it("goes by the name Socialklubben under www.jacobhauge.com/socialklubben", async () => {
    const home = await call("/", { headers: sk });
    expect(home.body).toContain("<span>Socialklubben</span>");
    expect(home.body).toContain("Sådan virker Socialklubben");
    expect(home.body).toContain("<title>Socialklubben – find events");
    expect(home.body).toContain('content="https://www.jacobhauge.com/socialklubben/assets/og-socialklubben.jpg"');
    expect(home.body).toContain('href="/socialklubben/find-en-flok"');
    expect(home.body).not.toContain("Flokken");
    const r = await call("/bliv-medlem", { form: { fornavn: "Kim" }, headers: sk, origin: "https://www.jacobhauge.com" });
    expect(r.headers.get("set-cookie")).toContain("Path=/socialklubben;");
    expect((await call("/bliv-medlem", { form: { fornavn: "Kim" }, headers: sk })).body).toContain("Socialklubbens egne sider");
    // The Worker's own name, without a mount.
    expect((await call("/")).body).toContain("<span>Flokken</span>");
  });
});
