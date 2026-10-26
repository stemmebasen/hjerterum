import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { newCode, sha256 } from "../src/flokken/auth.js";
import { toLocalInput } from "../src/flokken/forms.js";
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
async function call(path: string, init: { form?: Record<string, string | string[]>; cookie?: string; origin?: string | null } = {}): Promise<Res> {
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
  const r = await handle(new Request(ORIGIN + path, { method, headers, body }), env, NOW);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const cookieOf = (r: Res) => /flok_session=[^;]+/.exec(r.headers.get("set-cookie") ?? "")?.[0] ?? "";
const rows = (sql: string, ...params: unknown[]) => db.raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;

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

describe("Flokk", () => {
  it("is what the Worker shows by default: the concept, the steps, the promises – and no events before any are picked", async () => {
    const home = await call("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain('data-edition="forening"');
    expect(home.body).toMatch(/<h1>(Nye oplevelser, nye mennesker – <em>i trygge rammer\.<\/em>|Kom med ud – <em>vi har gemt en plads til dig\.<\/em>|Oplev mere sammen med nye mennesker – <em>trygt og uden pres\.<\/em>)<\/h1>/);
    // The headline takes turns: every one of the three shows up over a few visits.
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 3; i++) seen.add(/<h1>([\s\S]*?)<\/h1>/.exec((await call("/")).body)![1]!);
    expect(seen.size).toBe(3);
    expect(home.body).toContain("<title>Flokk – nye oplevelser, nye mennesker, i trygge rammer</title>");
    expect(home.body).toContain('class="mark mark-flokk"');
    expect(home.body).toContain('href="/assets/flokk-icon.svg"');
    expect(home.body).toContain("/assets/og-flokk.jpg");
    expect(home.body).not.toContain("Flokken");
    expect(home.body).toContain("Flokk gør det lettere at opleve mere sammen med andre.");
    expect(home.body).toContain("De første Udflugter er ved at blive planlagt");
    for (const frame of ["Du ved, hvad der skal ske", "En lille flok", "På din egen måde", "Klare frister"]) expect(home.body).toContain(frame);
    expect(home.body).toContain("Beløbet er ikke fastlagt endnu");
    // The event portal's pages are not part of it.
    for (const path of ["/kalender", "/kort", "/meditation", "/find-en-flok", "/flokke"]) expect((await call(path)).status).toBe(404);
    // Earlier addresses lead on.
    expect((await call("/samarbejde")).headers.get("location")).toBe("/for-arrangoerer");
    expect((await call("/for-foreninger")).headers.get("location")).toBe("/for-arrangoerer");
    expect((await call("/maanedens-events")).headers.get("location")).toBe("/udflugter");
    expect((await call("/tryghed")).headers.get("location")).toBe("/saadan-fungerer-det");
    for (const path of ["/udflugter", "/saadan-fungerer-det", "/skriv-dig-op", "/om", "/for-arrangoerer", "/privatliv"]) expect((await call(path)).status).toBe(200);
  });

  it("speaks about the experiences and the frame: no host, no deficits, nothing undecided stated as fact", async () => {
    for (const path of ["/", "/udflugter", "/saadan-fungerer-det", "/skriv-dig-op", "/om", "/for-arrangoerer", "/privatliv"]) {
      const text = (await call(path)).body.replace(/<[^>]+>/g, " ");
      expect(text, path).not.toMatch(/ensom|socialangst|social angst|genert|skrøbelig|bor alene|nemmeste i verden/i);
      expect(text, path).not.toMatch(/værten|vært, der|tager imod jer/i);
      expect(text, path).not.toMatch(/under stiftelse|kontingent|tage en ven med/i);
    }
    const how = (await call("/saadan-fungerer-det")).body;
    for (const rule of ["Man kan ikke tilmelde en gæst", "flere Udflugter", "først til mølle", "automatisk på ventelisten", "bekræftes, når fire har tilmeldt sig",
      "gennemføres Udflugten alligevel", "lukker 7 dage før", "deltagerlisten fast", "Hvis Flokk aflyser sin deltagelse", "uden for Flokks kontrol",
      "ikke automatisk en gruppechat", "fornavnene", "Der er ikke en vært fra Flokk med", "Det er ikke fastlagt endnu"]) expect(how).toContain(rule);
  });

  it("keeps an interest list: first name and mail, the rest optional, consent required", async () => {
    const bad = await call("/skriv-dig-op", { form: { fornavn: "", email: "nej" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain("Skriv dit fornavn");
    expect(bad.body).toContain("Sæt kryds, så vi må gemme dine oplysninger");
    const ok = await call("/skriv-dig-op", { form: { fornavn: "Maja", email: "Maja@Example.dk", alder: "30-39", omraade: "aarhus", interesser: ["Musik og koncerter", "Film", "Hacking"], samtykke: "ja" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("Tak, Maja!");
    expect(rows("SELECT first_name, email, age_group, area, interests, pick_id FROM interests")).toEqual([
      { first_name: "Maja", email: "maja@example.dk", age_group: "30-39", area: "aarhus", interests: "Musik og koncerter, Film", pick_id: null }
    ]);
    // A robot filling the hidden field is thanked, and nothing is stored.
    await call("/skriv-dig-op", { form: { fornavn: "Bot", email: "bot@example.dk", samtykke: "ja", website_url: "x" } });
    expect(rows("SELECT COUNT(*) AS n FROM interests")[0]!.n).toBe(1);
    // Only from the site's own pages.
    expect((await call("/skriv-dig-op", { form: { fornavn: "Eve", email: "eve@example.dk", samtykke: "ja" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("lets a volunteer log in, approve a collected event and edit it; then it is shown and people can ask to come along", async () => {
    expect((await call("/admin")).headers.get("location")).toBe("/log-ind");
    expect((await call("/log-ind", { form: { kode: "AAAA-BBBB-CCCC" } })).status).toBe(401);
    const login = await call("/log-ind", { form: { kode: adminCode.toLowerCase() } });
    expect(login.headers.get("location")).toBe("/admin");
    const cookie = cookieOf(login);
    expect((await call("/admin", { cookie })).body).toContain("Ingen Udflugter endnu");

    // Search by title, organiser or place.
    const found = await call("/admin/forslag?q=lysets hus", { cookie });
    expect(found.status).toBe(200);
    expect(found.body).toContain('name="event"');
    expect((await call("/admin/forslag?q=findesikke", { cookie })).body).toContain("Ingen forslag for den søgning");
    const list = await call("/admin/forslag", { cookie });
    const eventId = /name="event" value="([^"]+)"/.exec(list.body)![1]!;
    const approve = await call("/admin/forslag", { form: { event: eventId }, cookie });
    const pickId = /\/admin\/events\/([0-9a-f-]{36})\?besked=godkendt/.exec(approve.headers.get("location") ?? "")![1]!;
    const formPage = await call(approve.headers.get("location")!, { cookie });
    expect(formPage.body).toContain("Eventet er godkendt");
    const pick = rows("SELECT * FROM picks WHERE id = ?", pickId)[0]!;
    expect(pick.event_id).toBe(eventId);
    // Approving the same event again opens the same pick.
    expect((await call("/admin/forslag", { form: { event: eventId }, cookie })).headers.get("location")).toContain(pickId);
    expect((await call("/admin/forslag", { cookie })).body).not.toContain(`value="${eventId}"`);

    const save = await call(`/admin/events/${pickId}`, { cookie, form: {
      titel: "Koncert i foreningen", start: toLocalInput(pick.starts_at as number), slut: "", forening: "Foreningen Lyd", forening_url: "https://lyd.example",
      sted: "Salen", adresse: "Gaden 1", by: "Aarhus C", link: "", beskrivelse: "En rolig aften.", billede: "", pladser: "6", egenbetaling: "", eftermoede: "Café Rolig", status: "approved"
    } });
    expect(save.headers.get("location")).toBe(`/admin/events/${pickId}?besked=gemt`);
    const slug = rows("SELECT slug FROM picks WHERE id = ?", pickId)[0]!.slug as string;

    const home = await call("/");
    expect(home.body).toContain("Koncert i foreningen");
    expect(home.body).not.toContain("De første Udflugter er ved at blive planlagt");
    const eventPage = await call(`/events/${slug}`);
    expect(eventPage.body).toContain("Foreningen Lyd");
    expect(eventPage.body).toContain("Café Rolig");
    expect(eventPage.body).toContain("Et symbolsk beløb – ikke fastlagt endnu.");
    expect(eventPage.body).toContain("Tilmelding og afbud");
    expect(eventPage.body).toContain("6 – først til mølle, derefter venteliste");
    expect(eventPage.body).toContain(`href="/skriv-dig-op?event=${slug}"`);
    // A collected event that is not picked has no page here.
    const other = rows("SELECT slug FROM events WHERE id != ? LIMIT 1", eventId)[0]!.slug as string;
    expect((await call(`/events/${other}`)).status).toBe(404);

    const signup = await call(`/skriv-dig-op?event=${slug}`);
    expect(signup.body).toContain(`value="${slug}" selected`);
    // There is no guest: a "friend" field from an old form is ignored.
    await call("/skriv-dig-op", { form: { fornavn: "Ali", email: "ali@example.dk", event: slug, ven: "ja", samtykke: "ja" } });
    await call("/skriv-dig-op", { form: { fornavn: "Ali", email: "ALI@example.dk", event: slug, samtykke: "ja" } });
    expect(rows("SELECT first_name, with_friend FROM interests WHERE pick_id = ?", pickId)).toEqual([{ first_name: "Ali", with_friend: 0 }]);

    const listPage = await call("/admin/interesseliste", { cookie });
    expect(listPage.body).toContain("ali@example.dk");
    expect(listPage.body).toContain("Koncert i foreningen");
    const csv = await call("/admin/interesseliste.csv", { cookie });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.body).toContain("Ali;ali@example.dk");

    // Withdrawn: gone from the pages.
    await call(`/admin/events/${pickId}`, { cookie, form: { titel: "Koncert i foreningen", start: toLocalInput(pick.starts_at as number), forening: "Foreningen Lyd", status: "withdrawn" } });
    expect((await call(`/events/${slug}`)).status).toBe(404);
    expect((await call("/")).body).not.toContain("Koncert i foreningen");
  });

  it("lets a volunteer type an event in by hand, and keeps others out of the admin pages", async () => {
    const login = await call("/log-ind", { form: { kode: adminCode } });
    const cookie = cookieOf(login);
    const bad = await call("/admin/events/ny", { cookie, form: { titel: "", start: "", forening: "" } });
    expect(bad.status).toBe(400);
    const made = await call("/admin/events/ny", { cookie, form: { titel: "Foredrag om fugle", start: "2026-10-20T19:00", forening: "Fugleforeningen", status: "approved" } });
    expect(made.headers.get("location")).toMatch(/\/admin\/events\/[0-9a-f-]{36}\?besked=oprettet/);
    expect((await call("/udflugter")).body).toContain("Foredrag om fugle");

    // A member who is not an admin has no access.
    const code = newCode();
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at) VALUES ('m-2', 'Kim', ?, ?, ?)").run(await sha256(code), NOW, NOW);
    expect((await call("/log-ind", { form: { kode: code } })).status).toBe(401);
    expect((await call("/admin/interesseliste.csv")).headers.get("location")).toBe("/log-ind");
  });

  it("deletes a person from the interest list on request, and takes inquiries from organisers", async () => {
    await call("/skriv-dig-op", { form: { fornavn: "Slet", email: "slet@example.dk", samtykke: "ja" } });
    const r = await call("/privatliv", { form: { email: "SLET@example.dk" } });
    expect(r.body).toContain("Hvis mailen stod på listen, er den slettet nu.");
    expect(rows("SELECT COUNT(*) AS n FROM interests WHERE email = 'slet@example.dk'")[0]!.n).toBe(0);
    const sent = await call("/for-arrangoerer", { form: { organisation: "Foreningen Lyd", navn: "Bo", email: "bo@lyd.example", hjemmeside: "", besked: "En koncert i november." } });
    expect(sent.body).toContain("Tak for jeres henvendelse");
    expect(rows("SELECT organisation FROM partner_inquiries")).toEqual([{ organisation: "Foreningen Lyd" }]);
  });
});
