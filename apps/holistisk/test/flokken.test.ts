import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { normalizeCode } from "../src/flokken/auth.js";
import { toLocalInput } from "../src/flokken/forms.js";
import { maskContacts, purgeOldChats } from "../src/flokken/chat.js";
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
    expect(page.body).toContain('aria-label="1 af 3 pladser taget"');
    expect(page.body).toContain("Bliv en del af flokken");
    expect(page.body).not.toContain("Anna");
    // On the calendar: one person per seat, filled for those who are in.
    const calendar = (await call("/kalender")).body;
    expect(calendar).toContain('<span class="flock-badge-text">1 af 3 · Find en flok</span>');
    const badge = calendar.slice(calendar.indexOf('aria-label="1 af 3 pladser taget"'), calendar.indexOf("flock-badge-text"));
    expect(badge.match(/class="seat is-taken"/g)).toHaveLength(1);
    expect(badge.match(/class="seat"/g)).toHaveLength(2);
    expect(calendar).not.toContain("●●●");

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

  it("has no Eftermøde: no question after the event, and the old address does nothing", async () => {
    const gry = await join("Gry");
    const first = flockIdFrom((await startFlock(gry.cookie)).headers.get("location"));
    const after = event.starts_at + 5 * 3600_000;
    expect((await call(`/flokke/${first}`, { cookie: gry.cookie }, after)).body).not.toContain("Eftermød");
    expect((await call(`/events/${later.slug}/opret-flok`, { cookie: gry.cookie }, after)).body).not.toContain("Fortsæt fra en tidligere flok");
    expect((await call("/flokke", { cookie: gry.cookie }, after)).body).not.toContain("Eftermød");
    expect((await call(`/flokke/${first}/eftermoedet`, { cookie: gry.cookie, form: { svar: "ja" } }, after)).status).not.toBe(302);
  });
});

describe("the flock's chat", () => {
  const jsonCall = (path: string, cookie: string, form?: Record<string, string>, now = NOW) =>
    call(path, { cookie, ...(form ? { form } : {}), headers: { accept: "application/json" } }, now);

  it("is only for the flock's members, hides phone numbers and e-mails, and can be read for new messages", async () => {
    const eva = await join("Eva");
    const id = flockIdFrom((await startFlock(eva.cookie)).headers.get("location"));
    const finn = await join("Finn");

    // Not a member yet: no chat on the page, and the chat answers neither reading nor writing.
    expect((await call(`/flokke/${id}`, { cookie: finn.cookie })).body).not.toContain('id="chat"');
    expect((await jsonCall(`/flokke/${id}/chat`, finn.cookie)).status).toBe(403);
    expect((await jsonCall(`/flokke/${id}/chat`, finn.cookie, { tekst: "Hej" })).status).toBe(403);
    expect((await jsonCall(`/flokke/${id}/chat`, "", { tekst: "Hej" })).status).toBe(401);

    const evaPage = await call(`/flokke/${id}`, { cookie: eva.cookie });
    expect(evaPage.body).toContain('id="chat"');
    expect(evaPage.body).toContain("Ingen beskeder endnu");

    const sent = await jsonCall(`/flokke/${id}/chat`, eva.cookie, { tekst: "Hej! Ring på 22 33 44 55 eller skriv til eva@example.dk. Vi ses kl. 18.30 den 10.11.2026" });
    expect(sent.status).toBe(200);
    const message = JSON.parse(sent.body).message;
    expect(message.body).toBe("Hej! Ring på [nummer skjult] eller skriv til [e-mail skjult]. Vi ses kl. 18.30 den 10.11.2026");
    expect(message).not.toHaveProperty("member_id");
    expect(message.mine).toBe(true);
    expect(db.raw.prepare("SELECT body FROM flock_messages WHERE id = ?").all(message.id)[0]).toEqual({ body: message.body });

    await call(`/flokke/${id}/bliv-del-af`, { cookie: finn.cookie, form: {} });
    const read = JSON.parse((await jsonCall(`/flokke/${id}/chat`, finn.cookie)).body);
    expect(read.open).toBe(true);
    expect(read.messages.map((m: { name: string; mine: boolean }) => [m.name, m.mine])).toEqual([["Eva", false]]);

    // Without JavaScript: the form posts and comes back to the chat on the flock's page.
    const plain = await call(`/flokke/${id}/chat`, { cookie: finn.cookie, form: { tekst: "<b>Jeg kommer lidt senere</b>" } });
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toBe(`/flokke/${id}#chat`);
    const finnPage = await call(`/flokke/${id}`, { cookie: finn.cookie });
    expect(finnPage.body).toContain("&lt;b&gt;Jeg kommer lidt senere&lt;/b&gt;");
    expect(finnPage.body).toContain(`action="/flokke/${id}/chat/${message.id}/meld"`);

    // Polling from the last message seen returns only that and newer ones.
    const newer = JSON.parse((await jsonCall(`/flokke/${id}/chat?efter=${NOW}`, eva.cookie)).body);
    expect(newer.messages).toHaveLength(2);
    expect((await jsonCall(`/flokke/${id}/chat`, eva.cookie, { tekst: "   " })).status).toBe(400);
    expect(JSON.parse((await jsonCall(`/flokke/${id}/chat`, eva.cookie, { tekst: "x".repeat(501) })).body).error).toBe("chat_too_long");

    // Someone who leaves can no longer read along.
    await call(`/flokke/${id}/forlad`, { cookie: finn.cookie, form: {} });
    expect((await jsonCall(`/flokke/${id}/chat`, finn.cookie)).status).toBe(403);
  });

  it("hides a reported message from the reporter at once and from everyone after two reports", async () => {
    const gry = await join("Gry");
    const id = flockIdFrom((await startFlock(gry.cookie, { stoerrelse: "4" })).headers.get("location"));
    const [hans, ida] = [await join("Hans"), await join("Ida")];
    for (const m of [hans, ida]) await call(`/flokke/${id}/bliv-del-af`, { cookie: m.cookie, form: {} });
    const bad = JSON.parse((await jsonCall(`/flokke/${id}/chat`, gry.cookie, { tekst: "Noget grimt" })).body).message;

    expect((await jsonCall(`/flokke/${id}/chat/${bad.id}/meld`, gry.cookie, {})).status).toBe(400);
    expect((await jsonCall(`/flokke/${id}/chat/${bad.id}/meld`, hans.cookie, {})).status).toBe(200);
    const names = async (cookie: string) => JSON.parse((await jsonCall(`/flokke/${id}/chat`, cookie)).body).messages.map((m: { id: string }) => m.id);
    expect(await names(hans.cookie)).toEqual([]);
    expect(await names(ida.cookie)).toEqual([bad.id]);

    const plain = await call(`/flokke/${id}/chat/${bad.id}/meld`, { cookie: ida.cookie, form: {} });
    expect(plain.headers.get("location")).toBe(`/flokke/${id}?besked=meldt#chat`);
    expect(await names(gry.cookie)).toEqual([]);

    const unauth = await call("/api/chat-meldinger");
    expect(unauth.status).toBe(401);
    const list = JSON.parse((await call("/api/chat-meldinger", { headers: { authorization: `Bearer ${"x".repeat(32)}` } })).body);
    expect(list[0]).toMatchObject({ id: bad.id, body: "Noget grimt", written_by: "Gry", reports: 2 });
  });

  it("closes a week after the event and is deleted 30 days after it", async () => {
    const jon = await join("Jon");
    const id = flockIdFrom((await startFlock(jon.cookie, {}, later.slug, later.starts_at)).headers.get("location"));
    await jsonCall(`/flokke/${id}/chat`, jon.cookie, { tekst: "Ses!" });
    const ends = (db.raw.prepare("SELECT COALESCE(ends_at, starts_at + 10800000) AS t FROM events WHERE slug = ?").all(later.slug)[0] as { t: number }).t;

    const inWeek = ends + 6 * 86_400_000;
    expect((await jsonCall(`/flokke/${id}/chat`, jon.cookie, { tekst: "Tak for i aftes" }, inWeek)).status).toBe(200);
    const after = ends + 8 * 86_400_000;
    const closed = await jsonCall(`/flokke/${id}/chat`, jon.cookie, { tekst: "Hallo?" }, after);
    expect(JSON.parse(closed.body).error).toBe("chat_closed");
    expect(JSON.parse((await jsonCall(`/flokke/${id}/chat`, jon.cookie, undefined, after)).body).open).toBe(false);
    expect((await call(`/flokke/${id}`, { cookie: jon.cookie }, after)).body).toContain("Chatten er lukket");

    const count = () => (db.raw.prepare("SELECT COUNT(*) AS n FROM flock_messages WHERE flock_id = ?").all(id)[0] as { n: number }).n;
    await purgeOldChats(db, ends + 29 * 86_400_000);
    expect(count()).toBe(2);
    await purgeOldChats(db, ends + 31 * 86_400_000);
    expect(count()).toBe(0);
  });

  it("masks contact details but leaves times, dates and short numbers", () => {
    expect(maskContacts("+45 12 34 56 78")).toBe("[nummer skjult]");
    expect(maskContacts("ring 12345678 nu")).toBe("ring [nummer skjult] nu");
    expect(maskContacts("0045-1234-5678")).toBe("[nummer skjult]");
    expect(maskContacts("mig: a.b+c@gmail.com")).toBe("mig: [e-mail skjult]");
    expect(maskContacts("kl. 19.30, bord 12, 2 billetter, 24.12.2026")).toBe("kl. 19.30, bord 12, 2 billetter, 24.12.2026");
  });
});

describe("partners", () => {
  it("explains the model and stores an inquiry, readable only with the token", async () => {
    const page = await call("/samarbejde");
    expect(page.body).toContain("kontakt os");
    expect(page.body).not.toMatch(/rabat|billetfordel/i);
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
    const offer: PartnerOffer = { organizerSlug: "hjerterum", kind: "welcome_drink", text: "Kaffe", confirmedBy: "", confirmedOn: "2026-10-01" };
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
  it("shows Foreningen Samfolk under /samfolk (and its earlier /flokk and /flokken), whatever the Worker's own edition", async () => {
    const samfolk = await call("/", { headers: { "x-flokken-mount": "https://www.jacobhauge.com/samfolk" } });
    expect(samfolk.body).toContain('data-edition="forening"');
    expect(samfolk.body).toContain('href="/samfolk/bliv-medlem"');
    expect(samfolk.body).toContain("<span>samfolk</span>");
    expect(samfolk.body).toContain('content="https://www.jacobhauge.com/samfolk/assets/og-samfolk.jpg"');
    expect(samfolk.body).not.toMatch(/Flokk/);
    expect(samfolk.body).not.toMatch(/\s(href|src|action)="\/(?!samfolk\/|\/)/);
    for (const earlier of [{ "x-flokken-mount": "https://www.jacobhauge.com/flokk" }, mount]) {
      const home = await call("/", { headers: earlier });
      expect(home.body).toContain('data-edition="forening"');
      expect(home.body).toContain("<span>samfolk</span>");
    }
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

describe("served on its own domain socialklubben.dk", () => {
  const at = async (url: string, init: { form?: Record<string, string>; origin?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.form) { headers.origin = init.origin ?? "https://socialklubben.dk"; headers["content-type"] = "application/x-www-form-urlencoded"; }
    const r = await handle(new Request(url, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env, NOW);
    return { status: r.status, body: await r.text(), headers: r.headers };
  };
  it("shows Socialklubben at the root, with root links, its own canonical address and a cookie for the whole site", async () => {
    const home = await at("https://socialklubben.dk/");
    expect(home.body).toContain("<span>Socialklubben</span>");
    expect(home.body).toContain('href="/kalender"');
    expect(home.body).toContain('<link rel="canonical" href="https://socialklubben.dk/">');
    expect(home.body).not.toContain("Flokken");
    expect(home.body).not.toContain('data-edition="forening"');
    const r = await at("https://socialklubben.dk/bliv-medlem", { form: { fornavn: "Kim" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/Path=\/(;|$)/);
    expect((await at("https://socialklubben.dk/bliv-medlem", { form: { fornavn: "Kim" }, origin: "https://www.jacobhauge.com" })).status).toBe(403);
    // The proxy header cannot turn the own domain into Samfolk.
    expect((await at("https://socialklubben.dk/", { headers: { "x-flokken-mount": "https://www.jacobhauge.com/samfolk" } })).body).not.toContain('data-edition="forening"');
  });
  it("sends www and the old /socialklubben paths to the address without them", async () => {
    expect((await at("https://www.socialklubben.dk/kalender?periode=maaned")).headers.get("location")).toBe("https://socialklubben.dk/kalender?periode=maaned");
    expect((await at("https://socialklubben.dk/socialklubben/kort")).headers.get("location")).toBe("https://socialklubben.dk/kort");
    expect((await at("https://socialklubben.dk/socialklubben")).headers.get("location")).toBe("https://socialklubben.dk/");
  });
});
