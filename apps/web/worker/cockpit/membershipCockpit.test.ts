import { afterEach, describe, expect, it } from "vitest";
import { membershipPlans } from "../../membership.js";
import { currentLevels, forgetMembershipLevels, kroner, refreshMembershipLevels } from "../membership-levels.js";
import { handleCockpitRequest } from "./handler.js";
import { figures, monthlyMinor } from "./membershipCockpit.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested by the chair: "Vi skal udvikle et membership cockpit i admin hvor vi kan tjekke og redigere alt vedrørende medlemmer, medlemskab og
// abonnementer, se statistik og historik - inspireret af membership works" - and new admin features are the chair's first.
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-02T10:00:00Z");

async function setup() {
  const db = testDatabase();
  for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Douglas Crawford", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare(`INSERT INTO members (id, clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, phone, created_at_ms, updated_at_ms, billing, joined_on)
    VALUES (1, 'user_1', 'cus_1', 'standard', 'month', 'active', 'Anna Jensen', 'anna@example.dk', '11111111', ?, ?, 'stripe', '2024-03-01')`).bind(NOW, NOW).run();
  await db.prepare("INSERT INTO membershipworks_uploads (id, filename, uploaded_by, accounts, uploaded_at_ms) VALUES (1, 'export.csv', 'Jacob Hauge', 4, ?)").bind(Date.parse("2026-10-04T20:00:00Z")).run();
  const account = (email: string, name: string, tier: string | null, interval: string | null, billing: string | null, renews: string | null, plan: string | null, labels = "[]") =>
    db.prepare(`INSERT INTO membershipworks_accounts (email, full_name, plan, tier, interval, billing, joined_on, renews_on, stripe_customer_id, labels, row_json, upload_id)
      VALUES (?, ?, ?, ?, ?, ?, '2019-04-27', ?, ?, ?, '{}', 1)`).bind(email, name, plan, tier, interval, billing, renews, billing === "auto" ? `cus_${name}` : null, labels).run();
  await account("anna@example.dk", "Anna (MW)", "standard", "month", "auto", "2026-11-20", "Standard medlemskab");
  await account("douglas@example.dk", "Douglas Crawford", "standard", "month", "auto", "2026-11-10", "Standard medlemskab", '["Teacher","Hjerterum Team"]');
  await account("ole@example.dk", "Ole Late", "generoest", "year", "auto", "2026-09-30", "Generøst medlemskab");
  await account("tom@example.dk", "Tom Gone", null, null, null, null, null);
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(fakeServices().fetcher, NOW));
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, form, lisbeth: await memberCookie(session, "Lisbeth"), chair: await personalCookie("Jacob Hauge", NOW),
    douglas: await personalCookie("Douglas Crawford", NOW), douglasShared: await memberCookie(session, "Douglas Crawford"), lisbethOwn: await personalCookie("Lisbeth", NOW) };
}

describe("the membership cockpit", () => {
  it("is the chair's alone for now", async () => {
    const { call, lisbeth, chair } = await setup();
    expect((await call("/medlemskab", { cookie: lisbeth })).status).toBe(403);
    expect((await call("/medlemskab/eksport.csv", { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/medlemmer", { cookie: lisbeth })).text()).not.toContain("/medlemskab");
    expect(await (await call("/medlemmer", { cookie: chair })).text()).toContain("Åbn medlemsoverblikket");
  });

  // Asked (the chair, 12 Nov 2026), on Douglas' "Do you have access for me to an admin section for the membership system yet?": "YES!".
  it("is open to Douglas too, with his own login - and to no one else on the board", async () => {
    const { call, douglas, douglasShared, lisbethOwn } = await setup();
    expect((await call("/medlemskab", { cookie: douglas })).status).toBe(200);
    expect(await (await call("/medlemmer", { cookie: douglas })).text()).toContain("Åbn medlemsoverblikket");
    expect((await call("/medlemskab", { cookie: douglasShared })).status).toBe(403);
    expect((await call("/medlemskab", { cookie: lisbethOwn })).status).toBe(403);
  });

  it("shows everyone once - the platform's members first - with figures, filters and an export", async () => {
    const { db, call, chair } = await setup();
    const page = await (await call("/medlemskab", { cookie: chair })).text();
    for (const text of ["Anna Jensen", "Douglas Crawford", "Ole Late", "Tom Gone", "I restance", "Intet medlemskab", "Medlemskaber", "Nuværende medlemmer efter indmeldelsesår"]) expect(page).toContain(text);
    expect(page).not.toContain("Anna (MW)");
    // Active: Anna and Douglas (222 kr. each a month); Ole is past due (renewal before the export's day).
    expect(page).toContain("444 kr.");
    const late = await (await call("/medlemskab?status=restance", { cookie: chair })).text();
    expect(late).toContain("Ole Late");
    expect(late).not.toContain("Douglas Crawford");
    expect(await (await call("/medlemskab?underviser=1", { cookie: chair })).text()).toContain("Douglas Crawford");
    const csv = await (await call("/medlemskab/eksport.csv?status=aktiv", { cookie: chair })).text();
    expect(csv).toContain("Navn;E-mail;Telefon");
    expect(csv).toContain("Douglas Crawford;douglas@example.dk");
    expect(csv).not.toContain("Ole Late");
    const log = await db.prepare("SELECT detail FROM chair_audit").all<{ detail: string }>();
    expect(log.results?.map(r => r.detail)).toContain("Eksporterede 2 medlemmer");
  });

  it("changes a platform member's details and notes, and reads a MembershipWorks account", async () => {
    const { db, call, form, chair } = await setup();
    const card = await (await call("/medlemskab/medlem?k=p1", { cookie: chair })).text();
    expect(card).toContain("Anna Jensen");
    expect(card).toContain("Skift, giv eller afslut medlemskab");
    const saved = await (await call("/medlemskab/medlem?k=p1", { method: "POST", cookie: chair, body: form({ name: "Anna Holm Jensen", phone: "22222222", address: "Guldsmedgade 1", birthday: "1980-05-01", teacher: "1" }) })).text();
    expect(saved).toContain("Oplysningerne er gemt");
    expect(saved).toContain("Oplysninger rettet");
    const row = await db.prepare("SELECT full_name, phone, street_address, birthday, is_teacher FROM members WHERE id = 1").first();
    expect(row).toEqual({ full_name: "Anna Holm Jensen", phone: "22222222", street_address: "Guldsmedgade 1", birthday: "1980-05-01", is_teacher: 1 });
    expect(await (await call("/medlemskab/medlem?k=p1", { method: "POST", cookie: chair, body: form({ action: "note", note: "Ringede om pause." }) })).text()).toContain("Ringede om pause.");
    const mw = await call(`/medlemskab/medlem?k=${encodeURIComponent("mwdouglas%40example.dk")}`, { cookie: chair });
    const mwText = await mw.text();
    expect(mwText).toContain("MembershipWorks (indtil skæringsdagen)");
    expect(mwText).not.toContain('name="phone"');
  });

  it("works out a month's membership, a yearly one spread over twelve", () => {
    expect(monthlyMinor("standard", "month")).toBe(22_200);
    expect(monthlyMinor("standard", "year")).toBe(19_250);
    expect(monthlyMinor("gratis", "month")).toBe(0);
    expect(figures([], "2026-11-02").active).toBe(0);
  });

  // Asked (the chair, 12 Nov 2026), on Douglas' "The membership levels must be in the 'Membership Overview' page and editable": "Af mig og Douglas" -
  // "Douglas bliver Ansvarlig (admin) for medlemssystemet".
  describe("the membership levels", () => {
    afterEach(() => forgetMembershipLevels());

    it("are edited by the chair and Douglas, each with their own login, and no one else", async () => {
      const { call, chair, douglas, douglasShared, lisbethOwn } = await setup();
      expect(await (await call("/medlemskab", { cookie: chair })).text()).toContain("/medlemskab/niveauer");
      const page = await (await call("/medlemskab/niveauer", { cookie: douglas })).text();
      expect(page).toContain('value="222"');
      expect(page).toContain("medlemskaber, der allerede kører");
      expect((await call("/medlemskab/niveauer", { cookie: douglasShared })).status).toBe(403);
      expect((await call("/medlemskab/niveauer", { cookie: lisbethOwn })).status).toBe(403);
    });

    it("save a level, lay it over the one written in the code, and keep who changed what", async () => {
      const { db, call, form, douglas } = await setup();
      const saved = await call("/medlemskab/niveauer", { method: "POST", cookie: douglas,
        body: form({ tier: "standard", name: "Standard medlemskab", description: "Ny tekst.", month: "230", year: "2.400" }) });
      expect(saved.status).toBe(303);
      expect(membershipPlans.standard).toMatchObject({ name: "Standard medlemskab", description: "Ny tekst.", month: 23_000, year: 240_000, benefits: true });
      expect(currentLevels().find(l => l.tier === "standard")).toMatchObject({ month: 23_000 });
      const page = await (await call("/medlemskab/niveauer", { cookie: douglas })).text();
      expect(page).toContain("pr. måned: 222 → 230 kr.");
      expect(page).toContain("Douglas Crawford");
      // Another worker reads it from the database.
      forgetMembershipLevels();
      expect(membershipPlans.standard.month).toBe(22_200);
      await refreshMembershipLevels(db, NOW);
      expect(membershipPlans.standard.month).toBe(23_000);
      // A price that is not a price, or none, is refused; nothing changes.
      const bad = await call("/medlemskab/niveauer", { method: "POST", cookie: douglas, body: form({ tier: "standard", name: "Standard medlemskab", description: "", month: "gratis", year: "0" }) });
      expect(bad.status).toBe(400);
      expect(membershipPlans.standard.month).toBe(23_000);
    });

    it("reads prices as written in Danish", () => {
      expect(kroner("222")).toBe(22_200);
      expect(kroner("2.310")).toBe(231_000);
      expect(kroner("111,50 kr.")).toBe(11_150);
      expect(kroner("abc")).toBeNull();
    });
  });
});
