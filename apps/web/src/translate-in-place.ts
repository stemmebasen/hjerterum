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
.goog-text-highlight{background:none!important;box-shadow:none!important}#google_translate_element{display:none}`;

/** Google turned "Hjerterum" into "Heart Room" and "Heart Space". The name (and CIRKLER) is kept: each time it appears in the page's text, it
 * is put in a span Google leaves alone - also in what the page shows later. */
/** Labels Google cannot read right once the name is kept out of them. */
const PHRASES: Record<string, string> = { "Om Hjerterum": "About Hjerterum", "Brug Hjerterum": "Use Hjerterum", "Bliv en del af Hjerterum": "Become part of Hjerterum" };
// The spaces around the name go with it: Google trims them from the text it translates ("af Hjerterum" became "ofHjerterum").
const NAME = /\s?(?:Hjerterums?|CIRKLER)\s?/g;
function keepNames(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (!parent || !NAME.test(node.nodeValue ?? "")) { NAME.lastIndex = 0; return NodeFilter.FILTER_REJECT; }
      NAME.lastIndex = 0;
      return parent.closest('script,style,textarea,input,[translate="no"],.notranslate') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node as Text);
  for (const text of found) {
    // A short label is said whole: alone, "Om" became "Sore".
    const whole = PHRASES[(text.nodeValue ?? "").trim()];
    if (whole) {
      const keep = document.createElement("span");
      keep.className = "notranslate";
      keep.setAttribute("translate", "no");
      text.replaceWith(keep);
      keep.appendChild(text);
      text.nodeValue = whole;
      continue;
    }
    let node: Text = text;
    for (let match = NAME.exec(node.nodeValue ?? ""); match; match = NAME.exec(node.nodeValue ?? "")) {
      const name = node.splitText(match.index);
      const rest = name.splitText(match[0].length);
      const keep = document.createElement("span");
      keep.className = "notranslate";
      keep.setAttribute("translate", "no");
      name.replaceWith(keep);
      keep.appendChild(name);
      node = rest;
      NAME.lastIndex = 0;
    }
    NAME.lastIndex = 0;
  }
}

/** Called once when the page starts: translates it in place when English is chosen. */
export function startTranslation(): void {
  if (typeof window === "undefined" || !englishOn() || /translate\.goog$/.test(window.location.hostname)) return;
  tolerateTranslation();
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  keepNames(document.body);
  new MutationObserver(changes => { for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) keepNames(node.nodeType === Node.TEXT_NODE ? node.parentNode ?? node : node); })
    .observe(document.body, { childList: true, subtree: true });
  const holder = document.createElement("div");
  holder.id = "google_translate_element";
  document.body.appendChild(holder);
  const w = window as unknown as { googleTranslateElementInit?: () => void; google?: { translate?: { TranslateElement: new (options: Record<string, unknown>, id: string) => unknown } } };
  let started = false;
  w.googleTranslateElementInit = () => {
    if (!w.google?.translate) return;
    started = true;
    new w.google.translate.TranslateElement({ pageLanguage: "da", includedLanguages: "en", autoDisplay: false }, "google_translate_element");
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
