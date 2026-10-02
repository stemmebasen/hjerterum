import { describe, expect, it } from "vitest";
import { draftOverview } from "./saga.js";
import { latestOverview, saveBoardMessage, saveOverview } from "./store.js";
import { boardPicture } from "../cockpit/data.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Reported (screenshot): the cockpit greeted "Hej Jacob" with "```json {" - Saga's overview was cut off
// mid-JSON, and the broken answer was kept as the overview's text.
const NOW = Date.parse("2026-10-02T10:00:00Z");
const GOOD = '{"summary":"- Travlt op mod generalforsamlingen.","topics":[],"document":{},"forJacob":[]}';

describe("an overview cut off mid-JSON", () => {
  it("is never shown: the last good overview stands, and Saga tries once more, shorter", async () => {
    const db = testDatabase();
    await saveOverview(db, "- Roligt i gruppen.", NOW - 3_600_000, { data: JSON.stringify({ summary: "- Roligt i gruppen.", temperature: null, topics: [], document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] }, forJacob: [] }), docHash: "a" });
    // An old broken row, as in production: skipped.
    await saveOverview(db, '```json\n{\n  "summary": "**Bestyrelsen**\\n- Travlt', NOW - 60_000, { data: null, docHash: "b" });
    expect((await boardPicture(db, NOW)).summary).toBe("- Roligt i gruppen.");
    expect((await latestOverview(db))?.text).toBe("- Roligt i gruppen.");

    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Lisbeth", authorId: "201", text: "GF 14. okt.", sentAtMs: NOW - 1000, fromAssistant: false });
    let calls = 0;
    const cut = fakeServices({ ai: () => { calls++; return '```json\n{\n  "summary": "- Travlt op mod gener'; } });
    await draftOverview(sagaEnv(db), deps(cut.fetcher, NOW));
    expect(calls).toBe(2);
    expect((await boardPicture(db, NOW)).summary).toBe("- Roligt i gruppen.");

    let tries = 0;
    const retry = fakeServices({ ai: () => (++tries === 1 ? '```json\n{"summary": "- Trav' : GOOD) });
    await draftOverview(sagaEnv(db), deps(retry.fetcher, NOW + 1000));
    expect((await boardPicture(db, NOW + 1000)).summary).toBe("- Travlt op mod generalforsamlingen.");
  });
});
