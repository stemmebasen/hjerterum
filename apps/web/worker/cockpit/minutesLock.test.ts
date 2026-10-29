import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { addCorrection, answerQuestion, handleCorrection } from "./corrections.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookies } from "../saga/test-support.js";

// Requested: "Når et referat er blevet godkendt af alle bestyrelsesmedlemmer, skal det låses fast, ingen ændringer mulige."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-12T10:00:00Z");
const DAY = 86_400_000;
const DRAFT = "## Punkter\n### 1. Økonomi\n- Diskussion: Vi gennemgik budgettet.\n- Beslutning: Budgettet er godkendt.\n";

describe("locked minutes", () => {
  it("locks the minutes once the whole board has approved, and nothing can change it after", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
      VALUES ('upload', 'f1', 'm.m4a', 'approved', '2026-10-08', ?, ?, ?)`).bind(DRAFT, NOW - DAY, NOW - DAY).run();
    const services = fakeServices({ ai: () => JSON.stringify({ action: "rewrite", point: "### 1. Økonomi\n- Diskussion: Ændret.", summary: "ændret" }) });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);
    const locked = async () => (await db.prepare("SELECT locked_at_ms FROM board_minutes WHERE id = 1").first<{ locked_at_ms: number | null }>())?.locked_at_ms ?? null;

    // Requested: "Referat-udkast kan tilrettes og ændres i 3 dage. Herefter kan man ikke længere ændre det: nu skal bestyrelsesmedlemmerne godkende
    // det hver især. Når alle har godkendt låses det." In the three days a point can be corrected, and no one approves yet.
    const early = await (await call("/referat/1", { cookie: as("Gitta") })).text();
    expect(early).toContain("Kan rettes til 14. oktober kl. 12.00");
    expect(early).toContain("Ret dette punkt");
    expect(early).not.toContain("Jeg godkender referatet");
    expect((await call("/referat/1/godkend", { method: "POST", cookie: as("Lisbeth") })).headers.get("location")).toBe("/referat/1?retperiode=1");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_signoffs").first()).toEqual({ n: 0 });

    // After the three days the text stands: no correction is taken, and each member approves.
    await db.prepare("UPDATE board_minutes SET created_at_ms = ? WHERE id = 1").bind(NOW - 4 * DAY).run();
    const late = await (await call("/referat/1", { cookie: as("Gitta") })).text();
    expect(late).toContain("Rettelsesperioden sluttede 11. oktober kl. 12.00.");
    expect(late).toContain("Jeg godkender referatet");
    expect(late).not.toContain("Ret dette punkt");
    const tooLate = await call("/referat/1/punkt/1", { method: "POST", cookie: as("Lisbeth"), body: form({ correction: "Budgettet blev ikke godkendt" }) });
    expect(tooLate.headers.get("location")).toBe("/referat/1?lukket=1");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_corrections").first()).toEqual({ n: 0 });

    // Two of three approve: still open.
    for (const who of ["Jacob Hauge", "Lisbeth"]) {
      const done = await call("/referat/1/godkend", { method: "POST", cookie: as(who) });
      expect(done.headers.get("location")).toBe("/referat/1?godkendt=1");
    }
    expect(await locked()).toBeNull();

    // The last one approves: locked.
    const last = await call("/referat/1/godkend", { method: "POST", cookie: as("Gitta") });
    expect(last.headers.get("location")).toBe("/referat/1?laast=1");
    expect(await locked()).toBe(NOW);
    const page = await (await call("/referat/1?laast=1", { cookie: as("Lisbeth") })).text();
    expect(page).toContain("Godkendt af alle og låst 12. oktober 2026.");
    expect(page).toContain("Referatet kan ikke længere ændres.");
    expect(page).not.toContain("Ret dette punkt");
    expect(page).not.toContain("Jeg kan ikke godkende det");

    // No correction is taken any more, from the page or from Saga's round.
    const fix = await call("/referat/1/punkt/1", { method: "POST", cookie: as("Lisbeth"), body: form({ correction: "Budgettet blev ikke godkendt" }) });
    expect(fix.headers.get("location")).toBe("/referat/1?laast=1");
    const sign = await call("/referat/1/rettelse", { method: "POST", cookie: as("Lisbeth"), body: form({ comment: "Ret det" }) });
    expect(sign.headers.get("location")).toBe("/referat/1?laast=1");
    // Requested: "Rettelser til referat punkter skal ikke gemmes efter at det specifikke referat er godkendt." - the database keeps none.
    await expect(addCorrection(db, 1, 1, "Lisbeth", "Ret det", NOW)).rejects.toThrow(/minutes_locked/);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_corrections").first()).toEqual({ n: 0 });
    expect((await db.prepare("SELECT draft_markdown FROM board_minutes WHERE id = 1").first<{ draft_markdown: string }>())?.draft_markdown).toBe(DRAFT);

    // And the database itself refuses: the text, the approval, the sign-offs and the lock.
    await expect(db.prepare("UPDATE board_minutes SET draft_markdown = 'x' WHERE id = 1").run()).rejects.toThrow(/minutes_locked/);
    await expect(db.prepare("UPDATE board_minutes SET status = 'rejected' WHERE id = 1").run()).rejects.toThrow(/minutes_locked/);
    await expect(db.prepare("UPDATE board_minutes SET locked_at_ms = NULL WHERE id = 1").run()).rejects.toThrow(/minutes_locked/);
    await expect(db.prepare("DELETE FROM board_minutes WHERE id = 1").run()).rejects.toThrow(/minutes_locked/);
    await expect(db.prepare("DELETE FROM board_minutes_signoffs WHERE minutes_id = 1").run()).rejects.toThrow(/minutes_locked/);
    await expect(db.prepare("UPDATE board_minutes_signoffs SET status = 'correction' WHERE minutes_id = 1").run()).rejects.toThrow(/minutes_locked/);
    // What is not the minutes themselves - the link to the document - may still be kept up to date.
    await db.prepare("UPDATE board_minutes SET drive_document_url = 'https://docs.example/1' WHERE id = 1").run();
  });

  // Requested: "Rettelser til referat punkter skal ikke gemmes efter at det specifikke referat er godkendt."
  it("deletes the corrections of its points when the whole board has approved the minutes", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    const add = (file: string) => db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
      VALUES ('upload', ?, ?, 'approved', '2026-10-08', ?, ?, ?)`).bind(file, file, DRAFT, NOW - DAY, NOW - DAY).run();
    await add("f1");
    await add("f2");
    let ai = JSON.stringify({ action: "rewrite", point: "### 1. Økonomi\n- Diskussion: Ændret.", summary: "budgettet præciseret" });
    const services = fakeServices({ ai: () => ai });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);
    const count = async (id: number) => (await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_corrections WHERE minutes_id = ?").bind(id).first<{ n: number }>())?.n;

    // In the three days: one correction Saga makes, one she asks about - on both sets of minutes.
    for (const id of [1, 2]) await call(`/referat/${id}/punkt/1`, { method: "POST", cookie: as("Lisbeth"), body: form({ correction: "Budgettet blev præciseret" }) });
    ai = JSON.stringify({ action: "ask", question: "Hvilket beløb?" });
    for (const id of [1, 2]) await call(`/referat/${id}/punkt/1`, { method: "POST", cookie: as("Gitta"), body: form({ correction: "Beløbet er forkert" }) });
    expect(await count(1)).toBe(2);
    expect(await (await call("/referat/1", { cookie: as("Gitta") })).text()).toContain("1 rettelse");

    // The three days pass, and everyone approves minutes 1: it locks, and its corrections are gone - the text keeps what was corrected.
    await db.prepare("UPDATE board_minutes SET created_at_ms = ?").bind(NOW - 4 * DAY).run();
    for (const who of ["Jacob Hauge", "Lisbeth", "Gitta"]) await call("/referat/1/godkend", { method: "POST", cookie: as(who) });
    expect((await db.prepare("SELECT locked_at_ms FROM board_minutes WHERE id = 1").first<{ locked_at_ms: number | null }>())?.locked_at_ms).toBe(NOW);
    expect(await count(1)).toBe(0);
    expect((await db.prepare("SELECT draft_markdown FROM board_minutes WHERE id = 1").first<{ draft_markdown: string }>())?.draft_markdown).toContain("Ændret.");
    const page = await (await call("/referat/1", { cookie: as("Gitta") })).text();
    expect(page).not.toContain("1 rettelse");
    expect(page).not.toContain("Saga har spurgt");
    expect(page).not.toContain("Saga spørger dig");

    // Nothing comes back: not an answer to the old question, not Saga's round, not a new correction.
    const question = await db.prepare("SELECT id FROM board_minutes_corrections WHERE minutes_id = 2 AND status = 'question'").first<{ id: number }>();
    expect(await answerQuestion(db, 999, "Gitta", "500 kr.", NOW)).toBe(false);
    expect(await handleCorrection(env, deps(services.fetcher, NOW), 1)).toBe("failed");
    await expect(addCorrection(db, 1, 1, "Gitta", "Ret det", NOW)).rejects.toThrow(/minutes_locked/);
    expect(await count(1)).toBe(0);

    // Minutes 2 is not approved yet: its corrections stay.
    expect(question).not.toBeNull();
    expect(await count(2)).toBe(2);
  });
});
