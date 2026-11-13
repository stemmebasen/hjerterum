/** Requested (3 Nov 2026): "The new system is not picking up hidden links in the events. For example I have Source Breathwork as a link in the old
 * system, but it just gets the text but not the link." An event's description stays plain text (the source's HTML is never passed on), but a
 * link keeps its address as [text](address) - the event page shows it as a link; posters, shares and Saga get the text alone. */

/** A link written into a line: [text](https://…) or [text](mailto:…). */
const LINK = /\[([^\]\n]{1,300})\]\(((?:https?:\/\/|mailto:)[^\s)]{1,2000})\)/g;

export type LinePart = { text: string; href?: string; strong?: boolean; em?: boolean };

/** Douglas (13 Nov 2026): "When creating the text for events, I think we need an editor, where we can make bold/italic, and for making lists and
 * links etc. and emogis" - the chair: "Ja". The event form's buttons write **fed** and *kursiv* (and "- " for a list, [tekst](adresse) for a link). */
const EMPHASIS = /(\*\*[^*\n]+?\*\*|\*[^*\s\n](?:[^*\n]*?[^*\s\n])?\*)/g;
function emphasis(text: string, parts: LinePart[]): void {
  for (const piece of text.split(EMPHASIS)) {
    if (!piece) continue;
    if (/^\*\*[^*]+\*\*$/.test(piece)) parts.push({ text: piece.slice(2, -2), strong: true });
    else if (/^\*[^*\s](?:.*[^*\s])?\*$/.test(piece)) parts.push({ text: piece.slice(1, -1), em: true });
    else parts.push({ text: piece });
  }
}

/** A line as text and links - written links and bare web addresses alike. */
export function linkParts(line: string): LinePart[] {
  const parts: LinePart[] = [];
  const bare = (text: string) => {
    for (const piece of text.split(/(https?:\/\/[^\s<>"]+)/g)) if (piece) { if (/^https?:\/\//.test(piece)) parts.push({ text: piece.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: piece }); else emphasis(piece, parts); }
  };
  let at = 0;
  for (const match of line.matchAll(LINK)) {
    bare(line.slice(at, match.index));
    parts.push({ text: match[1]!, href: match[2]! });
    at = match.index! + match[0].length;
  }
  bare(line.slice(at));
  return parts;
}

/** The line without the addresses of its written links: what a poster, a share or Saga shows. */
export const plainLine = (line: string) => line.replace(LINK, "$1").replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/(^|[^*])\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*/g, "$1$2").replace(/^[-*]\s+/, "• ");
