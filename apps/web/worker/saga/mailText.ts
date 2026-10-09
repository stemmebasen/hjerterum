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
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
