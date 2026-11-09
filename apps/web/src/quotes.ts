/** Reported (the chair, 10 Nov 2026): "sørg for, at man altid får hele sætninger, der faktisk betyder noget. Lige nu har du brudt sætninger op" - "det er mere
 * bare, at citaterne er fuldstændige." The event description came in lines, and a sentence that ran on to the next line was cut. The whole text is read
 * as one, and only whole sentences are offered: beginning with a capital, ending with . ! ? or …, not cut at "kl. 19.30" or "d. 10. november". */
export function wholeSentences(lines: string[]): string[] {
  // Lines that belong together (a sentence running on) are one paragraph; an empty line or a finished sentence ends it.
  const paragraphs: string[] = [];
  let open = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (open) paragraphs.push(open); open = ""; continue; }
    open = open ? `${open} ${line}` : line;
    if (/[.!?…:]["”»)]?$/.test(line)) { paragraphs.push(open); open = ""; }
  }
  if (open) paragraphs.push(open);
  return paragraphs.flatMap(p => p.replace(/\s+/g, " ").split(/(?<=[.!?…]["”»)]?)\s+(?=["“«(]?[A-ZÆØÅ])/))
    .map(s => s.trim())
    .filter(s => /^["“«(]?[A-ZÆØÅ]/.test(s) && /[.!?…]["”»)]?$/.test(s) && s.length >= 30 && s.length <= 220 && !/https?:|www\.|\bkr\.?(\s|$)|\bpris\b/i.test(s));
}

/** The quotes to step through: the teacher's own words as given, then the description's whole sentences - each once. */
export function quoteChoices(own: Array<string | null | undefined>, lines: string[]): string[] {
  return [...own.map(q => (q ?? "").trim()).filter(q => q.length >= 15 && q.length <= 300), ...wholeSentences(lines)].filter((q, i, all) => all.indexOf(q) === i);
}
