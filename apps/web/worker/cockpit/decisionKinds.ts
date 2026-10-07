import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { allDecisions, approvedMinutes, boardPicture, type Decision } from "./data.js";

/** Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling."
 * A point from the minutes is a decision of the board or an informal agreement between a few people. New minutes keep them apart (the section "Aftaler"); for the rest Saga sorts them
 * once, and any board member can move a point - what is stored here wins. A decision is valid when it is taken, so a point is a decision unless it is clearly an agreement: what Saga
 * cannot read, or is not asked about, stays a decision. */

export type Kind = "beslutning" | "aftale";
export type Kinds = Map<string, { kind: Kind; by: string }>;

export const decisionKey = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);

export async function decisionKinds(db: D1Database): Promise<Kinds> {
  const rows = (await db.prepare("SELECT key, kind, decided_by FROM cockpit_decision_kinds").all<{ key: string; kind: Kind; decided_by: string }>()
    .catch(() => ({ results: [] as Array<{ key: string; kind: Kind; decided_by: string }> }))).results ?? [];
  return new Map(rows.map(r => [r.key, { kind: r.kind, by: r.decided_by }]));
}

/** A board member moves a point: it stays moved. */
export async function setDecisionKind(db: D1Database, text: string, kind: Kind, by: string, nowMs: number): Promise<boolean> {
  const key = decisionKey(text);
  if (!key || (kind !== "beslutning" && kind !== "aftale")) return false;
  await db.prepare("INSERT INTO cockpit_decision_kinds (key, kind, decided_by, at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, decided_by = excluded.decided_by, at_ms = excluded.at_ms")
    .bind(key, kind, by, nowMs).run();
  return true;
}

/** Each point with its kind: the table first, then the section of the minutes it stood in; a vote is always a decision. */
export function withKinds(list: Decision[], kinds: Kinds): Decision[] {
  return list.map(d => {
    if (d.source === "afstemning") return { ...d, kind: "beslutning" as const };
    const stored = kinds.get(decisionKey(d.text));
    return { ...d, kind: stored?.kind ?? d.kind ?? "beslutning", ...(stored ? { kindBy: stored.by } : {}) };
  });
}

/** The points Saga has not sorted: not a vote, not already in the section "Aftaler", and not in the table. */
export const unsorted = (list: Decision[], kinds: Kinds): string[] =>
  [...new Set(list.filter(d => d.source !== "afstemning" && d.kind !== "aftale" && !kinds.has(decisionKey(d.text))).map(d => d.text))];

const SYSTEM = "Du sorterer punkter fra bestyrelsens referater i foreningen Hjerterum i to slags. "
  + "\"beslutning\": en beslutning truffet af bestyrelsen, som binder foreningen eller ændrer noget - regler, priser og beløb, budget, kontrakter, ansættelser, hvem der har en post eller rolle, datoer for generalforsamling eller andre fælles frister, at noget indføres, afskaffes, godkendes eller sendes ud på foreningens vegne. "
  + "\"aftale\": en uformel aftale eller et praktisk arrangement mellem enkelte personer, som ikke er en beslutning i bestyrelsen - at nogle mødes eller holder møde, taler sammen, kigger på noget, forbereder et oplæg, melder tilbage. "
  + "Eksempel: \"De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling\" er en aftale. "
  + "En beslutning må aldrig fejlagtigt kaldes uformel: er du det mindste i tvivl, er det en beslutning. Brug kun ordene i punktet. "
  + "Svar KUN med JSON: {\"items\":[{\"n\":<punktets nummer>,\"kind\":\"beslutning\"|\"aftale\"}]} med ét svar for hvert punkt.";

/** Saga sorts what has not been sorted - at most 60 points in one request. A point she does not answer for, or an answer she cannot read, is left alone (and stays a decision). */
export async function classifyDecisions(env: SagaEnv, deps: SagaDeps, db: D1Database, texts: string[]): Promise<number> {
  const todo = [...new Set(texts.map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 60);
  if (!todo.length) return 0;
  const answer = await complete(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: todo.map((t, i) => `${i + 1}. ${t}`).join("\n") }]);
  let items: unknown = null;
  try { items = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { items?: unknown } | null)?.items; } catch { items = null; }
  if (!Array.isArray(items)) throw new Error("decision_kinds_unreadable");
  let done = 0;
  for (const item of items as Array<{ n?: unknown; kind?: unknown }>) {
    const text = typeof item?.n === "number" ? todo[item.n - 1] : undefined;
    if (!text || (item.kind !== "beslutning" && item.kind !== "aftale")) continue;
    // Never over what a board member (or an earlier round) has decided.
    const result = await db.prepare("INSERT INTO cockpit_decision_kinds (key, kind, decided_by, at_ms) VALUES (?, ?, 'Saga', ?) ON CONFLICT(key) DO NOTHING").bind(decisionKey(text), item.kind, deps.now()).run();
    done += Number(result.meta?.changes ?? 0);
  }
  return done;
}

/** The texts that are not informal agreements - for the places that list only decisions (the front page, Saga's list of decisions). */
export const onlyDecisions = (texts: string[], kinds: Kinds): string[] => texts.filter(t => kinds.get(decisionKey(t))?.kind !== "aftale");

/** In Saga's round, once an hour and only when something is unsorted: new minutes sort themselves, also when no one opens Beslutninger. */
export async function scheduledDecisionKinds(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return;
  const [minutes, { picture }, kinds] = await Promise.all([approvedMinutes(db), boardPicture(db, deps.now()), decisionKinds(db)]);
  const todo = unsorted(withKinds(allDecisions(minutes, picture), kinds), kinds);
  if (!todo.length || !(await claim("cockpit_decision_kinds", Math.floor(deps.now() / 3_600_000)))) return;
  await classifyDecisions(env, deps, db, todo);
}
