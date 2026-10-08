import { describe, expect, it } from "vitest";
import { scanEnquiries, scheduledEnquiryScan, tellChairAboutUrgentMail } from "./enquiries.js";
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
    const services = fakeServices({ ai: (sys, user) => { system = sys; return JSON.stringify({ items: answer((JSON.parse(user) as Array<{ id: number }>).map(m => m.id)) }); } });
    const env = sagaEnv(db, { COCKPIT_URL: "https://admin.hjerterum.info", COCKPIT_PASSWORD: "hjerte-2026" });
    const mail = (ref: string, subject: string, from = "Anna <anna@example.com>", at = NOW - 600_000) =>
      insertMail(db, { ref, sender: from, subject, receivedAtMs: at, preview: "Tekst", nowMs: NOW }).then(id => id!);
    return { db, services, env, mail, system: () => system };
  };

  it("judges every new mail for urgency, tells the chair on Telegram once - privately - and shows it first in Posthus", async () => {
    const { db, services, env, mail, system } = await setup(ids => ids.map(id => id === 1
      ? { id, enquiry: false, urgent: true, why: "Advokat kræver svar inden fredag" } : { id, enquiry: true, kind: "Lokaleleje", summary: "Maria vil leje salen", urgent: false }));
    const letter = await mail("m1", "Varsel om retssag", "Advokat <jura@example.com>");
    await mail("m2", "Leje af salen");
    expect(system()).toBe("");
    expect(await scanEnquiries(env, deps(services.fetcher, NOW), db)).toBe(1);
    expect(system()).toContain("kritisk");
    expect(await db.prepare("SELECT id, urgent_why FROM board_mail WHERE urgent_why IS NOT NULL").all()).toMatchObject({ results: [{ id: letter, urgent_why: "Advokat kræver svar inden fredag" }] });
    // One message, to the chair's own chat, with who, what, why and the way to Posthus.
    const sent = services.calls.filter(c => c.url.includes("sendMessage"));
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as { chat_id: string | number; text: string };
    expect(String(body.chat_id)).toBe(String(env.SAGA_OWNER_TELEGRAM_ID));
    expect(body.text).toContain("Kritisk mail i team@");
    expect(body.text).toContain("Varsel om retssag");
    expect(body.text).toContain("Advokat kræver svar inden fredag");
    expect(body.text).toContain("https://admin.hjerterum.info/posthus#kritiske");
    // Once: a second look sends nothing more.
    expect(await tellChairAboutUrgentMail(env, deps(services.fetcher, NOW), db)).toBe(0);
    // Posthus has them first, marked, with why.
    const cookie = await memberCookie(((await handleCockpitRequest(new Request(`${ORIGIN}/login`, { method: "POST", headers: { origin: ORIGIN }, body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() }), env, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!, "Jacob Hauge");
    const page = await (await handleCockpitRequest(new Request(`${ORIGIN}/posthus`, { headers: { cookie } }), env, deps(services.fetcher, NOW))).text();
    expect(page).toContain('<h2>Kritiske mails <span class="count">1</span></h2>');
    expect(page).toContain("<strong>Hvorfor:</strong> Advokat kræver svar inden fredag");
    expect(page.indexOf("Kritiske mails")).toBeLessThan(page.indexOf("<h2>Indbakke"));
    expect(page).toContain('<span class="kind urgent">Kritisk</span>');
  });

  it("does not flood: an old mail is not announced, a failed send is tried again, and no Telegram means nothing happens", async () => {
    const { db, services, env, mail } = await setup(ids => ids.map(id => ({ id, enquiry: false, urgent: true, why: "Haster" })));
    await mail("old", "Gammel klage", "x@example.com", NOW - 5 * 86_400_000);
    await mail("new", "Ny klage", "y@example.com");
    await scanEnquiries(env, deps(services.fetcher, NOW), db);
    expect(services.calls.filter(c => c.url.includes("sendMessage"))).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_mail WHERE urgent_why IS NOT NULL AND urgent_notified_ms IS NULL").first()).toEqual({ n: 1 });
    // Without a bot or an owner, nothing is sent and nothing is marked.
    expect(await tellChairAboutUrgentMail({ ...env, SAGA_OWNER_TELEGRAM_ID: "" }, deps(services.fetcher, NOW), db)).toBe(0);
  });

  it("scans every quarter of an hour on weekdays, not at the weekend", async () => {
    const { db, services, env, mail } = await setup(ids => ids.map(id => ({ id, enquiry: false, urgent: false })));
    await mail("m1", "Hej");
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };
    const AI = () => services.calls.filter(c => /anthropic|openai|completions|messages/.test(c.url)).length;
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW), db, claim);
    const first = AI();
    expect(first).toBeGreaterThan(0);
    await mail("m2", "Hej igen");
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW + 5 * 60_000), db, claim); // the same quarter
    expect(AI()).toBe(first);
    await scheduledEnquiryScan(env, deps(services.fetcher, NOW + 16 * 60_000), db, claim); // the next
    expect(AI()).toBeGreaterThan(first);
    const saturday = Date.parse("2026-10-10T10:00:00Z");
    const before = AI();
    await mail("m3", "Lørdag");
    await scheduledEnquiryScan(env, deps(services.fetcher, saturday), db, claim);
    expect(AI()).toBe(before);
  });
});
