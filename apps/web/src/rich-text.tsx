import { useEffect, useRef, useState, type RefObject } from "react";
import { linkParts } from "../site/event-links";

/** Douglas (17-18 Nov 2026), for the board: "I can see we have an editor now, but is it possible to have a WYSIWYG one, where the bold and italic etc
 * shows in the editor?" The event text is written in a field that shows fed, kursiv, lists and links as they will look. Underneath it is the same plain
 * text as before (**fed**, *kursiv*, "- " for a list, [tekst](adresse) for a link) in the form's hidden field, so the word count, Saga's reading,
 * saving and the event page work as they did (site/event-links.ts, event-page.tsx). */

const EMOJIS = ["✨", "🌿", "❤️", "🙏", "🧘", "🎶", "🌙", "🌞", "🌸", "🔥", "💫", "☕️", "🍲", "📅", "📍", "⏰"];
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The stored text as HTML for the field. */
export function textToHtml(text: string): string {
  const inline = (line: string) => linkParts(line).map(p => p.href ? `<a href="${esc(p.href)}">${esc(p.text)}</a>` : p.strong ? `<b>${esc(p.text)}</b>` : p.em ? `<i>${esc(p.text)}</i>` : esc(p.text)).join("");
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map(i => `<li>${i}</li>`).join("")}</ul>`); list = []; } };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const item = /^[-*•]\s+(.*)$/.exec(line);
    if (item) { list.push(inline(item[1]!)); continue; }
    flush();
    out.push(`<div>${line ? inline(line) : "<br>"}</div>`);
  }
  flush();
  return out.join("");
}

/** The field's HTML back to the stored text. Anything else (pasted styles, fonts, colours) is left out. */
export function htmlToText(root: Node): string {
  const lines: string[] = [];
  let line = "";
  // After a <br> the block's own end is not a second line break (<div><br></div> is one empty line).
  let broke = false;
  const end = () => { lines.push(line.replace(/ /g, " ").replace(/[ \t]+$/g, "")); line = ""; };
  const walk = (node: Node, mark = "", inLi = false): void => {
    if (node.nodeType === 3) { line += node.textContent ?? ""; if (node.textContent) broke = false; return; }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement, tag = el.tagName;
    if (tag === "BR") { end(); broke = true; return; }
    const block = /^(DIV|P|H[1-6]|BLOCKQUOTE)$/.test(tag);
    if (block && !inLi && line) end();
    if (block) broke = false;
    if (tag === "LI") { if (line) end(); line = "- "; el.childNodes.forEach(c => walk(c, mark, true)); end(); return; }
    if (tag === "UL" || tag === "OL") { if (line) end(); el.childNodes.forEach(c => walk(c)); return; }
    const style = el.style;
    const bold = tag === "B" || tag === "STRONG" || style.fontWeight === "bold" || Number(style.fontWeight) >= 600;
    const italic = tag === "I" || tag === "EM" || style.fontStyle === "italic";
    if (tag === "A" && el.getAttribute("href")) {
      const text = (el.textContent ?? "").replace(/[[\]]/g, "").trim();
      const href = el.getAttribute("href")!.trim();
      line += /^(https?:\/\/|mailto:)/.test(href) && text ? `[${text}](${href})` : text;
      return;
    }
    const wrap = bold && mark !== "**" ? "**" : italic && mark !== "*" ? "*" : "";
    if (wrap) {
      const before = line; line = "";
      el.childNodes.forEach(c => walk(c, wrap, inLi));
      const inner = line; line = before;
      // The marks go around the words, with the spaces outside (** fed** would not be read as fed).
      const lead = /^\s*/.exec(inner)![0], trail = /\s*$/.exec(inner)![0], core = inner.trim();
      line += core ? `${lead}${wrap}${core}${wrap}${trail}` : inner;
      return;
    }
    el.childNodes.forEach(c => walk(c, mark, inLi));
    if (block && !inLi && (line || !broke)) end();
    if (block) broke = false;
  };
  root.childNodes.forEach(c => walk(c));
  if (line) end();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}

export function RichText({ field, name, defaultValue, placeholder, id }: { field: RefObject<HTMLTextAreaElement | null>; name: string; defaultValue: string; placeholder?: string; id?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const writing = useRef(false);
  const [emojis, setEmojis] = useState(false);
  const [empty, setEmpty] = useState(!defaultValue.trim());

  // The field's words into the hidden text, and the text into the field when someone else changes it (Saga's suggestion).
  const sync = () => {
    const el = field.current, b = box.current;
    if (!el || !b) return;
    const text = htmlToText(b);
    setEmpty(!text.trim());
    if (text === el.value) return;
    el.value = text;
    writing.current = true;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    writing.current = false;
  };
  useEffect(() => {
    const el = field.current, b = box.current;
    if (!el || !b) return;
    b.innerHTML = textToHtml(el.value);
    const fromOutside = () => { if (writing.current) return; b.innerHTML = textToHtml(el.value); setEmpty(!el.value.trim()); };
    el.addEventListener("input", fromOutside);
    return () => el.removeEventListener("input", fromOutside);
  }, [field]);

  const run = (command: string, value?: string) => {
    box.current?.focus();
    document.execCommand(command, false, value);
    sync();
  };
  const link = () => {
    const address = window.prompt("Linkets adresse (fx https://…)", "https://");
    if (!address || !/^(https?:\/\/|mailto:)\S+$/.test(address.trim())) return;
    const chosen = window.getSelection()?.toString();
    if (chosen) run("createLink", address.trim());
    else run("insertHTML", `<a href="${esc(address.trim())}">Læs mere</a>&nbsp;`);
  };

  return <div className="rich-text">
    <div className="text-tools" role="toolbar" aria-label="Formatér teksten">
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run("bold")} title="Fed"><b>F</b></button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run("italic")} title="Kursiv"><i>K</i></button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run("insertUnorderedList")} title="Punktliste">• Liste</button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={link} title="Link">Link</button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setEmojis(!emojis)} aria-expanded={emojis} title="Emojis">🙂</button>
      {emojis && <span className="text-tools-emojis">{EMOJIS.map(e => <button type="button" key={e} onMouseDown={ev => ev.preventDefault()} onClick={() => run("insertText", e)}>{e}</button>)}</span>}
    </div>
    <div ref={box} id={id} className={"rich-text-box" + (empty ? " is-empty" : "")} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
      aria-label="Beskrivelse" data-placeholder={placeholder} onInput={sync} onBlur={sync}
      onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); sync(); }} />
    <textarea ref={field} name={name} defaultValue={defaultValue} hidden readOnly={false} aria-hidden="true" tabIndex={-1} />
  </div>;
}
