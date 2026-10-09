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
