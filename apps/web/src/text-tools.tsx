import { useState, type RefObject } from "react";

/** Douglas (13 Nov 2026): "When creating the text for events, I think we need an editor, where we can make bold/italic, and for making lists and
 * links etc. and emogis" - the chair: "Ja". Small buttons over the description: they write **fed**, *kursiv*, "- " for a list and [tekst](adresse)
 * for a link into the text, and the event page shows them so (site/event-links.ts, event-page.tsx). The text stays plain text everywhere else. */
const EMOJIS = ["✨", "🌿", "❤️", "🙏", "🧘", "🎶", "🌙", "🌞", "🌸", "🔥", "💫", "☕️", "🍲", "📅", "📍", "⏰"];

export function TextTools({ field }: { field: RefObject<HTMLTextAreaElement | null> }) {
  const [emojis, setEmojis] = useState(false);
  const change = (edit: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = field.current;
    if (!el) return;
    const done = edit(el.value, el.selectionStart, el.selectionEnd);
    el.value = done.text;
    el.focus();
    el.setSelectionRange(done.start, done.end);
    // The word count and Saga's reading follow the field (event-text-help.tsx).
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const wrap = (mark: string, sample: string) => change((text, start, end) => {
    const chosen = text.slice(start, end) || sample;
    return { text: text.slice(0, start) + mark + chosen + mark + text.slice(end), start: start + mark.length, end: start + mark.length + chosen.length };
  });
  const list = () => change((text, start, end) => {
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const lines = text.slice(from, end).split("\n").map(line => /^[-*•]\s/.test(line) || !line.trim() ? line : "- " + line);
    const block = lines.join("\n") || "- ";
    return { text: text.slice(0, from) + block + text.slice(end), start: from + block.length, end: from + block.length };
  });
  const link = () => {
    const address = window.prompt("Linkets adresse (fx https://…)", "https://");
    if (!address || !/^(https?:\/\/|mailto:)\S+$/.test(address.trim())) return;
    change((text, start, end) => {
      const label = (text.slice(start, end) || "Læs mere").replace(/[[\]]/g, "");
      const written = `[${label}](${address.trim()})`;
      return { text: text.slice(0, start) + written + text.slice(end), start: start + written.length, end: start + written.length };
    });
  };
  const emoji = (e: string) => change((text, start, end) => ({ text: text.slice(0, start) + e + text.slice(end), start: start + e.length, end: start + e.length }));
  return <div className="text-tools" role="toolbar" aria-label="Formatér teksten">
    <button type="button" onClick={() => wrap("**", "fed tekst")} title="Fed"><b>F</b></button>
    <button type="button" onClick={() => wrap("*", "kursiv tekst")} title="Kursiv"><i>K</i></button>
    <button type="button" onClick={list} title="Punktliste">• Liste</button>
    <button type="button" onClick={link} title="Link">Link</button>
    <button type="button" onClick={() => setEmojis(!emojis)} aria-expanded={emojis} title="Emojis">🙂</button>
    {emojis && <span className="text-tools-emojis">{EMOJIS.map(e => <button type="button" key={e} onClick={() => emoji(e)}>{e}</button>)}</span>}
    <small>Markér tekst og tryk på en knap. Eventsiden viser det som fed, kursiv, liste og link.</small>
  </div>;
}
