/** The site's own small Markdown (site/pages.ts): headings, paragraphs, lists, quotes, images, tables, a fold-out
 * ("+++ Title" … "+++") and inline bold, italic and links. Everything is escaped first, so no HTML can come through. */

export const slugify = (text: string) => text.toLocaleLowerCase("da-DK").replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function link(label: string, href: string): string {
  const external = /^https?:\/\//.test(href);
  const safe = /^(https?:\/\/|mailto:|tel:|\/|#)/.test(href) ? href : "#";
  return `<a href="${escape(safe)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
}

export function inline(text: string): string {
  // Links first, on the raw text, so their labels still get bold/italic and their addresses stay intact.
  const parts: string[] = [];
  let rest = text, out = "";
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/;
  for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
    out += escape(rest.slice(0, m.index)) + `\u0000${parts.length}\u0000`;
    parts.push(link(emphasis(escape(m[1]!)), m[2]!));
    rest = rest.slice(m.index + m[0].length);
  }
  out = emphasis(out + escape(rest));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => parts[Number(i)]!);
}

const emphasis = (html: string) => html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");

export type Heading = { level: 2 | 3; text: string; id: string };

export function headings(markdown: string): Heading[] {
  return markdown.split(/\r?\n/).flatMap(line => {
    const m = /^(#{2,3})\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/.exec(line);
    return m ? [{ level: m[1]!.length as 2 | 3, text: m[2]!, id: m[3] ?? slugify(m[2]!) }] : [];
  });
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let table: string[][] | null = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${para.map((line, i) => inline(line.trimEnd()) + (i < para.length - 1 ? (/ {2}$/.test(line) ? "<br>" : " ") : "")).join("")}</p>`);
    para = [];
  };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(q => `<p>${inline(q)}</p>`).join("")}</blockquote>`); quote = []; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push(`<div class="site-table"><table><thead><tr>${head!.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    table = null;
  };
  const flush = () => { flushPara(); flushList(); flushQuote(); flushTable(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, (s) => (s.startsWith("  ") ? "  " : ""));
    const trimmed = line.trim();
    let m: RegExpExecArray | null;
    if (!trimmed) { flush(); continue; }
    if ((m = /^(#{2,3})\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/.exec(trimmed))) {
      flush();
      const level = m[1]!.length;
      out.push(`<h${level} id="${escape(m[3] ?? slugify(m[2]!))}">${inline(m[2]!)}</h${level}>`);
    } else if (trimmed === "---") {
      flush(); out.push("<hr>");
    } else if ((m = /^\+\+\+\s+(.+)$/.exec(trimmed))) {
      flush(); out.push(`<details><summary>${inline(m[1]!)}</summary>`);
    } else if (trimmed === "+++") {
      flush(); out.push("</details>");
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(trimmed))) {
      flush();
      const src = /^\/(media|dokumenter)\//.test(m[2]!) ? m[2]! : "";
      if (src) out.push(`<figure><img src="${escape(src)}" alt="${escape(m[1]!)}" loading="lazy">${m[3] ? `<figcaption>${inline(m[3])}</figcaption>` : ""}</figure>`);
    } else if (/^\|.*\|$/.test(trimmed)) {
      flushPara(); flushList(); flushQuote();
      const cells = trimmed.slice(1, -1).split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue;
      (table ??= []).push(cells);
    } else if ((m = /^[-*]\s+(.+)$/.exec(trimmed)) || (m = /^\d+\.\s+(.+)$/.exec(trimmed))) {
      flushPara(); flushQuote(); flushTable();
      const tag = /^\d/.test(trimmed) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(m[1]!);
    } else if ((m = /^>\s?(.*)$/.exec(trimmed))) {
      flushPara(); flushList(); flushTable();
      quote.push(m[1]!);
    } else {
      flushList(); flushQuote(); flushTable();
      para.push(line.replace(/^\s+/, ""));
    }
  }
  flush();
  return out.join("\n");
}
