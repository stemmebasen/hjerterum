import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { listTeachers } from "./teachers.js";
import { contactSuggestions, looseKey, phonesIn } from "./teacherSuggestions.js";
import { insertMail } from "../saga/store.js";
import { deps, fakeServices, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Hvordan finder systemet ikke selv e-mails?" - "Ja" to looking through the mails to team@ and the member lists for the mail and phone
// of the teachers the system has no contact for, each suggestion accepted or declined by the board.
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-06T10:00:00Z");
const DAY = 86_400_000;

async function calendar(db: D1Database, id: string, host: string) {
  await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, category, description, content_hash, updated_at_ms) VALUES (?, 'Yoga', ?, ?, 'Yoga & Meditation', 'x', 'h', 1)").bind(id, NOW - DAY, host).run();
}

describe("Forslag til kontakt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches on first and last name without capitals, accents and initials", () => {
    expect(looseKey("Karítas E. Langkjær")).toBe("karitas langkjaer");
    expect(looseKey("KARITAS LANGKJÆR")).toBe("karitas langkjaer");
    expect(looseKey("Søren Åbo-Jensen")).toBe("soren jensen");
    expect(looseKey("Soren Jensen")).toBe("soren jensen");
    expect(looseKey("Madhu")).toBe("");
    expect(looseKey("")).toBe("");
  });

  it("reads Danish phone numbers written in groups, and not dates or other numbers", () => {
    expect(phonesIn("Ring på +45 12 34 56 78 eller 87 65 43 21 - møde 12.10.2026, ref 20261002, kr. 1.250,00")).toEqual(["+45 12 34 56 78", "87 65 43 21"]);
    expect(phonesIn("Tlf 1234 5678.")).toEqual(["1234 5678"]);
    expect(phonesIn("+4512345678")).toEqual(["+4512345678"]);
    expect(phonesIn("Den 20261002 kl. 10")).toEqual([]);
  });

  it("suggests what the mails and the member lists know, saves only what the board accepts and does not bring a declined one back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    await calendar(db, "1", "Karítas E. Langkjær");
    await calendar(db, "2", "Ole Nielsen");
    await calendar(db, "3", "Pia Sørensen");
    await calendar(db, "4", "Rasmus Ukendt");
    await calendar(db, "5", "Anna Hansen");
    await calendar(db, "6", "Anna K. Hansen");
    await insertMail(db, { ref: "m1", sender: "\"Karitas Langkjær\" <karitas@example.com>", subject: "Nye datoer", receivedAtMs: NOW - 2 * DAY, preview: "Tak! Mvh Karitas, mobil 12 34 56 78", nowMs: NOW });
    await insertMail(db, { ref: "m2", sender: "Hjerterum Team <team@holistisk.org>", subject: "Karitas Langkjær", receivedAtMs: NOW - DAY, preview: "Ring til 99 99 99 99", nowMs: NOW });
    await insertMail(db, { ref: "m3", sender: "Anna Hansen <anna@example.com>", subject: "Hej", receivedAtMs: NOW - DAY, preview: "-", nowMs: NOW });
    await db.prepare("INSERT INTO membership_import_batches (source, filename, imported_by_email, started_at_ms) VALUES ('membershipworks', 'f.csv', 'a@b.dk', 1)").run();
    await db.prepare(`INSERT INTO external_memberships (source, normalized_email, full_name, raw_json, first_seen_at_ms, last_seen_at_ms, last_changed_at_ms, last_import_batch_id)
      VALUES ('membershipworks', 'ole@example.com', 'Ole K. Nielsen', '{}', 1, 1, 1, 1)`).run();
    await db.prepare("INSERT INTO teachers (name, email, phone, created_at_ms, updated_at_ms) VALUES ('Pia Sørensen', 'pia@example.com', NULL, 1, 1)").run();
    // Pia's mail is known exactly (the website's register): only a phone number would be missing - and none is found.

    const suggestions = await contactSuggestions(db, await listTeachers(db, NOW));
    expect(suggestions.map(s => [s.name, s.kind, s.value])).toEqual([
      ["Karítas E. Langkjær", "mail", "karitas@example.com"],
      ["Karítas E. Langkjær", "telefon", "12 34 56 78"],
      ["Ole Nielsen", "mail", "ole@example.com"]
    ]);
    // Two teachers with the same first and last name: whose mail it is cannot be told, so nothing is suggested. The mail to team@ gives nothing either.
    expect(suggestions.some(s => s.name.startsWith("Anna"))).toBe(false);
    expect(suggestions[0]!.from).toContain("skrev til team@ den 4. okt. 2026 som »Karitas Langkjær« (»Nye datoer«)");
    expect(suggestions[1]!.from).toContain("står i mailen fra »Karitas Langkjær«");

    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const services = fakeServices({});
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");

    const list = await (await call("/arrangementer/undervisere", { cookie })).text();
    expect(list).toContain('href="/arrangementer/undervisere/forslag"');
    const page = await (await call("/arrangementer/undervisere/forslag", { cookie })).text();
    expect(page).toContain("Mail: karitas@example.com");
    expect(page).toContain("Telefon: 12 34 56 78");
    expect(page).toContain("Mail: ole@example.com");
    expect(page).not.toContain("99 99 99 99");
    // Nothing is saved before the board says so.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_teachers").first<{ n: number }>().then(r => r?.n)).toBe(0);

        const used = await call("/arrangementer/undervisere/forslag", { method: "POST", cookie, body: form({ action: "accept", key: "karítas e. langkjær", kind: "mail", value: "karitas@example.com" }) });
    expect(used.headers.get("location")).toBe("/arrangementer/undervisere/forslag?besked=brugt");
    expect(await db.prepare("SELECT email, phone, updated_by FROM cockpit_teachers WHERE key = 'karítas e. langkjær'").first()).toEqual({ email: "karitas@example.com", phone: null, updated_by: "Lisbeth" });
    // The phone number is still on offer after the mail was accepted, and accepted separately - the mail already saved stays.
    const after = await (await call("/arrangementer/undervisere/forslag?besked=brugt", { cookie })).text();
    expect(after).toContain("Gemt som underviserens kontakt.");
    expect(after).not.toContain("Mail: karitas@example.com");
    expect(after).toContain("Telefon: 12 34 56 78");
    await call("/arrangementer/undervisere/forslag", { method: "POST", cookie, body: form({ action: "accept", key: "karítas e. langkjær", kind: "telefon", value: "12 34 56 78" }) });
    expect(await db.prepare("SELECT email, phone FROM cockpit_teachers WHERE key = 'karítas e. langkjær'").first()).toEqual({ email: "karitas@example.com", phone: "12 34 56 78" });

    // Nej tak: Ole's suggestion does not come back.
    const declined = await call("/arrangementer/undervisere/forslag", { method: "POST", cookie, body: form({ action: "decline", key: "ole nielsen", kind: "mail", value: "ole@example.com" }) });
    expect(declined.headers.get("location")).toBe("/arrangementer/undervisere/forslag?besked=afvist");
    expect(await contactSuggestions(db, await listTeachers(db, NOW))).toEqual([]);
    expect(await db.prepare("SELECT value, declined_by FROM cockpit_teacher_declined").first()).toEqual({ value: "ole@example.com", declined_by: "Lisbeth" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_teachers WHERE key = 'ole nielsen'").first<{ n: number }>().then(r => r?.n)).toBe(0);

    // Made-up values and unknown teachers change nothing.
    await call("/arrangementer/undervisere/forslag", { method: "POST", cookie, body: form({ action: "accept", key: "ole nielsen", kind: "mail", value: "ikke en mail" }) });
    await call("/arrangementer/undervisere/forslag", { method: "POST", cookie, body: form({ action: "accept", key: "nogen ukendt", kind: "mail", value: "x@example.com" }) });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_teachers").first<{ n: number }>().then(r => r?.n)).toBe(1);
    const empty = await (await call("/arrangementer/undervisere/forslag", { cookie })).text();
    expect(empty).toContain("Ingen forslag lige nu.");
  });
});
