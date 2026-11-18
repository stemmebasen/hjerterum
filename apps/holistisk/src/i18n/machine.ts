/** Arrangements' own text in English (Jake 2026-11-18: "og selve eventet"). The organisers write in Danish; for the
 * English pages each upcoming arrangement's title and description is machine-translated once, by Cloudflare Workers
 * AI, and kept in event_translations. The English event page shows the translation, says it is automatic, and keeps
 * the Danish original one tap away. Names (bands, artists, venues, shows) are kept as they are: the model is told so,
 * and a title it is unsure about stays in the original.
 *
 * Translation runs from its own cron (TRANSLATE_CRON) and from POST /api/translate/run, a few arrangements at a time,
 * soonest first. Without the AI binding nothing is translated and the English pages show the Danish text, as before. */
import type { D1Database } from "../db.js";
import type { Env } from "../env.js";

export const TRANSLATE_CRON = "27 * * * *";
/** Small, fast and cheap: about 20 Workers AI "neurons" an arrangement, so Workers Free's 10,000 a day covers ~500. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
/** How far ahead arrangements are translated. */
const AHEAD_MS = 60 * 86_400_000;
/** Longer descriptions are translated up to here (whole paragraphs); the rest is in the Danish original. */
const MAX_TEXT = 3000;

export type EventTranslation = { status: "translated" | "kept"; title_en: string | null; description_en: string | null; partial: boolean };

/** Does this look like Danish? Letters æøå, or a few of the commonest Danish words. */
export function looksDanish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zæøå]+/g) ?? [];
  if (!words.length) return false;
  if (/[æøå]/i.test(text.replace(/\b[A-ZÆØÅ][\p{L}'’-]*/gu, ""))) return true;
  const common = new Set(["og", "er", "på", "til", "med", "ikke", "det", "der", "som", "en", "et", "af", "for", "i", "vi", "du", "dig", "jer", "kan", "skal", "vil", "har", "fra", "hvor", "hvad", "når", "også", "eller", "om", "den", "de", "at", "bliver", "kom", "vores"]);
  const hits = words.filter(w => common.has(w) && !["i", "en", "for", "de", "om"].includes(w)).length;
  return hits >= 2 || (words.length <= 6 && hits >= 1);
}

/** The Danish text that is translated: the description (or the summary), whole paragraphs up to MAX_TEXT. */
export function sourceText(e: { description: string | null; summary: string | null }): { text: string; partial: boolean } {
  const paragraphs = (e.description ?? e.summary ?? "").split(/\n+/).map(p => p.trim()).filter(Boolean);
  const kept: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (kept.length && size + p.length > MAX_TEXT) return { text: kept.join("\n"), partial: true };
    kept.push(p.length > MAX_TEXT ? p.slice(0, MAX_TEXT) : p);
    size += p.length + 1;
  }
  return { text: kept.join("\n"), partial: false };
}

/** FNV-1a of what was translated, so a changed text is translated again. */
export function sourceHash(title: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${title}\n${text}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0") + ":" + s.length;
}

const PROMPT = `You translate Danish event listings for an English-language events website in Aarhus, Denmark.
Translate the "title" and the "text" from Danish into natural, friendly British English.
Rules:
- Keep the names of people, bands, artists, venues, places, organisations, shows, films, books and works exactly as written. Do not translate them.
- If the title is only a name (for example a band, an artist, a show or a film) or is already in English, return the title unchanged.
- The text has one paragraph per line. Return the same paragraphs, one per line, in the same order.
- Keep URLs, e-mail addresses, phone numbers, prices, dates and times as they are.
- Do not add, explain or leave out anything.
Answer with JSON only, exactly: {"title": "...", "text": "..."}`;

/** Asks the model; null when it gave no usable answer. */
async function askModel(env: Env, model: string, title: string, text: string): Promise<{ title: string; text: string } | null> {
  const answer = await env.AI!.run(model, {
    messages: [{ role: "system", content: PROMPT }, { role: "user", content: JSON.stringify({ title, text }) }],
    max_tokens: 2048,
    temperature: 0.2
  });
  const raw = (answer as { response?: unknown })?.response ?? answer;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  }
  const p = parsed as { title?: unknown; text?: unknown };
  if (typeof p?.title !== "string" || (text && typeof p.text !== "string")) return null;
  return { title: p.title.trim(), text: typeof p.text === "string" ? p.text.trim() : "" };
}

/** The model's title, unless it looks like a mistake: then the original stays. */
function checkedTitle(original: string, en: string): string | null {
  if (!en || en === original) return null;
  if (en.length > original.length * 2 + 20 || en.length < original.length / 3) return null;
  if (/[{}"]|^title\b/i.test(en)) return null;
  return en;
}

export type TranslateOutcome = { model: string; translated: number; kept: number; failed: number; pending: number; error: string | null };

/** Translates up to `limit` upcoming arrangements that have no (current) translation, soonest first. Stops at the
 * first error from the model (most likely the day's free allowance is used up); the rest wait for the next run. */
export async function translateEvents(env: Env, now: number, limit = 20): Promise<TranslateOutcome> {
  const model = env.TRANSLATE_MODEL || DEFAULT_MODEL;
  const out: TranslateOutcome = { model, translated: 0, kept: 0, failed: 0, pending: 0, error: null };
  const db = env.DB;
  if (!db) return { ...out, error: "database_unbound" };
  const rows = (await db.prepare(
    `SELECT e.id, e.title, e.description, e.summary, t.source_hash FROM events e LEFT JOIN event_translations t ON t.event_id = e.id
     WHERE e.status = 'scheduled' AND e.starts_at >= ? AND e.starts_at <= ? ORDER BY e.starts_at LIMIT 1500`
  ).bind(now - 6 * 3_600_000, now + AHEAD_MS).all<{ id: string; title: string; description: string | null; summary: string | null; source_hash: string | null }>()).results ?? [];
  const due = rows.map(r => ({ ...r, ...sourceText(r) })).map(r => ({ ...r, hash: sourceHash(r.title, r.text) })).filter(r => r.source_hash !== r.hash);
  out.pending = due.length;
  if (!env.AI) return { ...out, error: "ai_unbound" };
  const save = (id: string, hash: string, status: "translated" | "kept", title: string | null, text: string | null) => db.prepare(
    `INSERT INTO event_translations (event_id, source_hash, status, title_en, description_en, model, translated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET source_hash = excluded.source_hash, status = excluded.status, title_en = excluded.title_en,
       description_en = excluded.description_en, model = excluded.model, translated_at = excluded.translated_at`
  ).bind(id, hash, status, title, text, status === "kept" ? null : model, now).run();
  for (const e of due.slice(0, limit)) {
    if (!looksDanish(e.title) && !looksDanish(e.text)) {
      await save(e.id, e.hash, "kept", null, null);
      out.kept++; out.pending--;
      continue;
    }
    let answer: { title: string; text: string } | null;
    try {
      answer = await askModel(env, model, e.title, e.text);
    } catch (error) {
      out.error = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
      console.error(JSON.stringify({ event: "translate_failed", id: e.id, model, error: out.error }));
      break;
    }
    if (!answer || (e.text && !answer.text)) { out.failed++; continue; }
    // One paragraph per line, as the page shows them; an answer that lost most of the text is not used.
    const text = e.text ? answer.text.split(/\n+/).map(p => p.trim()).filter(Boolean).join("\n") : null;
    if (text !== null && text.length < e.text.length / 3) { out.failed++; continue; }
    await save(e.id, e.hash, "translated", checkedTitle(e.title, answer.title), looksDanish(e.text) ? text : null);
    out.translated++; out.pending--;
  }
  console.log(JSON.stringify({ event: "translate_run", ...out }));
  return out;
}

/** An arrangement's English text, if it has been translated from the text it has now. */
export async function eventTranslation(db: D1Database, e: { id: string; title: string; description: string | null; summary: string | null }): Promise<EventTranslation | null> {
  const row = await db.prepare("SELECT source_hash, status, title_en, description_en FROM event_translations WHERE event_id = ?").bind(e.id)
    .first<{ source_hash: string; status: "translated" | "kept"; title_en: string | null; description_en: string | null }>().catch(() => null);
  if (!row) return null;
  const src = sourceText(e);
  if (row.source_hash !== sourceHash(e.title, src.text)) return null;
  return { status: row.status, title_en: row.title_en, description_en: row.description_en, partial: src.partial };
}

/** Danish title -> English title, for every arrangement still to come: used on every English page (cards, lists, the
 * event page's heading). Kept for ten minutes while the Worker lives. */
let titles: { at: number; map: Map<string, string> } | null = null;
export async function englishTitles(db: D1Database | undefined, now: number): Promise<Map<string, string>> {
  if (!db) return new Map();
  if (titles && now - titles.at < 600_000 && now >= titles.at) return titles.map;
  const rows = (await db.prepare(
    `SELECT e.title, t.title_en FROM event_translations t JOIN events e ON e.id = t.event_id
     WHERE t.title_en IS NOT NULL AND e.starts_at >= ?`
  ).bind(now - 7 * 86_400_000).all<{ title: string; title_en: string }>().catch(() => ({ results: [] as Array<{ title: string; title_en: string }> }))).results ?? [];
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.title.replace(/\s+/g, " ").trim(), r.title_en);
  titles = { at: now, map };
  return map;
}

/** For tests: forget the kept titles. */
export const forgetTitles = (): void => { titles = null; };
