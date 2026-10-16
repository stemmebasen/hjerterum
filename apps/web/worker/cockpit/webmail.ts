import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { openPassword, teamMailAccount } from "../saga/teamMail.js";
import { esc, layout } from "./page.js";
import { composeRoute } from "./webmailCompose.js";

/** Requested: "Posthus skal udbygges så det er en sand webmail med alle mapper, med alle svarmuligheder, og alle almindelige funktioner. Findes der
 * ikke en skabelon du kan bruge så vi ikke skal starte helt forfra med børnesygdomme?" - then: "Det vigtige er at alt kan holdes indenfor admin og at
 * det er let at automatisere og køre AI indover" - "Ja". The mailbox itself in admin, on the same tried pieces Saga already reads team@ with:
 * ImapFlow for the mailbox (folders, lists, search, flags) and mailparser for the mails. Step 1: reading - every folder, the list with search and
 * pages, a mail shown safely (its HTML in a frame of its own that may run nothing and fetch nothing, unless one asks for its pictures), its
 * attachments, read and unread. */

const DAY = 86_400_000;
const PAGE = 40;
const ZONE = "Europe/Copenhagen";
const MAX_SOURCE = 25 * 1024 * 1024;

export type WebFolder = { path: string; name: string; special: string | null; depth: number; unseen: number; total: number; selectable: boolean };
export type WebListItem = { uid: number; date: number; from: string; fromAddress: string; to: string; subject: string; seen: boolean; flagged: boolean; answered: boolean; attachments: boolean };
export type WebmailSession = {
  folders(): Promise<WebFolder[]>;
  list(path: string, page: number, size: number, query: string): Promise<{ total: number; items: WebListItem[] }>;
  /** The whole message as it is on the server; null when it is not there (any more). */
  source(path: string, uid: number): Promise<{ source: Uint8Array; seen: boolean; flagged: boolean } | null>;
  /** Sets or takes a flag (\\Seen read, \\Flagged flagged) on mails in a folder. */
  setFlag(path: string, uids: number[], flag: "\\Seen" | "\\Flagged" | "\\Answered", on: boolean): Promise<void>;
  /** Lays a whole message in a folder (a sent mail in Sendt, a draft in Kladder). */
  append(path: string, raw: Uint8Array, flags: string[]): Promise<void>;
  uidValidity(path: string): Promise<string>;
  /** Moves mails to another folder; the folder's UIDVALIDITY says which mails they were (Posthus knows them by it). */
  move(path: string, uids: number[], dest: string): Promise<{ uidValidity: string }>;
  /** Deletes mails for good (from Papirkurv). */
  remove(path: string, uids: number[]): Promise<{ uidValidity: string }>;
  close(): Promise<void>;
};
export type WebmailLogin = { host: string; user: string; password: string };
export type WebmailOpener = (login: WebmailLogin) => Promise<WebmailSession>;

// ---- Folders: what a mail program calls them, in the order one expects ----

const SPECIAL_NAME: Record<string, string> = { "\\Inbox": "Indbakke", "\\Drafts": "Kladder", "\\Sent": "Sendt", "\\Archive": "Arkiv", "\\Junk": "Spam", "\\Trash": "Papirkurv" };
const SPECIAL_ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Archive", "\\Junk", "\\Trash"];

/** A folder's name from its path alone (the mail's page does not ask the server for the list): "INBOX.Sent" is Sendt. */
const COMMON: Record<string, string> = { inbox: "Indbakke", sent: "Sendt", "sent items": "Sendt", "sent messages": "Sendt", drafts: "Kladder", trash: "Papirkurv", "deleted items": "Papirkurv",
  junk: "Spam", spam: "Spam", archive: "Arkiv" };
export function folderName(path: string): string {
  const last = path.split(/[./]/).filter(Boolean).pop() ?? path;
  return COMMON[last.toLowerCase()] ?? last;
}

export function orderFolders(folders: WebFolder[]): WebFolder[] {
  const rank = (f: WebFolder) => f.special ? SPECIAL_ORDER.indexOf(f.special) : SPECIAL_ORDER.length;
  return [...folders].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, "da"));
}

type ImapAddress = { name?: string | undefined; address?: string | undefined };
type Structure = { type?: string; disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; childNodes?: Structure[] };
/** Whether a mail carries a file: a part given as an attachment, or any non-text part with a file name. */
export function hasAttachment(node: Structure | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachment);
  const type = (node.type ?? "").toLowerCase();
  if (node.disposition?.toLowerCase() === "attachment") return true;
  return !type.startsWith("text/") && !type.startsWith("multipart/") && Boolean(node.dispositionParameters?.filename || node.parameters?.name);
}

const who = (list: ImapAddress[] | undefined) => (list ?? []).map(a => a.name || a.address || "").filter(Boolean).join(", ");

/** ImapFlow over the Workers runtime's sockets (nodejs_compat), as Saga reads team@ (saga/teamMail.ts). */
export const imapflowWebmail: WebmailOpener = async login => {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: login.host, port: 993, secure: true, tls: { servername: login.host, rejectUnauthorized: true },
    auth: { user: login.user, pass: login.password }, logger: false, connectionTimeout: 15_000, socketTimeout: 30_000 });
  await client.connect();
  const item = (m: { uid: number; envelope?: { date?: Date | string | undefined; subject?: string | undefined; from?: ImapAddress[] | undefined; to?: ImapAddress[] | undefined } | undefined;
    flags?: Set<string> | undefined; bodyStructure?: unknown; internalDate?: Date | string | undefined }): WebListItem => {
    const flags = m.flags ?? new Set<string>();
    const from = m.envelope?.from?.[0];
    const raw = m.envelope?.date ?? m.internalDate, date = raw ? new Date(raw) : null;
    return { uid: m.uid, date: date && !Number.isNaN(date.getTime()) ? date.getTime() : 0, from: from?.name || from?.address || "(ukendt)", fromAddress: from?.address ?? "", to: who(m.envelope?.to),
      subject: m.envelope?.subject || "(intet emne)", seen: flags.has("\\Seen"), flagged: flags.has("\\Flagged"), answered: flags.has("\\Answered"),
      attachments: hasAttachment(m.bodyStructure as Structure | undefined) };
  };
  const query = { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true } as const;
  return {
    async folders() {
      const list = await client.list({ statusQuery: { messages: true, unseen: true } });
      return list.map(f => {
        const special = f.path.toUpperCase() === "INBOX" ? "\\Inbox" : f.specialUse ?? null;
        const parts = f.path.split(f.delimiter || "/").filter(Boolean);
        const depth = Math.max(0, parts.length - 1 - (parts[0]?.toUpperCase() === "INBOX" && parts.length > 1 ? 1 : 0));
        return { path: f.path, name: special && SPECIAL_NAME[special] ? SPECIAL_NAME[special]! : f.name, special, depth: special ? 0 : depth,
          unseen: Number(f.status?.unseen ?? 0), total: Number(f.status?.messages ?? 0), selectable: !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent") };
      });
    },
    async list(path, page, size, search) {
      const box = await client.mailboxOpen(path, { readOnly: true });
      const items: WebListItem[] = [];
      if (search) {
        const found = await client.search({ or: [{ subject: search }, { from: search }, { to: search }, { body: search }] }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a);
        const slice = uids.slice(page * size, page * size + size);
        if (slice.length) for await (const m of client.fetch(slice.join(","), query, { uid: true })) items.push(item(m));
        return { total: uids.length, items: items.sort((a, b) => b.uid - a.uid) };
      }
      const exists = Number(box.exists ?? 0);
      const end = exists - page * size, start = Math.max(1, end - size + 1);
      if (end >= 1) for await (const m of client.fetch(`${start}:${end}`, query)) items.push(item(m));
      return { total: exists, items: items.sort((a, b) => b.date - a.date || b.uid - a.uid) };
    },
    async source(path, uid) {
      await client.mailboxOpen(path, { readOnly: true });
      const m = await client.fetchOne(String(uid), { uid: true, flags: true, source: { maxLength: MAX_SOURCE } }, { uid: true });
      if (!m || !m.source) return null;
      return { source: new Uint8Array(m.source), seen: Boolean(m.flags?.has("\\Seen")), flagged: Boolean(m.flags?.has("\\Flagged")) };
    },
    async setFlag(path, uids, flag, on) {
      if (!uids.length) return;
      await client.mailboxOpen(path, { readOnly: false });
      if (on) await client.messageFlagsAdd(uids.join(","), [flag], { uid: true });
      else await client.messageFlagsRemove(uids.join(","), [flag], { uid: true });
    },
    async append(path, raw, flags) {
      const bytes = (globalThis as unknown as { Buffer: { from(bytes: Uint8Array): unknown } }).Buffer.from(raw);
      await (client as unknown as { append(path: string, content: unknown, flags?: string[]): Promise<unknown> }).append(path, bytes, flags);
    },
    async uidValidity(path) { return String((await client.mailboxOpen(path, { readOnly: true })).uidValidity); },
    async move(path, uids, dest) {
      const box = await client.mailboxOpen(path, { readOnly: false });
      if (uids.length) await client.messageMove(uids.join(","), dest, { uid: true });
      return { uidValidity: String(box.uidValidity) };
    },
    async remove(path, uids) {
      const box = await client.mailboxOpen(path, { readOnly: false });
      if (uids.length) await client.messageDelete(uids.join(","), { uid: true });
      return { uidValidity: String(box.uidValidity) };
    },
    async close() { await client.logout().catch(() => client.close()); },
  };
};

// ---- A mail, read ----

export type WebAttachment = { index: number; filename: string; contentType: string; size: number; content: Uint8Array; cid: string | null; inline: boolean };
export type WebMessage = { from: string; to: string; cc: string; replyTo: string; subject: string; date: number; html: string | null; text: string; attachments: WebAttachment[] };

type AddressObject = { text?: string; value?: Array<{ name?: string; address?: string }> };
type Parsed = { from?: AddressObject; to?: AddressObject | AddressObject[]; cc?: AddressObject | AddressObject[]; replyTo?: AddressObject;
  subject?: string; date?: Date; html?: string | false; text?: string; textAsHtml?: string;
  attachments?: Array<{ filename?: string; contentType?: string; size?: number; content?: Uint8Array; cid?: string; contentDisposition?: string; related?: boolean }> };
/** "Pia Lund <pia@example.dk>, bo@example.dk" - names without the quotes mailparser puts on them. */
const addresses = (value: AddressObject | AddressObject[] | undefined) => (Array.isArray(value) ? value : value ? [value] : [])
  .flatMap(v => v.value?.length ? v.value.map(a => a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name || "") : [v.text ?? ""]).filter(Boolean).join(", ");

export async function parseMail(source: Uint8Array): Promise<WebMessage> {
  const { simpleParser } = await import("mailparser");
  // Buffer is there under nodejs_compat (and in tests on Node); the worker's types do not include Node's.
  const parsed = await simpleParser((globalThis as unknown as { Buffer: { from(bytes: Uint8Array): unknown } }).Buffer.from(source)) as Parsed;
  const attachments = (parsed.attachments ?? []).map((a, index) => ({ index, filename: a.filename || `vedhæftning-${index + 1}`, contentType: a.contentType || "application/octet-stream",
    size: a.size ?? a.content?.length ?? 0, content: a.content ? new Uint8Array(a.content) : new Uint8Array(), cid: a.cid ? a.cid.replace(/^<|>$/g, "") : null,
    inline: a.contentDisposition === "inline" || Boolean(a.related) }));
  return { from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc), replyTo: addresses(parsed.replyTo), subject: parsed.subject || "(intet emne)",
    date: parsed.date ? parsed.date.getTime() : 0, html: typeof parsed.html === "string" && parsed.html.trim() ? parsed.html : null, text: parsed.text ?? "", attachments };
}

const base64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** The mail's own HTML as a page of its own: nothing in it may run (no scripts, no forms), and nothing is fetched from outside unless asked for -
 * a picture from the sender's server tells them the mail was read. Pictures sent along in the mail (cid:) are shown at once. */
export function mailDocument(message: WebMessage, pictures: boolean): string {
  let html = message.html ?? `<pre style="white-space:pre-wrap;font:inherit">${esc(message.text)}</pre>`;
  for (const a of message.attachments) {
    if (!a.cid || a.size > 3 * 1024 * 1024 || !/^image\//i.test(a.contentType)) continue;
    html = html.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${base64(a.content)}`);
  }
  html = html.replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<meta[^>]+http-equiv[^>]*>/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0}body{padding:14px 16px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#222;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
}
export const remotePictures = (message: WebMessage) => Boolean(message.html && /<img[^>]+src=["']?https?:/i.test(message.html));

/** What the frame may do: show the mail - styles and its own pictures (and the sender's, when asked) - and open links in a new tab. */
export const MAIL_FRAME_HEADERS = (pictures: boolean): Record<string, string> => ({
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
  "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${pictures ? " https: http:" : ""}; sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'`
});

// ---- The pages ----

const WHEN_TODAY = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });
const WHEN_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: ZONE });
const WHEN_YEAR = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: ZONE });
const WHEN_FULL = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONE });
const dayKey = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(ms);
export function shortWhen(ms: number, nowMs: number): string {
  if (!ms) return "";
  if (dayKey(ms) === dayKey(nowMs)) return WHEN_TODAY.format(ms);
  return nowMs - ms < 300 * DAY ? WHEN_DAY.format(ms) : WHEN_YEAR.format(ms);
}
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const CLIP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Vedhæftning"><path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4l8-8"/></svg>';

export const folderUrl = (base: string, path: string, extra = "") => `${base}/posthus/mail?mappe=${encodeURIComponent(path)}${extra}`;
export const mailUrl = (base: string, path: string, uid: number, extra = "") => `${base}/posthus/mail/vis?mappe=${encodeURIComponent(path)}&uid=${uid}${extra}`;

export const WEBMAIL_STYLE = `
.wm{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:start}
.wm-folders{position:sticky;top:12px;display:grid;gap:2px;padding:10px}.wm-folders a{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;color:var(--ink);text-decoration:none;font-size:14px}
.wm-folders a:hover{background:var(--soft)}.wm-folders a.on{background:var(--soft);font-weight:700}.wm-folders .n{font-size:12px;font-weight:700;color:var(--accent)}.wm-folders .sub{padding-left:24px}
.wm-pick{display:none}
.wm-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}.wm-head h2{margin:0}
.wm-search{display:flex;gap:8px;flex:1;min-width:220px;max-width:420px}.wm-search input{flex:1;min-height:0;padding:8px 12px}
.wm-list,.card ul.wm-list{list-style:none;margin:0;padding:0}.wm-list li{border-top:1px solid var(--line)}.wm-list li:first-child{border-top:0}
.wm-list a{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:11px 6px;color:var(--ink);text-decoration:none}
.wm-list a:hover{background:var(--soft)}.wm-list .from,.wm-list .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wm-list .when{font-size:12.5px;color:var(--muted);white-space:nowrap;display:flex;gap:6px;align-items:center}
.wm-list .unread .from,.wm-list .unread .subj{font-weight:700}.wm-list .unread .from::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:7px;vertical-align:1px}
.wm-list .flag{color:var(--warn)}
.wm-pages{display:flex;justify-content:space-between;gap:10px;margin-top:12px;font-size:14px}
.wm-msg h1{font-size:22px;line-height:1.3;margin:0 0 10px}.wm-meta{display:grid;gap:3px;font-size:13.5px;color:var(--muted);margin-bottom:12px}.wm-meta b{color:var(--ink);font-weight:600}
.wm-acts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.wm-acts form{margin:0}.wm-acts button,.wm-acts a.button{min-height:0;padding:6px 14px;font-size:13.5px}
.wm-files{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.wm-files a{display:inline-flex;gap:6px;align-items:center;padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--ink);text-decoration:none}
.wm-files a:hover{border-color:var(--accent)}.wm-files .s{color:var(--muted)}
.wm-frame{width:100%;min-height:360px;border:1px solid var(--line);border-radius:12px;background:#fff;display:block}
.wm-note{font-size:13px;color:var(--muted);margin:0 0 10px}
.wm-test{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--muted);vertical-align:middle;letter-spacing:.02em}
.wm-list li{display:flex;align-items:center}.wm-list li>a{flex:1;min-width:0}.wm-check{width:18px;height:18px;min-height:0;margin:0 4px 0 6px;flex:none;accent-color:var(--accent)}
.wm-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px;padding:8px 0;border-bottom:1px solid var(--line)}.wm-bar button{min-height:0;padding:6px 12px;font-size:13px}
.wm-bar select{width:auto;min-height:0;padding:6px 10px;font-size:13px}.wm-bar label.all{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted);margin-right:4px}
.wm-acts select{width:auto;min-height:0;padding:6px 10px;font-size:13.5px}
@media (max-width:760px){.wm{grid-template-columns:minmax(0,1fr)}.wm-folders{display:none}.wm-pick{display:block;margin-bottom:10px}.wm-pick select{width:100%}
.wm-list a{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"from when" "subj subj";gap:2px 10px}.wm-list .from{grid-area:from}.wm-list .subj{grid-area:subj;font-size:14px;color:var(--muted)}.wm-list .unread .subj{color:var(--ink)}.wm-list .when{grid-area:when}
.card:not(:has(.wm-list .wm-check:checked)) .wm-bar>:not(.all):not(input){display:none}.wm-bar{padding:4px 0 8px}}
`;

function folderNav(base: string, folders: WebFolder[], current: string): string {
  const shown = orderFolders(folders).filter(f => f.selectable);
  const links = shown.map(f => `<a href="${folderUrl(base, f.path)}" class="${[f.path === current ? "on" : "", f.depth ? "sub" : ""].filter(Boolean).join(" ")}"${f.path === current ? ' aria-current="page"' : ""}><span>${esc(f.name)}</span>${f.unseen && f.special !== "\\Sent" && f.special !== "\\Drafts" && f.special !== "\\Trash" ? `<span class="n">${f.unseen}</span>` : ""}</a>`).join("");
  const pick = `<form class="wm-pick" method="get" action="${base}/posthus/mail"><select name="mappe" aria-label="Mappe" onchange="this.form.submit()">${shown.map(f => `<option value="${esc(f.path)}"${f.path === current ? " selected" : ""}>${"  ".repeat(f.depth)}${esc(f.name)}${f.unseen ? ` (${f.unseen})` : ""}</option>`).join("")}</select><noscript><button>Vis</button></noscript></form>`;
  return `<nav class="card wm-folders" aria-label="Mapper">${links}</nav>${pick}`;
}

/** Which special folder a path is - from the listing, or from its name when there is none. */
const specialOf = (folders: WebFolder[], path: string) => folders.find(f => f.path === path)?.special ?? (path.toUpperCase() === "INBOX" ? "\\Inbox" : null);
export const findFolder = (folders: WebFolder[], special: string) => folders.find(f => f.special === special && f.selectable)?.path ?? null;

function moveSelect(folders: WebFolder[], current: string): string {
  const targets = orderFolders(folders).filter(f => f.selectable && f.path !== current);
  return targets.length ? `<select name="til" aria-label="Flyt til mappe"><option value="">Flyt til …</option>${targets.map(f => `<option value="${esc(f.path)}">${"  ".repeat(f.depth)}${esc(f.name)}</option>`).join("")}</select><button class="ghost" name="handling" value="flyt">Flyt</button>` : "";
}

/** The buttons over the list, for the mails ticked in it. */
function actionBar(base: string, folders: WebFolder[], current: string, back: "liste"): string {
  const special = specialOf(folders, current);
  const inTrash = special === "\\Trash", inJunk = special === "\\Junk";
  return `<form id="wm-bulk" class="wm-bar" method="post" action="${base}/posthus/mail/handling"><input type="hidden" name="mappe" value="${esc(current)}"><input type="hidden" name="tilbage" value="${back}">
<label class="all"><input type="checkbox" id="wm-all" class="wm-check" style="margin:0"> Alle</label>
${findFolder(folders, "\\Archive") && special !== "\\Archive" ? `<button class="ghost" name="handling" value="arkiv">Arkivér</button>` : ""}
<button class="ghost" name="handling" value="slet"${inTrash ? ` onclick="return confirm('Slette de valgte mails for altid?')"` : ""}>${inTrash ? "Slet for altid" : "Slet"}</button>
${inJunk ? `<button class="ghost" name="handling" value="ikkespam">Ikke spam</button>` : findFolder(folders, "\\Junk") ? `<button class="ghost" name="handling" value="spam">Spam</button>` : ""}
<button class="ghost" name="handling" value="laest">Læst</button><button class="ghost" name="handling" value="ulaest">Ulæst</button><button class="ghost" name="handling" value="flag">Flag</button>
${moveSelect(folders, current)}</form>`;
}

/** Answer, answer all, forward - and a draft is written on. */
function replyButtons(base: string, folders: WebFolder[], current: string, uid: number): string {
  const write = (kind: string, label: string, ghost = true) => `<a class="button${ghost ? " ghost" : ""}" href="${base}/posthus/mail/skriv?type=${kind}&mappe=${encodeURIComponent(current)}&uid=${uid}">${label}</a>`;
  if (specialOf(folders, current) === "\\Drafts") return `<div class="wm-acts">${write("kladde", "Fortsæt kladden", false)}</div>`;
  return `<div class="wm-acts">${write("svar", "Svar", false)}${write("svaralle", "Svar alle")}${write("videresend", "Videresend")}</div>`;
}

/** The buttons on a mail. */
function messageActions(base: string, folders: WebFolder[], current: string, uid: number, flagged: boolean): string {
  const special = specialOf(folders, current);
  const inTrash = special === "\\Trash", inJunk = special === "\\Junk";
  return `<form class="wm-acts" method="post" action="${base}/posthus/mail/handling"><input type="hidden" name="mappe" value="${esc(current)}"><input type="hidden" name="uid" value="${uid}"><input type="hidden" name="tilbage" value="vis">
${findFolder(folders, "\\Archive") && special !== "\\Archive" ? `<button class="ghost" name="handling" value="arkiv">Arkivér</button>` : ""}
<button class="ghost" name="handling" value="slet"${inTrash ? ` onclick="return confirm('Slette mailen for altid?')"` : ""}>${inTrash ? "Slet for altid" : "Slet"}</button>
${inJunk ? `<button class="ghost" name="handling" value="ikkespam">Ikke spam</button>` : findFolder(folders, "\\Junk") ? `<button class="ghost" name="handling" value="spam">Spam</button>` : ""}
<button class="ghost" name="handling" value="${flagged ? "fjernflag" : "flag"}">${flagged ? "Fjern flag" : "Flag"}</button><button class="ghost" name="handling" value="ulaest">Markér som ulæst</button>
${moveSelect(folders, current)}</form>`;
}

export function folderPage(base: string, data: { who: string | null; address: string; folders: WebFolder[]; path: string; page: number; query: string; total: number; items: WebListItem[]; nowMs: number; notice?: string }): string {
  const folder = data.folders.find(f => f.path === data.path);
  const title = folder?.name ?? data.path;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const q = data.query ? `&q=${encodeURIComponent(data.query)}` : "";
  const list = data.items.length ? `${actionBar(base, data.folders, data.path, "liste")}<ul class="wm-list">${data.items.map(m => `<li><input type="checkbox" class="wm-check" name="uid" value="${m.uid}" form="wm-bulk" aria-label="Vælg: ${esc(m.subject)}"><a href="${mailUrl(base, data.path, m.uid)}" class="${m.seen ? "" : "unread"}">
<span class="from">${esc(folder?.special === "\\Sent" || folder?.special === "\\Drafts" ? `Til: ${m.to || "(ingen)"}` : m.from)}</span><span class="subj">${esc(m.subject)}</span>
<span class="when">${m.flagged ? '<span class="flag" aria-label="Flaget">⚑</span>' : ""}${m.attachments ? CLIP : ""}${esc(shortWhen(m.date, data.nowMs))}</span></a></li>`).join("")}</ul>`
    : `<p class="muted">${data.query ? "Ingen mails passer til søgningen." : "Mappen er tom."}</p>`;
  const nav = pages > 1 ? `<div class="wm-pages"><span>${data.page > 0 ? `<a href="${folderUrl(base, data.path, `&side=${data.page - 1}${q}`)}">← Nyere</a>` : ""}</span><span class="muted">Side ${data.page + 1} af ${pages}</span><span>${data.page + 1 < pages ? `<a href="${folderUrl(base, data.path, `&side=${data.page + 1}${q}`)}">Ældre →</a>` : ""}</span></div>` : "";
  return layout(base, `Mailboks · ${title}`, `<main><p class="small"><a href="${base}/posthus">← Posthus</a></p><h1>Mailboks <span class="wm-test">Testversion</span></h1><p class="muted small">${esc(data.address)}</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}<div class="wm">${folderNav(base, data.folders, data.path)}<section class="card">
<div class="wm-head"><h2>${esc(title)}${data.query ? ` <span class="small muted">· søgning: ${esc(data.query)}</span>` : ""}</h2><a class="button" href="${base}/posthus/mail/skriv?type=ny&mappe=${encodeURIComponent(data.path)}">Ny mail</a>
<form class="wm-search" method="get" action="${base}/posthus/mail"><input type="hidden" name="mappe" value="${esc(data.path)}"><input type="search" name="q" value="${esc(data.query)}" placeholder="Søg i afsender, emne og tekst" aria-label="Søg"><button class="ghost">Søg</button></form></div>
${list}${nav}</section></div></main>
<script>document.getElementById("wm-all")?.addEventListener("change",e=>document.querySelectorAll(".wm-check").forEach(c=>{c.checked=e.target.checked}))</script>`, { section: "/posthus", who: data.who, style: WEBMAIL_STYLE });
}

export function messagePage(base: string, data: { who: string | null; path: string; uid: number; folderName: string; message: WebMessage; pictures: boolean; flagged: boolean; folders?: WebFolder[] }): string {
  const m = data.message;
  // A picture sent along to stand in the mail (mailparser has already put it there) is not a file.
  const files = m.attachments.filter(a => !(a.inline && a.cid && /^image\//i.test(a.contentType) && m.html));
  const asked = data.pictures ? "&billeder=1" : "";
  return layout(base, m.subject, `<main class="wm-msg"><p class="small"><a href="${folderUrl(base, data.path)}">← ${esc(data.folderName)}</a> · Mailboks <span class="wm-test">Testversion</span></p>
<h1>${esc(m.subject)}${data.flagged ? ' <span class="small" style="color:var(--warn)" aria-label="Flaget">⚑</span>' : ""}</h1>
<div class="wm-meta"><span><b>Fra:</b> ${esc(m.from)}</span>${m.to ? `<span><b>Til:</b> ${esc(m.to)}</span>` : ""}${m.cc ? `<span><b>Cc:</b> ${esc(m.cc)}</span>` : ""}${m.replyTo && m.replyTo !== m.from ? `<span><b>Svar til:</b> ${esc(m.replyTo)}</span>` : ""}${m.date ? `<span>${esc(WHEN_FULL.format(m.date))}</span>` : ""}</div>
${replyButtons(base, data.folders ?? [], data.path, data.uid)}${messageActions(base, data.folders ?? [], data.path, data.uid, data.flagged)}
${files.length ? `<div class="wm-files">${files.map(a => `<a href="${base}/posthus/mail/fil?mappe=${encodeURIComponent(data.path)}&uid=${data.uid}&nr=${a.index}">${CLIP}<span>${esc(a.filename)}</span><span class="s">${size(a.size)}</span></a>`).join("")}</div>` : ""}
${remotePictures(m) && !data.pictures ? `<p class="wm-note">Billeder fra afsenderens server er ikke hentet, så afsenderen ikke kan se, at mailen er læst. <a href="${mailUrl(base, data.path, data.uid, "&billeder=1")}">Vis billeder</a></p>` : ""}
<iframe class="wm-frame" title="Mailen" src="${base}/posthus/mail/indhold?mappe=${encodeURIComponent(data.path)}&uid=${data.uid}${asked}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" loading="lazy"
 onload="try{this.style.height=(this.contentDocument.documentElement.scrollHeight+4)+'px'}catch(e){}"></iframe></main>`, { section: "/posthus", who: data.who, style: WEBMAIL_STYLE });
}

// ---- The routes ----

export type WebmailContext = { base: string; path: string; url: URL; request: Request; env: SagaEnv; deps: SagaDeps & { webmail?: WebmailOpener }; db: D1Database; who: string | null;
  html: (body: string, status?: number, extra?: Record<string, string>) => Response; redirect: (location: string) => Response; notFound: () => Response };

/** The admin page's own rules, and a frame for the mail from the same place. */
export const WEBMAIL_PAGE_HEADERS = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; form-action 'self'; base-uri 'none'" };

async function session(ctx: WebmailContext): Promise<{ s: WebmailSession; address: string; login: WebmailLogin } | { error: string }> {
  const account = await teamMailAccount(ctx.db);
  if (!account) return { error: "team@ er ikke forbundet. Formanden forbinder den under Posthus." };
  try {
    const password = await openPassword(ctx.env, account.password_sealed);
    const login = { host: account.imap_host, user: account.address, password };
    const s = await (ctx.deps.webmail ?? imapflowWebmail)(login);
    return { s, address: account.address, login };
  } catch (error) {
    console.warn("webmail_login_failed", error instanceof Error ? error.message : error);
    return { error: "Mailserveren svarede ikke. Prøv igen om lidt." };
  }
}

const folderOf = (url: URL) => (url.searchParams.get("mappe") ?? "INBOX").slice(0, 300) || "INBOX";
export const uidOf = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

const DONE: Record<string, (n: number) => string> = {
  arkiv: n => n === 1 ? "Mailen er arkiveret." : `${n} mails er arkiveret.`, slet: n => n === 1 ? "Mailen er lagt i papirkurven." : `${n} mails er lagt i papirkurven.`,
  sletaltid: n => n === 1 ? "Mailen er slettet for altid." : `${n} mails er slettet for altid.`, spam: n => n === 1 ? "Mailen er flyttet til spam." : `${n} mails er flyttet til spam.`,
  ikkespam: n => n === 1 ? "Mailen er flyttet til indbakken." : `${n} mails er flyttet til indbakken.`, flyt: n => n === 1 ? "Mailen er flyttet." : `${n} mails er flyttet.`,
  laest: n => n === 1 ? "Markeret som læst." : `${n} mails markeret som læst.`, ulaest: n => n === 1 ? "Markeret som ulæst." : `${n} mails markeret som ulæst.`,
  flag: n => n === 1 ? "Flaget." : `${n} mails flaget.`, sendt: () => "Mailen er sendt og ligger i Sendt.", kladde: () => "Kladden er gemt.", fjernflag: () => "Flaget er fjernet.", ingen: () => "Vælg en eller flere mails først.", mappe: () => "Mappen findes ikke i mailboksen."
};

/** Requested: "... med alle mapper, med alle svarmuligheder, og alle almindelige funktioner" - step 2: archive, delete (to Papirkurv; from there for good),
 * spam and back, read and unread, flag, move to any folder - one mail or the ones ticked in the list. A mail that leaves for Arkiv, Papirkurv or Spam is
 * done in Posthus too. */
async function act(ctx: WebmailContext, s: WebmailSession, form: FormData | null): Promise<Response> {
  const folder = String(form?.get("mappe") ?? "INBOX").slice(0, 300) || "INBOX";
  const uids = [...new Set((form?.getAll("uid") ?? []).map(uidOf).filter(Boolean))].slice(0, 200);
  const action = String(form?.get("handling") ?? ""), back = form?.get("tilbage") === "vis" ? "vis" : "liste";
  const toList = (code: string, n = 0) => ctx.redirect(folderUrl(ctx.base, folder, `&udfoert=${code}&n=${n}`));
  if (!uids.length) return toList("ingen");
  const folders = await s.folders();
  const special = specialOf(folders, folder);
  const moveTo = async (dest: string | null, code: string) => {
    if (!dest || !folders.some(f => f.path === dest && f.selectable) || dest === folder) return toList("mappe");
    const { uidValidity } = await s.move(folder, uids, dest);
    if (code === "arkiv" || code === "slet" || code === "spam") await doneInPosthus(ctx, folder, uidValidity, uids);
    return toList(code, uids.length);
  };
  switch (action) {
    case "laest": case "ulaest": case "flag": case "fjernflag":
      await s.setFlag(folder, uids, action === "laest" || action === "ulaest" ? "\\Seen" : "\\Flagged", action === "laest" || action === "flag");
      return back === "vis" && uids.length === 1 && action !== "ulaest" ? ctx.redirect(mailUrl(ctx.base, folder, uids[0]!)) : toList(action, uids.length);
    case "arkiv": return moveTo(findFolder(folders, "\\Archive"), "arkiv");
    case "spam": return moveTo(findFolder(folders, "\\Junk"), "spam");
    case "ikkespam": return moveTo(findFolder(folders, "\\Inbox") ?? "INBOX", "ikkespam");
    case "flyt": return moveTo(String(form?.get("til") ?? "").slice(0, 300), "flyt");
    case "slet": {
      const trash = findFolder(folders, "\\Trash");
      if (trash && special !== "\\Trash") return moveTo(trash, "slet");
      const { uidValidity } = await s.remove(folder, uids);
      await doneInPosthus(ctx, folder, uidValidity, uids);
      return toList("sletaltid", uids.length);
    }
    default: return toList("ingen");
  }
}

/** The mails as Posthus knows them (saga/teamMail.ts: "imap:<uidvalidity>:<uid>" in the inbox, "imap:<folder>:<uidvalidity>:<uid>" elsewhere) are done. */
async function doneInPosthus(ctx: WebmailContext, folder: string, uidValidity: string, uids: number[]): Promise<void> {
  const refs = uids.map(uid => folder.toUpperCase() === "INBOX" ? `imap:${uidValidity}:${uid}` : `imap:${folder}:${uidValidity}:${uid}`);
  for (let i = 0; i < refs.length; i += 50) {
    const part = refs.slice(i, i + 50);
    await ctx.db.prepare(`UPDATE board_mail SET handled_at_ms = ?, handled_by = ? WHERE handled_at_ms IS NULL AND message_ref IN (${part.map(() => "?").join(",")})`)
      .bind(ctx.deps.now(), ctx.who, ...part).run().catch(error => console.warn("webmail_posthus_failed", error instanceof Error ? error.message : error));
  }
}

export async function webmailRoute(ctx: WebmailContext): Promise<Response | null> {
  const { path, url, request } = ctx;
  if (!path.startsWith("/posthus/mail")) return null;
  if (!ctx.who) return ctx.redirect(`${ctx.base}/hvem`);
  const known = ["/posthus/mail", "/posthus/mail/vis", "/posthus/mail/indhold", "/posthus/mail/fil", "/posthus/mail/handling", "/posthus/mail/skriv", "/posthus/mail/send"];
  if (!known.includes(path)) return ctx.notFound();
  const opened = await session(ctx);
  if ("error" in opened) return ctx.html(layout(ctx.base, "Mailboks", `<main><p class="small"><a href="${ctx.base}/posthus">← Posthus</a></p><h1>Mailboks</h1><p class="notice">${esc(opened.error)}</p></main>`, { section: "/posthus", who: ctx.who }), 503, WEBMAIL_PAGE_HEADERS);
  const { s, address, login } = opened;
  try {
    if (path === "/posthus/mail/handling" && request.method === "POST") return await act(ctx, s, await request.formData().catch(() => null));
    const composed = await composeRoute(ctx, s, login);
    if (composed) return composed;
    if (request.method !== "GET") return ctx.notFound();
    const folder = folderOf(url);
    if (path === "/posthus/mail") {
      const page = Math.max(0, Math.min(500, Number(url.searchParams.get("side")) || 0)), query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
      const folders = await s.folders();
      if (!folders.some(f => f.path === folder && f.selectable)) return ctx.redirect(folderUrl(ctx.base, "INBOX"));
      const { total, items } = await s.list(folder, page, PAGE, query);
      const done = DONE[url.searchParams.get("udfoert") ?? ""]?.(Math.max(1, Number(url.searchParams.get("n")) || 1)) ?? "";
      return ctx.html(folderPage(ctx.base, { who: ctx.who, address, folders, path: folder, page, query, total, items, nowMs: ctx.deps.now(), notice: done }), 200, WEBMAIL_PAGE_HEADERS);
    }
    const uid = uidOf(url.searchParams.get("uid"));
    const found = uid ? await s.source(folder, uid) : null;
    if (!found) return ctx.notFound();
    const message = await parseMail(found.source);
    const pictures = url.searchParams.get("billeder") === "1";
    if (path === "/posthus/mail/indhold") return new Response(mailDocument(message, pictures), { headers: MAIL_FRAME_HEADERS(pictures) });
    if (path === "/posthus/mail/fil") {
      const file = message.attachments[Number(url.searchParams.get("nr"))];
      if (!file) return ctx.notFound();
      const name = file.filename.replace(/["\\\r\n]/g, "_");
      return new Response(file.content as unknown as BodyInit, { headers: { "content-type": file.contentType.replace(/[\r\n]/g, ""), "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
    }
    // Opening a mail reads it, as in any mail program.
    if (!found.seen) await s.setFlag(folder, [uid], "\\Seen", true).catch(error => console.warn("webmail_seen_failed", error instanceof Error ? error.message : error));
    const folders = await s.folders().catch(() => [] as WebFolder[]);
    return ctx.html(messagePage(ctx.base, { who: ctx.who, path: folder, uid, folderName: folders.find(f => f.path === folder)?.name ?? folderName(folder), message, pictures, flagged: found.flagged, folders }), 200, WEBMAIL_PAGE_HEADERS);
  } catch (error) {
    console.warn("webmail_failed", error instanceof Error ? error.message : error);
    return ctx.html(layout(ctx.base, "Mailboks", `<main><p class="small"><a href="${ctx.base}/posthus">← Posthus</a></p><h1>Mailboks</h1><p class="notice">Mailserveren svarede ikke. Prøv igen om lidt.</p></main>`, { section: "/posthus", who: ctx.who }), 503, WEBMAIL_PAGE_HEADERS);
  } finally {
    await s.close().catch(() => undefined);
  }
}

/** Where a mail in Posthus is in the mailbox: its reference is "imap:<uidvalidity>:<uid>" (the inbox) or "imap:<folder>:<uidvalidity>:<uid>". */
export function mailboxLink(base: string, ref: string): string | null {
  const m = /^imap:(?:(.+):)?(\d+):(\d+)$/.exec(ref);
  return m ? mailUrl(base, m[1] ?? "INBOX", Number(m[3])) : null;
}
