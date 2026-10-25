import { describe, expect, it } from "vitest";
import { isAutomatic, scanEnquiries, scheduledEnquiryScan } from "./enquiries.js";
import { handleCockpitRequest } from "./handler.js";
import { insertMail } from "../saga/store.js";
import { deps, fakeServices, memberCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Holder hun også øje med mails om der er nogen der er kritiske og vi skal forholde os til hurtigst muligt" - "Bare mig nu".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-08T10:00:00Z"); // a Thursday

describe("critical mail", () => {
  const setup = async (answer: (ids: number[]) => unknown[]) => {
    const db = testDatabase();
    let system = "";
    const services = fakeServices({ ai: (sys, user) => { if (sys.includes("forespørgsel")) system = sys; return JSON.stringify({ items: answer((JSON.parse(user) as Array<{ id: number }>).map(m => m.id)) }); } });
    const env = sagaEnv(db, { COCKPIT_URL: "https://admin.hjerterum.info", COCKPIT_PASSWORD: "hjerte-2026" });
    const mail = (ref: string, subject: string, from = "Anna <anna@example.com>", at = NOW - 600_000) =>
      insertMail(db, { ref, sender: from, subject, receivedAtMs: at, preview: "Tekst", nowMs: NOW }).then(id => id!);
    return { db, services, env, mail, system: () => system };
  };

  it("judges every new mail for urgency and shows it first in Posthus - without a word on Telegram", async () => {
    const { db, services, env, mail, system } = await setup(ids => ids.map(id => id === 1
      ? { id, enquiry: false, urgent: true, why: "Advokat kræver svar inden fredag" } : { id, enquiry: true, kind: "Lokaleleje", summary: "Maria vil leje salen", urgent: false }));
    const letter = await mail("m1", "Varsel om retssag", "Advokat <jura@example.com>");
    await mail("m2", "Leje af salen");
    expect(system()).toBe("");
    expect(await scanEnquiries(env, deps(services.fetcher, NOW), db)).toBe(1);
    expect(system()).toContain("kritisk");
    expect(await db.prepare("SELECT id, urgent_why FROM board_mail WHERE urgent_why IS NOT NULL").all()).toMatchObject({ results: [{ id: letter, urgent_why: "Advokat kræver svar inden fredag" }] });
    // Requested: "Saga skal ikke længere underrette mig om mails i telegram" - nothing goes to Telegram.
    expect(services.calls.filter(c => c.url.includes("sendMessage"))).toHaveLength(0);
    // Posthus has them first, marked, with why.
    const cookie = await memberCookie(((await handleCockpitRequest(new Request(`${ORIGIN}/login`, { method: "POST", headers: { origin: ORIGIN }, body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() }), env, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!, "Jacob Hauge");
    const page = await (await handleCockpitRequest(new Request(`${ORIGIN}/posthus`, { headers: { cookie } }), env, deps(services.fetcher, NOW))).text();
    expect(page).toContain('<h2>Kritiske mails <span class="count">1</span></h2>');
    expect(page).toContain("<strong>Angående:</strong> Advokat kræver svar inden fredag");
    expect(page.indexOf("Kritiske mails")).toBeLessThan(page.indexOf("<h2>Indbakke"));
    expect(page).toContain('<span class="kind urgent">Kritisk</span>');
  });


  // Asked: "How often is the email checked? Maybe that's why." - sorted in the same ten-minute round as team@ is read, every day.
  it("sorts new mail every ten minutes, also at the weekend, and only calls Saga when there is new mail", async () => {
    const { db, services, env, mail } = await setup(ids => ids.map(id => ({ id, enquiry: false, urgent: false })));
    await mail("m1", "Hej");
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };
    const AI = () => services.calls.filter(c => /anthropic|openai|completions|messages/.test(c.url)).length;
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW), db, claim);
    const first = AI();
    expect(first).toBeGreaterThan(0);
    await mail("m2", "Hej igen");
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW + 5 * 60_000), db, claim); // the same ten minutes
    expect(AI()).toBe(first);
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW + 11 * 60_000), db, claim); // the next round
    expect(AI()).toBeGreaterThan(first);
    const after = AI();
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW + 31 * 60_000), db, claim); // nothing new: no call
    expect(AI()).toBe(after);
    const saturday = Date.parse("2026-10-10T10:00:00Z");
    await mail("m3", "Lørdag", "Bo <bo@example.com>", saturday - 60_000);
    await scheduledEnquiryScan(env, deps(services.fetcher, saturday), db, claim);
    expect(AI()).toBeGreaterThan(after);
  });

  // Reported (Douglas): "9 long emails from Mailchimp that were activated because I was helping Gitta with the newsletter. They can be ignored" -
  // "How do we make sure that this doesn't happen now or in the future?" and "Also add a little cross by each so we can delete them immediately."
  it("never reads the board's own newsletter service as critical, and a cross takes a mail off the list", async () => {
    expect(isAutomatic({ sender: "Mailchimp <hello@mailchimp.com>", preview: "Your account", subject: "New login to Mailchimp" })).toBe(true);
    expect(isAutomatic({ sender: "Mailchimp <bounce-mc.us21_1234@mail123.mcsv.net>", preview: "Test", subject: "[Test] Oktober i Hjerterum" })).toBe(true);
    expect(isAutomatic({ sender: "Intuit Mailchimp <no-reply@intuit.com>", preview: "x", subject: "x" })).toBe(true);
    expect(isAutomatic({ sender: "Gmail <konto@example.com>", preview: "x", subject: "Your verification code is 123456" })).toBe(true);
    // A person complaining about a login is still read.
    expect(isAutomatic({ sender: "Anna <anna@example.com>", preview: "Jeg kan ikke logge ind og vil have pengene tilbage", subject: "Klage" })).toBe(false);

    const { db, services, env, mail } = await setup(ids => ids.map(id => ({ id, enquiry: false, urgent: true, why: "Advarsel om sikkerhed" })));
    await mail("mc", "New login to Mailchimp", "Mailchimp <hello@mailchimp.com>");
    const real = await mail("p1", "Klage over aflyst kursus");
    await scanEnquiries(env, deps(services.fetcher, NOW), db);
    expect(await db.prepare("SELECT id FROM board_mail WHERE urgent_why IS NOT NULL").all()).toMatchObject({ results: [{ id: real }] });
    expect((await db.prepare("SELECT label FROM board_mail WHERE subject LIKE '%Mailchimp%'").first<{ label: string }>())?.label).toBe("Automatisk");
    const ask = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(`${ORIGIN}${path}`, init), env, deps(services.fetcher, NOW));
    const session = ((await ask("/login", { method: "POST", headers: { origin: ORIGIN }, body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Gitta");
    const page = await (await ask("/posthus", { headers: { cookie } })).text();
    expect(page).toContain(`<form method="post" action="/posthus/ikke-kritisk" class="x-form"><input type="hidden" name="id" value="${real}"><button class="x"`);
    const removed = await ask("/posthus/ikke-kritisk", { method: "POST", headers: { origin: ORIGIN, cookie }, body: (() => { const f = new FormData(); f.append("id", String(real)); return f; })() });
    expect(removed.headers.get("location")).toBe("/posthus#kritiske");
    const after = await (await ask("/posthus", { headers: { cookie } })).text();
    expect(after).not.toContain("Kritiske mails");
    expect(after).toContain("Klage over aflyst kursus");
  });

  // Requested: "Der bør i øvrigt ikke være mere end én advarsel pr. sag. Lige nu er der fem advarsler om den samme ting."
  it("gives one warning per matter on the page, and one cross takes them all", async () => {
    const { db, services, env, mail } = await setup(ids => ids.map(id => ({ id, enquiry: false, urgent: true, why: "Kunden kræver pengene tilbage" })));
    const first = await mail("k1", "Klage over kursus", "Bo <bo@example.com>", NOW - 3_000_000);
    const second = await mail("k2", "Re: Klage over kursus", "Bo <bo@example.com>", NOW - 2_000_000);
    const third = await mail("k3", "RE: SV: Klage over kursus", "Bo <bo@example.com>", NOW - 1_000_000);
    await mail("o1", "Inkasso", "Firma <inkasso@example.com>");
    await scanEnquiries(env, deps(services.fetcher, NOW), db);
    expect(services.calls.filter(c => c.url.includes("sendMessage"))).toHaveLength(0);
    const ask = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(`${ORIGIN}${path}`, init), env, deps(services.fetcher, NOW));
    const session = ((await ask("/login", { method: "POST", headers: { origin: ORIGIN }, body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Gitta");
    const page = await (await ask("/posthus", { headers: { cookie } })).text();
    expect(page).toContain('<h2>Kritiske mails <span class="count">2</span></h2>');
    expect(page).toContain('<span class="kind">3 mails</span>');
    // Reported: "But there is no way to fold the email again" - each open mail has its own way back.
    expect(page).toContain('<button type="button" class="fold-up" onclick="const d=this.closest(\'details\');d.open=false;d.scrollIntoView({block:\'nearest\'})">Fold sammen ▴</button></details>');
    expect(page).toContain(`name="id" value="${third},${second},${first}"`);
    await ask("/posthus/ikke-kritisk", { method: "POST", headers: { origin: ORIGIN, cookie }, body: (() => { const f = new FormData(); f.append("id", `${third},${second},${first}`); return f; })() });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_mail WHERE urgent_why IS NOT NULL").first<{ n: number }>())?.n).toBe(1);
  });
});
