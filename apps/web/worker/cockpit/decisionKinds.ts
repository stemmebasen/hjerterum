import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { allDecisions, approvedMinutes, boardPicture, type Decision } from "./data.js";

/** Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling."
 * A point from the minutes is a decision of the board, or it is not (yet) one: an informal agreement between a few people, a recommendation, a proposal, a backing, something to look into
 * ("aftale" in the table; the page calls them "Aftaler og anbefalinger"). New minutes keep them apart (the section "Aftaler"); for the rest Saga sorts them once by what the point says, and any
 * board member can move a point - what is stored here wins. A decision is valid when it is taken, whatever the state of the minutes - but a recommendation is not a decision.
 * Requested: "lige nu står en linje som 'Der anbefales op til fire suppleanter på generalforsamlingen.' sådan beslutning med laurbær". What Saga cannot read, or is not asked about, stays
 * where it stood in the minutes until she can. */

export type Kind = "beslutning" | "aftale";
export type Kinds = Map<string, { kind: Kind; by: string }>;

/** What says itself that nothing was decided, or that something is only recommended - no need to ask anyone: "Der blev ikke truffet beslutning om ...", "Ingen beslutning", "... ikke vedtaget",
 * "Der anbefales ...". Requested, as examples of lines that are not decisions: "Der anbefales op til fire suppleanter på generalforsamlingen." and "Der blev ikke truffet beslutning om at udsætte fundraisingfestivalen." */
export const undecided = (text: string) => /\bingen (?:beslutning|afgørelse)\b|\bikke (?:blevet )?(?:truffet|taget|besluttet|vedtaget|afgjort)\b|\banbefal(?:es|er|et)\b/i.test(text);

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

/** Each point with its kind: what a board member chose first; then what says itself that nothing was decided (`undecided`) - over Saga's guess; then Saga's sorting; then the section of the minutes
 * it stood in. A vote is always a decision. */
export function withKinds(list: Decision[], kinds: Kinds): Decision[] {
  return list.map(d => {
    if (d.source === "afstemning") return { ...d, kind: "beslutning" as const };
    const stored = kinds.get(decisionKey(d.text));
    if (stored && stored.by !== "Saga") return { ...d, kind: stored.kind, kindBy: stored.by };
    if (undecided(d.text)) return { ...d, kind: "aftale" as const };
    return { ...d, kind: stored?.kind ?? d.kind ?? "beslutning", ...(stored ? { kindBy: stored.by } : {}) };
  });
}

/** The points Saga has not sorted: not a vote, not already in the section "Aftaler", not obviously undecided, and not in the table. */
export const unsorted = (list: Decision[], kinds: Kinds): string[] =>
  [...new Set(list.filter(d => d.source !== "afstemning" && d.kind !== "aftale" && !undecided(d.text) && !kinds.has(decisionKey(d.text))).map(d => d.text))];

const SYSTEM = "Du sorterer punkter fra bestyrelsens referater i foreningen Hjerterum i to slags efter ordlyden. "
  + "\"beslutning\": bestyrelsen har truffet en afgørelse, som binder foreningen eller ændrer noget - noget besluttes, vedtages, godkendes, indføres, etableres, sættes til et beløb eller en dato, nogen får en post eller rolle, et budget eller en kontrakt er aftalt. "
  + "\"aftale\": alt, der ikke er afgjort som en beslutning: en uformel aftale mellem enkelte personer (nogle holder møde, taler sammen, kigger på noget, forbereder eller sender noget), "
  + "en anbefaling, et forslag eller en idé, en opbakning eller stemning (\"der var opbakning til\"), noget der skal undersøges eller overvejes, og noget der først skal afgøres senere, fx af generalforsamlingen. "
  + "Et punkt, der siger, at noget IKKE er besluttet, er aldrig en beslutning, og det er en melding om, hvad en enkelt person vil eller gør, heller ikke. "
  + "Eksempler på aftale (altså ikke en beslutning): \"De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling\"; \"Der anbefales op til fire suppleanter på generalforsamlingen\" (en anbefaling er ikke afgjort); "
  + "\"Gitta genopstiller til bestyrelsen\" (en melding fra en enkelt person); \"Der blev ikke truffet beslutning om at udsætte fundraisingfestivalen\" (der blev netop ikke besluttet noget); \"Regler og vedtægter undersøges først\". "
  + "Eksempel på beslutning: \"Minimumsdonationen sættes til 50 kr.\". "
  + "Vælg efter hvad punktet siger, ikke efter hvor det står: begge fejl er forkerte - at kalde en anbefaling for en beslutning, og at kalde en afgørelse for uformel. Brug kun ordene i punktet. "
  + "Svar KUN med JSON: {\"items\":[{\"n\":<punktets nummer>,\"kind\":\"beslutning\"|\"aftale\"}]} med ét svar for hvert punkt.";

/** Saga sorts what has not been sorted - at most 100 points in one request. A point she does not answer for, or an answer she cannot read, is left alone (and stays a decision). */
export async function classifyDecisions(env: SagaEnv, deps: SagaDeps, db: D1Database, texts: string[]): Promise<number> {
  const todo = [...new Set(texts.map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 100);
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
