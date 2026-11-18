import { englishPath } from "./paths.js";
import { EN_TEXT, EN_RULES } from "./en.js";

/** Turns a rendered Danish page into its English version: the visible text and the readable attributes are looked up
 * in the dictionary (src/i18n/en.ts), and every link, form and redirect inside the portal moves to its /en/ address.
 * Text that is not in the dictionary stays as it is: that is how arrangements' own titles and descriptions (written
 * by the organisers, in Danish) keep their original wording. */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const decode = (s: string) => s.replace(/&nbsp;/g, "\u00a0").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Answers already worked out, kept between requests while the Worker lives (the same texts recur on every page). */
const seen = new Map<string, string | null>();

/** English for a piece of Danish text (already decoded, whitespace collapsed), or null when there is none. */
export function translateText(text: string): string | null {
  const core = norm(text);
  if (!core) return null;
  if (Object.hasOwn(EN_TEXT, core)) return EN_TEXT[core]!;
  if (seen.has(core)) return seen.get(core)!;
  const found = byRule(core);
  if (seen.size > 5000) seen.clear();
  seen.set(core, found);
  return found;
}

function byRule(core: string): string | null {
  for (const [pattern, to] of EN_RULES) {
    const m = pattern.exec(core);
    if (!m) continue;
    const en = to(m);
    if (en !== null) return en;
  }
  return null;
}

/** A piece of text in English if known, else unchanged: for the parts of a rule. */
export const t = (text: string): string => translateText(text) ?? text;

function translateNode(raw: string): string {
  if (!/[A-Za-zÆØÅæøå]/.test(raw)) return raw;
  const lead = /^\s*/.exec(raw)![0], trail = /\s*$/.exec(raw)![0];
  const en = translateText(decode(raw));
  return en === null ? raw : lead + encode(en) + trail;
}

const TEXT_ATTRS = new Set(["aria-label", "placeholder", "title", "alt", "data-label", "data-empty", "data-confirm"]);
const LINK_ATTRS = new Set(["href", "action", "formaction"]);

function translateTag(tag: string, base = ""): string {
  if (/^<[!/]/.test(tag)) return tag;
  const name = /^<([a-zA-Z0-9-]+)/.exec(tag)?.[1]?.toLowerCase() ?? "";
  // An element marked hreflang (the language switch) keeps its address.
  const keepLinks = /\shreflang="/.test(tag);
  const meta = name === "meta" && /\s(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"/.test(tag);
  const button = name === "input" && /\stype="(?:submit|button)"/.test(tag);
  return tag.replace(/(\s)([a-zA-Z:-]+)="([^"]*)"/g, (all, sp: string, attr: string, value: string) => {
    const a = attr.toLowerCase();
    if (LINK_ATTRS.has(a)) {
      if (keepLinks) return all;
      const inside = base && (value === base || value.startsWith(base + "/")) ? base + englishPath(value.slice(base.length) || "/") : englishPath(value);
      return `${sp}${attr}="${inside}"`;
    }
    if (TEXT_ATTRS.has(a) || (a === "content" && meta) || (a === "value" && button)) {
      const en = translateText(decode(value));
      if (en !== null) return `${sp}${attr}="${encode(en)}"`;
      // A title or description from a template with a value in it ("Meditation i Aarhus – 12 arrangementer").
      return all;
    }
    return all;
  });
}

/** schema.org data: names and descriptions through the dictionary, the portal's own addresses to /en/. */
function translateJson(value: unknown, origin: string, key = ""): unknown {
  if (typeof value === "string") {
    if (key === "@id") return value;
    if (value.startsWith(origin + "/") || value === origin) return origin + englishPath(value.slice(origin.length) || "/");
    if (["name", "description", "keywords"].includes(key)) return t(value);
    if (key === "inLanguage" && value === "da") return value;
    return value;
  }
  if (Array.isArray(value)) return value.map(v => translateJson(v, origin, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translateJson(v, origin, k)]));
  return value;
}

/** The whole page. Script and style contents, and text people typed (textarea), are left alone except JSON-LD. */
export function translateHtml(page: string, origin: string, base = ""): string {
  const out: string[] = [];
  const re = /<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    const piece = m[0];
    if (m[1]) {
      const open = /^<[^>]+>/.exec(piece)![0];
      const close = `</${m[1]}>`;
      let inner = piece.slice(open.length, piece.length - close.length);
      if (/type="application\/ld\+json"/.test(open)) {
        try { inner = JSON.stringify(translateJson(JSON.parse(inner), origin)).replace(/</g, "\\u003c"); } catch { /* left as it was */ }
      }
      out.push(translateTag(open, base) + inner + close);
    } else if (piece.startsWith("<")) out.push(piece.startsWith("<!--") ? piece : translateTag(piece, base));
    else out.push(translateNode(piece));
  }
  return out.join("");
}
