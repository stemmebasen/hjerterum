/** Requested: "Se, om ikke vi kan sortere kodesprog fra i selve mailen" - links, tracking and signature footers are
 * code to a reader. The words stay; the addresses stay (a reply goes to one); links and mail-program leftovers go. */
export function cleanMailText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/gi, "$1")
    .replace(/<\s*(?:https?:\/\/|www\.)[^>]*>/gi, " ")
    .replace(/<#[0-9a-f-]{8,}>/gi, " ")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi, " ")
    .replace(/(?:Virus-free|Virusfri)\.?\s*/gi, " ")
    .replace(/\[(?:cid|image):[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LINKS = (text: string) => text
  .replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/gi, "$1")
  .replace(/<\s*(?:https?:\/\/|www\.)[^>]*>/gi, " ")
  .replace(/<#[0-9a-f-]{8,}>/gi, " ")
  .replace(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi, " ")
  .replace(/(?:Virus-free|Virusfri)\.?[ \t]*/gi, " ")
  .replace(/\[(?:cid|image):[^\]]*\]/gi, " ");

/** What is stored of a mail: the same clean words, but with its line breaks (at most one empty line), so it can be read. */
export function mailBody(text: string): string {
  return LINKS(text).replace(/\r/g, "").split("\n").map(line => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Requested: "En mail gengivet som denne er næsten ubrugelig, fordi teksten uden linjeskift er så massiv": a mail is shown with a line for each
 * "Navn: ..." of a form, and without the empty fields and the file-storage boilerplate of the booking form. Mails stored before the line breaks
 * were kept are broken at the labels. */
export function readableMail(text: string): string {
  let out = mailBody(text);
  out = out.replace(/\s*Bemærkninger:\s*Instagram:[\s\S]*?(?:PR-materiale:[\s\S]*)$/i, "");
  out = out.replace(/[ \t]*[\p{L}][\p{L} -]{1,40}:[ \t]*\((?:Ingen|Intet)[^)]*\)/giu, "");
  if (!out.includes("\n")) out = out.replace(/ ?(---[^-]+---)/g, "\n$1\n").replace(/ (?=[A-ZÆØÅ][\p{L}().-]*(?: [a-zæøå(][\p{L}().-]*){0,4}: )/gu, "\n");
  // Requested: "du skal huske at tilføje linjeskift i mailsene. Ellers bliver de alt for uoverskuelige" - rules of dashes become breaks,
  // the greeting stands alone, and a long block is cut into paragraphs of a couple of sentences.
  out = out.replace(/[ \t]*-{5,}[ \t]*/g, "\n");
  out = out.split("\n").map(paragraphs).join("\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const GREETING = /^((?:Kære|Hej|Hi|Hello|Dear|Godmorgen|Goddag)(?: [\p{Lu}][\p{L}-]+){0,2}[,!]?) (?=[\p{Lu}])/u;
function paragraphs(line: string): string {
  let rest = line.trim(), head = "";
  const greeting = GREETING.exec(rest);
  if (greeting && rest.length > 120) { head = `${greeting[1]}\n\n`; rest = rest.slice(greeting[0].length); }
  if (rest.length <= 280) return head + rest;
  const sentences = rest.split(/(?<=[.!?…])\s+(?=["“„(]?[\p{Lu}0-9])/u);
  const parts: string[] = [];
  let part = "";
  for (const sentence of sentences) {
    if (part && (part.length + sentence.length > 260)) { parts.push(part); part = sentence; } else part = part ? `${part} ${sentence}` : sentence;
  }
  if (part) parts.push(part);
  return head + parts.join("\n\n");
}

/** One or two lines to see what a mail is about before opening it: the text without the greeting and the breaks. */
export function mailSnippet(text: string, max = 180): string {
  const flat = readableMail(text).replace(/\s+/g, " ").trim().replace(GREETING, "");
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, "")} …` : flat;
}
