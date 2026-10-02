import type { D1Database } from "../db.js";
import type { SagaEnv } from "../saga/env.js";
import { markOwnerDone } from "../saga/store.js";
import { allTasks, approvedMinutes, imperative, boardMembers, boardPicture, openFor, setTaskChecked, setTodoDone, taskKey } from "./data.js";
import { currentForChair } from "./home.js";

/** Requested: "Det er vigtigt, at min adgang til cockpittet synkroniseres med Matrix, for det er basalt set de
 * samme informationer, jeg får i Matrix, og de samme opgaver. Og når jeg for eksempel klikker på »klaret«,
 * jamen så forsvinder opgaven begge steder." One list of what is open for the chair - Saga's questions and
 * tasks for him, his tasks from the minutes, and the items written to him or to Alle - each with a key that
 * Matrix keeps on its reminder. Checked off in the cockpit, it is gone from this list and Matrix closes the
 * reminder; completed in Matrix, Matrix sends the key back and it is checked off here. */

export type ChairItem = { key: string; kind: "spørgsmål" | "opgave"; text: string; source: string; from: string | null; since: string };

/** A short, stable key (lowercase letters and digits, at most 16): FNV-1a twice, in base 36. */
function shortKey(prefix: string, value: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (const ch of value) { a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0; b = Math.imul(b ^ ch.charCodeAt(0), 0x811c9dc5) >>> 0; }
  return (prefix + a.toString(36) + b.toString(36)).slice(0, 16);
}

async function chairList(env: SagaEnv, db: D1Database, nowMs: number) {
  const { chair } = await boardMembers(env, db);
  if (!chair) return { chair: null, items: [] as Array<ChairItem & { done: () => Promise<void> }> };
  const [{ picture }, minutes] = await Promise.all([boardPicture(db, nowMs), approvedMinutes(db)]);
  const open = await openFor(db, chair, allTasks(minutes, picture));
  const items: Array<ChairItem & { done: () => Promise<void> }> = [
    ...currentForChair(picture?.forJacob ?? []).map(f => ({ key: f.key, kind: f.kind === "spørgsmål" ? "spørgsmål" as const : "opgave" as const, text: f.text,
      source: f.source, from: f.from ?? null, since: f.since, done: () => markOwnerDone(db, f.key, f.text, nowMs) })),
    ...open.tasks.map(t => ({ key: shortKey("t", taskKey(t)), kind: "opgave" as const, text: imperative(t.what), source: "referat", from: null, since: t.meeting,
      done: () => setTaskChecked(db, chair, taskKey(t), true, nowMs) })),
    ...open.todos.map(t => ({ key: `p${t.id}`, kind: "opgave" as const, text: t.text, source: "cockpit", from: t.created_by === chair ? null : t.created_by,
      since: new Date(t.created_at_ms).toISOString().slice(0, 10), done: () => setTodoDone(db, t.id, chair, true, nowMs) }))
  ];
  return { chair, items };
}

export async function chairItems(env: SagaEnv, db: D1Database, nowMs: number): Promise<{ chair: string | null; items: ChairItem[] }> {
  const { chair, items } = await chairList(env, db, nowMs);
  return { chair, items: items.map(({ done: _done, ...item }) => item) };
}

/** Matrix says the chair completed one: checked off here. False when it is no longer open. */
export async function chairItemDone(env: SagaEnv, db: D1Database, key: string, nowMs: number): Promise<boolean> {
  const { items } = await chairList(env, db, nowMs);
  const item = items.find(i => i.key === key);
  if (!item) return false;
  await item.done();
  return true;
}
