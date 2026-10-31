import { describe, expect, it } from "vitest";
import { testDatabase } from "./saga/test-support.js";
import { GUIDE_PREFIX, openConversation, saveConversation } from "./web-saga.js";

// Reported: "Chat widget springer op ad sig selv. Og så spørger hun om jeg vil fortsætte. Men det forrige event er jo allerede oprettet?"
describe("Opret med Saga has conversations of its own", () => {
  it("starts a new guide conversation, continues only its own, and is never the bubble's latest", async () => {
    const db = await testDatabase();
    const now = Date.now();
    // The member's chat in the bubble.
    await saveConversation(db, "bubble-conversation-0000001", "user_1", [{ role: "user", text: "Hej" }], now - 1000);
    // A guide starts fresh - not in the bubble's conversation.
    const guide = await openConversation(db, null, "user_1", now, { guide: true });
    expect(guide.id.startsWith(GUIDE_PREFIX)).toBe(true);
    expect(guide.messages).toEqual([]);
    await saveConversation(db, guide.id, "user_1", [{ role: "assistant", text: "Så er eventet oprettet." }], now);
    // The guide continues its own conversation, but not the bubble's.
    expect((await openConversation(db, guide.id, "user_1", now, { guide: true })).id).toBe(guide.id);
    expect((await openConversation(db, "bubble-conversation-0000001", "user_1", now, { guide: true })).id).not.toBe("bubble-conversation-0000001");
    // The bubble gets its own latest conversation, never the guide's - even though the guide's is newer.
    expect((await openConversation(db, null, "user_1", now)).id).toBe("bubble-conversation-0000001");
    expect((await openConversation(db, guide.id, "user_1", now)).id).toBe("bubble-conversation-0000001");
  });
});
