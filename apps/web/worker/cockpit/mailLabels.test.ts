import { describe, expect, it } from "vitest";
import { labelUnlabelled, scanEnquiries, setLabel } from "./enquiries.js";
import { handleCockpitRequest } from "./handler.js";
import { translateHtml } from "./i18n.js";
import { insertMail } from "../saga/store.js";
import { deps, fakeServices, memberCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "I Posthus kan du lave forskellige mærkater, for eksempel medlem, event, generel og økonomi, og gøre det muligt at sortere under de forskellige mærkater. Kom også gerne med andre forslag for at gøre det mere overskueligt."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-09T10:00:00Z");

describe("labels in Posthus", () => {
  const setup = () => {
    const db = testDatabase();
    const asked: string[] = [];
    const services = fakeServices({ ai: (sys, user) => {
      const mails = JSON.parse(user) as Array<{ id: number; subject: string }>;
      asked.push(sys.includes("forespørgsel") ? "scan" : "labels");
      const label = (subject: string) => /kontingent|medlem/i.test(subject) ? "Medlem" : /faktura|betaling/i.test(subject) ? "Økonomi" : /yoga|kursus/i.test(subject) ? "Event" : /nyhedsbrev/i.test(subject) ? "Automatisk" : "Generel";
      return JSON.stringify({ items: mails.map(m => sys.includes("forespørgsel") ? { id: m.id, enquiry: false, urgent: false, label: label(m.subject) } : { id: m.id, label: label(m.subject) }) });
    } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const mail = (ref: string, subject: string, at = NOW - 3_600_000) => insertMail(db, { ref, sender: `Afsender <${ref}@example.com>`, subject, receivedAtMs: at, preview: "Tekst", nowMs: NOW }).then(id => id!);
    const cookie = async () => {
      const f = new FormData(); f.append("password", "hjerte-2026");
      const login = await handleCockpitRequest(new Request(`${ORIGIN}/login`, { method: "POST", headers: { origin: ORIGIN }, body: f }), env, deps(services.fetcher, NOW));
      return memberCookie((login.headers.get("set-cookie") ?? "").split(";")[0]!, "Jacob Hauge");
    };
    const call = async (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), cookie: await cookie() } }), env, deps(services.fetcher, NOW));
    return { db, env, services, mail, call, asked };
  };

  it("labels every new mail in the same scan, counts them, sorts by label and lets a member change one - for good", async () => {
    const { db, env, services, mail, call, asked } = setup();
    const a = await mail("a", "Kontingent for oktober"), b = await mail("b", "Faktura 1234"), c = await mail("c", "Yoga i november"), d = await mail("d", "Nyhedsbrev fra banken");
    await scanEnquiries(env, deps(services.fetcher, NOW), db);
    expect(asked[0]).toBe("scan");
    expect(await db.prepare("SELECT id, label FROM board_mail ORDER BY id").all()).toMatchObject({ results: [{ id: a, label: "Medlem" }, { id: b, label: "Økonomi" }, { id: c, label: "Event" }, { id: d, label: "Automatisk" }] });
    // The chips with how many each has; "Økonomi" shows only its mails.
    const all = await (await call("/posthus")).text();
    expect(all).toContain('<a href="/posthus" aria-current="page">Alle<small>4</small></a>');
    for (const l of ["Medlem", "Økonomi", "Event", "Generel", "Automatisk"]) expect(all).toContain(`>${l}<small>`);
    expect(all).toContain('<span class="kind label">Økonomi</span>');
    const money = await (await call("/posthus?maerkat=%C3%98konomi")).text();
    expect(money).toContain('<a href="/posthus?maerkat=%C3%98konomi" aria-current="page">Økonomi<small>1</small></a>');
    expect(money).toContain("Faktura 1234");
    expect(money).not.toContain("Yoga i november");
    // A member changes one: it stays, also when Saga labels the rest again.
    const changed = await call("/posthus/maerkat", { method: "POST", body: (() => { const f = new FormData(); f.append("id", String(d)); f.append("label", "Økonomi"); f.append("back", ""); return f; })() });
    expect(changed.headers.get("location")).toBe("/posthus");
    expect(await db.prepare("SELECT label FROM board_mail WHERE id = ?").bind(d).first()).toEqual({ label: "Økonomi" });
    await db.prepare("UPDATE board_mail SET label = NULL WHERE id = ?").bind(a).run();
    expect(await labelUnlabelled(env, deps(services.fetcher, NOW), db)).toBe(1);
    expect(await db.prepare("SELECT id, label FROM board_mail WHERE id IN (?, ?) ORDER BY id").bind(a, d).all()).toMatchObject({ results: [{ id: a, label: "Medlem" }, { id: d, label: "Økonomi" }] });
    // Nothing but the five labels is accepted.
    expect(await setLabel(db, a, "Hemmeligt")).toBe(false);
    expect(await setLabel(db, a, "")).toBe(true);
    expect(await db.prepare("SELECT label FROM board_mail WHERE id = ?").bind(a).first()).toEqual({ label: null });
  });

  it("gives the mails from before labels a label, newest first, without touching the ones that have one", async () => {
    const { db, env, services, mail, asked } = setup();
    const old = await mail("old", "Medlem siger op", NOW - 20 * 86_400_000), had = await mail("had", "Faktura", NOW - 86_400_000);
    await db.prepare("UPDATE board_mail SET label = 'Generel' WHERE id = ?").bind(had).run();
    expect(await labelUnlabelled(env, deps(services.fetcher, NOW), db)).toBe(1);
    expect(asked).toEqual(["labels"]);
    expect(await db.prepare("SELECT id, label FROM board_mail ORDER BY id").all()).toMatchObject({ results: [{ id: old, label: "Medlem" }, { id: had, label: "Generel" }] });
    expect(await labelUnlabelled(env, deps(services.fetcher, NOW), db)).toBe(0);
  });

  it("has the chips and the search in English", () => {
    const en = translateHtml('<nav aria-label="Mærkater"></nav><input type="search" placeholder="Søg i afsender og emne" aria-label="Søg i mails"><label>Mærkat <select><option value="">Intet</option><option>Økonomi</option></select></label>');
    for (const text of ['aria-label="Labels"', 'placeholder="Search sender and subject"', "Label ", ">None<", ">Finance<"]) expect(en).toContain(text);
  });
});
