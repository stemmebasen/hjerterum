import { describe, expect, it } from "vitest";
import { CONVERSATION_GAP_MS, conversations, sagaTranscript, transcriptText, type SagaTurn } from "./samtaler.js";
import { testDatabase } from "../saga/test-support.js";

// Requested by the chair as super admin: "Lad mig også se chatudskrift" - what the board's members asked Saga.

const NOW = Date.parse("2026-10-06T12:00:00Z");
const MIN = 60_000;
const turn = (id: number, who: string, atMs: number, question = `Spørgsmål ${id}`): SagaTurn => ({ id, who, question, answer: `Svar ${id}`, atMs });

describe("conversations", () => {
  it("puts one person's questions less than 30 minutes apart in one conversation, newest conversation first", () => {
    const list = conversations([
      turn(1, "Lisbeth", NOW - 300 * MIN), turn(2, "Lisbeth", NOW - 290 * MIN), turn(3, "Lisbeth", NOW - 290 * MIN + CONVERSATION_GAP_MS + MIN),
      turn(4, "Gitta", NOW - 295 * MIN), turn(5, "Gitta", NOW - 10 * MIN)
    ]);
    expect(list.map(c => [c.who, c.turns.map(t => t.id)])).toEqual([["Gitta", [5]], ["Lisbeth", [3]], ["Gitta", [4]], ["Lisbeth", [1, 2]]]);
    expect(list[3]!.startMs).toBe(NOW - 300 * MIN);
    expect(list[3]!.endMs).toBe(NOW - 290 * MIN);
  });
});

describe("the transcript from the database", () => {
  async function filled() {
    const db = testDatabase();
    const add = (who: string | null, question: string, answer: string | null, at: number) =>
      db.prepare("INSERT INTO cockpit_questions (asked_by, question, answer, created_at_ms) VALUES (?, ?, ?, ?)").bind(who, question, answer, at).run();
    await add("Lisbeth", "Hvornår er generalforsamlingen?", "Den er **den 12. marts**.", NOW - 3 * 3600_000);
    await add("Lisbeth", "Og hvem indkalder?", "Formanden.", NOW - 3 * 3600_000 + 5 * MIN);
    await add("Gitta", "Hvad koster en leje?", "- 100 kr.\n- 200 kr.", NOW - 86_400_000);
    await add(null, "Hej?", null, NOW - 2 * 86_400_000);
    return db;
  }

  it("lists the askers with how many each asked, and filters by member and by word", async () => {
    const db = await filled();
    const all = await sagaTranscript(db, {});
    expect(all.askers.map(a => [a.who, a.n])).toEqual([["Lisbeth", 2], ["Gitta", 1], ["Ukendt", 1]]);
    expect(all.turns).toBe(4);
    expect(all.more).toBe(false);
    expect((await sagaTranscript(db, { who: "Gitta" })).conversations.map(c => c.who)).toEqual(["Gitta"]);
    expect((await sagaTranscript(db, { who: "Ukendt" })).conversations.map(c => c.who)).toEqual(["Ukendt"]);
    expect((await sagaTranscript(db, { q: "generalforsamling" })).conversations.flatMap(c => c.turns.map(t => t.id))).toHaveLength(1);
    // A search word is a word, not a pattern: "%" and "_" match themselves only.
    expect((await sagaTranscript(db, { q: "%" })).turns).toBe(0);
  });

  it("reads as plain text with each question and answer", async () => {
    const text = transcriptText((await sagaTranscript(await filled(), { who: "Lisbeth" })).conversations, NOW);
    expect(text).toContain("Samtaler med Saga - udskrevet");
    expect(text).toContain("Lisbeth: Hvornår er generalforsamlingen?");
    expect(text).toContain("Saga: Den er **den 12. marts**.");
    expect(text).toContain("Lisbeth: Og hvem indkalder?");
    expect(text).not.toContain("Gitta");
  });
});
