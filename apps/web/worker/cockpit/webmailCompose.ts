import type { SagaDeps } from "../saga/env.js";
import { esc, layout } from "./page.js";
import { findFolder, folderUrl, mailUrl, parseMail, uidOf, WEBMAIL_PAGE_HEADERS, WEBMAIL_STYLE, type WebFolder, type WebmailContext, type WebmailLogin, type WebmailSession, type WebMessage } from "./webmail.js";

/** Requested: "... med alle svarmuligheder, og alle almindelige funktioner" - step 3 of the mailbox in admin: write a new mail, answer, answer all and
 * forward, with files, as a draft in Kladder or sent from team@ and kept in Sendt. Sent with nodemailer (the same maker and the same care as ImapFlow
 * and mailparser): the mail is built once, sent over One.com's SMTP and laid in Sendt as it went. The board writes and sends; Saga never sends. */

export type OutgoingFile = { filename: string; contentType: string; content: Uint8Array };
export type Outgoing = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; inReplyTo?: string; references?: string; attachments: OutgoingFile[] };
/** Builds the message and, unless `draft`, sends it; the message as built is what goes in Sendt or Kladder. */
export type MailSender = (login: WebmailLogin, mail: Outgoing, options: { draft: boolean; fetcher: typeof fetch }) => Promise<{ raw: Uint8Array; messageId: string }>;

const MAX_FILES_BYTES = 20 * 1024 * 1024;
const SMTP_HOST: Record<string, string> = { "imap.one.com": "send.one.com" };
type Buffers = { Buffer: { from(bytes: Uint8Array): unknown; isBuffer(value: unknown): boolean } };
const toBuffer = (bytes: Uint8Array) => (globalThis as unknown as Buffers).Buffer.from(bytes);

/** The SMTP server's address, looked up over HTTPS: the Workers runtime has no DNS of its own, and nodemailer then connects straight to it (with the name for TLS). */
async function smtpAddress(host: string, fetcher: typeof fetch): Promise<string> {
  try {
    const answer = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: "application/dns-json" } });
    const data = await answer.json() as { Answer?: Array<{ type: number; data: string }> };
    return data.Answer?.find(a => a.type === 1)?.data ?? host;
  } catch { return host; }
}

export const nodemailerSender: MailSender = async (login, mail, options) => {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer") as unknown as { default: new (m: unknown) => { compile(): { build(): Promise<unknown>; messageId(): string } } };
  const message = new MailComposer({ from: mail.from, to: mail.to, cc: mail.cc, bcc: mail.bcc, subject: mail.subject, text: mail.text,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}), ...(mail.references ? { references: mail.references } : {}),
    attachments: mail.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: toBuffer(a.content) })), keepBcc: false }).compile();
  const raw = new Uint8Array(await message.build() as ArrayLike<number>);
  const messageId = message.messageId();
  if (!options.draft) {
    const { createTransport } = await import("nodemailer") as unknown as { createTransport(o: unknown): { sendMail(m: unknown): Promise<unknown>; close(): void } };
    const host = SMTP_HOST[login.host] ?? login.host.replace(/^imap\./, "smtp.");
    const transport = createTransport({ host: await smtpAddress(host, options.fetcher), port: 465, secure: true, name: "hjerterum.info", tls: { servername: host, rejectUnauthorized: true },
      auth: { user: login.user, pass: login.password }, connectionTimeout: 15_000, socketTimeout: 30_000, greetingTimeout: 15_000, disableFileAccess: true, disableUrlAccess: true });
    try {
      await transport.sendMail({ envelope: { from: login.user, to: [...mail.to, ...mail.cc, ...mail.bcc].map(bare) }, raw: toBuffer(raw) });
    } finally { transport.close(); }
  }
  return { raw, messageId };
};

// ---- Addresses ----

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
/** The bare address of "Pia Lund <pia@example.dk>". */
export const bare = (one: string) => (/<([^>]+)>/.exec(one)?.[1] ?? one).trim().toLowerCase();
/** "Pia <pia@x.dk>, bo@y.dk; Ann Ny <ann@z.dk>" - each written address, or null when one of them is not an address. */
export function parseRecipients(text: string): string[] | null {
  const parts: string[] = [];
  let current = "", quoted = false, angle = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === "<") angle = true;
    if (ch === ">") angle = false;
    if ((ch === "," || ch === ";" || ch === "\n") && !quoted && !angle) { parts.push(current); current = ""; } else current += ch;
  }
  parts.push(current);
  const list = parts.map(p => p.trim()).filter(Boolean);
  return list.every(p => EMAIL.test(bare(p))) ? list.slice(0, 100) : null;
}

// ---- What a new mail, an answer and a forward start with ----

export type ComposeKind = "ny" | "svar" | "svaralle" | "videresend" | "kladde";
export type Draft = { kind: ComposeKind; to: string; cc: string; bcc: string; subject: string; text: string; folder: string; uid: number; files: Array<{ index: number; filename: string }> };

const QUOTED_WHEN = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const prefix = (subject: string, p: "Re" | "Fwd") => new RegExp(`^(?:${p === "Re" ? "re|sv|aw" : "fwd?|vs|wg"}):`, "i").test(subject.trim()) ? subject.trim() : `${p}: ${subject.trim()}`;
const firstName = (who: string) => who.trim().split(/\s+/)[0] ?? who;
export const signature = (who: string) => `Venlig hilsen\n${firstName(who)}\nHjerterum`;
/** The board's own address and the one writing are never answered to themselves. */
const without = (list: string[], own: string) => list.filter(a => bare(a) !== own.toLowerCase());
const split = (text: string) => parseRecipients(text) ?? (text ? [text] : []);

/** The mail as plain text for quoting: its own text part, or its HTML without the tags (a mail sent only as HTML). */
export function plainText(message: Pick<WebMessage, "text" | "html">): string {
  if (message.text.trim() || !message.html) return message.text;
  return message.html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
}

export function startDraft(kind: ComposeKind, who: string, own: string, original: (WebMessage & { folder: string; uid: number }) | null): Draft {
  const sign = `\n\n${signature(who)}`;
  if (!original || kind === "ny") return { kind: "ny", to: "", cc: "", bcc: "", subject: "", text: sign, folder: original?.folder ?? "INBOX", uid: 0, files: [] };
  const base = { folder: original.folder, uid: original.uid, bcc: "" };
  const text = plainText(original);
  if (kind === "kladde") return { ...base, kind, to: original.to, cc: original.cc, subject: original.subject, text, files: [] };
  const when = original.date ? QUOTED_WHEN.format(original.date) : "";
  if (kind === "videresend") {
    const head = ["---------- Videresendt mail ----------", `Fra: ${original.from}`, when ? `Dato: ${when}` : "", `Emne: ${original.subject}`, original.to ? `Til: ${original.to}` : ""].filter(Boolean).join("\n");
    return { ...base, kind, to: "", cc: "", subject: prefix(original.subject, "Fwd"), text: `${sign}\n\n${head}\n\n${text.trim()}`,
      files: original.attachments.filter(a => !(a.inline && a.cid && original.html)).map(a => ({ index: a.index, filename: a.filename })) };
  }
  const to = original.replyTo || original.from;
  const quote = text.trim().split("\n").map(l => `> ${l}`).join("\n");
  const cc = kind === "svaralle" ? without([...split(original.to), ...split(original.cc)], own).filter(a => bare(a) !== bare(to)).join(", ") : "";
  return { ...base, kind, to, cc, subject: prefix(original.subject, "Re"), text: `${sign}\n\n${when ? `Den ${when} skrev ${original.from}:` : `${original.from} skrev:`}\n${quote}`, files: [] };
}

// ---- The page ----

export const COMPOSE_STYLE = `
.wm-compose{display:grid;gap:12px;max-width:820px}.wm-compose label{display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
.wm-compose input[type=text],.wm-compose input[type=email]{width:100%}.wm-compose textarea{width:100%;min-height:340px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;resize:vertical}
.wm-compose .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wm-compose details summary{font-size:13px;color:var(--muted)}
.wm-compose .files{display:flex;flex-wrap:wrap;gap:8px}.wm-compose .files label{display:inline-flex;flex-direction:row;gap:6px;align-items:center;font-weight:500;padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--ink)}
.wm-compose .send{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
@media (max-width:760px){.wm-compose .row2{grid-template-columns:1fr}.wm-compose textarea{min-height:260px}}
`;
const TITLE: Record<ComposeKind, string> = { ny: "Ny mail", svar: "Svar", svaralle: "Svar alle", videresend: "Videresend", kladde: "Kladde" };

export function composePage(base: string, who: string, address: string, draft: Draft, error = ""): string {
  const hidden = `<input type="hidden" name="type" value="${draft.kind}"><input type="hidden" name="mappe" value="${esc(draft.folder)}"><input type="hidden" name="uid" value="${draft.uid}">`;
  const back = draft.uid ? mailUrl(base, draft.folder, draft.uid) : folderUrl(base, draft.folder);
  return layout(base, TITLE[draft.kind], `<main><p class="small"><a href="${back}">← Tilbage</a> · Mailboks <span class="wm-test">Testversion</span></p><h1>${TITLE[draft.kind]}</h1>
${error ? `<p class="notice warn">${esc(error)}</p>` : ""}
<form class="card wm-compose" method="post" action="${base}/posthus/mail/send" enctype="multipart/form-data">${hidden}
<p class="small muted" style="margin:0">Fra: ${esc(firstName(who))} | Hjerterum &lt;${esc(address)}&gt;</p>
<label>Til<input type="text" name="til" value="${esc(draft.to)}" autocomplete="off" placeholder="navn@eksempel.dk, flere adskilt af komma"></label>
<details${draft.cc || draft.bcc ? " open" : ""}><summary>Cc og Bcc</summary><div class="row2" style="margin-top:8px"><label>Cc<input type="text" name="cc" value="${esc(draft.cc)}" autocomplete="off"></label><label>Bcc<input type="text" name="bcc" value="${esc(draft.bcc)}" autocomplete="off"></label></div></details>
<label>Emne<input type="text" name="emne" value="${esc(draft.subject)}" maxlength="300"></label>
<label>Tekst<textarea name="tekst">${esc(draft.text)}</textarea></label>
${draft.files.length ? `<div><p class="small muted" style="margin:0 0 6px">Med fra den oprindelige mail:</p><div class="files">${draft.files.map(f => `<label><input type="checkbox" name="medtag" value="${f.index}" checked> ${esc(f.filename)}</label>`).join("")}</div></div>` : ""}
<label>Vedhæft filer<input type="file" name="filer" multiple></label>
<div class="send"><button name="handling" value="send">Send</button><button class="ghost" name="handling" value="kladde">Gem som kladde</button>
<span class="small muted">Sendes fra team@ og gemmes i Sendt.</span></div></form></main>
<script>document.querySelector(".wm-compose")?.addEventListener("submit",e=>{const b=e.submitter;if(b&&b.value==="send"){setTimeout(()=>{b.disabled=true;b.textContent="Sender …"},0)}})</script>`, { section: "/posthus", who, style: WEBMAIL_STYLE + COMPOSE_STYLE });
}

// ---- The routes ----

const kindOf = (value: unknown): ComposeKind => (["ny", "svar", "svaralle", "videresend", "kladde"] as const).find(k => k === value) ?? "ny";

async function original(s: WebmailSession, folder: string, uid: number): Promise<(WebMessage & { folder: string; uid: number; messageId: string; references: string }) | null> {
  if (!uid) return null;
  const found = await s.source(folder, uid);
  if (!found) return null;
  const message = await parseMail(found.source);
  const head = new TextDecoder().decode(found.source.slice(0, 64 * 1024)).split(/\r?\n\r?\n/)[0] ?? "";
  const header = (name: string) => new RegExp(`^${name}:[ \\t]*([^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*)`, "im").exec(head)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return { ...message, folder, uid, messageId: header("Message-ID"), references: header("References") };
}

export async function composeRoute(ctx: WebmailContext & { deps: SagaDeps & { webmailSend?: MailSender } }, s: WebmailSession, login: WebmailLogin): Promise<Response | null> {
  const { path, url, request } = ctx;
  const who = ctx.who!;
  if (path === "/posthus/mail/skriv" && request.method === "GET") {
    const kind = kindOf(url.searchParams.get("type"));
    const folder = (url.searchParams.get("mappe") ?? "INBOX").slice(0, 300) || "INBOX";
    const found = kind === "ny" ? null : await original(s, folder, uidOf(url.searchParams.get("uid")));
    if (kind !== "ny" && !found) return ctx.notFound();
    return ctx.html(composePage(ctx.base, who, login.user, startDraft(kind, who, login.user, found)), 200, WEBMAIL_PAGE_HEADERS);
  }
  if (path !== "/posthus/mail/send" || request.method !== "POST") return null;
  const form = await request.formData().catch(() => null);
  const kind = kindOf(form?.get("type")), folder = String(form?.get("mappe") ?? "INBOX").slice(0, 300) || "INBOX", uid = uidOf(form?.get("uid"));
  const asDraft = form?.get("handling") === "kladde";
  const field = (name: string, max = 4000) => String(form?.get(name) ?? "").slice(0, max);
  const draft: Draft = { kind, to: field("til"), cc: field("cc"), bcc: field("bcc"), subject: field("emne", 300), text: field("tekst", 200_000), folder, uid, files: [] };
  const again = (error: string) => ctx.html(composePage(ctx.base, who, login.user, draft, error), 400, WEBMAIL_PAGE_HEADERS);
  const to = parseRecipients(draft.to), cc = parseRecipients(draft.cc), bcc = parseRecipients(draft.bcc);
  if (!to || !cc || !bcc) return again("En af adresserne er ikke en mailadresse. Ret den, og prøv igen.");
  if (!asDraft && !to.length && !cc.length && !bcc.length) return again("Skriv mindst én modtager.");
  if (!asDraft && !draft.subject.trim() && !draft.text.trim()) return again("Mailen er tom.");

  const source = kind === "ny" ? null : await original(s, folder, uid);
  const attachments: OutgoingFile[] = [];
  for (const entry of form?.getAll("filer") ?? []) {
    if (typeof entry === "string" || !entry.size) continue;
    attachments.push({ filename: entry.name || "fil", contentType: entry.type || "application/octet-stream", content: new Uint8Array(await entry.arrayBuffer()) });
  }
  if (source && kind === "videresend") {
    const keep = new Set((form?.getAll("medtag") ?? []).map(Number));
    for (const a of source.attachments) if (keep.has(a.index)) attachments.push({ filename: a.filename, contentType: a.contentType, content: a.content });
  }
  if (attachments.reduce((n, a) => n + a.content.length, 0) > MAX_FILES_BYTES) return again("Filerne fylder mere end 20 MB tilsammen. Send dem i flere mails.");

  const reply = source && (kind === "svar" || kind === "svaralle") ? source : null;
  const mail: Outgoing = { from: `"${firstName(who)} | Hjerterum" <${login.user}>`, to, cc, bcc, subject: draft.subject.trim(), text: draft.text, attachments,
    ...(reply?.messageId ? { inReplyTo: reply.messageId, references: [reply.references, reply.messageId].filter(Boolean).join(" ") } : {}) };
  const folders = await s.folders();
  const send = ctx.deps.webmailSend ?? nodemailerSender;
  let built: { raw: Uint8Array; messageId: string };
  try {
    built = await send(login, mail, { draft: asDraft, fetcher: ctx.deps.fetcher });
  } catch (error) {
    console.warn("webmail_send_failed", error instanceof Error ? error.message : error);
    return again(`Mailen blev ikke sendt: mailserveren afviste den eller svarede ikke. Teksten står her stadig${attachments.length ? " - vedhæft filerne igen" : ""}.`);
  }
  // A draft that is sent or saved again leaves Kladder; the new one takes its place.
  const drafts = findFolder(folders, "\\Drafts");
  if (kind === "kladde" && uid && drafts && folder === drafts) await s.remove(folder, [uid]).catch(() => undefined);
  if (asDraft) {
    if (!drafts) return again("Der er ingen mappe til kladder i mailboksen.");
    await s.append(drafts, built.raw, ["\\Draft", "\\Seen"]);
    return ctx.redirect(folderUrl(ctx.base, drafts, "&udfoert=kladde&n=1"));
  }
  const sent = findFolder(folders, "\\Sent");
  if (sent) await s.append(sent, built.raw, ["\\Seen"]).catch(error => console.warn("webmail_sent_copy_failed", error instanceof Error ? error.message : error));
  if (reply) {
    await s.setFlag(folder, [uid], "\\Answered", true).catch(() => undefined);
    await answeredInPosthus(ctx, folder, uid, reply, `${firstName(who)} | Hjerterum`, s);
  }
  return ctx.redirect(folderUrl(ctx.base, kind === "kladde" ? (sent ?? "INBOX") : folder, "&udfoert=sendt&n=1"));
}

/** The mail answered is answered in Posthus too, by whom (as the answer's sender name says, the way Saga reads team@'s Sendt). */
async function answeredInPosthus(ctx: WebmailContext, folder: string, uid: number, original: WebMessage, by: string, s: WebmailSession): Promise<void> {
  const validity = await s.uidValidity(folder).catch(() => "");
  if (!validity) return;
  const ref = folder.toUpperCase() === "INBOX" ? `imap:${validity}:${uid}` : `imap:${folder}:${validity}:${uid}`;
  await ctx.db.prepare("UPDATE board_mail SET answered_at_ms = ?, answered_how = 'svar', answered_by = ? WHERE message_ref = ? AND answered_at_ms IS NULL")
    .bind(ctx.deps.now(), by, ref).run().catch(error => console.warn("webmail_posthus_answer_failed", error instanceof Error ? error.message : error, original.subject));
}
