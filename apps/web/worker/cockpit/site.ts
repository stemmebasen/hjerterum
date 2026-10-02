import type { D1Database } from "../db.js";
import type { SagaDeps } from "../saga/env.js";
import type { SagaEnv } from "../saga/env.js";
import { questionWords } from "./ask.js";
import ARCHIVE from "./site-archive.json";

/** Requested: "Generelt må hun gerne have al data fra den nuværende hjemmeside tilgængelig" - "Jo men holistisk.org indhold
 * bliver ikke ved med at være tilgængelig så det skal lagres". The site is kept for good, three ways:
 * - site-archive.json (in the code, read 2 Oct 2026): the text of every page and post, and of the PDFs in its media library
 *   (minutes of general assemblies, budgets, statutes); the raw export is in docs/legacy/holistisk-org-2026-10-02/.
 * - site_pages in D1: while the site lives, read once a day through WordPress' API (no AI). Nothing is ever deleted: a page
 *   gone from the site is marked removed, and a changed page keeps its earlier text in site_page_versions.
 * - The media files themselves (images, PDFs, audio) are copied to R2 (BOARD_RECORDINGS, under holistisk-org/), a few at a time.
 * Saga sees the list of all pages and documents, and in full the ones her question points to. */

export const SITE = "https://holistisk.org";
const DAY = 86_400_000;
const PAGE_CHARS = 12_000, SITE_CHARS = 30_000, ALWAYS = ["/", "/vision/"];

export type SitePage = { url: string; title: string; text: string; modified: string | null; fetched_at_ms: number; removed_at_ms?: number | null };
type ArchivePage = { url: string; title: string; date: string; modified: string | null; text: string };
type ArchiveDocument = { url: string; title: string; date: string; text: string };
type ArchiveMedia = { url: string; mime: string; bytes: number | null };
const archive = ARCHIVE as { captured: string; pages: ArchivePage[]; documents: ArchiveDocument[]; media: ArchiveMedia[] };
export const ARCHIVED = archive.captured;
type WpItem = { link?: unknown; title?: { rendered?: unknown }; content?: { rendered?: unknown }; modified?: unknown };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => e[0] === "#"
  ? String.fromCodePoint(e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? all);

/** A page's HTML as readable text: headings, paragraphs and list items on their own lines. */
export function pageText(html: string): string {
  const text = html.replace(/<(script|style|noscript|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ").replace(/<h[1-6]\b[^>]*>/gi, "\n\n## ").replace(/<\/(p|div|h[1-6]|li|ul|ol|table|tr|section|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/\[\/?[a-z_]+[^\]]*\]/gi, " ");
  return decode(text).split("\n").map(line => line.replace(/[ \t ]+/g, " ").trim()).filter((line, i, all) => line && line !== "##" && line !== all[i - 1] && !line.startsWith("/*"))
    .join("\n").replace(/\n## (?=\n|$)/g, "").slice(0, PAGE_CHARS);
}

async function wpList(deps: SagaDeps, kind: "pages" | "posts"): Promise<WpItem[]> {
  const response = await deps.fetcher(`${SITE}/wp-json/wp/v2/${kind}?per_page=100&_fields=link,title,content,modified`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`site_${kind}_${response.status}`);
  const data = await response.json() as unknown;
  return Array.isArray(data) ? data as WpItem[] : [];
}

/** Reads the whole site and keeps it. Nothing is deleted: a page gone from the site (after a full, sane read) is marked
 * removed, and a page whose text has changed keeps the earlier text as a version. */
export async function syncSite(deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  const items = [...await wpList(deps, "pages"), ...await wpList(deps, "posts").catch(() => [])];
  const pages = items.map(item => ({ url: typeof item.link === "string" ? item.link : "", title: decode(String(item.title?.rendered ?? "")).replace(/<[^>]+>/g, "").trim() || (item.link === `${SITE}/` ? "Forside" : ""),
    text: pageText(String(item.content?.rendered ?? "")), modified: typeof item.modified === "string" ? item.modified : null }))
    .filter(p => p.url.startsWith(SITE) && p.text.length >= 40);
  if (pages.length < 10) throw new Error(`site_too_small_${pages.length}`);
  for (const p of pages) {
    const before = await db.prepare("SELECT text, modified, fetched_at_ms FROM site_pages WHERE url = ?").bind(p.url).first<{ text: string; modified: string | null; fetched_at_ms: number }>();
    if (before && before.text !== p.text)
      await db.prepare("INSERT INTO site_page_versions (url, text, modified, fetched_at_ms, replaced_at_ms) VALUES (?, ?, ?, ?, ?)").bind(p.url, before.text, before.modified, before.fetched_at_ms, now).run();
    await db.prepare(`INSERT INTO site_pages (url, title, text, modified, fetched_at_ms, removed_at_ms) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(url) DO UPDATE SET title = excluded.title, text = excluded.text, modified = excluded.modified, fetched_at_ms = excluded.fetched_at_ms, removed_at_ms = NULL`)
      .bind(p.url, p.title, p.text, p.modified, now).run();
  }
  await db.prepare("UPDATE site_pages SET removed_at_ms = ? WHERE fetched_at_ms < ? AND removed_at_ms IS NULL").bind(now, now).run();
  return pages.length;
}

/** Once a day in Saga's round - and every hour until the first read has succeeded. When the site is gone, the read just fails. */
export async function scheduledSiteSync(deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  const empty = !(await db.prepare("SELECT 1 AS x FROM site_pages LIMIT 1").first<{ x: number }>());
  if (!(await (empty ? claim("site_sync_first", Math.floor(deps.now() / 3_600_000)) : claim("site_sync", Math.floor(deps.now() / DAY))))) return;
  await syncSite(deps, db);
}

const MEDIA_PER_RUN = 8, MEDIA_TRIES = 3;
/** The R2 key of a file from the site's media library. */
export const mediaKey = (url: string) => `holistisk-org/${url.replace(/^https?:\/\/[^/]+\//, "").replace(/^wp-content\/uploads\//, "")}`;

/** Copies the site's media files to R2, a few in each of Saga's rounds, until all are kept (a file that cannot be had is tried three times). */
export async function archiveSiteMedia(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const bucket = env.BOARD_RECORDINGS;
  if (!bucket) return 0;
  const done = new Set(((await db.prepare("SELECT url FROM site_media WHERE stored_at_ms IS NOT NULL OR tries >= ?").bind(MEDIA_TRIES).all<{ url: string }>()).results ?? []).map(r => r.url));
  const next = archive.media.filter(m => !done.has(m.url)).slice(0, MEDIA_PER_RUN);
  let stored = 0;
  for (const m of next) {
    const key = mediaKey(m.url);
    try {
      const response = await deps.fetcher(m.url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`media_${response.status}`);
      const bytes = await response.arrayBuffer();
      await bucket.put(key, bytes, { httpMetadata: { contentType: response.headers.get("content-type") ?? m.mime } });
      await db.prepare(`INSERT INTO site_media (url, r2_key, mime, bytes, stored_at_ms, tries) VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(url) DO UPDATE SET r2_key = excluded.r2_key, bytes = excluded.bytes, stored_at_ms = excluded.stored_at_ms, tries = site_media.tries + 1`).bind(m.url, key, m.mime, bytes.byteLength, deps.now()).run();
      stored++;
    } catch (error) {
      await db.prepare(`INSERT INTO site_media (url, r2_key, mime, bytes, stored_at_ms, tries, last_error) VALUES (?, ?, ?, NULL, NULL, 1, ?)
        ON CONFLICT(url) DO UPDATE SET tries = site_media.tries + 1, last_error = excluded.last_error`).bind(m.url, key, m.mime, error instanceof Error ? error.message.slice(0, 200) : "error").run();
    }
  }
  return stored;
}

const DOC_CHUNK = 6_000, DOC_CHARS = 30_000;
const day = (ms: number) => new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric" }).format(ms);

/** For Saga: every page and document by title and address, and in full the home page, "Hvad er Hjerterum?" and the pages and
 * document parts the question's words find (titles weigh most), as long as they fit. Pages kept in D1 win over the archive. */
export async function siteForSaga(db: D1Database, question: string, budget = SITE_CHARS): Promise<string> {
  const kept = (await db.prepare("SELECT url, title, text, modified, fetched_at_ms, removed_at_ms FROM site_pages ORDER BY url").all<SitePage>().catch(() => ({ results: [] as SitePage[] }))).results ?? [];
  const known = new Set(kept.map(p => p.url));
  const archived = Date.parse(`${archive.captured}T12:00:00Z`);
  const pages: SitePage[] = [...kept, ...archive.pages.filter(p => !known.has(p.url)).map(p => ({ url: p.url, title: p.title, text: p.text, modified: p.modified, fetched_at_ms: archived, removed_at_ms: null }))]
    .sort((a, b) => a.url.localeCompare(b.url));
  // Danish endings vary ("resultatopgørelsen", "generalforsamlingens"): match on the word's stem.
  const words = questionWords(question).map(w => w.slice(0, Math.max(5, w.length - 3)));
  const score = (title: string, text: string) => {
    const t = title.toLocaleLowerCase("da-DK"), body = text.toLocaleLowerCase("da-DK");
    return words.reduce((sum, w) => sum + (t.includes(w) ? 5 : 0) + Math.min(5, body.split(w).length - 1), 0);
  };
  const ranked = [...pages.filter(p => ALWAYS.some(path => p.url === SITE + path)), ...pages.map(p => ({ p, s: score(p.title, p.text) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.p)];
  const chosen: SitePage[] = [];
  let used = 0;
  for (const p of ranked) {
    if (chosen.includes(p) || used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length;
  }
  // The documents in parts, so a long one (a year of minutes) gives the part the question is about.
  const parts = archive.documents.flatMap(d => {
    const out: Array<{ d: ArchiveDocument; n: number; text: string }> = [];
    for (let i = 0; i < d.text.length; i += DOC_CHUNK) out.push({ d, n: out.length + 1, text: d.text.slice(i, i + DOC_CHUNK) });
    return out;
  });
  const docParts: typeof parts = [];
  let docUsed = 0;
  for (const x of parts.map(x => ({ x, s: score(x.d.title, x.text) })).filter(y => y.s > 0).sort((a, b) => b.s - a.s).map(y => y.x)) {
    if (docUsed + x.text.length > DOC_CHARS) continue;
    docParts.push(x);
    docUsed += x.text.length;
  }
  const note = (p: SitePage) => p.removed_at_ms ? ` [ikke længere på hjemmesiden - gemt fra ${day(p.fetched_at_ms)}]` : "";
  const index = pages.map(p => `- ${p.title || "(uden titel)"}: ${p.url}${note(p)}${chosen.includes(p) ? "" : " [kun titel]"}`);
  const docIndex = archive.documents.map(d => `- ${d.date}: ${d.title} (${d.url})${d.text ? "" : " [scannet - ingen tekst]"}${docParts.some(x => x.d === d) ? "" : " [kun titel]"}`);
  return `Hjemmesiden er gemt permanent (arkiv fra ${day(archived)}${kept.length ? `, senest hentet ${day(Math.max(...kept.map(p => p.fetched_at_ms)))}` : ""}). ALLE ${pages.length} SIDER:\n${index.join("\n")}\n\n`
    + `${chosen.map(p => `--- ${p.title || p.url} (${p.url})${note(p)} ---\n${p.text}`).join("\n\n")}\n\n`
    + `DOKUMENTER FRA HJEMMESIDEN (PDF - referater fra generalforsamlinger, budgetter, vedtægter m.m.):\n${docIndex.join("\n")}`
    + `${docParts.length ? `\n\n${docParts.map(x => `--- ${x.d.title} (${x.d.date}, del ${x.n}) ---\n${x.text}`).join("\n\n")}` : ""}`;
}
