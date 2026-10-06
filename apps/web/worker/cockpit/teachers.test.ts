import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { contactsByName, listTeachers } from "./teachers.js";
import { insertMail, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Vi skal også have en underside til arrangementer, som hedder Undervisere, hvor vi samler alle underviserne.
// Man kan så klikke ind på hver underviser, udfylde basis-kontaktinformationer, hvis systemet ikke allerede har dem, samt
// bede Saga om at lave et resumé af vores samarbejde med denne underviser." - "Men ser ikke, at man som udgangspunkt selv
// skal hente de undervisere, der allerede eksisterer." - "I bunden skal der stå ... © Jacob Hauge".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");
const DAY = 86_400_000;

async function calendar(db: D1Database, id: string, title: string, host: string, at: number) {
  await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, category, description, content_hash, updated_at_ms) VALUES (?, ?, ?, ?, 'Yoga & Meditation', ?, 'h', 1)")
    .bind(id, title, at, host, `Underviser: ${host}\nEn rolig time.`).run();
}

describe("Undervisere", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collects the teachers by itself, knows their contacts, keeps the board's and lets Saga sum up the collaboration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    await calendar(db, "1", "Yin yoga", "Karítas E. Langkjær", NOW - 30 * DAY);
    await calendar(db, "2", "Yin yoga", "Karítas E. Langkjær", NOW + 5 * DAY);
    await calendar(db, "3", "Lydbad", "Philip Lenbroch", NOW - 900 * DAY);
    await db.prepare("INSERT INTO fixed_teachers (email, name, added_by, added_at_ms) VALUES ('kasper@example.com', 'Kasper Frausing', 'Gitta', 1)").run();
    await insertMail(db, { ref: "m1", sender: "Karítas E. Langkjær <karitas@example.com>", subject: "Nye datoer i foråret", receivedAtMs: NOW - 3 * DAY, preview: "Kan jeg få tirsdage fra februar?", nowMs: NOW });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Lisbeth", authorId: "201", text: "Karítas E. Langkjær vil gerne have tirsdage", sentAtMs: NOW - DAY, fromAssistant: false });

    const list = await listTeachers(db, NOW);
    expect(list.map(t => t.name)).toEqual(["Karítas E. Langkjær", "Kasper Frausing", "Philip Lenbroch"]);
    // Karítas's mail is known from the mail to team@ - the list no longer says "Mangler kontakt" for what the system knows; Philip has none.
    expect(list[0]).toMatchObject({ events: 2, upcoming: 1, hasContact: true });
    expect(list[1]).toMatchObject({ fixed: true, hasContact: true });
    expect(list[2]).toMatchObject({ name: "Philip Lenbroch", hasContact: false });

    let asked = "";
    const services = fakeServices({ ai: (_system, user) => { asked = user; return "- Karítas har holdt yin yoga i Hjerterum siden 2026.\n- Hun ønsker tirsdage fra februar (mail 29. sep.)."; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");

    expect(await (await call("/arrangementer", { cookie })).text()).toContain('href="/arrangementer/undervisere">Undervisere →');
    const page = await (await call("/arrangementer/undervisere", { cookie })).text();
    expect(page).toContain("Karítas E. Langkjær");
    expect(page).toContain("Mangler kontakt");
    expect(page).toContain("Tidligere (1)");
    expect(page).toContain("© Jacob Hauge");

    const url = `/arrangementer/undervisere/${encodeURIComponent("karítas e. langkjær")}`;
    const detail = await (await call(url, { cookie })).text();
    expect(detail).toContain("karitas@example.com <span class=\"small muted\">· mail fra mail til team@");
    expect(detail).toContain('name="email" value="karitas@example.com"');
    expect(detail).toContain("Kommende");

    await call(url, { method: "POST", cookie, body: form({ action: "save", email: "karitas@example.com", phone: "+45 12 34 56 78", website: "karitas.dk", note: "Fast tirsdag?" }) });
    expect(await db.prepare("SELECT email, phone, website, note, updated_by FROM cockpit_teachers").first()).toEqual({ email: "karitas@example.com", phone: "+45 12 34 56 78", website: "https://karitas.dk", note: "Fast tirsdag?", updated_by: "Lisbeth" });

    const summed = await call(url, { method: "POST", cookie, body: form({ action: "summary" }) });
    expect(summed.headers.get("location")).toContain("besked=resume");
    expect(asked).toContain("ARRANGEMENTER (2 i alt");
    expect(asked).toContain("Kan jeg få tirsdage fra februar?");
    expect(asked).toContain("Lisbeth: Karítas E. Langkjær vil gerne have tirsdage");
    expect(asked).toContain("Fast tirsdag?");
    const after = await (await call(url, { cookie })).text();
    expect(after).toContain("<li>Hun ønsker tirsdage fra februar (mail 29. sep.).</li>");
    expect((await call("/arrangementer/undervisere/ukendt%20person", { cookie })).status).toBe(404);
  });

  it("lets the board choose between most events and alphabetical, and keeps the search and the choice together", async () => {
    const db = testDatabase();
    // Days ago: Ægir 1 event, Bo 3, Anna 2 - and Zoe 4, all of them more than a year ago.
    const events: Array<[string, number]> = [["Ægir", 1], ["Bo", 2], ["Bo", 3], ["Bo", 4], ["Anna", 5], ["Anna", 6], ["Zoe", 500], ["Zoe", 520], ["Zoe", 540], ["Zoe", 560]];
    for (const [n, [host, daysAgo]] of events.entries()) await calendar(db, String(n + 1), "Yoga", host, NOW - daysAgo * DAY);
    // Zoe has the most events, but none within the last year: still "Tidligere" - the groups stay, the order inside them follows the choice.
    expect((await listTeachers(db, NOW)).map(t => t.name)).toEqual(["Bo", "Anna", "Ægir", "Zoe"]);
    expect((await listTeachers(db, NOW, "events")).map(t => t.name)).toEqual(["Bo", "Anna", "Ægir", "Zoe"]);
    expect((await listTeachers(db, NOW, "navn")).map(t => t.name)).toEqual(["Anna", "Bo", "Ægir", "Zoe"]);

    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const services = fakeServices({});
    const call = (path: string, cookie?: string) => handleCockpitRequest(new Request(ORIGIN + path, { headers: cookie ? { cookie } : {} }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await handleCockpitRequest(new Request(ORIGIN + "/login", { method: "POST", body: login, headers: { origin: ORIGIN } }), env, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");
    const order = (html: string) => ["Anna", "Bo", "Ægir"].map(n => [n, html.indexOf(`>${n}</a>`)] as const).sort((a, b) => a[1] - b[1]).map(([n]) => n);

    const byEvents = await (await call("/arrangementer/undervisere", cookie)).text();
    expect(order(byEvents)).toEqual(["Bo", "Anna", "Ægir"]);
    expect(byEvents).toContain('<a href="/arrangementer/undervisere?sorter=events" class="on" aria-current="true">Flest events</a>');
    expect(byEvents).toContain('<a href="/arrangementer/undervisere?sorter=navn">A–Å</a>');

    const byName = await (await call("/arrangementer/undervisere?sorter=navn", cookie)).text();
    expect(order(byName)).toEqual(["Anna", "Bo", "Ægir"]);
    expect(byName).toContain('<a href="/arrangementer/undervisere?sorter=navn" class="on" aria-current="true">A–Å</a>');
    expect(byName).toContain('<input type="hidden" name="sorter" value="navn">');

    const searched = await (await call("/arrangementer/undervisere?q=an&sorter=navn", cookie)).text();
    expect(searched).toContain('<a href="/arrangementer/undervisere?q=an&sorter=events">Flest events</a>');
    expect((await call("/arrangementer/undervisere?sorter=noget-andet", cookie).then(r => r.text()))).toContain('class="on" aria-current="true">Flest events</a>');
  });

  it("finds a teacher's mail where the system already has it: the website's register, members and the import from MembershipWorks", async () => {
    const db = testDatabase();
    await calendar(db, "1", "Yoga", "Mette Hansen", NOW - DAY);
    await calendar(db, "2", "Lydbad", "Ole Nielsen", NOW - DAY);
    await calendar(db, "3", "Dans", "Pia Sørensen", NOW - DAY);
    await calendar(db, "4", "Samtale", "Rasmus Ukendt", NOW - DAY);
    await db.prepare("INSERT INTO teachers (name, email, phone, created_at_ms, updated_at_ms) VALUES ('mette hansen', 'mette@example.com', '+45 11 22 33 44', 1, 1)").run();
    await db.prepare("INSERT INTO membership_import_batches (source, filename, imported_by_email, started_at_ms) VALUES ('membershipworks', 'f.csv', 'a@b.dk', 1)").run();
    await db.prepare(`INSERT INTO external_memberships (source, normalized_email, full_name, raw_json, first_seen_at_ms, last_seen_at_ms, last_changed_at_ms, last_import_batch_id)
      VALUES ('membershipworks', 'ole@example.com', 'Ole Nielsen', '{}', 1, 1, 1, 1)`).run();
    await insertMail(db, { ref: "m2", sender: "\"Pia Sørensen\" <pia@example.com>", subject: "Hej", receivedAtMs: NOW - DAY, preview: "Tak for sidst", nowMs: NOW });

    const byName = Object.fromEntries((await listTeachers(db, NOW)).map(t => [t.name, t.hasContact]));
    expect(byName).toEqual({ "Mette Hansen": true, "Ole Nielsen": true, "Pia Sørensen": true, "Rasmus Ukendt": false });

    const all = await contactsByName(db);
    expect(all.get("mette hansen")).toEqual([{ kind: "mail", value: "mette@example.com", from: "hjemmesidens underviserregister" }, { kind: "telefon", value: "+45 11 22 33 44", from: "hjemmesidens underviserregister" }]);
    expect(all.get("ole nielsen")).toEqual([{ kind: "mail", value: "ole@example.com", from: "medlem i MembershipWorks" }]);
    // The teacher's own page asks for one name and gets the same.
    expect((await contactsByName(db, "Pia Sørensen")).get("pia sørensen")).toEqual([{ kind: "mail", value: "pia@example.com", from: "mail til team@" }]);
    expect((await contactsByName(db, "Rasmus Ukendt")).size).toBe(0);
  });
});
