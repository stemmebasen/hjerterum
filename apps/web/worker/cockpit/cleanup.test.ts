import { describe, expect, it } from "vitest";
import { cleanupCard, cleanupForChair, decideCleanup, runCleanup, scheduledCleanup } from "./cleanup.js";
import { addTodo } from "./data.js";
import { createPost } from "./board.js";
import { claimJob, insertMail, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "I would like to add an intelligent and clever AI call once per day that looks through it all and tidies up and catches duplets,
// irrelevant or outdated information and just makes sure the admin is nicely kept." - "Ja".
const NOW = Date.parse("2026-10-14T01:30:00Z"); // 03:30 in Copenhagen
const DAY = 86_400_000;

async function setup(answer: (user: string) => unknown[]) {
  const db = testDatabase();
  let seen = "";
  const services = fakeServices({ ai: (_s, user) => { seen = user; return JSON.stringify({ items: answer(user) }); } });
  const env = sagaEnv(db, {});
  await addTodo(db, { owner: "Gitta Hansen", text: "Send nyhedsbrevet", due: null, createdBy: "Jacob Hauge" }, NOW - 5 * DAY);
  await addTodo(db, { owner: "Gitta Hansen", text: "Nyhedsbrev skal sendes ud", due: null, createdBy: "Lisbeth" }, NOW - 2 * DAY);
  const post = (await createPost(db, { kind: "afklaring", title: "Skal vi forlænge prøveperioden?", text: "", who: "Gitta" }, NOW - 10 * DAY))!;
  const mail = (await insertMail(db, { ref: "m1", sender: "Pia <pia@example.dk>", subject: "Leje af salen", receivedAtMs: NOW - 6 * DAY, preview: "Hej", nowMs: NOW }))!;
  await db.prepare("UPDATE board_mail SET enquiry_kind = 'Lokaleleje' WHERE id = ?").bind(mail).run();
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: "200", text: "Vi forlænger prøveperioden til 30 dage - det er aftalt", sentAtMs: NOW - DAY, fromAssistant: false });
  return { db, env, services, ids: { a: 1, b: 2, post, mail }, seen: () => seen };
}

describe("Saga's nightly tidy-up", () => {
  it("closes a duplicate to-do herself, and suggests the rest to the chair with what the group and team@ say", async () => {
    const { db, env, services, ids, seen } = await setup(() => [
      { kind: "dublet", ref: "todo:2", keep: "todo:1", why: "Samme opgave som 'Send nyhedsbrevet'" },
      { kind: "klaret", ref: "post:1", why: "Jacob skrev i gruppen, at det er aftalt" },
      { kind: "forældet", ref: "mail:99", why: "findes ikke" }]);
    expect(await runCleanup(env, deps(services.fetcher, NOW), db)).toEqual({ done: 1, suggested: 1 });
    expect(seen()).toContain(`[todo:${ids.b}] to-do til Gitta Hansen: Nyhedsbrev skal sendes ud`);
    expect(seen()).toContain("Vi forlænger prøveperioden til 30 dage");
    expect(seen()).toContain(`[mail:${ids.mail}] vigtig mail fra Pia`);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.b).first<{ done_at_ms: number }>())?.done_at_ms).toBe(NOW);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.a).first<{ done_at_ms: number | null }>())?.done_at_ms).toBeNull();
    const shown = await cleanupForChair(db, NOW);
    const card = cleanupCard("/c", shown);
    expect(card).toContain("<h2>Saga har ryddet op</h2><p>1 dublet ryddet · 1 forslag til dig</p>");
    expect(card).toContain("Opslag: Skal vi forlænge prøveperioden?");
    // The chair accepts the suggestion: the post is closed with why; and undoes the duplicate.
    const suggestion = shown.find(a => a.status === "forslag")!, duplicate = shown.find(a => a.status === "gjort")!;
    expect(await decideCleanup(db, suggestion.id, "ja", "Jacob Hauge", NOW + 1000)).toBe(true);
    expect(await db.prepare("SELECT status, outcome FROM board_posts WHERE id = ?").bind(ids.post).first()).toEqual({ status: "closed", outcome: "Ryddet op: Jacob skrev i gruppen, at det er aftalt" });
    expect(await decideCleanup(db, duplicate.id, "fortryd", "Jacob Hauge", NOW + 2000)).toBe(true);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.b).first<{ done_at_ms: number | null }>())?.done_at_ms).toBeNull();
    expect(await cleanupForChair(db, NOW + 3000)).toEqual([]);
  });

  it("does not bring the same thing up again within a month, and runs once a night from three", async () => {
    let calls = 0;
    const { db, env, services } = await setup(() => { calls++; return [{ kind: "forældet", ref: "mail:1", why: "Gammel" }]; });
    const first = await runCleanup(env, deps(services.fetcher, NOW), db);
    expect(first.suggested).toBe(1);
    const row = (await cleanupForChair(db, NOW))[0]!;
    await decideCleanup(db, row.id, "nej", "Jacob Hauge", NOW);
    expect((await runCleanup(env, deps(services.fetcher, NOW + DAY), db)).suggested).toBe(0);
    calls = 0;
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T00:30:00Z")), db, claim); // 02:30 - not yet
    expect(calls).toBe(0);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T01:05:00Z")), db, claim);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T09:00:00Z")), db, claim);
    expect(calls).toBe(1);
  });
});
