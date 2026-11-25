/** Douglas (25 Nov 2026), in English: "I think the problem with the numbers on this section is only to do with the translation as it seems to be OK in
 * danish." A translation in the browser (Google's or Chrome's own) changes the page's words behind React's back; when React then changes a time or a
 * number in place, the old translated words can stay on the screen. A text that changes is drawn as a new element each time it changes (its key is
 * the text), so the browser shows the new words - translated anew - and never the old ones. */
export function Live({ text, className }: { text: string; className?: string }) {
  return <span key={text} className={className}>{text}</span>;
}
