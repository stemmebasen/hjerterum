import { describe, expect, it } from "vitest";
import { handleSagaRequest } from "./handler.js";
import { clip, sagaBrief, type Brief } from "./brief.js";
import { createPostDraft, insertMail, queueMinutes, saveBoardMessage, setServiceStatus, updateMinutes } from "./store.js";
import { createProposal } from "../cockpit/votes.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "./test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Byg en brief til Matrix' startside (Jacobs eget system). Matrix henter den mandag-fredag kl. 09, 12 og 16 dansk
// tid og ved tryk på Opdatér. Svar inden 20 sekunder." Clear when: "200 med gyldig JSON, 401 uden nøgle, tom items når intet
// kræver Jacob, hvert punkt forståeligt alene, svar under 20 sekunder." Everyone here is made up.

const NOW = Date.parse("2026-10-05T07:00:00Z"); // Monday
const DAY = 86_400_000;
const TARGET = /^(hjerterum|reminders|cockpit(:[a-z0-9/_-]+)?|url:https:\/\/([a-z0-9-]+\.)*hjerterum\.info\/\S*)$/;

const brief = (db: D1Database, key: string | null = "liva-secret") => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/brief", {
  headers: key ? { authorization: `Bearer ${key}` } : {} }), sagaEnv(db), deps(fakeServices().fetcher, NOW));

async function chairAndBoard(db: D1Database) {
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
}

describe("Saga's brief for Matrix' front page", () => {
  it("answers only behind the key, in JSON, and says plainly when nothing needs the chair", async () => {
    const db = testDatabase();
    await chairAndBoard(db);
    for (const key of [null, "wrong-secret", "liva-secre"]) expect((await brief(db, key)).status).toBe(401);
    const response = await brief(db);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json() as Brief;
    expect(body).toEqual({ at: "2026-10-05T07:00:00.000Z", lead: "Intet, der kræver dig.", items: [] });
    // Other methods are not briefs.
    const post = await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/brief", { method: "POST", headers: { authorization: "Bearer liva-secret" } }), sagaEnv(db), deps(fakeServices().fetcher, NOW));
    expect(post.status).toBe(404);
  });

  it("lists what the chair must do or should soon, most important first, each point readable alone, with allowed targets", async () => {
    const db = testDatabase();
    await chairAndBoard(db);
    // Minutes and a post waiting for his yes.
    const draft = (await queueMinutes(db, { source: "telegram", fileId: "f1", fileName: "møde.m4a", mimeType: null, meetingDate: "2026-09-30", nowMs: NOW - 3 * DAY }))!;
    await updateMinutes(db, draft, { status: "drafted", draft: "# Referat\n## Beslutninger\n- Budget vedtaget" }, NOW - 3 * DAY);
    // A vote that closes in two days.
    await createProposal(db, { title: "Skal vi leje en ekstra lagerplads til stole og borde i Guldsmedgade?", text: "Forslag", days: 2, who: "Lisbeth", members: 3 }, NOW);
    // Approved minutes he has not signed.
    const approved = (await queueMinutes(db, { source: "telegram", fileId: "f2", fileName: "a.m4a", mimeType: null, meetingDate: "2026-09-23", nowMs: NOW - 10 * DAY }))!;
    await updateMinutes(db, approved, { status: "approved", draft: "# Referat" }, NOW - 10 * DAY);
    // A meeting on Wednesday with no agenda, and one last week with nothing registered.
    await db.prepare("INSERT INTO board_meetings (meeting_date, start_time, agenda, created_at_ms, updated_at_ms) VALUES ('2026-10-07', '19:00', '', ?, ?), ('2026-10-01', '19:00', 'Budget', ?, ?)").bind(NOW, NOW, NOW, NOW).run();
    // A recording that failed.
    const failed = (await queueMinutes(db, { source: "upload", fileId: "f3", fileName: "b.m4a", mimeType: null, meetingDate: "2026-09-16", nowMs: NOW - 4 * DAY }))!;
    await updateMinutes(db, failed, { status: "failed", error: "ai_failed" }, NOW - 4 * DAY);
    // Two important mails in team@ that have waited five days, and a fresh one.
    for (const [i, age] of [[1, 5], [2, 6], [3, 0.2]] as const) {
      const id = (await insertMail(db, { ref: `m${i}`, sender: `Hemmelig Afsender ${i} <afsender${i}@example.com>`, subject: `Privat emne ${i}`, receivedAtMs: NOW - age * DAY, preview: "Tekst", nowMs: NOW }))!;
      await db.prepare("UPDATE board_mail SET enquiry_kind = 'leje', scanned_at_ms = ? WHERE id = ?").bind(NOW, id).run();
    }
    // A member event waiting for the board, starting on Thursday.
    await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, review_status, created_at_ms, updated_at_ms)
      VALUES ('u1', 'Mette Holm', 'mette@example.dk', 'Yin yoga', ?, ?, 'pending', ?, ?)`).bind(NOW + 3 * DAY, NOW + 3 * DAY + 7_200_000, NOW, NOW).run();
    // Saga's connections: the mail watch stopped, and her AI answered with an error.
    await setServiceStatus(db, "team_mail", true, "0 nye i indbakken", NOW - 3 * 3_600_000);
    await setServiceStatus(db, "ai", false, "529 overloaded", NOW - 3_600_000);
    await db.prepare("INSERT INTO board_now (text, newest_source_ms, created_at_ms) VALUES (?, ?, ?)")
      .bind("Roligt i gruppen. Budgettet fylder mest, og Lisbeth venter på svar om lageret. Det skriver Matrix også. Mere tekst her.", NOW - 3_600_000, NOW - 3_600_000).run();

    const body = await (await brief(db)).json() as Brief;
    const weights = body.items.map(i => i.weight);
    expect(weights).toEqual([...weights].sort((a, b) => ["must", "should", "fyi"].indexOf(a) - ["must", "should", "fyi"].indexOf(b)));
    const texts = body.items.map(i => i.text);
    expect(body.items.length).toBeLessThanOrEqual(10);
    for (const expected of [
      "Referatet fra 30. september venter på dit ja", "Afstemning: «Skal vi leje en ekstra lagerplads",
      "Godkend referatet fra 23. september", "Mødet onsdag den 7. oktober kl. 19:00 har ingen dagsorden", "Optagelsen fra 16. september blev ikke til et referat",
      "2 vigtige mails i team@ har ventet på svar i mere end tre dage", "1 medlems-event venter på bestyrelsens godkendelse", "Saga har ikke set noget referat eller nogen optagelse fra mødet 1. oktober"
    ]) expect(texts.some(t => t.startsWith(expected)), expected).toBe(true);
    expect(body.items.find(i => i.text.startsWith("Referatet fra 30. september"))).toMatchObject({ weight: "must", action: { kind: "open", target: "hjerterum" } });
    expect(body.items.find(i => i.text.startsWith("Afstemning: «Skal vi"))).toMatchObject({ weight: "must", action: { kind: "open", target: "cockpit:beslutninger" } });
    expect(body.items.find(i => i.text.startsWith("Mødet onsdag"))).toMatchObject({ weight: "should", action: { kind: "write", label: "Foreslå dagsorden" } });
    expect(body.items.find(i => i.text.includes("medlems-event"))).toMatchObject({ weight: "must" });
    expect(body.items.find(i => i.text.startsWith("Sagas AI"))).toMatchObject({ weight: "should" });
    expect(body.items.find(i => i.text.startsWith("team@ er ikke blevet tjekket"))).toMatchObject({ weight: "should", action: { target: "cockpit:posthus" } });

    // Mood: the first two sentences of Saga's own line, and a sentence that names Matrix is left out.
    expect(body.lead).toBe("Roligt i gruppen. Budgettet fylder mest, og Lisbeth venter på svar om lageret.");
    expect(JSON.stringify(body)).not.toMatch(/matrix/i);
    // team@ is only counted: no sender, subject or text.
    expect(JSON.stringify(body)).not.toMatch(/Hemmelig|afsender|Privat emne/i);

    // The limits of the format.
    expect(body.lead!.length).toBeLessThanOrEqual(300);
    for (const point of body.items) {
      expect(point.text.length).toBeGreaterThan(0);
      expect(point.text.length).toBeLessThanOrEqual(240);
      if (point.why) expect(point.why.length).toBeLessThanOrEqual(200);
      if (!point.action) continue;
      expect(["open", "write", "run"]).toContain(point.action.kind);
      expect(point.action.label.length).toBeGreaterThanOrEqual(2);
      expect(point.action.label.length).toBeLessThanOrEqual(40);
      if (point.action.kind === "open") { expect(point.action.target).toMatch(TARGET); expect(point.action.prompt).toBeUndefined(); }
      else { expect(point.action.prompt!.length).toBeLessThanOrEqual(600); expect(point.action.target).toBeUndefined(); }
    }
  });

  it("asks for the chair's yes to a post, and treats a vote with a distant deadline as something to do soon", async () => {
    const db = testDatabase();
    await chairAndBoard(db);
    await createPostDraft(db, { kind: "weekly_summary", text: "Ugen der gik", nowMs: NOW - DAY });
    await createProposal(db, { title: "Nyt navn til caféen", text: "Forslag", days: 20, who: "Gitta", members: 3 }, NOW);
    const body = await (await brief(db)).json() as Brief;
    expect(body.items.map(i => [i.weight, i.text.replace(/ - frist .*/, "")])).toEqual([
      ["must", "Et opslag til bestyrelsens gruppe venter på dit ja"], ["should", "Afstemning: «Nyt navn til caféen»"]]);
    expect(body.items[1]!.text).toBe("Afstemning: «Nyt navn til caféen» - frist søndag den 25. oktober");
  });

  it("does not repeat the chair's own tasks, and shows a quiet week as an empty list", async () => {
    const db = testDatabase();
    await chairAndBoard(db);
    await db.prepare("INSERT INTO cockpit_todos (owner, text, created_by, created_at_ms) VALUES ('Jacob Hauge', 'Ring til revisor', 'Jacob Hauge', ?)").bind(NOW).run();
    const body = await (await brief(db)).json() as Brief;
    expect(body.items).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("revisor");
  });

  it("keeps ten points at most, the most important kept, and tells when a part could not be read", async () => {
    const db = testDatabase();
    await chairAndBoard(db);
    for (let i = 0; i < 6; i++) {
      await createProposal(db, { title: `Forslag ${i}`, text: "x", days: 1, who: "Lisbeth", members: 3 }, NOW);
      const id = (await queueMinutes(db, { source: "telegram", fileId: `d${i}`, fileName: "m.m4a", mimeType: null, meetingDate: `2026-09-0${i + 1}`, nowMs: NOW - DAY }))!;
      await updateMinutes(db, id, { status: "drafted", draft: "# Referat" }, NOW - DAY);
    }
    await createPostDraft(db, { kind: "weekly_summary", text: "Ugen der gik", nowMs: NOW - DAY });
    const signed = (await queueMinutes(db, { source: "telegram", fileId: "ok", fileName: "a.m4a", mimeType: null, meetingDate: "2026-09-23", nowMs: NOW - 4 * DAY }))!;
    await updateMinutes(db, signed, { status: "approved", draft: "# Referat" }, NOW - 4 * DAY);
    const lost = (await queueMinutes(db, { source: "upload", fileId: "lost", fileName: "b.m4a", mimeType: null, meetingDate: "2026-09-16", nowMs: NOW - 4 * DAY }))!;
    await updateMinutes(db, lost, { status: "failed", error: "ai_failed" }, NOW - 4 * DAY);
    await db.prepare("INSERT INTO board_meetings (meeting_date, start_time, agenda, created_at_ms, updated_at_ms) VALUES ('2026-10-06', '19:00', '', ?, ?), ('2026-10-01', '19:00', 'Budget', ?, ?)").bind(NOW, NOW, NOW, NOW).run();
    const broken: D1Database = { prepare: (query: string) => { if (query.includes("FROM board_mail")) throw new Error("db_down"); return db.prepare(query); } };
    const body = await sagaBrief(sagaEnv(broken), broken, NOW);
    expect(body.items.length).toBe(10);
    // More than ten things need him; the ten most important are kept, the musts first.
    expect(body.items.every(i => i.weight === "must" || i.weight === "should")).toBe(true);
    expect(body.items.filter(i => i.weight === "must").length).toBe(8);
    expect(body.items.slice(0, 8).every(i => i.weight === "must")).toBe(true);
    const emptyDb = testDatabase();
    const brokenEmpty: D1Database = { prepare: (query: string) => { if (query.includes("FROM board_mail")) throw new Error("db_down"); return emptyDb.prepare(query); } };
    expect((await sagaBrief(sagaEnv(brokenEmpty), brokenEmpty, NOW)).items).toEqual([
      { weight: "fyi", text: "Saga kunne ikke læse team@ lige nu, så listen kan mangle punkter" }]);
  });

  it("cuts long text at a word", () => {
    expect(clip("kort", 10)).toBe("kort");
    const long = clip("Et meget langt forslag om at leje lagerplads til alle stolene i hele huset", 30);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith("…")).toBe(true);
    expect(long).toBe("Et meget langt forslag om at…");
  });
});
