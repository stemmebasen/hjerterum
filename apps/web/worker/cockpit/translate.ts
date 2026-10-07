import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { latestBoardNow } from "./boardNow.js";
import { approvedMinutes, boardPicture, minutesDecisions } from "./data.js";
import { frontPagePoints, lead } from "./home.js";
import { englishReaders, translateHtml } from "./i18n.js";

/** Requested: "Douglas taler engelsk" - "Ja byg det sådan". Saga's own short texts on the front page ("Bestyrelsen lige nu",
 * the overview's lead, the key points from the last meeting) are translated once, when they are new and someone reads the
 * cockpit in English - in Saga's weekday round, never at the weekend - and kept by the Danish text's hash. A page shows the
 * kept English, or the Danish while there is none. A whole minutes document is translated only when a reader asks for it. */

const SYSTEM = "You translate texts from the board's admin site of Hjerterum, a Danish association in Aarhus, from Danish into natural, warm, plain English. "
  + "Translate faithfully: add, drop or explain nothing; keep names, places, amounts, dates and Markdown as they are. "
  + "Hjerterum stays Hjerterum. Answer ONLY with JSON: {\"texts\":[\"...\"]} - the same number of texts in the same order.";
const DOC_SYSTEM = "You translate the minutes of a board meeting of Hjerterum, a Danish association in Aarhus, from Danish into clear English. "
  + "Translate faithfully and completely: add, drop or explain nothing; keep names, places, amounts and dates. Keep the Markdown structure (headings, lists, bold labels) exactly. "
  + "Answer only with the translated Markdown.";

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** The kept English of each text that has one - read 50 at a time, a page can hold a hundred texts. */
export async function translations(db: D1Database, texts: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const byHash = new Map<string, string>();
  for (const text of new Set(texts.filter(t => t.trim()))) byHash.set(await hash(text), text);
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 50) {
    const part = hashes.slice(i, i + 50);
    const rows = await db.prepare(`SELECT source_hash, text FROM cockpit_translations WHERE lang = 'en' AND source_hash IN (${part.map(() => "?").join(",")})`)
      .bind(...part).all<{ source_hash: string; text: string }>().catch(() => ({ results: [] as Array<{ source_hash: string; text: string }> }));
    for (const row of rows.results ?? []) { const text = byHash.get(row.source_hash); if (text) found.set(text, row.text); }
  }
  return found;
}

async function keep(db: D1Database, source: string, text: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_translations (source_hash, lang, text, created_at_ms) VALUES (?, 'en', ?, ?) ON CONFLICT(source_hash, lang) DO UPDATE SET text = excluded.text, created_at_ms = excluded.created_at_ms")
    .bind(await hash(source), text, nowMs).run();
}

/** Translates the texts that have no English yet - in one request. Returns how many were translated. */
export async function translateTexts(env: SagaEnv, deps: SagaDeps, db: D1Database, texts: string[]): Promise<number> {
  const have = await translations(db, texts);
  const missing = [...new Set(texts.filter(t => t.trim() && !have.has(t)))].slice(0, 20);
  if (!missing.length) return 0;
  const answer = await complete(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify({ texts: missing }) }]);
  let out: unknown = null;
  try { out = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { texts?: unknown } | null)?.texts; } catch { out = null; }
  if (!Array.isArray(out) || out.length !== missing.length || !out.every(t => typeof t === "string" && t.trim())) throw new Error("translation_unreadable");
  for (const [i, source] of missing.entries()) await keep(db, source, String(out[i]).trim(), deps.now());
  return missing.length;
}

/** Saga's texts on the front page right now - the same strings home.ts shows. */
export async function frontPageTexts(db: D1Database, nowMs: number): Promise<string[]> {
  const [now, { summary }, minutes] = await Promise.all([latestBoardNow(db), boardPicture(db, nowMs), approvedMinutes(db)]);
  const latest = minutes.find(m => m.source !== "document") ?? minutes[0] ?? null;
  return [now?.text ?? "", lead(summary), ...(latest ? frontPagePoints(minutesDecisions(latest).map(d => d.text)) : [])].filter(Boolean);
}

/** In Saga's round: on weekdays 07-22, once an hour, only when someone reads in English and something is new. */
export async function scheduledTranslations(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(deps.now()).map(p => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun" || Number(parts.hour) < 7 || Number(parts.hour) > 22) return;
  if (!(await englishReaders(db)).length) return;
  const texts = await frontPageTexts(db, deps.now());
  if ((await translations(db, texts)).size === new Set(texts).size) return;
  if (!(await claim("cockpit_translations", Math.floor(deps.now() / 3_600_000)))) return;
  await translateTexts(env, deps, db, texts);
}

/** A whole minutes document in English, kept; translated when a reader asks for it. */
export async function translatedMinutes(db: D1Database, markdown: string): Promise<string | null> {
  return (await translations(db, [markdown])).get(markdown) ?? null;
}

export async function translateMinutes(env: SagaEnv, deps: SagaDeps, db: D1Database, markdown: string): Promise<string> {
  const kept = await translatedMinutes(db, markdown);
  if (kept) return kept;
  const answer = (await complete(env, deps, [{ role: "system", content: DOC_SYSTEM }, { role: "user", content: markdown }])).trim();
  if (answer.length < Math.min(200, markdown.length / 3)) throw new Error("translation_too_short");
  await keep(db, markdown, answer, deps.now());
  return answer;
}

/** Requested: "I think that overview, tasks, and decisions should be automatically translated". The pages that are
 * translated whole for a member who reads in English. */
export const AUTO_TRANSLATED = new Set(["/", "/status", "/opgaver", "/beslutninger"]);
const AUTO_WAIT_MS = 20_000;

const weekend = (nowMs: number) => ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short" }).format(nowMs));

/** The page in English: the dictionary, then the kept translations; what has none yet is translated now (in parts of
 * 20, at most 160 texts) - on weekdays only, as all of Saga's AI - and kept. A page that waits longer than 20 s is shown
 * with what is ready, and the rest is finished in the background for the next visit. */
export async function translatePage(env: SagaEnv, deps: SagaDeps, db: D1Database, html: string): Promise<string> {
  const missing = new Set<string>();
  translateHtml(html, { missing });
  const texts = [...missing].slice(0, 160);
  let kept = await translations(db, texts);
  const left = texts.filter(t => !kept.has(t));
  if (left.length && env.AI_API_KEY && env.AI_MODEL && !weekend(deps.now())) {
    const parts: string[][] = [];
    for (let i = 0; i < left.length; i += 20) parts.push(left.slice(i, i + 20));
    const work = Promise.all(parts.map(part => translateTexts(env, deps, db, part).catch(error => { console.warn("cockpit_page_translate_failed", error instanceof Error ? error.message : error); return 0; })));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([work.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), AUTO_WAIT_MS); })]);
    clearTimeout(timer);
    if (!ready) deps.waitUntil?.(work);
    kept = await translations(db, texts);
  }
  return translateHtml(html, { kept });
}
