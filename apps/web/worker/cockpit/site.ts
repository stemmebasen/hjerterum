import type { D1Database } from "../db.js";
import type { SagaDeps } from "../saga/env.js";
import { questionWords } from "./ask.js";

/** Requested: "Generelt må hun gerne have al data fra den nuværende hjemmeside tilgængelig". Once a day the cockpit reads
 * every page and post on holistisk.org through WordPress' own API (no AI) and keeps the text. Saga sees the list of all
 * pages, and in full the ones her question points to - the whole site is too long to send every time. */

export const SITE = "https://holistisk.org";
const DAY = 86_400_000;
const PAGE_CHARS = 12_000, SITE_CHARS = 30_000, ALWAYS = ["/", "/vision/"];

export type SitePage = { url: string; title: string; text: string; modified: string | null; fetched_at_ms: number };
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

/** Reads the whole site and keeps it. A page gone from the site is dropped - only after a full, sane read. */
export async function syncSite(deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  const items = [...await wpList(deps, "pages"), ...await wpList(deps, "posts").catch(() => [])];
  const pages = items.map(item => ({ url: typeof item.link === "string" ? item.link : "", title: decode(String(item.title?.rendered ?? "")).replace(/<[^>]+>/g, "").trim() || (item.link === `${SITE}/` ? "Forside" : ""),
    text: pageText(String(item.content?.rendered ?? "")), modified: typeof item.modified === "string" ? item.modified : null }))
    .filter(p => p.url.startsWith(SITE) && p.text.length >= 40);
  if (pages.length < 10) throw new Error(`site_too_small_${pages.length}`);
  for (const p of pages)
    await db.prepare(`INSERT INTO site_pages (url, title, text, modified, fetched_at_ms) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET title = excluded.title, text = excluded.text, modified = excluded.modified, fetched_at_ms = excluded.fetched_at_ms`).bind(p.url, p.title, p.text, p.modified, now).run();
  await db.prepare("DELETE FROM site_pages WHERE fetched_at_ms < ?").bind(now).run();
  return pages.length;
}

/** Once a day in Saga's round - and every hour until the first read has succeeded. */
export async function scheduledSiteSync(deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  const empty = !(await db.prepare("SELECT 1 AS x FROM site_pages LIMIT 1").first<{ x: number }>());
  if (!(await (empty ? claim("site_sync_first", Math.floor(deps.now() / 3_600_000)) : claim("site_sync", Math.floor(deps.now() / DAY))))) return;
  await syncSite(deps, db);
}

/** For Saga: every page by title and address, and in full the home page, "Hvad er Hjerterum?" and the pages the question's
 * words find (titles weigh most), as long as they fit. */
export async function siteForSaga(db: D1Database, question: string, budget = SITE_CHARS): Promise<string> {
  const pages = (await db.prepare("SELECT url, title, text, modified, fetched_at_ms FROM site_pages ORDER BY url").all<SitePage>().catch(() => ({ results: [] as SitePage[] }))).results ?? [];
  if (!pages.length) return "(hjemmesiden er ikke hentet endnu)";
  const words = questionWords(question);
  const score = (p: SitePage) => {
    const title = p.title.toLocaleLowerCase("da-DK"), text = p.text.toLocaleLowerCase("da-DK");
    return words.reduce((sum, w) => sum + (title.includes(w) ? 5 : 0) + Math.min(5, text.split(w).length - 1), 0);
  };
  const ranked = [...pages.filter(p => ALWAYS.some(path => p.url === SITE + path)), ...pages.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.p)];
  const chosen: SitePage[] = [];
  let used = 0;
  for (const p of ranked) {
    if (chosen.includes(p) || used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length;
  }
  const day = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric" }).format(Math.max(...pages.map(p => p.fetched_at_ms)));
  const index = pages.map(p => `- ${p.title || "(uden titel)"}: ${p.url}${chosen.includes(p) ? "" : " [kun titel]"}`);
  return `Hentet ${day}. ALLE ${pages.length} SIDER:\n${index.join("\n")}\n\n${chosen.map(p => `--- ${p.title || p.url} (${p.url}) ---\n${p.text}`).join("\n\n")}`;
}
