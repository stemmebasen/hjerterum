import { describe, expect, it } from "vitest";
import { handleSagaRequest } from "../saga/handler.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// The chair (27 Nov 2026): "Kan du få mine personlige opgaver ind i Matrix som kan læses via API".
describe("the chair's own list for Matrix", () => {
  it("gives the chair's open items in admin, with keys that stay - only with the Liva key", async () => {
    const db = testDatabase();
    const now = Date.now();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: now - 86_400_000 });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 2, author: "Lisbeth", authorId: "201", text: "Hej", sentAtMs: now - 86_400_000 });
    const add = (owner: string, text: string, done: number | null = null) => db.prepare("INSERT INTO cockpit_todos (owner, text, due, created_by, created_at_ms, done_at_ms) VALUES (?, ?, '2026-12-01', 'Lisbeth', ?, ?)")
      .bind(owner, text, now - 3_600_000, done).run();
    await add("Jacob Hauge", "Ring til udlejer om nøgler");
    await add("Jacob Hauge", "Allerede klaret", now - 60_000);
    await add("Lisbeth", "Ikke Jacobs");
    const services = fakeServices();
    const env = sagaEnv(db);
    const get = (path: string, key = "liva-secret") => handleSagaRequest(new Request(`https://hjerterum.test${path}`, { headers: { authorization: `Bearer ${key}` } }), env, deps(services.fetcher, now));
    expect((await get("/api/saga/liva/todos", "wrong")).status).toBe(401);
    const body = await (await get("/api/saga/liva/todos")).json() as { chair: string; todos: Array<{ key: string; text: string; due: string; source: string; createdBy: string }> };
    expect(body.chair).toBe("Jacob Hauge");
    expect(body.todos.map(t => t.text)).toEqual(["Ring til udlejer om nøgler"]);
    expect(body.todos[0]).toMatchObject({ key: expect.stringMatching(/^t\d+$/), due: "2026-12-01", source: "cockpit", createdBy: "Lisbeth" });
    // And in the overview Matrix already reads.
    const overview = await (await get("/api/saga/liva/overview")).json() as { chairTodos: Array<{ text: string }> };
    expect(overview.chairTodos.map(t => t.text)).toEqual(["Ring til udlejer om nøgler"]);
  });
});
