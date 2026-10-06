import type { D1Database } from "../db.js";
import { esc, layout } from "./page.js";

/** Requested by the chair: "Og vigtigt at Saga lærer af vores samtaler!" - and a line in the chat window: "Hvis Saga tager fejl, så fortæl hende
 * det - på den måde får vi bygget en klog og nyttig assistent med tiden."
 *
 * While answering, Saga may write a line [[HUSK omfang=mig|alle tekst=...]] when a member tells her something worth keeping, or corrects her:
 * - omfang=mig: about this member (how they like answers, what to call them, what they usually ask for) - used only when answering them;
 * - omfang=alle: about the house or how the board works (a practice, a preference, a correction of a fact she got wrong) - used for everyone.
 * Each memory says who taught her. Members see what she remembers on "Det Saga har lært" and can remove their own; the chair can remove any.
 * What is in the minutes, the statutes and the other material stays the truth: a memory never overrides it. */

export const MAX_MEMORY_CHARS = 280;
export const MAX_BOARD_MEMORIES = 60;
export const MAX_MEMBER_MEMORIES = 30;
/** What goes into one answer's context: the newest of each. */
const CONTEXT_BOARD = 40;
const CONTEXT_MEMBER = 20;

export type Memory = { id: number; scope: "member" | "board"; member: string | null; text: string; learned_from: string | null; created_at_ms: number };

const ACTION = /\[\[HUSK\s+([^\]]*)\]\]/gi;
const field = (line: string, name: string) => new RegExp(`${name}=(.+?)(?=\\s+(?:omfang|tekst)=|$)`, "i").exec(line)?.[1]?.trim() ?? "";
const normal = (text: string) => text.toLocaleLowerCase("da-DK").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Carries out Saga's [[HUSK ...]] lines and takes them out of the answer. Nothing is written for a member Saga cannot identify. */
export async function applyMemory(db: D1Database, answer: string, who: string | null, nowMs: number): Promise<string> {
  const lines = [...answer.matchAll(ACTION)];
  if (!lines.length) return answer;
  let unknown = false;
  for (const line of lines) {
    const text = field(line[1] ?? "", "tekst").replace(/\s+/g, " ").slice(0, MAX_MEMORY_CHARS).trim();
    const scope = /^alle$/i.test(field(line[1] ?? "", "omfang")) ? "board" as const : "member" as const;
    if (!text) continue;
    if (!who) { unknown = true; continue; }
    await remember(db, { scope, member: scope === "member" ? who : null, text, learnedFrom: who }, nowMs);
  }
  const cleaned = answer.replace(ACTION, "").replace(/\n{3,}/g, "\n\n").trim();
  return unknown ? `${cleaned}\n\n(Vælg hvem du er øverst, så kan jeg huske det næste gang.)` : cleaned;
}

/** Keeps one memory (the same text twice is kept once) and lets the oldest go when there are too many. */
export async function remember(db: D1Database, input: { scope: "member" | "board"; member: string | null; text: string; learnedFrom: string }, nowMs: number): Promise<void> {
  const same = await db.prepare("SELECT id, text FROM saga_memories WHERE scope = ? AND member IS ?").bind(input.scope, input.member).all<{ id: number; text: string }>().then(r => r.results ?? []);
  if (same.some(m => normal(m.text) === normal(input.text))) return;
  await db.prepare("INSERT INTO saga_memories (scope, member, text, learned_from, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(input.scope, input.member, input.text, input.learnedFrom, nowMs).run();
  const limit = input.scope === "board" ? MAX_BOARD_MEMORIES : MAX_MEMBER_MEMORIES;
  await db.prepare(`DELETE FROM saga_memories WHERE scope = ? AND member IS ? AND id NOT IN (
    SELECT id FROM saga_memories WHERE scope = ? AND member IS ? ORDER BY created_at_ms DESC, id DESC LIMIT ${limit})`).bind(input.scope, input.member, input.scope, input.member).run();
}

export async function allMemories(db: D1Database): Promise<Memory[]> {
  return db.prepare("SELECT id, scope, member, text, learned_from, created_at_ms FROM saga_memories ORDER BY created_at_ms DESC, id DESC").all<Memory>().then(r => r.results ?? []).catch(() => []);
}

/** Who may remove a memory: the member their own, the chair any. */
export async function forget(db: D1Database, id: number, who: string, isChair: boolean): Promise<boolean> {
  const row = await db.prepare("SELECT scope, member FROM saga_memories WHERE id = ?").bind(id).first<{ scope: string; member: string | null }>();
  if (!row || !(isChair || (row.scope === "member" && row.member === who))) return false;
  await db.prepare("DELETE FROM saga_memories WHERE id = ?").bind(id).run();
  return true;
}

/** What Saga has learned, for her context: the house's, and the asker's own. */
export async function memorySection(db: D1Database, who: string | null): Promise<string> {
  const [board, own] = await Promise.all([
    db.prepare(`SELECT text, learned_from FROM saga_memories WHERE scope = 'board' ORDER BY created_at_ms DESC, id DESC LIMIT ${CONTEXT_BOARD}`).all<{ text: string; learned_from: string | null }>().then(r => r.results ?? []).catch(() => []),
    who ? db.prepare(`SELECT text FROM saga_memories WHERE scope = 'member' AND member = ? ORDER BY created_at_ms DESC, id DESC LIMIT ${CONTEXT_MEMBER}`).bind(who).all<{ text: string }>().then(r => r.results ?? []).catch(() => []) : Promise.resolve([] as Array<{ text: string }>)
  ]);
  if (!board.length && !own.length) return "";
  return `\n\nDET, DU HAR LÆRT AF SAMTALERNE (medlemmerne har selv fortalt dig det - brug det, men referater, vedtægter og det øvrige materiale gælder, hvis de siger noget andet; så sig det venligt):`
    + (board.length ? `\nOm huset og bestyrelsen:\n${board.map(m => `- ${m.text}${m.learned_from ? ` (fortalt af ${m.learned_from})` : ""}`).join("\n")}` : "")
    + (own.length ? `\nOm ${who} (kun til brug, når du svarer ${who}):\n${own.map(m => `- ${m.text}`).join("\n")}` : "");
}

const WHEN = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" });

export const MEMORY_STYLE = `
.mem{display:grid;gap:20px}.mem ul{list-style:none;margin:0;padding:0;display:grid}
.mem li{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}.mem li:first-child{border-top:0;padding-top:0}
.mem li p{margin:0}.mem li small{display:block;color:var(--faint);font-size:12.5px;margin-top:2px}.mem form{margin:0;flex:none}
.mem .empty{margin:0;color:var(--muted)}
`;

/** "Det Saga har lært": the house's memories for everyone, each member's own, and - for the chair - everyone's. */
export function memoryPage(base: string, who: string | null, d: { memories: Memory[]; isChair: boolean }): string {
  const row = (m: Memory, who2: string | null) => `<li><div><p>${esc(m.text)}</p><small>${m.learned_from ? `Fortalt af ${esc(m.learned_from)} · ` : ""}${esc(WHEN.format(m.created_at_ms))}${who2 ? ` · om ${esc(who2)}` : ""}</small></div>
${d.isChair || (m.scope === "member" && m.member === who) ? `<form method="post" action="${base}/hukommelse/glem"><input type="hidden" name="id" value="${m.id}"><button class="ghost">Glem</button></form>` : ""}</li>`;
  const board = d.memories.filter(m => m.scope === "board");
  const mine = d.memories.filter(m => m.scope === "member" && m.member === who);
  const others = d.isChair ? d.memories.filter(m => m.scope === "member" && m.member !== who) : [];
  const list = (items: Memory[], withMember = false) => `<ul>${items.map(m => row(m, withMember ? m.member : null)).join("")}</ul>`;
  return layout(base, "Det Saga har lært", `<main class="mem"><div class="hero"><p class="small muted" style="margin:0 0 6px"><a href="${base}/profil">← Profil</a></p><h1>Det Saga har lært</h1>
<p>Det, I har fortalt Saga i chatten, og som hun husker næste gang. Tager hun fejl, så fortæl hende det i chatten - eller tryk Glem her.</p></div>
<section class="panel"><header><h2>Om huset og bestyrelsen</h2><p>Bruges, når Saga svarer alle.</p></header>${board.length ? list(board) : `<p class="empty">Intet endnu. Fortæl hende noget, hun skal huske, eller ret hende, når hun tager fejl.</p>`}</section>
<section class="panel"><header><h2>Om dig</h2><p>Bruges kun, når Saga svarer dig.</p></header>${mine.length ? list(mine) : `<p class="empty">Intet endnu.</p>`}</section>
${others.length ? `<section class="panel"><header><h2>Om de andre medlemmer</h2><p>Kun for formanden.</p></header>${list(others, true)}</section>` : ""}</main>`,
    { section: "/profil", who, style: MEMORY_STYLE });
}
