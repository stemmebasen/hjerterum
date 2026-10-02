import { describe, expect, it } from "vitest";
import { handleSagaRequest } from "./handler.js";
import { saveBoardMessage } from "./store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "./test-support.js";

// Requested: "Kan jeg have Saga og Zilla tilgængelig i chat i Matrix på en klog måde?" - "Ja".
const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("asking Saga from Matrix's chat", () => {
  it("answers the chair in Markdown from her own knowledge, behind Liva's key, with links into the cockpit", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    let system = "", user = "";
    const services = fakeServices({ ai: (s, u) => { system = s; user = u; return "Prøveperioden er **30 dage** (se [opgaver](https://x/cockpit/opgaver))."; } });
    const env = sagaEnv(db);
    const ask = (body: unknown, secret = "liva-secret") => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/ask", {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(services.fetcher, NOW));

    expect((await ask({ question: "Hvor lang er prøveperioden?" }, "wrong-secre")).status).toBe(401);
    expect((await ask({ question: "" })).status).toBe(400);
    const response = await ask({ question: "Hvor lang er prøveperioden?", history: [{ role: "user", content: "Hej" }, { role: "assistant", content: "Hej Jacob" }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Prøveperioden er **30 dage** (se [opgaver](https://x/cockpit/opgaver))." });
    expect(system).toContain("MEDLEMSKAB - TYPER, PRISER, FORDELE OG VILKÅR");
    expect(system).toContain("https://hjerterum.test/cockpit/opgaver");
    // The history comes first (the fake AI sees the first turn after the system prompt).
    expect(user).toBe("Hej");
    expect(await db.prepare("SELECT asked_by FROM cockpit_questions").first()).toEqual({ asked_by: "Jacob Hauge" });
  });
});
