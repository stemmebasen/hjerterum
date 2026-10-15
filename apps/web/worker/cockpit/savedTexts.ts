import type { D1Database } from "../db.js";
import { createGoogleDoc, driveAccessToken } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { esc, layout } from "./page.js";

/** Asked: "Hvorfor kan hun ikke hjælpe?" - "Vil du gemme formandens tale fra Generalforsamlingen" got "Jeg kan ikke gemme tekster til senere". Saga keeps
 * a text when asked: in admin (Arkiv → Gemte tekster), as a Google Doc in the minutes folder when Drive is connected, and she reads it back when asked. */
export type SavedText = { id: number; title: string; body: string; saved_by: string | null; doc_url: string | null; created_at_ms: number };

const SAVE_LINE = /\[\[GEM\s+titel=(.+?)(?:\s+fra=(.+?))?\]\]/i;
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Copenhagen" });

/** The text to keep: from where Saga says it starts ("fra=" its first words), so the request line in front of it is left out. Reported: a rename
 * ("Den hedder faktisk officielt 'Formandens beretning'") was kept as a new "text" of 51 characters - so when the words are not in the message, or
 * the message holds no real text, there is nothing to keep (""). */
export const MIN_TEXT = 200;
export function textToKeep(question: string, from: string | undefined): string {
  const start = from ? question.toLocaleLowerCase("da-DK").indexOf(from.trim().toLocaleLowerCase("da-DK").replace(/[."'”“]+$/, "")) : -1;
  const text = (from ? (start >= 0 ? question.slice(start) : "") : question).trim();
  return text.length >= MIN_TEXT ? text : "";
}

export async function applySaveText(env: SagaEnv, deps: SagaDeps, db: D1Database, answer: string, who: string | null, question: string, base = ""): Promise<string> {
  const line = SAVE_LINE.exec(answer);
  if (!line) return answer;
  const text = answer.replace(SAVE_LINE, "").trim();
  const title = line[1]!.trim().slice(0, 200), body = textToKeep(question, line[2]).slice(0, 60_000);
  if (!who || !title) return text;
  if (!body) return `${text}\n\nJeg kunne ikke finde selve teksten i din besked, så intet er gemt. Indsæt hele teksten, så gemmer jeg den.`;
  let docUrl: string | null = null;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_DRIVE_MINUTES_FOLDER_ID) {
    const html = body.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    docUrl = await createGoogleDoc(env, deps, await driveAccessToken(env, deps), title, `<h1>${esc(title)}</h1>${html}`).then(d => d.url).catch(() => null);
  }
  const saved = await db.prepare("INSERT INTO saved_texts (title, body, saved_by, doc_url, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(title, body, who, docUrl, deps.now()).run();
  const id = Number(saved.meta?.last_row_id);
  return `${text}\n\n✓ Gemt: "${title}" (${body.length.toLocaleString("da-DK")} tegn) - [læs den i admin](${base}/tekster/${id})${docUrl ? ` · [Google-dokumentet](${docUrl})` : ""}`;
}

/** Asked, after a second copy and "Kan du slette den?" - "Jeg kan desværre ikke slette tekster": a kept text is renamed ([[OMDØB TEKST id=<n> titel=...]])
 * and deleted ([[SLET TEKST id=<n>]]) when asked - deleted only by who kept it, or the chair. */
const RENAME_LINE = /\[\[OMDØB TEKST\s+id=(\d+)\s+titel=(.+?)\]\]/gi, DELETE_LINE = /\[\[SLET TEKST\s+id=(\d+)\]\]/gi;
export async function renameText(db: D1Database, id: number, title: string): Promise<boolean> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return false;
  return Number((await db.prepare("UPDATE saved_texts SET title = ? WHERE id = ?").bind(clean, id).run()).meta?.changes ?? 0) === 1;
}
export async function deleteText(db: D1Database, id: number, who: string, chair: boolean): Promise<boolean> {
  const done = await db.prepare(`DELETE FROM saved_texts WHERE id = ? AND (saved_by = ? OR ?)`).bind(id, who, chair ? 1 : 0).run();
  return Number(done.meta?.changes ?? 0) === 1;
}
export async function applyTextChanges(db: D1Database, answer: string, who: string | null, chair: boolean, base = ""): Promise<string> {
  const renames = [...answer.matchAll(RENAME_LINE)], deletes = [...answer.matchAll(DELETE_LINE)];
  if (!renames.length && !deletes.length) return answer;
  let text = answer.replace(RENAME_LINE, "").replace(DELETE_LINE, "").trim();
  if (!who) return text;
  for (const [, id, title] of renames.slice(0, 5)) text += await renameText(db, Number(id), title!) ? `\n\n✓ Omdøbt til "${title!.trim()}" - [læs den](${base}/tekster/${id})` : `\n\nJeg fandt ingen gemt tekst nr. ${id}.`;
  for (const [, id] of deletes.slice(0, 5)) {
    const t = await savedText(db, Number(id));
    text += await deleteText(db, Number(id), who, chair) ? `\n\n✓ Slettet: "${t?.title ?? id}"` : t ? `\n\nKun den, der gemte "${t.title}", eller formanden kan slette den.` : `\n\nJeg fandt ingen gemt tekst nr. ${id}.`;
  }
  return text;
}

export const savedTexts = (db: D1Database, limit = 100) =>
  db.prepare("SELECT id, title, body, saved_by, doc_url, created_at_ms FROM saved_texts ORDER BY created_at_ms DESC, id DESC LIMIT ?").bind(limit).all<SavedText>().then(r => r.results ?? []).catch(() => [] as SavedText[]);
export const savedText = (db: D1Database, id: number) =>
  db.prepare("SELECT id, title, body, saved_by, doc_url, created_at_ms FROM saved_texts WHERE id = ?").bind(id).first<SavedText>().catch(() => null);

/** For Saga: every kept text's title, and in full the ones the question points to (or the newest), within about 30,000 characters. */
export function savedTextsForSaga(texts: SavedText[], question: string): string {
  if (!texts.length) return "";
  const q = question.toLocaleLowerCase("da-DK");
  const words = (t: string) => t.toLocaleLowerCase("da-DK").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3);
  const hits = texts.filter(t => words(t.title).some(w => q.includes(w)));
  const full: SavedText[] = [];
  let used = 0;
  for (const t of [...hits, ...texts.slice(0, 1)]) {
    if (full.includes(t) || used + t.body.length > 30_000) continue;
    full.push(t); used += t.body.length;
  }
  return `GEMTE TEKSTER (det, bestyrelsen har bedt dig gemme - nyeste først):\n${texts.map(t => `- [${t.id}] "${t.title}" (${t.body.length} tegn) - gemt af ${t.saved_by ?? "?"} ${DAY.format(t.created_at_ms)}`).join("\n")}`
    + full.map(t => `\n\n--- "${t.title}" (fuld tekst) ---\n${t.body}`).join("");
}

export function savedTextsCard(base: string, texts: SavedText[]): string {
  return `<div class="card" id="tekster"><h2>Gemte tekster</h2>${texts.length ? `<ul class="plain">${texts.map(t => `<li><a href="${base}/tekster/${t.id}"><strong>${esc(t.title)}</strong></a><span class="small muted"> · ${esc(DAY.format(t.created_at_ms))}${t.saved_by ? ` · ${esc(t.saved_by.split(/\s+/)[0]!)}` : ""}</span></li>`).join("")}</ul>`
    : `<p class="muted small">Ingen endnu. Bed Saga om at gemme en tekst - fx en tale eller et oplæg - så ligger den her.</p>`}</div>`;
}

export function savedTextPage(base: string, t: SavedText, who: string | null, canDelete = false, notice = ""): string {
  return layout(base, t.title, `<main><p class="small"><a href="${base}/arkiv#tekster">← Arkiv</a></p>${notice ? `<p class="notice">${esc(notice)}</p>` : ""}<h1>${esc(t.title)}</h1>
<p class="muted small">Gemt ${esc(DAY.format(t.created_at_ms))}${t.saved_by ? ` af ${esc(t.saved_by)}` : ""}${t.doc_url ? ` · <a href="${esc(t.doc_url)}" target="_blank" rel="noopener">Åbn som Google-dokument</a>` : ""}</p>
<div class="card saved-text">${t.body.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>
${who ? `<details class="small"><summary>Omdøb${canDelete ? " eller slet" : ""}</summary><form method="post" action="${base}/tekster/${t.id}" class="text-actions"><label>Ny titel<input name="title" value="${esc(t.title)}" maxlength="200" required></label><button name="action" value="rename">Gem titel</button></form>
${canDelete ? `<form method="post" action="${base}/tekster/${t.id}" onsubmit="return confirm('Slet teksten for altid?')"><button name="action" value="delete" class="ghost">Slet teksten</button></form>` : ""}</details>` : ""}</main>`, { section: "/arkiv", who, style: ".saved-text p{max-width:68ch;line-height:1.6}" });
}
