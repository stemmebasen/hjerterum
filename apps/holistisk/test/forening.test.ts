import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { newCode, sha256 } from "../src/flokken/auth.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Saturday 10 October 2026, 14:00 in Aarhus.
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ORIGIN = "https://portal.example";
let env: Env;
let db: ReturnType<typeof testDb>;
let adminCode: string;

type Res = { status: number; body: string; headers: Headers };
async function call(path: string, init: { form?: Record<string, string | string[]>; cookie?: string; origin?: string | null; at?: number } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  const method = init.form ? "POST" : "GET";
  if (method === "POST" && init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  let body: URLSearchParams | null = null;
  if (init.form) {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(init.form)) for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const r = await handle(new Request(ORIGIN + path, { method, headers, body }), env, init.at ?? NOW);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const cookieOf = (r: Res) => /flok_session=[^;]+/.exec(r.headers.get("set-cookie") ?? "")?.[0] ?? "";
const rows = (sql: string, ...params: unknown[]) => db.raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
const profile = (name: string, email: string, extra: Record<string, string | string[]> = {}) =>
  ({ fornavn: name, email, interesser: ["Musik og koncerter", "Film"], omraade: "aarhus", medlemskab: "month", samtykke: "ja", ...extra });
/** A new member: joins and comes back with a login and the code. */
async function join(name: string, email = `${name.toLowerCase()}@example.dk`, extra: Record<string, string | string[]> = {}): Promise<{ cookie: string; code: string; body: string }> {
  const r = await call("/bliv-medlem", { form: { ...profile(name, email, extra), naeste: "/ture" } });
  return { cookie: cookieOf(r), code: /<p class="f-code-value">([A-Z0-9-]+)<\/p>/.exec(r.body)?.[1] ?? "", body: r.body };
}
async function adminLogin(): Promise<string> { return cookieOf(await call("/log-ind", { form: { kode: adminCode } })); }
/** A member creates a tur; returns its id and slug. */
async function createTur(cookie: string, fields: Record<string, string>): Promise<{ id: string; slug: string; res: Res }> {
  const res = await call("/ture/ny", { cookie, form: fields });
  const slug = /\/events\/([a-z0-9-]+)\?besked=oprettet/.exec(res.headers.get("location") ?? "")?.[1] ?? "";
  const id = (rows("SELECT id FROM picks WHERE slug = ?", slug)[0]?.id as string) ?? "";
  return { id, slug, res };
}

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus"].includes(s.id)) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland" };
  // A volunteer, made an admin by hand (as on staging and production).
  adminCode = newCode();
  db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, is_admin) VALUES ('admin-1', 'Sofie', ?, ?, ?, 1)").run(await sha256(adminCode), NOW, NOW);
});

describe("Foreningen Samfolk", () => {
  it("is what the Worker shows by default: the association, Samfolk's own event, the ture, examples, for all, membership and the letter", async () => {
    const home = await call("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain('data-edition="forening"');
    expect(home.body).toContain("<title>Foreningen Samfolk – oplevelser sammen med ligesindede</title>");
    expect(home.body).toContain("<h1>Oplevelser er bedre <em>sammen.</em></h1>");
    expect(home.body).toContain("Medlemmerne opretter selv ture");
    expect(home.body).toContain("En gang om måneden laver Samfolk sit eget event, som er gratis for medlemmer.");
    expect(home.body).toContain('class="mark mark-flokk"');
    expect(home.body).toContain('href="/assets/samfolk-icon.svg"');
    expect(home.body).toContain("/assets/og-samfolk.jpg");
    expect(home.body).not.toMatch(/Flokk|Flokken/);
    // Samfolk's own event: none planned yet, so it says where it will be shown.
    expect(home.body).toContain("Det næste bliver vist her, så snart det er på plads.");
    expect(home.body).toContain("Der er ingen ture endnu.");
    expect(home.body).toContain('href="/ture/ny"');
    // The made-up examples are labelled as examples.
    expect(home.body).toContain("Eksempler til inspiration – ikke rigtige ture endnu.");
    expect(home.body.match(/<span class="f-ex-tag">Eksempel<\/span>/g)?.length).toBe(8);
    expect(home.body).toContain("uanset alder, køn og etnicitet");
    expect(home.body).toContain("<strong>50 kr.</strong> om måneden");
    expect(home.body).toContain("<strong>500 kr.</strong> om året");
    expect(home.body).toContain("Betalingen åbner senere. Du betaler ikke noget nu.");
    expect(home.body).toContain('action="/samfolk-brevet"');
    // The event portal's pages are not part of it.
    for (const path of ["/kalender", "/kort", "/meditation", "/find-en-flok", "/flokke"]) expect((await call(path)).status).toBe(404);
    // Earlier addresses lead on.
    for (const [from, to] of [["/samarbejde", "/om"], ["/for-arrangoerer", "/om"], ["/udflugter", "/ture"], ["/mine-udflugter", "/mine-ture"], ["/tryghed", "/saadan-fungerer-det"], ["/skriv-dig-op", "/bliv-medlem"]]) {
      expect((await call(from!)).headers.get("location"), from).toBe(to);
    }
    for (const path of ["/ture", "/saadan-fungerer-det", "/bliv-medlem", "/log-ind", "/om", "/samfolk-brevet", "/privatliv"]) expect((await call(path)).status, path).toBe(200);
  });

  it("states what is decided and says what is not – and asks no one about age, gender or ethnicity", async () => {
    for (const path of ["/", "/ture", "/saadan-fungerer-det", "/bliv-medlem", "/om", "/samfolk-brevet", "/privatliv"]) {
      const text = (await call(path)).body.replace(/<[^>]+>/g, " ");
      expect(text, path).not.toMatch(/symbolsk beløb|Flokk|ensom|socialangst|skrøbelig/i);
    }
    const how = (await call("/saadan-fungerer-det")).body;
    for (const rule of ["50 kr. om måneden eller 500 kr. om året", "Betalingen åbner senere", "udfylder du din profil", "Kun medlemmer kan melde sig til",
      "uanset alder, køn og etnicitet", "Medlemmerne opretter selv ture", "kan ses, så snart den er oprettet", "vælger antal pladser og tilmeldingsfrist",
      "gratis for medlemmer", "først til mølle", "automatisk på ventelisten", "melde fra indtil fristen", "betaler hver især selv", "Samfolk-brevet",
      "Det er ikke fastlagt endnu", "Hvordan kontingentet betales"]) expect(how).toContain(rule);
    const joinPage = (await call("/bliv-medlem")).body;
    expect(joinPage).not.toMatch(/name="(alder|koen|køn|etnicitet)"/);
    expect(joinPage).toContain("vi spørger ikke om alder, køn eller etnicitet");
  });

  it("lets people join with a complete profile, shows the code once, and lets them change it, log in and leave", async () => {
    const bad = await call("/bliv-medlem", { form: { fornavn: "", email: "nej" } });
    expect(bad.status).toBe(400);
    for (const error of ["Skriv dit fornavn", "Skriv en mailadresse", "Vælg mindst én ting", "Vælg, hvor du bor", "Vælg medlemskab", "Sæt kryds"]) expect(bad.body).toContain(error);
    const maja = await join("Maja", "Maja@Example.dk", { brev: "ja", medlemskab: "year" });
    expect(maja.body).toContain("Velkommen, Maja!");
    expect(maja.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(rows("SELECT first_name, email, interests, area, plan FROM members WHERE email = 'maja@example.dk'"))
      .toEqual([{ first_name: "Maja", email: "maja@example.dk", interests: "Musik og koncerter, Film", area: "aarhus", plan: "year" }]);
    expect(rows("SELECT email FROM newsletter")).toEqual([{ email: "maja@example.dk" }]);
    expect((await call("/", { cookie: maja.cookie })).body).toContain('href="/mine-ture"');
    // One profile per mail.
    expect((await call("/bliv-medlem", { form: profile("Maja", "maja@example.dk") })).status).toBe(409);
    // Logging in with the code, on another device.
    expect((await call("/log-ind", { form: { kode: maja.code.toLowerCase(), naeste: "/ture" } })).headers.get("location")).toBe("/ture");
    expect((await call("/log-ind", { form: { kode: "AAAA-BBBB-CCCC" } })).status).toBe(401);
    // A member of the event portal (Socialklubben) is not a member of Samfolk.
    const portalCode = newCode();
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at) VALUES ('portal-1', 'Kim', ?, ?, ?)").run(await sha256(portalCode), NOW, NOW);
    expect((await call("/log-ind", { form: { kode: portalCode } })).status).toBe(401);
    // Changing the profile: the letter can be turned off, and another member's mail is refused.
    await join("Nora");
    expect((await call("/min-profil", { cookie: maja.cookie, form: profile("Maja", "nora@example.dk") })).status).toBe(409);
    expect((await call("/min-profil", { cookie: maja.cookie, form: profile("Maja", "maja@example.dk", { medlemskab: "month" }) })).headers.get("location")).toBe("/min-profil?besked=gemt");
    expect(rows("SELECT plan FROM members WHERE email = 'maja@example.dk'")[0]!.plan).toBe("month");
    expect(rows("SELECT COUNT(*) AS n FROM newsletter")[0]!.n).toBe(0);
    // Leaving deletes the profile.
    expect((await call("/meld-ud", { form: { bekraeft: "ja" }, cookie: maja.cookie })).body).toContain("Du er meldt ud");
    expect(rows("SELECT COUNT(*) AS n FROM members WHERE email = 'maja@example.dk'")[0]!.n).toBe(0);
    // Only from the site's own pages.
    expect((await call("/bliv-medlem", { form: profile("Eve", "eve@example.dk"), origin: "https://evil.example" })).status).toBe(403);
  });

  it("asks a member from before Samfolk to complete their profile before using the site", async () => {
    const code = newCode();
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, email, flokk_joined_at) VALUES ('old-1', 'Ole', ?, ?, ?, 'ole@example.dk', ?)").run(await sha256(code), NOW, NOW, NOW);
    const login = await call("/log-ind", { form: { kode: code } });
    expect(login.headers.get("location")).toBe("/min-profil?naeste=%2Fmine-ture&besked=udfyld");
    const cookie = cookieOf(login);
    expect((await call("/ture/ny", { cookie })).headers.get("location")).toBe("/min-profil?naeste=%2Fture%2Fny&besked=udfyld");
    expect((await call("/min-profil?besked=udfyld", { cookie })).body).toContain("Udfyld din profil, før du går videre");
    const saved = await call("/min-profil", { cookie, form: { ...profile("Ole", "ole@example.dk"), naeste: "/ture/ny" } });
    expect(saved.headers.get("location")).toBe("/ture/ny");
    expect((await call("/ture/ny", { cookie })).status).toBe(200);
  });

  it("lets a member create a tur that is shown at once, and others sign up by its rules: first come, a waiting list, and the creator's deadline", async () => {
    expect((await call("/ture/ny")).headers.get("location")).toBe("/log-ind?naeste=%2Fture%2Fny");
    const lea = await join("Lea");
    const invalid = await call("/ture/ny", { cookie: lea.cookie, form: { titel: "", start: "2026-10-01T19:00", frist: "" } });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toContain("Turen skal ligge ude i fremtiden.");
    expect((await call("/ture/ny", { cookie: lea.cookie, form: { titel: "Jazz", start: "2026-10-25T20:00", frist: "2026-10-26T12:00" } })).body).toContain("Fristen skal ligge før turen starter.");
    const tur = await createTur(lea.cookie, { titel: "Jazz i baggården", start: "2026-10-25T20:00", frist: "2026-10-23T18:00", pladser: "2", sted: "Baggården",
      by: "Aarhus C", beskrivelse: "Vi hører jazz.", egenbetaling: "Billet 120 kr. – køb den selv", moedested: "Ved porten", moedetid: "2026-10-25T19:45" });
    expect(tur.slug).not.toBe("");
    // Shown at once, with who created it and what it costs.
    expect((await call("/ture")).body).toContain("Jazz i baggården");
    expect((await call("/")).body).toContain("Jazz i baggården");
    const page = (c?: string, at?: number) => call(`/events/${tur.slug}`, { ...(c ? { cookie: c } : {}), ...(at ? { at } : {}) });
    const visitor = await page();
    for (const text of ["Tur oprettet af Lea", "Billet 120 kr. – køb den selv", "2 – først til mølle, derefter venteliste", "Lukker fredag 23. oktober kl. 18.00"]) expect(visitor.body).toContain(text);
    expect(visitor.body).not.toContain("Ved porten");
    expect(visitor.body).toContain(`href="/bliv-medlem?naeste=%2Fevents%2F${tur.slug}"`);
    expect((await page(lea.cookie)).body).toContain(`href="/ture/${tur.id}/ret"`);

    const [mo, nik, ott] = [await join("Mo"), await join("Nik"), await join("Ott")];
    const signUp = (m: { cookie: string }, at?: number) => call(`/events/${tur.slug}/tilmeld`, { form: {}, cookie: m.cookie, ...(at ? { at } : {}) });
    const cancel = (m: { cookie: string }, at?: number) => call(`/events/${tur.slug}/afbud`, { form: {}, cookie: m.cookie, ...(at ? { at } : {}) });
    const statusOf = (name: string) => rows("SELECT s.status FROM signups s JOIN members m ON m.id = s.member_id WHERE s.pick_id = ? AND m.first_name = ?", tur.id, name)[0]?.status;
    expect((await signUp(mo)).headers.get("location")).toBe(`/events/${tur.slug}?besked=tilmeldt`);
    await signUp(nik);
    expect((await signUp(ott)).headers.get("location")).toBe(`/events/${tur.slug}?besked=venteliste`);
    expect((await page(ott.cookie)).body).toContain("Du står nr. 1 på ventelisten.");
    // Those with a place see where to meet and who is coming.
    const moPage = (await page(mo.cookie)).body;
    expect(moPage).toContain("Ved porten");
    expect(moPage).toContain("Mo, Nik");
    // A cancellation before the deadline gives the place to the waiting list.
    await cancel(nik);
    expect([statusOf("Nik"), statusOf("Ott")]).toEqual(["cancelled", "registered"]);
    // After the creator's deadline, the list is locked.
    const late = Date.parse("2026-10-23T17:00:00Z");
    expect((await cancel(mo, late)).headers.get("location")).toBe(`/events/${tur.slug}?besked=lukket`);
    expect((await signUp(nik, late)).headers.get("location")).toBe(`/events/${tur.slug}?besked=lukket`);

    // The creator sees first names, not mails, and may change the tur; others may not.
    const list = await call(`/ture/${tur.id}/deltagere`, { cookie: lea.cookie });
    expect(list.body).toContain("Mo");
    expect(list.body).not.toContain("mo@example.dk");
    expect((await call(`/ture/${tur.id}/ret`, { cookie: mo.cookie })).status).toBe(404);
    expect((await call(`/ture/${tur.id}/aflys`, { cookie: mo.cookie, form: { bekraeft: "ja" } })).status).toBe(404);
    // More places give the waiting list places at once.
    await signUp(nik);
    expect(statusOf("Nik")).toBe("waitlist");
    const edit = await call(`/ture/${tur.id}/ret`, { cookie: lea.cookie, form: { titel: "Jazz i baggården", start: "2026-10-25T20:00", frist: "2026-10-23T18:00", pladser: "3", moedested: "Ved porten" } });
    expect(edit.headers.get("location")).toBe(`/events/${tur.slug}?besked=gemt`);
    expect(statusOf("Nik")).toBe("registered");
    // Mine ture shows both sides.
    expect((await call("/mine-ture", { cookie: lea.cookie })).body).toContain("Ture, du har oprettet");
    expect((await call("/mine-ture", { cookie: mo.cookie })).body).toContain("Ved porten");
    // The creator cancels: everyone sees it, and no one can sign up.
    expect((await call(`/ture/${tur.id}/aflys`, { cookie: lea.cookie, form: { bekraeft: "ja" } })).headers.get("location")).toBe(`/events/${tur.slug}?besked=aflyst`);
    expect((await page(mo.cookie)).body).toContain("Turen er aflyst.");
    expect((await call("/mine-ture", { cookie: mo.cookie })).body).toContain("Turen er aflyst.");
    expect((await signUp(ott)).headers.get("location")).toBe(`/events/${tur.slug}?besked=lukket`);
  });

  it("cancels the coming ture of a member who leaves, and gives their places to the waiting list", async () => {
    const [pia, rud, sus] = [await join("Pia"), await join("Rud"), await join("Sus")];
    const own = await createTur(pia.cookie, { titel: "Gåtur ved stranden", start: "2026-10-18T10:00" });
    const other = await createTur(rud.cookie, { titel: "Foredrag om lys", start: "2026-10-28T19:00", pladser: "1" });
    await call(`/events/${other.slug}/tilmeld`, { form: {}, cookie: pia.cookie });
    await call(`/events/${other.slug}/tilmeld`, { form: {}, cookie: sus.cookie });
    await call("/meld-ud", { form: { bekraeft: "ja" }, cookie: pia.cookie });
    expect(rows("SELECT flokk_cancelled_at FROM picks WHERE id = ?", own.id)[0]!.flokk_cancelled_at).toBe(NOW);
    expect(rows("SELECT m.first_name, s.status FROM signups s JOIN members m ON m.id = s.member_id WHERE s.pick_id = ?", other.id)).toEqual([{ first_name: "Sus", status: "registered" }]);
  });

  it("signs anyone up for Samfolk-brevet, and off again", async () => {
    expect((await call("/samfolk-brevet", { form: { email: "nej" } })).status).toBe(400);
    expect((await call("/samfolk-brevet", { form: { email: "Brev@Example.dk" } })).headers.get("location")).toBe("/samfolk-brevet?besked=tilmeldt");
    await call("/samfolk-brevet", { form: { email: "brev@example.dk" } });
    expect(rows("SELECT email, member_id FROM newsletter WHERE email = 'brev@example.dk'")).toEqual([{ email: "brev@example.dk", member_id: null }]);
    expect((await call("/samfolk-brevet?besked=tilmeldt")).body).toContain("Du er tilmeldt Samfolk-brevet.");
    expect((await call("/samfolk-brevet/afmeld", { form: { email: "BREV@example.dk" } })).headers.get("location")).toBe("/samfolk-brevet?besked=afmeldt");
    expect(rows("SELECT COUNT(*) AS n FROM newsletter WHERE email = 'brev@example.dk'")[0]!.n).toBe(0);
  });

  it("lets a volunteer make Samfolk's own event, start one from the collected events, hide a tur, see members and the letter – and keeps others out", async () => {
    expect((await call("/admin")).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
    const login = await call("/log-ind", { form: { kode: adminCode.toLowerCase() } });
    expect(login.headers.get("location")).toBe("/admin");
    const cookie = cookieOf(login);

    // Samfolk's own event: free for members, and on the front page.
    expect((await call("/admin/events/ny", { cookie, form: { titel: "", start: "" } })).status).toBe(400);
    const made = await call("/admin/events/ny", { cookie, form: { titel: "Samfolk spiser sammen", start: "2026-10-30T18:00", sted: "Foreningshuset", status: "approved" } });
    expect(made.headers.get("location")).toMatch(/\/admin\/events\/[0-9a-f-]{36}\?besked=oprettet/);
    const home = (await call("/")).body;
    expect(home).toContain("Samfolk spiser sammen");
    expect(home).toContain("Samfolk-event · gratis for medlemmer");
    const slug = rows("SELECT slug FROM picks WHERE title = 'Samfolk spiser sammen'")[0]!.slug as string;
    const eventPage = (await call(`/events/${slug}`)).body;
    expect(eventPage).toContain("Gratis for medlemmer.");
    expect(eventPage).toContain("Foreningen Samfolk");

    // From the collector: hidden until a volunteer has checked it.
    expect((await call("/admin/forslag?q=findesikke", { cookie })).body).toContain("Ingen forslag for den søgning");
    const list = await call("/admin/forslag", { cookie });
    const eventId = /name="event" value="([^"]+)"/.exec(list.body)![1]!;
    const used = await call("/admin/forslag", { form: { event: eventId }, cookie });
    const pickId = /\/admin\/events\/([0-9a-f-]{36})\?besked=brugt/.exec(used.headers.get("location") ?? "")![1]!;
    const pick = rows("SELECT slug, status, kind FROM picks WHERE id = ?", pickId)[0]!;
    expect([pick.status, pick.kind]).toEqual(["withdrawn", "samfolk"]);
    expect((await call(`/events/${pick.slug}`)).status).toBe(404);
    expect((await call("/admin/forslag", { form: { event: eventId }, cookie })).headers.get("location")).toContain(pickId);

    // Hiding a member's tur: gone for others, still there for its creator.
    const tom = await join("Tom");
    const tur = await createTur(tom.cookie, { titel: "Filmaften", start: "2026-10-22T19:30" });
    await call(`/admin/events/${tur.id}`, { cookie, form: { titel: "Filmaften", start: "2026-10-22T19:30", status: "withdrawn" } });
    expect((await call(`/events/${tur.slug}`)).status).toBe(404);
    expect((await call(`/events/${tur.slug}`, { cookie: tom.cookie })).status).toBe(200);
    expect((await call("/mine-ture", { cookie: tom.cookie })).body).toContain("Skjult af foreningen.");

    // Members, with their membership; a new code for one who lost theirs.
    const members = await call("/admin/medlemmer", { cookie });
    expect(members.body).toContain("50 kr. om måneden");
    const tomId = rows("SELECT id FROM members WHERE email = 'tom@example.dk'")[0]!.id as string;
    const renewed = await call("/admin/medlemmer", { cookie, form: { medlem: tomId } });
    const fresh = /class="f-code-inline">([A-Z0-9-]+)</.exec(renewed.body)![1]!;
    expect((await call("/log-ind", { form: { kode: tom.code } })).status).toBe(401);
    expect((await call("/log-ind", { form: { kode: fresh } })).status).toBe(303);

    // The letter's list.
    await call("/samfolk-brevet", { form: { email: "liste@example.dk" } });
    expect((await call("/admin/samfolk-brevet", { cookie })).body).toContain("liste@example.dk");
    const csv = await call("/admin/samfolk-brevet.csv", { cookie });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.body).toContain("liste@example.dk");

    // A member who is not a volunteer has no access.
    const uma = await join("Uma");
    expect((await call("/admin", { cookie: uma.cookie })).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
    expect((await call("/admin/samfolk-brevet.csv")).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
  });

  it("deletes a person from the earlier interest list on request", async () => {
    db.raw.prepare("INSERT INTO interests (id, first_name, email, created_at, updated_at) VALUES ('i-1', 'Slet', 'slet@example.dk', ?, ?)").run(NOW, NOW);
    const r = await call("/privatliv", { form: { email: "SLET@example.dk" } });
    expect(r.body).toContain("Hvis mailen stod på listen, er den slettet nu.");
    expect(rows("SELECT COUNT(*) AS n FROM interests WHERE email = 'slet@example.dk'")[0]!.n).toBe(0);
  });
});
