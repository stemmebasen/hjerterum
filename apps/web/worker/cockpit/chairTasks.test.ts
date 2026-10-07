import { describe, expect, it } from "vitest";
import { addTodo } from "./data.js";
import { chairItemDone, chairItems } from "./chairTasks.js";
import { decideMinutes, queueMinutes, saveBoardMessage, saveOverview, updateMinutes } from "../saga/store.js";
import { BOARD, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Please also delete duplicates when it comes to to-dos." - Matrix shows the chair's list too.
const NOW = Date.parse("2026-10-07T10:00:00Z");

describe("the chair's list in Matrix", () => {
  it("shows the same task once, however many places it is written, and checking it takes them all", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, {});
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const picture = { summary: "Roligt.", temperature: { level: "god", why: "" }, topics: [],
      document: { latestMeeting: "1/10", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] },
      forJacob: [{ key: "k1", kind: "opgave", text: "Send preview-link til nyt system til Douglas", source: "dokument", from: "", since: "1/10" },
        { key: "k2", kind: "spørgsmål", text: "Skal vi svare Thomas Emil?", source: "telegram", from: "Blanka", since: "" }], forMembers: [] };
    await saveOverview(db, picture.summary, NOW, { data: JSON.stringify(picture), docHash: "x" });
    const minutes = (await queueMinutes(db, { source: "telegram", fileId: "f1", fileName: "møde.m4a", mimeType: "audio/mp4", meetingDate: "2026-10-01", nowMs: NOW }))!;
    await updateMinutes(db, minutes, { status: "drafted", draft: "# Referat\n## Opgaver\n- Jacob - Send preview-link til nyt system til Douglas - 12. oktober" }, NOW);
    await decideMinutes(db, minutes, "approved", NOW);
    await addTodo(db, { owner: "Jacob Hauge", text: "Send preview link til det nye system til Douglas", due: null, createdBy: "Jacob Hauge" }, NOW);

    const before = await chairItems(env, db, NOW);
    expect(before.items.map(i => i.text)).toEqual(["Send preview-link til nyt system til Douglas", "Skal vi svare Thomas Emil?"]);
    expect(await chairItemDone(env, db, before.items[0]!.key, NOW)).toBe(true);
    // All three places are done: Saga's list, the minutes' task and the written to-do.
    expect((await chairItems(env, db, NOW)).items.map(i => i.text)).toEqual(["Skal vi svare Thomas Emil?"]);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM cockpit_task_checks").first<{ n: number }>())?.n).toBe(1);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos").first<{ done_at_ms: number | null }>())?.done_at_ms).toBe(NOW);
  });
});
