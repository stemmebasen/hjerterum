const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (text: string) => escape(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** The small Markdown subset Saga writes (headings, bullet lists, paragraphs, bold) as HTML, so a
 * Google Doc made from it keeps its structure. */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let list = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!bullet && list) { out.push("</ul>"); list = false; }
    if (heading) out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    else if (bullet) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(bullet[1]!)}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return `<html><head><meta charset="utf-8"></head><body>${out.join("")}</body></html>`;
}

/** The "## <title>" section of a Markdown text, without its heading. */
export function section(markdown: string, title: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => /^#{1,3}\s+/.test(line) && title.test(line));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^#{1,2}\s+/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}
