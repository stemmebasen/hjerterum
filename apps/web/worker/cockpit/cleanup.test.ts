import { describe, expect, it } from "vitest";
import { applyOpenSuggestions, cleanupCard, cleanupForChair, decideCleanup, runCleanup, scheduledCleanup } from "./cleanup.js";
import { addTodo, boardPicture } from "./data.js";
import { createPost } from "./board.js";
import { claimJob, insertMail, saveBoardMessage, saveOverview } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

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
  // Then: "alle dem, som hun har fundet, er helt fine og skal egentlig bare ryddes automatisk fremover. Men det er kun mig, der må se det".
  it("tidies all she is sure of herself, with what the group and team@ say, and the chair can undo it", async () => {
    const { db, env, services, ids, seen } = await setup(() => [
      { kind: "dublet", ref: "todo:2", keep: "todo:1", why: "Samme opgave som 'Send nyhedsbrevet'" },
      { kind: "klaret", ref: "post:1", why: "Jacob skrev i gruppen, at det er aftalt" },
      { kind: "forældet", ref: "mail:99", why: "findes ikke" }]);
    expect(await runCleanup(env, deps(services.fetcher, NOW), db)).toEqual({ done: 2, suggested: 0 });
    expect(seen()).toContain(`[todo:${ids.b}] to-do til Gitta Hansen: Nyhedsbrev skal sendes ud`);
    expect(seen()).toContain("Vi forlænger prøveperioden til 30 dage");
    expect(seen()).toContain(`[mail:${ids.mail}] vigtig mail fra Pia`);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.b).first<{ done_at_ms: number }>())?.done_at_ms).toBe(NOW);
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.a).first<{ done_at_ms: number | null }>())?.done_at_ms).toBeNull();
    expect(await db.prepare("SELECT status, outcome FROM board_posts WHERE id = ?").bind(ids.post).first()).toEqual({ status: "closed", outcome: "Ryddet op: Jacob skrev i gruppen, at det er aftalt" });
    const shown = await cleanupForChair(db, NOW);
    const card = cleanupCard("/c", shown);
    expect(card).toContain("<h2>Saga har ryddet op</h2><p>2 ting ryddet op · kun du ser det</p>");
    expect(card).toContain("Opslag: Skal vi forlænge prøveperioden?");
    expect(card).not.toContain("Ja, ryd op");
    // The chair undoes both: the post opens again, the to-do is back.
    for (const a of shown) expect(await decideCleanup(db, a.id, "fortryd", "Jacob Hauge", NOW + 1000)).toBe(true);
    expect((await db.prepare("SELECT status FROM board_posts WHERE id = ?").bind(ids.post).first<{ status: string }>())?.status).toBe("open");
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(ids.b).first<{ done_at_ms: number | null }>())?.done_at_ms).toBeNull();
    expect(await cleanupForChair(db, NOW + 3000)).toEqual([]);
  });

  it("carries out the suggestions left from before", async () => {
    const { db, ids } = await setup(() => []);
    await db.prepare("INSERT INTO cleanup_actions (run_day, kind, target, text, why, status, created_at_ms) VALUES ('2026-10-13', 'forældet', ?, 'Leje af salen', 'Gammel', 'forslag', ?)").bind(`mail:${ids.mail}`, NOW - DAY).run();
    expect(await applyOpenSuggestions(db, NOW)).toBe(1);
    expect((await db.prepare("SELECT handled_by FROM board_mail WHERE id = ?").bind(ids.mail).first<{ handled_by: string }>())?.handled_by).toBe("Saga");
    expect((await cleanupForChair(db, NOW)).map(a => a.status)).toEqual(["gjort"]);
  });

  it("does not tidy the same thing again within a month once undone, and runs once a night from three", async () => {
    let calls = 0;
    const { db, env, services } = await setup(() => { calls++; return [{ kind: "forældet", ref: "mail:1", why: "Gammel" }]; });
    const first = await runCleanup(env, deps(services.fetcher, NOW), db);
    expect(first.done).toBe(1);
    const row = (await cleanupForChair(db, NOW))[0]!;
    await decideCleanup(db, row.id, "fortryd", "Jacob Hauge", NOW);
    expect((await runCleanup(env, deps(services.fetcher, NOW + DAY), db)).done).toBe(0);
    calls = 0;
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T00:30:00Z")), db, claim); // 02:30 - not yet
    expect(calls).toBe(0);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T01:05:00Z")), db, claim);
    await scheduledCleanup(env, deps(services.fetcher, Date.parse("2026-10-15T09:00:00Z")), db, claim);
    expect(calls).toBe(1);
  });

  // Reported: "Jeg ser stadig dubletter, selvom de er ryddet op. Hvorfor forsvinder de ikke fra min forside?"
  it("reads the whole of Dine opgaver - Saga's own items too - and takes the duplicate away from there", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    await saveOverview(db, "Rolig uge.", NOW - DAY, { docHash: "x", data: JSON.stringify({ summary: "Rolig uge.", temperature: null, topics: [],
      document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] },
      forJacob: [{ kind: "opgave", text: "Kontakt udlejeren om en ny nøgle til salen", source: "telegram", from: "Gitta", since: "", sure: true }], forMembers: [] }) });
    await addTodo(db, { owner: "Jacob Hauge", text: "Ring til udlejer om nøglen", due: null, createdBy: "Jacob Hauge" }, NOW - 3 * DAY);
    await addTodo(db, { owner: "Jacob Hauge", text: "Bestil kaffe", due: null, createdBy: "Jacob Hauge" }, NOW - 3 * DAY);
    let seen = "";
    const services = fakeServices({ ai: (_s, user) => { seen = user; const ref = /\[(s\d+)\] Sagas punkt til Jacob Hauge: Kontakt udlejeren/.exec(user)?.[1];
      return JSON.stringify({ items: [{ kind: "dublet", ref, keep: "todo:1", why: "Samme som 'Ring til udlejer om nøglen'" }] }); } });
    const result = await runCleanup(sagaEnv(db, {}), deps(services.fetcher, NOW), db);
    expect(result).toEqual({ done: 1, suggested: 0 });
    expect(seen).toContain("Sagas punkt til Jacob Hauge: Kontakt udlejeren om en ny nøgle til salen");
    expect((await boardPicture(db, NOW)).picture?.forJacob).toEqual([]);
    const [action] = await cleanupForChair(db, NOW);
    expect(cleanupCard("/c", [action!])).toContain("Fra Saga: Kontakt udlejeren om en ny nøgle til salen");
    // Fortryd brings it back.
    expect(await decideCleanup(db, action!.id, "fortryd", "Jacob Hauge", NOW + 1000)).toBe(true);
    expect((await boardPicture(db, NOW)).picture?.forJacob.map(f => f.text)).toEqual(["Kontakt udlejeren om en ny nøgle til salen"]);
  });
});
