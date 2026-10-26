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
/** A new member: joins and comes back with a login and the code. */
async function join(name: string, email = `${name.toLowerCase()}@example.dk`): Promise<{ cookie: string; code: string; body: string }> {
  const r = await call("/bliv-medlem", { form: { fornavn: name, email, samtykke: "ja", naeste: "/udflugter" } });
  return { cookie: cookieOf(r), code: /<p class="f-code-value">([A-Z0-9-]+)<\/p>/.exec(r.body)?.[1] ?? "", body: r.body };
}
async function adminLogin(): Promise<string> { return cookieOf(await call("/log-ind", { form: { kode: adminCode } })); }

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
  it("is what the Worker shows by default: the concept, the steps, the frame – and no Udflugter before any are picked", async () => {
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
    expect(home.body).toContain('href="/bliv-medlem"');
    for (const frame of ["Du ved, hvad der skal ske", "En lille flok", "På din egen måde", "Klare frister"]) expect(home.body).toContain(frame);
    expect(home.body).toContain("Beløbet er ikke fastlagt endnu");
    // The event portal's pages are not part of it.
    for (const path of ["/kalender", "/kort", "/meditation", "/find-en-flok", "/flokke"]) expect((await call(path)).status).toBe(404);
    // Earlier addresses lead on.
    expect((await call("/samarbejde")).headers.get("location")).toBe("/for-arrangoerer");
    expect((await call("/for-foreninger")).headers.get("location")).toBe("/for-arrangoerer");
    expect((await call("/maanedens-events")).headers.get("location")).toBe("/udflugter");
    expect((await call("/tryghed")).headers.get("location")).toBe("/saadan-fungerer-det");
    expect((await call("/skriv-dig-op?event=x")).headers.get("location")).toBe("/bliv-medlem?naeste=%2Fevents%2Fx");
    for (const path of ["/udflugter", "/saadan-fungerer-det", "/bliv-medlem", "/log-ind", "/om", "/for-arrangoerer", "/privatliv"]) expect((await call(path)).status).toBe(200);
  });

  it("speaks about the experiences and the frame: no host, no deficits, nothing undecided stated as fact", async () => {
    for (const path of ["/", "/udflugter", "/saadan-fungerer-det", "/bliv-medlem", "/log-ind", "/om", "/for-arrangoerer", "/privatliv"]) {
      const text = (await call(path)).body.replace(/<[^>]+>/g, " ");
      expect(text, path).not.toMatch(/ensom|socialangst|social angst|genert|skrøbelig|bor alene|nemmeste i verden/i);
      expect(text, path).not.toMatch(/værten|vært, der|tager imod jer/i);
      expect(text, path).not.toMatch(/under stiftelse|kontingent|tage en ven med|medlemskab er gratis/i);
    }
    const how = (await call("/saadan-fungerer-det")).body;
    for (const rule of ["Man kan ikke tilmelde en gæst", "flere Udflugter", "først til mølle", "automatisk på ventelisten", "bekræftes, når fire har tilmeldt sig",
      "gennemføres Udflugten alligevel", "lukker 7 dage før", "deltagerlisten fast", "Hvis Flokk aflyser sin deltagelse", "uden for Flokks kontrol",
      "ikke automatisk en gruppechat", "fornavnene", "Der er ikke en vært fra Flokk med", "Det er ikke fastlagt endnu"]) expect(how).toContain(rule);
    expect((await call("/bliv-medlem")).body).toContain("Beløb og medlemsvilkår er ikke fastlagt endnu. Du betaler ikke noget nu.");
  });

  it("lets people join with a first name and a mail, shows the personal code once, and lets them log in and leave", async () => {
    const bad = await call("/bliv-medlem", { form: { fornavn: "", email: "nej" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain("Skriv dit fornavn");
    expect(bad.body).toContain("Sæt kryds, så vi må gemme dine oplysninger");
    const maja = await join("Maja", "Maja@Example.dk");
    expect(maja.body).toContain("Velkommen, Maja!");
    expect(maja.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(maja.cookie).not.toBe("");
    expect(rows("SELECT first_name, email FROM members WHERE email = 'maja@example.dk'")).toEqual([{ first_name: "Maja", email: "maja@example.dk" }]);
    // The header greets members with their own page.
    expect((await call("/", { cookie: maja.cookie })).body).toContain('href="/mine-udflugter"');
    // One profile per mail.
    expect((await call("/bliv-medlem", { form: { fornavn: "Maja", email: "maja@example.dk", samtykke: "ja" } })).status).toBe(409);
    // Logging in with the code, on another device.
    const login = await call("/log-ind", { form: { kode: maja.code.toLowerCase(), naeste: "/udflugter" } });
    expect(login.headers.get("location")).toBe("/udflugter");
    expect((await call("/log-ind", { form: { kode: "AAAA-BBBB-CCCC" } })).status).toBe(401);
    // A member of the event portal (Socialklubben) is not a Flokk member.
    const portalCode = newCode();
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at) VALUES ('portal-1', 'Kim', ?, ?, ?)").run(await sha256(portalCode), NOW, NOW);
    expect((await call("/log-ind", { form: { kode: portalCode } })).status).toBe(401);
    expect((await call("/mine-udflugter")).headers.get("location")).toBe("/log-ind?naeste=%2Fmine-udflugter");
    const mine = await call("/mine-udflugter", { cookie: maja.cookie });
    expect(mine.body).toContain("Du er ikke tilmeldt nogen Udflugter endnu");
    // Leaving deletes the profile.
    const bye = await call("/meld-ud", { form: { bekraeft: "ja" }, cookie: maja.cookie });
    expect(bye.body).toContain("Du er meldt ud");
    expect(rows("SELECT COUNT(*) AS n FROM members WHERE email = 'maja@example.dk'")[0]!.n).toBe(0);
    // Only from the site's own pages.
    expect((await call("/bliv-medlem", { form: { fornavn: "Eve", email: "eve@example.dk", samtykke: "ja" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("follows the rules for an Udflugt: first come, a waiting list, confirmed at four, cancellations, the seven-day close and Flokk cancelling", async () => {
    const cookie = await adminLogin();
    const made = await call("/admin/events/ny", { cookie, form: { titel: "Koncert i salen", start: "2026-10-25T19:00", forening: "Foreningen Lyd", pladser: "4", status: "approved" } });
    const pickId = /\/admin\/events\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")![1]!;
    const slug = rows("SELECT slug FROM picks WHERE id = ?", pickId)[0]!.slug as string;
    const page = (c?: string, at?: number) => call(`/events/${slug}`, { ...(c ? { cookie: c } : {}), ...(at ? { at } : {}) });

    // Not a member: join or log in.
    const visitor = await page();
    expect(visitor.body).toContain(`href="/bliv-medlem?naeste=/events/${slug}"`);
    expect(visitor.body).toContain("0 af 4 pladser taget");
    expect((await call(`/events/${slug}/tilmeld`, { form: {} })).headers.get("location")).toBe(`/log-ind?naeste=%2Fevents%2F${slug}`);

    const people = [];
    for (const name of ["Ana", "Bo", "Cy", "Di", "Eli", "Fie"]) people.push(await join(name));
    const [ana, bo, cy, di, eli, fie] = people as [typeof people[0], typeof people[0], typeof people[0], typeof people[0], typeof people[0], typeof people[0]];
    const signUp = (m: { cookie: string }) => call(`/events/${slug}/tilmeld`, { form: {}, cookie: m.cookie });
    const cancel = (m: { cookie: string }, at?: number) => call(`/events/${slug}/afbud`, { form: {}, cookie: m.cookie, ...(at ? { at } : {}) });
    const statusOf = (name: string) => rows("SELECT s.status FROM signups s JOIN members m ON m.id = s.member_id WHERE s.pick_id = ? AND m.first_name = ?", pickId, name)[0]?.status;

    expect((await signUp(ana)).headers.get("location")).toBe(`/events/${slug}?besked=tilmeldt`);
    for (const m of [bo, cy]) await signUp(m);
    expect(rows("SELECT confirmed_at FROM picks WHERE id = ?", pickId)[0]!.confirmed_at).toBeNull();
    await signUp(di);
    expect(rows("SELECT confirmed_at FROM picks WHERE id = ?", pickId)[0]!.confirmed_at).toBe(NOW);
    expect((await signUp(eli)).headers.get("location")).toBe(`/events/${slug}?besked=venteliste`);
    await signUp(fie);
    expect((await page(fie.cookie)).body).toContain("Du står nr. 2 på ventelisten.");
    expect((await page()).body).toContain("4 af 4 pladser taget · 2 på venteliste · flokken er bekræftet");
    // Signing up twice changes nothing.
    await signUp(ana);
    expect(rows("SELECT COUNT(*) AS n FROM signups WHERE pick_id = ?", pickId)[0]!.n).toBe(6);

    // A cancellation before the deadline: the place goes to the first on the waiting list.
    expect((await cancel(bo)).headers.get("location")).toBe(`/events/${slug}?besked=afmeldt`);
    expect([statusOf("Bo"), statusOf("Eli"), statusOf("Fie")]).toEqual(["cancelled", "registered", "waitlist"]);
    expect((await page(fie.cookie)).body).toContain("Du står nr. 1 på ventelisten.");
    // Signing up again joins the back of the queue.
    await signUp(bo);
    expect(statusOf("Bo")).toBe("waitlist");
    expect((await page(bo.cookie)).body).toContain("Du står nr. 2 på ventelisten.");

    // The flock was confirmed at four and stays confirmed if fewer come.
    await cancel(cy); await cancel(di); await cancel(fie); await cancel(bo);
    expect(rows("SELECT COUNT(*) AS n FROM signups WHERE pick_id = ? AND status = 'registered'", pickId)[0]!.n).toBe(2);
    expect(rows("SELECT confirmed_at FROM picks WHERE id = ?", pickId)[0]!.confirmed_at).toBe(NOW);

    // The practical information and the first names reach the flock on their own page.
    await call(`/admin/events/${pickId}`, { cookie, form: { titel: "Koncert i salen", start: "2026-10-25T19:00", forening: "Foreningen Lyd", pladser: "4",
      moedested: "Ved hovedindgangen, under uret", moedetid: "2026-10-25T18:30", program: "18.30 Vi mødes\n19.00 Koncert", status: "approved" } });
    const mine = await call("/mine-udflugter", { cookie: ana.cookie });
    expect(mine.body).toContain("Ved hovedindgangen, under uret");
    expect(mine.body).toContain("kl. 18.30");
    expect(mine.body).toContain("Ana, Eli");
    expect(mine.body).toContain("Meld afbud");

    // More places for Flokk give the waiting list places at once.
    for (const m of [cy, di, fie]) await signUp(m);
    await call(`/admin/events/${pickId}`, { cookie, form: { titel: "Koncert i salen", start: "2026-10-25T19:00", forening: "Foreningen Lyd", pladser: "4", status: "approved",
      moedested: "Ved hovedindgangen, under uret" } });
    expect(statusOf("Fie")).toBe("waitlist");
    await call(`/admin/events/${pickId}`, { cookie, form: { titel: "Koncert i salen", start: "2026-10-25T19:00", forening: "Foreningen Lyd", pladser: "5", status: "approved",
      moedested: "Ved hovedindgangen, under uret" } });
    expect(statusOf("Fie")).toBe("registered");

    // Seven days before, sign-up and cancellation close and the list is locked.
    const late = Date.parse("2026-10-19T12:00:00Z");
    expect((await cancel(ana, late)).headers.get("location")).toBe(`/events/${slug}?besked=lukket`);
    expect(statusOf("Ana")).toBe("registered");
    expect((await call(`/events/${slug}/tilmeld`, { form: {}, cookie: bo.cookie, at: late })).headers.get("location")).toBe(`/events/${slug}?besked=lukket`);
    expect((await page(ana.cookie, late)).body).toContain("Tilmelding og afbud er lukket – deltagerlisten ligger fast.");

    // The volunteers' list, with a mail ready for each participant.
    const list = await call(`/admin/events/${pickId}/deltagere`, { cookie });
    expect(list.body).toContain("ana@example.dk");
    expect(list.body).toMatch(/href="mailto:ana%40example\.dk\?subject=Flokk%3A%20Koncert%20i%20salen&amp;body=[^"]*under%20uret/);
    // Flokk cancels its participation: members see it, apart from the organiser's event.
    await call(`/admin/events/${pickId}/aflys`, { cookie, form: { bekraeft: "ja" } });
    expect((await page(ana.cookie)).body).toContain("Flokk har aflyst sin deltagelse i denne Udflugt.");
    expect((await call("/mine-udflugter", { cookie: ana.cookie })).body).toContain("Flokk har aflyst sin deltagelse.");
    expect((await signUp(bo)).headers.get("location")).toBe(`/events/${slug}?besked=lukket`);
  });

  it("lets a member who leaves give their place to the waiting list", async () => {
    const cookie = await adminLogin();
    const made = await call("/admin/events/ny", { cookie, form: { titel: "Foredrag om lys", start: "2026-10-28T19:00", forening: "Lysforeningen", pladser: "1", status: "approved" } });
    const pickId = /\/admin\/events\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")![1]!;
    const slug = rows("SELECT slug FROM picks WHERE id = ?", pickId)[0]!.slug as string;
    const gry = await join("Gry"), hans = await join("Hans");
    await call(`/events/${slug}/tilmeld`, { form: {}, cookie: gry.cookie });
    await call(`/events/${slug}/tilmeld`, { form: {}, cookie: hans.cookie });
    await call("/meld-ud", { form: { bekraeft: "ja" }, cookie: gry.cookie });
    expect(rows("SELECT m.first_name, s.status FROM signups s JOIN members m ON m.id = s.member_id WHERE s.pick_id = ?", pickId)).toEqual([{ first_name: "Hans", status: "registered" }]);
  });

  it("lets a volunteer approve a collected event and edit it, type one in, give a member a new code – and keeps others out", async () => {
    expect((await call("/admin")).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
    const login = await call("/log-ind", { form: { kode: adminCode.toLowerCase() } });
    expect(login.headers.get("location")).toBe("/admin");
    const cookie = cookieOf(login);

    // Search by title, organiser or place.
    const found = await call("/admin/forslag?q=lysets hus", { cookie });
    expect(found.status).toBe(200);
    expect(found.body).toContain('name="event"');
    expect((await call("/admin/forslag?q=findesikke", { cookie })).body).toContain("Ingen forslag for den søgning");
    const list = await call("/admin/forslag", { cookie });
    const eventId = /name="event" value="([^"]+)"/.exec(list.body)![1]!;
    const approve = await call("/admin/forslag", { form: { event: eventId }, cookie });
    const pickId = /\/admin\/events\/([0-9a-f-]{36})\?besked=godkendt/.exec(approve.headers.get("location") ?? "")![1]!;
    expect((await call(approve.headers.get("location")!, { cookie })).body).toContain("Eventet er godkendt");
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
    expect((await call("/")).body).toContain("Koncert i foreningen");
    const eventPage = await call(`/events/${slug}`);
    for (const text of ["Foreningen Lyd", "Café Rolig", "Et symbolsk beløb – ikke fastlagt endnu.", "Tilmelding og afbud", "6 – først til mølle, derefter venteliste"]) expect(eventPage.body).toContain(text);
    // A collected event that is not picked has no page here.
    const other = rows("SELECT slug FROM events WHERE id != ? LIMIT 1", eventId)[0]!.slug as string;
    expect((await call(`/events/${other}`)).status).toBe(404);
    // Withdrawn: gone from the pages.
    await call(`/admin/events/${pickId}`, { cookie, form: { titel: "Koncert i foreningen", start: toLocalInput(pick.starts_at as number), forening: "Foreningen Lyd", status: "withdrawn" } });
    expect((await call(`/events/${slug}`)).status).toBe(404);

    // Typed in by hand.
    expect((await call("/admin/events/ny", { cookie, form: { titel: "", start: "", forening: "" } })).status).toBe(400);
    const made = await call("/admin/events/ny", { cookie, form: { titel: "Foredrag om fugle", start: "2026-10-20T19:00", forening: "Fugleforeningen", status: "approved" } });
    expect(made.headers.get("location")).toMatch(/\/admin\/events\/[0-9a-f-]{36}\?besked=oprettet/);
    expect((await call("/udflugter")).body).toContain("Foredrag om fugle");

    // A new code for a member who lost theirs: the old one stops working.
    const ida = await join("Ida");
    const idaId = rows("SELECT id FROM members WHERE email = 'ida@example.dk'")[0]!.id as string;
    const renewed = await call("/admin/medlemmer", { cookie, form: { medlem: idaId } });
    const fresh = /class="f-code-inline">([A-Z0-9-]+)</.exec(renewed.body)![1]!;
    expect((await call("/log-ind", { form: { kode: ida.code } })).status).toBe(401);
    expect((await call("/log-ind", { form: { kode: fresh } })).status).toBe(303);
    expect((await call("/mine-udflugter", { cookie: ida.cookie })).headers.get("location")).toBe("/log-ind?naeste=%2Fmine-udflugter");

    // A member who is not a volunteer has no access.
    const jon = await join("Jon");
    expect((await call("/admin", { cookie: jon.cookie })).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
    expect((await call("/admin/interesseliste.csv")).headers.get("location")).toBe("/log-ind?naeste=%2Fadmin");
  });

  it("deletes a person from the earlier interest list on request, and takes inquiries from organisers", async () => {
    db.raw.prepare("INSERT INTO interests (id, first_name, email, created_at, updated_at) VALUES ('i-1', 'Slet', 'slet@example.dk', ?, ?)").run(NOW, NOW);
    const r = await call("/privatliv", { form: { email: "SLET@example.dk" } });
    expect(r.body).toContain("Hvis mailen stod på listen, er den slettet nu.");
    expect(rows("SELECT COUNT(*) AS n FROM interests WHERE email = 'slet@example.dk'")[0]!.n).toBe(0);
    const sent = await call("/for-arrangoerer", { form: { organisation: "Foreningen Lyd", navn: "Bo", email: "bo@lyd.example", hjemmeside: "", besked: "En koncert i november." } });
    expect(sent.body).toContain("Tak for jeres henvendelse");
    expect(rows("SELECT organisation FROM partner_inquiries")).toEqual([{ organisation: "Foreningen Lyd" }]);
  });
});
