/** Text helpers: source HTML is never passed on; it becomes plain paragraphs. */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ", oslash: "ø",
  Oslash: "Ø", eacute: "é", Eacute: "É", oacute: "ó", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä", Uuml: "Ü", Ouml: "Ö", Auml: "Ä",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", bull: "•", middot: "·",
  shy: "", zwj: "", zwnj: "", copy: "©", reg: "®", trade: "™", euro: "€", deg: "°", frac12: "½", times: "×"
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => safeCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name: string) => NAMED[name] ?? m);
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
}

/** HTML (or plain text) to paragraphs of plain text. Scripts and styles go, block ends become breaks. */
export function htmlToParagraphs(html: string, max = 80): string[] {
  const text = decodeEntities(html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<\s*(script|style|iframe|noscript)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, ""));
  return text.split(/\n/)
    .map(line => line.replace(/[\s ]+/g, " ").trim())
    .filter(line => line.length > 0 && !/^[_\-=~*.\s]{3,}$/.test(line))
    .slice(0, max);
}

export const collapse = (value: string | null | undefined): string => (value ?? "").replace(/[\s ]+/g, " ").trim();

/** Text for a URL: "Deep Shamanic Healing Journey" -> "deep-shamanic-healing-journey". */
export function slugify(value: string, maxLength = 70): string {
  const s = value.toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s.slice(0, maxLength).replace(/-+$/g, "") || "event");
}

const NOISE = /\b(aflyst|cancelled|canceled|udsolgt|sold out|nyhed|new|kun få pladser|få pladser|venteliste)\b/gi;

/** A title reduced to comparable words, for spotting the same event twice. */
export function normalizeTitle(title: string): string {
  return slugify(title.replace(NOISE, " "), 200).replace(/-/g, " ").trim();
}

/** Word overlap between two normalized titles (0..1), with one title containing the other counting as a match. */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) return 0.9;
  const wa = new Set(a.split(" ").filter(w => w.length > 1));
  const wb = new Set(b.split(" ").filter(w => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/** A short teaser from the description's first real sentences. */
export function summarize(paragraphs: string[], max = 220): string | null {
  const useful = paragraphs.filter(p => !/^(underviser|facilitator|instruktør|teacher|v\/)\s*[:.]/i.test(p) && p.length > 30);
  const text = collapse(useful.join(" "));
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + " …";
}

/** "Underviser: Lisa Mai Toft" and the like, from the first lines of a description. */
export function findHost(paragraphs: string[]): string | null {
  for (const p of paragraphs.slice(0, 8)) {
    const m = /^(?:undervisere?|facilitator(?:er)?|instruktør(?:er)?|teacher|guide|vært(?:er)?|ved|v\/)\s*[:.]?\s+(.{3,80})$/i.exec(p);
    if (m?.[1]) return collapse(m[1]).replace(/[.,;]+$/, "");
  }
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Text for LIKE search: lower case, one line. */
export const searchText = (...parts: Array<string | null | undefined>): string => collapse(parts.filter(Boolean).join(" ")).toLowerCase();
