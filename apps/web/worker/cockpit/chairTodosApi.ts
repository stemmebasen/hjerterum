import type { D1Database } from "../db.js";
import type { SagaEnv } from "../saga/env.js";
import { allTasks, approvedMinutes, boardMembers, boardPicture, openFor, taskKey } from "./data.js";

/** The chair (27 Nov 2026): "Kan du få mine personlige opgaver ind i Matrix som kan læses via API". The chair's own list in admin ("Dine to-do's"):
 * what he wrote himself or was given, and his tasks from the minutes he has not checked off - the same lines as on admin's front page. Read by Matrix
 * (and anything else holding the Liva key) on GET /api/saga/liva/todos and in /api/saga/liva/overview as `chairTodos`. Each line has a key that stays
 * the same (t<id> for an item, m<hash> for a task from the minutes), so Matrix keeps one reminder per line. */
export type ChairTodo = { key: string; text: string; due: string | null; source: "cockpit" | "referat" | "dokument" | "formand"; createdBy: string | null; createdAt: string | null; meeting: string | null };

const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

export async function chairTodos(env: SagaEnv, db: D1Database, nowMs: number): Promise<{ chair: string | null; todos: ChairTodo[] }> {
  const { chair } = await boardMembers(env, db);
  if (!chair) return { chair: null, todos: [] };
  const [{ picture }, minutes] = await Promise.all([boardPicture(db, nowMs), approvedMinutes(db)]);
  const open = await openFor(db, chair, allTasks(minutes, picture));
  return {
    chair,
    todos: [
      ...open.todos.map(t => ({ key: `t${t.id}`, text: t.text, due: t.due, source: "cockpit" as const, createdBy: t.created_by, createdAt: new Date(t.created_at_ms).toISOString(), meeting: null })),
      ...open.tasks.map(t => ({ key: `m${hash(taskKey(t))}`, text: t.what, due: t.due || null, source: t.source, createdBy: null, createdAt: null, meeting: t.meeting || null }))
    ]
  };
}
