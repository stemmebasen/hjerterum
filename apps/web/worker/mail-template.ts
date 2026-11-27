import { TEAM_MAIL } from "../site/mail.js";

/** Douglas (forslag #5, 27 Nov 2026): "Can it be made to look a bit more attractive and professional, at least with our logo." - "one common mail
 * template for all the system's mails, with Hjerterum's round logo at the top, the house colours, readable type, clear link buttons and a proper
 * footer". Every mail the system sends to people outside the team goes through hjerterumMail: the sign-up confirmation (guest-signup.ts), the
 * organiser's mail at each sign-up (event-signup-mail.ts), the welcome (member-welcome.ts), the donation receipt (donations.ts) and the login code
 * (login-mail.ts) - and a new kind of mail (e.g. a notice that a card payment failed) is built on it from the start.
 *
 * "Many mail apps block images, so the logo needs alt text and the mail must still make sense without images. It must look good on a phone and in
 * dark mode, and there should still be a plain-text version." One column of at most 600 px, tables and inline styles (what mail apps read), the
 * colours of Hjerterum Lys (lys.ts) with their dark twins, and the same words as plain text. The logo is the round mark on its own light disc, so it
 * reads on a light and a dark background alike; with images blocked its alt text "Hjerterum" stands in its place. */

export const MAIL_SITE = "https://www.hjerterum.info";
/** Served from public/brand, and open while the website is closed (site-closed.ts). */
export const MAIL_LOGO_PATH = "/brand/hjerterum-mail-logo.png";
export const MAIL_LOGO_URL = `${MAIL_SITE}${MAIL_LOGO_PATH}`;
export const MAIL_POSTAL = "Guldsmedgade 26B, 8000 Aarhus C";

export type MailLang = "da" | "en";
/** A run of words: plain, bold, or a link (http(s) or mailto). All of it is escaped. */
export type MailRun = string | { text: string; bold?: boolean; href?: string };
type Runs = string | MailRun[];
/** `text` is the block's words in the plain-text part when they should read otherwise than the HTML; null leaves the block out of it. */
type Plain = { text?: string | null };
export type MailBlock =
  | ({ heading: string } & Plain)
  | ({ p: Runs } & Plain)
  | ({ small: Runs } & Plain)
  | ({ box: Runs[]; title?: string } & Plain)
  | ({ code: string } & Plain)
  | ({ button: string; url: string } & Plain);

export type MailInput = {
  /** The mail's kind, shown small above the words (and the page title). */
  title: string;
  /** The line mail apps show after the subject in the inbox. */
  preheader?: string;
  lang?: MailLang;
  blocks: MailBlock[];
  /** The closing lines; "Varme hilsner / Hjerterum" unless given, none with null. */
  signoff?: string[] | null;
};

// Hjerterum Lys (lys.ts): --lys-bg, --lys-surface, --lys-soft, --lys-line, --lys-ink, --lys-muted, --lys-accent, --lys-accent-ink, --lys-terra.
const LIGHT = { bg: "#fbfaf8", surface: "#ffffff", soft: "#f6f3ef", line: "#ebe5dd", ink: "#2a2622", muted: "#766d64", accent: "#5b4a3f", accentInk: "#fffaf4", terra: "#94503f" };
const DARK = { bg: "#1f1d1a", surface: "#282521", soft: "#2f2b27", line: "#3a352f", ink: "#f3eee6", muted: "#bdb4a9", accent: "#e6cdb8", accentInk: "#2a211b", terra: "#e3a58f" };
const SANS = "Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const SIGNOFF: Record<MailLang, string[]> = { da: ["Varme hilsner", "Hjerterum"], en: ["Warm regards", "Hjerterum"] };

export const escapeMailHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const withBreaks = (text: string) => escapeMailHtml(text).replace(/\r?\n/g, "<br>");
const safeHref = (href: string | undefined) => href && /^(?:https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null;
const runsOf = (runs: Runs): MailRun[] => typeof runs === "string" ? [runs] : runs;

function runsHtml(runs: Runs): string {
  return runsOf(runs).map(run => {
    if (typeof run === "string") return withBreaks(run);
    let html = withBreaks(run.text);
    if (run.bold) html = `<strong>${html}</strong>`;
    const href = safeHref(run.href);
    return href ? `<a class="hr-link" href="${escapeMailHtml(href)}" style="color:${LIGHT.terra};text-decoration:underline">${html}</a>` : html;
  }).join("");
}

/** A link in plain text: its words and then the address, unless the words are the address. */
function runsText(runs: Runs): string {
  return runsOf(runs).map(run => {
    if (typeof run === "string") return run;
    const href = safeHref(run.href);
    if (!href) return run.text;
    const shown = href.replace(/^mailto:/i, "");
    return run.text.includes(shown) ? run.text : `${run.text} (${shown})`;
  }).join("");
}

const P = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${LIGHT.ink}`;

function blockHtml(block: MailBlock): string {
  if ("heading" in block) return `<h1 class="hr-ink" style="margin:0 0 18px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:400;color:${LIGHT.ink}">${withBreaks(block.heading)}</h1>`;
  if ("p" in block) return `<p class="hr-ink" style="${P}">${runsHtml(block.p)}</p>`;
  if ("small" in block) return `<p class="hr-muted" style="margin:0 0 16px;font-family:${SANS};font-size:14px;line-height:1.6;color:${LIGHT.muted}">${runsHtml(block.small)}</p>`;
  if ("box" in block) {
    const title = block.title ? `<strong>${withBreaks(block.title)}</strong><br>` : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-collapse:separate"><tr>`
      + `<td class="hr-box hr-ink" bgcolor="${LIGHT.soft}" style="background:${LIGHT.soft};border:1px solid ${LIGHT.line};border-radius:14px;padding:16px 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${LIGHT.ink}">`
      + `${title}${block.box.map(runsHtml).join("<br>")}</td></tr></table>`;
  }
  if ("code" in block) return `<p class="hr-code" style="margin:0 0 18px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;line-height:1.2;font-weight:600;letter-spacing:.18em;color:${LIGHT.accent}">${escapeMailHtml(block.code)}</p>`;
  const url = safeHref(block.url);
  if (!url) return `<p class="hr-ink" style="${P}">${escapeMailHtml(block.button)}</p>`;
  // A button that is a link with padding: it works where styles are cut, and the whole of it is the tap target on a phone.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;border-collapse:separate"><tr>`
    + `<td class="hr-btn" align="center" bgcolor="${LIGHT.accent}" style="border-radius:999px;background:${LIGHT.accent}">`
    + `<a class="hr-btn-a" href="${escapeMailHtml(url)}" target="_blank" style="display:inline-block;padding:13px 28px;border-radius:999px;background:${LIGHT.accent};color:${LIGHT.accentInk};font-family:${SANS};font-size:16px;line-height:1.2;font-weight:600;text-decoration:none">${escapeMailHtml(block.button)}</a>`
    + `</td></tr></table>`;
}

function blockText(block: MailBlock): string | null {
  if (block.text !== undefined) return block.text;
  if ("heading" in block) return block.heading;
  if ("p" in block) return runsText(block.p);
  if ("small" in block) return runsText(block.small);
  if ("box" in block) return [block.title, ...block.box.map(runsText)].filter(Boolean).join("\n");
  if ("code" in block) return block.code;
  return `${block.button}: ${block.url}`;
}

const DARK_RULES = (pre: string) => [
  `${pre}.hr-bg{background:${DARK.bg}!important}`,
  `${pre}.hr-card{background:${DARK.surface}!important;border-color:${DARK.line}!important}`,
  `${pre}.hr-ink{color:${DARK.ink}!important}`,
  `${pre}.hr-muted{color:${DARK.muted}!important}`,
  `${pre}.hr-link,${pre}.hr-kicker{color:${DARK.terra}!important}`,
  `${pre}.hr-box{background:${DARK.soft}!important;border-color:${DARK.line}!important}`,
  `${pre}.hr-code{color:${DARK.accent}!important}`,
  `${pre}.hr-btn,${pre}.hr-btn-a{background:${DARK.accent}!important}`,
  `${pre}.hr-btn-a{color:${DARK.accentInk}!important}`
].join("");

/** The mail as HTML and as plain text. */
export function hjerterumMail(input: MailInput): { html: string; text: string } {
  const lang = input.lang ?? "da";
  const signoff = input.signoff === null ? [] : input.signoff ?? SIGNOFF[lang];
  const site = MAIL_SITE.replace(/^https:\/\//, "");
  const body = input.blocks.map(blockHtml).join("")
    + (signoff.length ? `<p class="hr-ink" style="margin:8px 0 0;font-family:${SANS};font-size:16px;line-height:1.6;color:${LIGHT.ink}">${signoff.map(withBreaks).join("<br>")}</p>` : "");
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;opacity:0;color:transparent">${escapeMailHtml(input.preheader)}${"&#8199;&#65279;&#847; ".repeat(12)}</div>`
    : "";
  const html = `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeMailHtml(input.title)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
img{border:0;outline:none;text-decoration:none}
@media only screen and (max-width:620px){.hr-outer{padding:20px 10px!important}.hr-pad{padding:26px 20px!important}.hr-btn-a{display:block!important}}
@media (prefers-color-scheme:dark){${DARK_RULES("")}}
${DARK_RULES("[data-ogsc] ")}${DARK_RULES("[data-ogsb] ")}
</style>
</head>
<body class="hr-bg" style="margin:0;padding:0;background:${LIGHT.bg}">
${preheader}<table role="presentation" class="hr-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT.bg}" style="background:${LIGHT.bg}">
<tr><td class="hr-outer" align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 20px">
<a href="${MAIL_SITE}" style="text-decoration:none"><img class="hr-ink" src="${MAIL_LOGO_URL}" width="96" height="96" alt="Hjerterum" style="display:block;width:96px;height:96px;border:0;font-family:${SERIF};font-size:20px;line-height:96px;letter-spacing:.2em;text-align:center;color:${LIGHT.ink}"></a>
</td></tr>
<tr><td class="hr-card hr-pad" bgcolor="${LIGHT.surface}" style="background:${LIGHT.surface};border:1px solid ${LIGHT.line};border-radius:20px;padding:34px 36px">
<p class="hr-kicker" style="margin:0 0 14px;font-family:${SANS};font-size:12px;line-height:1.4;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:${LIGHT.terra}">${escapeMailHtml(input.title)}</p>
${body}
</td></tr>
<tr><td class="hr-muted" align="center" style="padding:24px 16px 0;font-family:${SANS};font-size:13px;line-height:1.7;color:${LIGHT.muted}">
<strong>Hjerterum</strong> · ${escapeMailHtml(MAIL_POSTAL)}<br>
<a class="hr-link" href="mailto:${TEAM_MAIL}" style="color:${LIGHT.terra};text-decoration:underline">${TEAM_MAIL}</a> · <a class="hr-link" href="${MAIL_SITE}" style="color:${LIGHT.terra};text-decoration:underline">${site}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const parts = input.blocks.map(blockText).filter((t): t is string => t !== null && t !== "");
  if (signoff.length) parts.push(signoff.join("\n"));
  parts.push(`--\nHjerterum · ${MAIL_POSTAL}\n${TEAM_MAIL} · ${site}`);
  return { html, text: parts.join("\n\n") };
}
