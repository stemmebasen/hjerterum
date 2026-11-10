import { translateUrl } from "../site/pages";

/** Douglas (3 Nov 2026): "When I click 'EN', I am no longer logged in." EN used to open the page through Google's own address
 * (…translate.goog), where our login does not reach. Now Google translates the page where it is - on hjerterum.info - so whoever is logged
 * in stays logged in, on the website and the member pages alike. The choice is kept in Google's own cookie (googtrans) for the whole domain,
 * so the next page opens in English too; DA takes it away. Should Google's script not come, EN falls back to Google's address as before. */

const COOKIE = "googtrans";
const domains = () => {
  const host = window.location.hostname;
  return /(^|\.)hjerterum\.info$/.test(host) ? ["", "; domain=.hjerterum.info", `; domain=${host}`] : [""];
};

export function englishOn(): boolean {
  try { return new RegExp(`(?:^|; )${COOKIE}=/da/en(?:;|$)`).test(document.cookie); } catch { return false; }
}

export function setEnglish(on: boolean): void {
  try {
    for (const domain of domains()) document.cookie = `${COOKIE}=${on ? "/da/en" : ""}${domain}; path=/; ${on ? "max-age=31536000" : "max-age=0"}; samesite=lax`;
  } catch { /* ignore */ }
  window.location.reload();
}

/** Google's translation changes the page's text nodes behind React's back; React must not stop the page for that (react#11538). */
function tolerateTranslation(): void {
  const proto = Node.prototype as Node & { __tolerant?: boolean };
  if (proto.__tolerant) return;
  proto.__tolerant = true;
  const removeChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child) as T;
  };
  const insertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, reference: Node | null): T {
    if (reference && reference.parentNode !== this) return insertBefore.call(this, node, null) as T;
    return insertBefore.call(this, node, reference) as T;
  };
}

const STYLE = `.goog-te-banner-frame,.skiptranslate>iframe,#goog-gt-tt,.goog-te-balloon-frame{display:none!important}body{top:0!important;position:static!important}
.goog-text-highlight{background:none!important;box-shadow:none!important}#google_translate_element{display:none}
html.retranslating body{opacity:.55;transition:opacity .15s}`;

/** Douglas (6 Nov 2026): "It does not translate to English on the 'My Profile' and 'Calendar' in 'My Page' pages. Also the booking request does not
 * translate." Google's widget translates the page once; what React shows afterwards - a page whose data comes later, the booking request opened
 * with a click - stays Danish. When new Danish text appears, the page is translated again: Google's own "Show original" and then "Translate" (its
 * hidden bar), the only way it offers. The page dims for that moment. */
const WORDS = /[a-zæøå]{3,}/i;
const OURS = "font,script,style,textarea,input,select,.skiptranslate,.notranslate,[translate=\"no\"],#google_translate_element";
function untranslated(node: Node): boolean {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
  if (!element || element.closest(OURS)) return false;
  return WORDS.test(node.textContent ?? "");
}
function bar(id: string): HTMLElement | null {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.skiptranslate")) {
    const found = frame.contentDocument?.getElementById(id) ?? null;
    if (found) return found;
  }
  return null;
}
function watchNewText(): void {
  // missed: new text came while Google was at work (fx the booking request opened just as the hall's free time came back) - one more round
  // for that, and no more: Google's own restoring brings Danish text back too, and that must not start rounds without end.
  let busy = false, missed = false, timer = 0;
  const html = document.documentElement;
  const again = (followUp: boolean) => {
    const restore = bar(":1.restore"), confirm = bar(":1.confirm");
    if (!restore || !confirm || !html.classList.contains("translated-ltr")) return;
    busy = true; missed = false;
    html.classList.add("retranslating");
    restore.click();
    let waited = 0;
    const next = window.setInterval(() => {
      waited += 100;
      if (html.classList.contains("translated-ltr") && waited < 400) return;
      window.clearInterval(next);
      // What came before this is in the page Google now translates (and Google's own restoring is not new text): only what comes after counts.
      missed = false;
      confirm.click();
      // Google adds its translation over a moment; what it changes then is not new text.
      window.setTimeout(() => {
        busy = false; html.classList.remove("retranslating");
        if (missed && !followUp) again(true);
        missed = false;
      }, 1500);
    }, 100);
  };
  new MutationObserver(changes => {
    const fresh = changes.some(change => [...change.addedNodes].some(untranslated) || (change.type === "characterData" && untranslated(change.target)));
    if (!fresh) return;
    if (busy) { missed = true; return; }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => again(false), 600);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** Labels Google cannot read right on their own. */
// Asked (4 Nov): "'Front' in the top menu in English should be 'Home'". Alone, "Om" became "Sore".
const PHRASES: Record<string, string> = { "Forside": "Home", "Om Hjerterum": "About Hjerterum", "Brug Hjerterum": "Use Hjerterum", "Bliv en del af Hjerterum": "Become part of Hjerterum" };
function keepPhrases(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (!parent || !((node.nodeValue ?? "").trim() in PHRASES)) return NodeFilter.FILTER_REJECT;
      return parent.closest('script,style,textarea,input,[translate="no"],.notranslate') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node as Text);
  for (const text of found) {
    const keep = document.createElement("span");
    keep.className = "notranslate kept";
    keep.setAttribute("translate", "no");
    text.replaceWith(keep);
    keep.appendChild(text);
    text.nodeValue = PHRASES[(text.nodeValue ?? "").trim()]!;
    keepSpaces(keep);
  }
  // Douglas (9-10 Nov 2026): "regnskab@holistisk.org does not translate correctly" ("regnsbak@…") - addresses are never translated.
  const element = root.nodeType === Node.ELEMENT_NODE ? root as Element : root.parentElement;
  const links = element ? [...(element.matches?.('a[href^="mailto:"]') ? [element] : []), ...element.querySelectorAll('a[href^="mailto:"]:not(.notranslate)')] : [];
  for (const link of links) {
    if (link.classList.contains("notranslate")) continue;
    link.classList.add("notranslate");
    link.setAttribute("translate", "no");
    keepSpaces(link);
  }
}
/** Google trims the spaces of the text around what it leaves alone ("at" + "About Hjerterum" became "atAbout Hjerterum"): the spaces are put
 * beside it, where Google does not reach. */
function keepSpaces(kept: Element): void {
  let outer: Element = kept;
  while (outer.parentElement && outer.parentElement.childNodes.length === 1 && /^(A|B|STRONG|EM|I|SPAN)$/.test(outer.parentElement.tagName)) outer = outer.parentElement;
  const space = () => { const s = document.createElement("span"); s.className = "notranslate"; s.setAttribute("translate", "no"); s.textContent = " "; return s; };
  const before = outer.previousSibling, after = outer.nextSibling;
  if (before?.nodeType === Node.TEXT_NODE && /\s$/.test(before.nodeValue ?? "") && (before.nodeValue ?? "").trim()) { before.nodeValue = (before.nodeValue ?? "").replace(/\s+$/, ""); outer.before(space()); }
  if (after?.nodeType === Node.TEXT_NODE && /^\s/.test(after.nodeValue ?? "") && (after.nodeValue ?? "").trim()) { after.nodeValue = (after.nodeValue ?? "").replace(/^\s+/, ""); outer.after(space()); }
}

/** Google turned "Hjerterum" into "Heart Room". The name used to be kept out of the text Google translates, but then Google translated the
 * sentence in pieces - Douglas (8-9 Nov 2026): "put your event in. Hjerterums calendar", "Do you want to use it yourself? Hjerterum?",
 * "CIRKLERSmall". Now Google gets the whole sentence, and the names are put back in its English afterwards. */
// Douglas (9 Nov 2026): "2021 – Goldsmith Street" - "Very accurate but not really Goldsmith Street, ha ha!" Street names stay Danish.
const NAMES: Array<[RegExp, string]> = [[/\b(?:the )?Heart ?(?:Room|room|Space|space|Rum|rum)\b/g, "Hjerterum"], [/\bCIRCLES\b/g, "CIRKLER"],
  [/\bGoldsmith(?:'s)? ?(?:Street|Lane|street|lane)\b/g, "Guldsmedgade"]];
export function englishNames(text: string): string {
  return NAMES.reduce((out, [pattern, name]) => out.replace(pattern, name), text);
}
/** Douglas (10 Nov 2026): "No space after these two email addresses" - "team@hjerterum.infoif something". The Danish has a comma after the address
 * (", hvis noget skal ændres"); Google leaves the comma out in English, and the space with it. After Google's work a space is put between an address
 * (or a kept name) and a word that runs into it. */
function spaceKept(): void {
  for (const kept of document.querySelectorAll('a[href^="mailto:"].notranslate, span.notranslate.kept')) {
    let outer: Element = kept;
    while (outer.parentElement && outer.parentElement.childNodes.length === 1 && /^(A|B|STRONG|EM|I|SPAN)$/.test(outer.parentElement.tagName)) outer = outer.parentElement;
    const after = outer.nextSibling, before = outer.previousSibling, text = outer.textContent ?? "";
    if (after && /^[\p{L}\p{N}]/u.test(after.textContent ?? "") && !/\s$/.test(text)) outer.after(document.createTextNode(" "));
    if (before && /[\p{L}\p{N}]$/u.test(before.textContent ?? "") && !/^\s/.test(text)) outer.before(document.createTextNode(" "));
  }
}
function fixNames(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest("font") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const fixed = englishNames(node.nodeValue ?? "");
    if (fixed !== node.nodeValue) node.nodeValue = fixed;
  }
}

/** Called once when the page starts: translates it in place when English is chosen. */
export function startTranslation(): void {
  if (typeof window === "undefined" || !englishOn() || /translate\.goog$/.test(window.location.hostname)) return;
  tolerateTranslation();
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  keepPhrases(document.body);
  let spacing = false;
  new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) continue;
      const root = node.nodeType === Node.TEXT_NODE ? node.parentNode ?? node : node;
      keepPhrases(root);
      fixNames(root);
    }
    if (!spacing) { spacing = true; requestAnimationFrame(() => { spacing = false; spaceKept(); }); }
  }).observe(document.body, { childList: true, subtree: true });
  const holder = document.createElement("div");
  holder.id = "google_translate_element";
  document.body.appendChild(holder);
  const w = window as unknown as { googleTranslateElementInit?: () => void; google?: { translate?: { TranslateElement: new (options: Record<string, unknown>, id: string) => unknown } } };
  let started = false;
  w.googleTranslateElementInit = () => {
    if (!w.google?.translate) return;
    started = true;
    new w.google.translate.TranslateElement({ pageLanguage: "da", includedLanguages: "en", autoDisplay: false }, "google_translate_element");
    watchNewText();
  };
  const fallBack = () => {
    if (started) return;
    for (const domain of domains()) document.cookie = `${COOKIE}=${domain}; path=/; max-age=0`;
    window.location.href = translateUrl(window.location.href);
  };
  const script = document.createElement("script");
  script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  script.onerror = fallBack;
  document.head.appendChild(script);
  window.setTimeout(fallBack, 10_000);
}
