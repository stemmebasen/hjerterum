import type { D1Database } from "../db.js";
import { recordMailWatch } from "./connections.js";
import { setServiceStatus } from "./store.js";
import type { SagaDeps, SagaEnv } from "./env.js";
import { watchMail } from "./saga.js";

/** Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Hjerterum reads its own mailbox
 * (team@) itself, instead of having it handed over from outside: the chair connects it in the cockpit (Posthus), the
 * password is kept sealed with a key only Hjerterum holds, and Saga reads the inbox and its folders in every run. Read-only: every
 * folder is opened read-only, nothing is marked, moved or sent. Every run records what it saw, or its error (connections.ts). */

export const TEAM_MAIL_HOST = "imap.one.com";
const INBOX = "INBOX";
/** The first read reaches this far back, so the mails since the old hand-over stopped come too. */
const FIRST_LOOKBACK_MS = 30 * 24 * 3_600_000;
/** Saga runs every five minutes with 30 seconds of CPU for everything she does: reading and parsing mail is the
 * heavy part, so a run takes a dozen mails and only the first 96 KB of each (the text is at the top; attachments are not read). */
const MAX_PER_RUN = 12;
const RUN_LIMIT_MS = 40_000;
const MAX_SOURCE_BYTES = 96 * 1024;

export type TeamMailAccount = { address: string; imap_host: string; password_sealed: string; uid_validity: string | null; last_uid: number | null; connected_by: string; connected_at_ms: number };

/** The slice of an IMAP client Saga uses - ImapFlow in the worker, a fake in tests. */
type Address = { name?: string; address?: string };
export type FetchedMail = { uid: number; envelope?: { date?: Date; subject?: string; from?: Address[]; to?: Address[]; cc?: Address[]; replyTo?: Address[];
  messageId?: string; inReplyTo?: string }; flags?: Iterable<string>; references?: string; source?: Uint8Array };
export type MailFolder = { path: string; delimiter?: string; specialUse?: string; noSelect?: boolean };
export type ImapSession = {
  /** Opens a folder read-only (the inbox when none is named); search and fetch then work in it. */
  open(path?: string): Promise<{ uidValidity: string; uidNext: number }>;
  /** Every folder in the mailbox (IMAP LIST). Without it only the inbox is read. */
  folders?(): Promise<MailFolder[]>;
  search(query: { since?: Date; uid?: string }): Promise<number[]>;
  /** The mails with envelope and flags; with body: false not the message itself (only to see who answered what). */
  fetch(uids: number[], options?: { body?: boolean }): Promise<FetchedMail[]>;
  /** Lays a whole message in the inbox, unread (prisberegneren's booking requests) - nothing is sent. */
  append?(raw: Uint8Array): Promise<void>;
  close(): Promise<void>;
};
export type ImapOpener = (login: { host: string; user: string; password: string }) => Promise<ImapSession>;

/** ImapFlow over the Workers runtime's sockets (nodejs_compat), as Matrix has done since September. */
export const imapflowOpener: ImapOpener = async login => {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: login.host, port: 993, secure: true, tls: { servername: login.host, rejectUnauthorized: true },
    auth: { user: login.user, pass: login.password }, logger: false, connectionTimeout: 15_000, socketTimeout: 30_000 });
  await client.connect();
  return {
    async open(path = INBOX) {
      const box = await client.mailboxOpen(path, { readOnly: true });
      return { uidValidity: String(box.uidValidity), uidNext: Number(box.uidNext) };
    },
    async folders() {
      return (await client.list()).map(f => ({ path: f.path, delimiter: f.delimiter, ...(f.specialUse ? { specialUse: f.specialUse } : {}),
        noSelect: f.flags.has("\\Noselect") || f.flags.has("\\NonExistent") }));
    },
    async search(query) { const found = await client.search(query, { uid: true }); return Array.isArray(found) ? found : []; },
    async fetch(uids, options) {
      const mails: FetchedMail[] = [];
      if (!uids.length) return mails;
      const body = options?.body !== false;
      for await (const message of client.fetch(uids.join(","), { uid: true, envelope: true, flags: true, headers: ["references"], ...(body ? { source: { maxLength: MAX_SOURCE_BYTES } } : {}) }, { uid: true })) {
        const references = message.headers ? new TextDecoder().decode(message.headers).replace(/^references:\s*/i, "").replace(/\s+/g, " ").trim() : "";
        mails.push({ uid: message.uid, ...(message.envelope ? { envelope: message.envelope as NonNullable<FetchedMail["envelope"]> } : {}), ...(message.flags ? { flags: message.flags } : {}),
          ...(references ? { references } : {}), ...(body && message.source ? { source: message.source } : {}) });
      }
      return mails;
    },
    async append(raw) {
      const bytes = (globalThis as unknown as { Buffer: { from(bytes: Uint8Array): unknown } }).Buffer.from(raw);
      await (client as unknown as { append(path: string, content: unknown, flags?: string[]): Promise<unknown> }).append("INBOX", bytes, []);
    },
    async close() { await client.logout().catch(() => client.close()); },
  };
};

// ---- The password, sealed (AES-GCM) with a key derived from Hjerterum's own secret ----

function keySecret(env: SagaEnv): string {
  const secret = env.MAIL_ENCRYPTION_KEY || env.SAGA_TELEGRAM_WEBHOOK_SECRET || "";
  if (secret.length < 16) throw new Error("mail_key_missing");
  return secret;
}
async function sealKey(env: SagaEnv): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(keySecret(env)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("hjerterum-team-mail"), info: new TextEncoder().encode("password:v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export async function sealPassword(env: SagaEnv, password: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), new TextEncoder().encode(password)));
  return `v1.${b64(iv)}.${b64(data)}`;
}
export async function openPassword(env: SagaEnv, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("mail_password_unreadable");
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(env), unb64(data)));
  } catch { throw new Error("mail_password_unreadable"); }
}

// ---- The account ----

export async function teamMailAccount(db: D1Database): Promise<TeamMailAccount | null> {
  return db.prepare("SELECT address, imap_host, password_sealed, uid_validity, last_uid, connected_by, connected_at_ms FROM team_mail_account WHERE id = 1")
    .first<TeamMailAccount>().catch(() => null);
}

const ADDRESS = /^[^\s@<>]+@holistisk\.org$/i;

/** The chair connects the mailbox: the login is tried first, and only a mailbox that opens is kept. */
export async function connectTeamMail(env: SagaEnv, db: D1Database, input: { address: string; password: string; by: string; nowMs: number }, opener: ImapOpener = imapflowOpener): Promise<void> {
  const address = input.address.trim().toLowerCase();
  if (!ADDRESS.test(address)) throw new Error("mail_address_invalid");
  if (!input.password || input.password.length > 4096) throw new Error("mail_password_required");
  const sealed = await sealPassword(env, input.password);
  const session = await opener({ host: TEAM_MAIL_HOST, user: address, password: input.password }).catch(error => { throw loginError(error); });
  try { await session.open(); } catch (error) { throw loginError(error); } finally { await session.close().catch(() => undefined); }
  // Another mailbox starts over; the same one with a new password reads on from where it was.
  await db.prepare("DELETE FROM team_mail_folders WHERE NOT EXISTS (SELECT 1 FROM team_mail_account WHERE id = 1 AND address = ?)").bind(address).run();
  await db.prepare(`INSERT INTO team_mail_account (id, address, imap_host, password_sealed, uid_validity, last_uid, connected_by, connected_at_ms)
    VALUES (1, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET address = excluded.address, imap_host = excluded.imap_host,
    password_sealed = excluded.password_sealed, connected_by = excluded.connected_by, connected_at_ms = excluded.connected_at_ms`)
    .bind(address, TEAM_MAIL_HOST, sealed, input.by, input.nowMs).run();
}

export async function disconnectTeamMail(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("DELETE FROM team_mail_account WHERE id = 1").run();
  await db.prepare("DELETE FROM team_mail_folders").run();
  await recordMailWatch(db, { connected: false }, nowMs);
}

function loginError(error: unknown): Error {
  const text = error instanceof Error ? `${error.message} ${(error as { responseText?: string }).responseText ?? ""}` : String(error);
  if (/auth|login|credential|password/i.test(text)) return new Error("mail_login_failed");
  return new Error("mail_unreachable");
}

// ---- Reading ----

const sender = (mail: FetchedMail) => {
  const from = mail.envelope?.from?.[0];
  return [from?.name, from?.address ? `<${from.address}>` : ""].filter(Boolean).join(" ") || "ukendt";
};

async function bodyText(source: Uint8Array | undefined): Promise<string> {
  if (!source) return "";
  try {
    const { simpleParser } = await import("mailparser");
    // Buffer is there under nodejs_compat (and in tests on Node); the worker's types do not include Node's.
    const parsed = await simpleParser((globalThis as unknown as { Buffer: { from(bytes: Uint8Array): unknown } }).Buffer.from(source));
    const text = parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ") : "");
    return text.replace(/\s+/g, " ").trim().slice(0, 4000);
  } catch { return ""; }
}

/** Requested: "Hun skal læse alle relevante mails fra både hovedmappen og undermapper". Every folder is read except the
 * ones that hold no mail to the house: sent mail, drafts, trash and spam (by the server's own marking, or by the name,
 * in English or Danish), and anything inside them. The inbox always comes first. */
const SKIPPED_USE = new Set(["\\Sent", "\\Drafts", "\\Trash", "\\Junk", "\\All", "\\Flagged"]);
const SKIPPED_NAME = /^(?:sent|sent items|sent messages|sent mail|sendt|sendte|sendte elementer|sendte e-mails|sendt post|drafts?|kladder?|templates|skabeloner|trash|deleted|deleted items|deleted messages|papirkurv|slettet|slettede|slettede elementer|junk|junk e-mail|junk mail|spam|uønsket|uønsket post|uønsket e-mail|outbox|udbakke)$/i;
const SENT_NAME = /^(?:sent|sent items|sent messages|sent mail|sendt|sendte|sendte elementer|sendte e-mails|sendt post)$/i;
const leaf = (f: { path: string; delimiter?: string }) => (f.delimiter ? f.path.split(f.delimiter).pop() ?? f.path : f.path).trim();
export function readableFolders(folders: MailFolder[]): string[] {
  const skipped = folders.filter(f => (f.specialUse && SKIPPED_USE.has(f.specialUse)) || SKIPPED_NAME.test(leaf(f)));
  const inSkipped = (f: MailFolder) => skipped.some(s => f.path === s.path || (!!s.delimiter && f.path.startsWith(s.path + s.delimiter)));
  const paths = folders.filter(f => !f.noSelect && !inSkipped(f) && f.path.toUpperCase() !== INBOX).map(f => f.path);
  return [INBOX, ...new Set(paths)];
}
/** The sent-mail folders - read only for whom team@ answered, never shown or handed to Saga as mail. */
export function sentFolders(folders: MailFolder[]): string[] {
  return folders.filter(f => !f.noSelect && (f.specialUse === "\\Sent" || SENT_NAME.test(leaf(f)))).map(f => f.path);
}
/** A folder the house puts answered mail in ("Besvarede"). */
const ANSWERED_FOLDER = /^(?:besvaret|besvarede|answered|replied)$/i;

type FolderMark = { path: string; uid_validity: string; last_uid: number; checked_at_ms: number };
type Unanswered = { id: number; message_ref: string; sender: string; subject: string; received_at_ms: number; message_id: string | null; reply_address: string | null;
  folder: string | null; uid_validity: string | null; uid: number | null; preview?: string | null };

/** Sent mail is looked at this far back the first time, and a mail is checked for an answer for this long. */
const SENT_LOOKBACK_MS = 90 * 24 * 3_600_000;
const ANSWER_WINDOW_MS = 60 * 24 * 3_600_000;
const MAX_SENT_PER_RUN = 300;

const lower = (text: string | undefined) => (text ?? "").trim().toLowerCase();
const firstAddress = (list: Address[] | undefined) => lower(list?.find(a => a.address)?.address);
const answeredFlag = (mail: FetchedMail) => [...(mail.flags ?? [])].some(f => f.toLowerCase() === "\\answered");
const addressOf = (sender: string) => lower(/<([^>]+)>/.exec(sender)?.[1] ?? (sender.includes("@") ? sender : ""));
const ANY_ADDRESS = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const usableAddress = (to: string, own: string) => Boolean(to) && to !== own.toLowerCase() && !/^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/.test(to);
/** Who an answer to a mail would go to: its Reply-To or sender. A mail a web form sent from team@ itself carries the asker only in
 * what the form wrote, so there the first other address in the text counts. Null when no one can be found - then Saga cannot
 * see an answer by its recipient, and Posthus says so. */
export function replyTarget(row: Pick<Unanswered, "reply_address" | "sender" | "preview">, ownAddress: string): { to: string; fromText: boolean } | null {
  const direct = row.reply_address?.trim().toLowerCase() || addressOf(row.sender);
  if (usableAddress(direct, ownAddress)) return { to: direct, fromText: false };
  for (const found of row.preview?.match(ANY_ADDRESS) ?? []) {
    const address = found.toLowerCase();
    if (usableAddress(address, ownAddress)) return { to: address, fromText: true };
  }
  return null;
}

/** "Re: Sv: Fwd: Leje af salen" and "leje af salen" are the same subject. */
export const sameSubject = (subject: string) => subject.toLowerCase().replace(/^(?:\s*(?:re|sv|aw|vs|fw|fwd|videresend)\s*(?:\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();

/** Where a kept mail lies in team@: from its own columns, or from the reference it was kept under (imap:[path:]validity:uid). */
function location(row: Unanswered): { folder: string; uidValidity: string; uid: number } | null {
  if (row.folder && row.uid_validity && row.uid) return { folder: row.folder, uidValidity: row.uid_validity, uid: row.uid };
  const m = /^imap:(?:(.+):)?([^:]+):(\d+)$/.exec(row.message_ref);
  return m ? { folder: m[1] ?? INBOX, uidValidity: m[2]!, uid: Number(m[3]) } : null;
}

async function markAnswered(db: D1Database, id: number, atMs: number, how: "svar" | "markeret" | "mappe"): Promise<void> {
  await db.prepare("UPDATE board_mail SET answered_at_ms = ?, answered_how = ? WHERE id = ? AND answered_at_ms IS NULL AND answered_how IS NULL").bind(atMs, how, id).run();
}

/** One run: the new mails in the inbox and the other folders to Saga (each once), every folder's watermark moved, and
 * what happened recorded. A mail moved between folders is the same mail to Saga (same sender, subject and minute).
 * Asked: "hvordan ved Saga, at de ikke er besvaret?" - "Hun er nødt til at tjekke, om der er kommet svar i mailboksen".
 * Every run also looks for answers to the mails of the last 60 days: the mail marked answered in team@ (what a mail
 * program does when someone replies), the mail put in a folder "Besvarede", or a mail in Sent that replies to it. */
export async function readTeamMail(env: SagaEnv, deps: SagaDeps, db: D1Database, opener: ImapOpener = imapflowOpener): Promise<{ read: number; answered: number; error?: string }> {
  const account = await teamMailAccount(db);
  if (!account) return { read: 0, answered: 0 };
  const status = { connected: true, folders: 0, listed: 0, relayed: 0, answered: 0, error: "" };
  let session: ImapSession | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("read_timeout")), RUN_LIMIT_MS); });
  try {
    await Promise.race([(async () => {
      const password = await openPassword(env, account.password_sealed);
      session = await opener({ host: account.imap_host, user: account.address, password }).catch(error => { throw loginError(error); });
      const open: ImapSession = session;
      const now = deps.now();
      // Where the run is, so a run cut off from outside (the runtime's limits) shows where it stopped.
      const progress = (step: string) => setServiceStatus(db, "team_mail_progress", true, step, deps.now());
      await progress("logget ind");
      const marks = new Map((await db.prepare("SELECT path, uid_validity, last_uid, checked_at_ms FROM team_mail_folders").all<FolderMark>()).results?.map(m => [m.path, m] as const) ?? []);
      const listing = open.folders ? await open.folders() : null;
      const paths = listing ? readableFolders(listing) : [INBOX];
      const sent = listing ? sentFolders(listing) : [];
      const answeredFolders = new Set((listing ?? []).filter(f => ANSWERED_FOLDER.test(leaf(f))).map(f => f.path));
      if (listing) await db.prepare("DELETE FROM team_mail_folders WHERE path NOT IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...paths, ...sent])).run();
      const unanswered = (await db.prepare(`SELECT id, message_ref, sender, subject, received_at_ms, message_id, reply_address, folder, uid_validity, uid FROM board_mail
        WHERE answered_at_ms IS NULL AND answered_how IS NULL AND received_at_ms >= ? ORDER BY received_at_ms DESC LIMIT 500`).bind(now - ANSWER_WINDOW_MS).all<Unanswered>()).results ?? [];
      const waitingIn = new Map<string, Unanswered[]>();
      for (const row of unanswered) { const at = location(row); if (at) waitingIn.set(at.folder, [...(waitingIn.get(at.folder) ?? []), row]); }

      const watermark = (path: string, uidValidity: string, last: number) => db.prepare(`INSERT INTO team_mail_folders (path, uid_validity, last_uid, checked_at_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, checked_at_ms = excluded.checked_at_ms`).bind(path, uidValidity, last, now).run();
      const newUids = async (mark: FolderMark | undefined, box: { uidValidity: string }, lookbackMs: number) => {
        // A changed UIDVALIDITY means the old numbers mean nothing: start again from the lookback.
        const after = !mark || mark.uid_validity !== box.uidValidity ? null : mark.last_uid;
        const uids = (after === null ? await open.search({ since: new Date(now - lookbackMs) }) : await open.search({ uid: `${after + 1}:*` }))
          .filter(uid => after === null || uid > after).sort((a, b) => a - b);
        return { after, uids };
      };

      // The inbox first, then the folder checked longest ago, so no folder waits for ever behind a busy one.
      const order = [INBOX, ...paths.filter(p => p !== INBOX).sort((a, b) => (marks.get(a)?.checked_at_ms ?? 0) - (marks.get(b)?.checked_at_ms ?? 0) || a.localeCompare(b))];
      status.folders = order.length;
      let room = MAX_PER_RUN;
      for (const [n, path] of order.entries()) {
        const waiting = waitingIn.get(path) ?? [];
        if (room <= 0 && !waiting.length) continue;
        await progress(`mappe ${n + 1}/${order.length}: ${path}`);
        // A subfolder that will not open is passed over (and tried again next run); the inbox failing is the run's error.
        const box = await open.open(path).catch(error => { if (path === INBOX) throw error; console.warn("team_mail_folder_unreadable", path, error instanceof Error ? error.message : error); return null; });
        if (!box) continue;
        if (room > 0) {
          const { after, uids } = await newUids(marks.get(path), box, FIRST_LOOKBACK_MS);
          status.listed += uids.length;
          const batch = uids.slice(0, room);
          const mails = (await open.fetch(batch)).sort((a, b) => a.uid - b.uid);
          const relayed = [];
          for (const mail of mails) {
            relayed.push({ ref: path === INBOX ? `imap:${box.uidValidity}:${mail.uid}` : `imap:${path}:${box.uidValidity}:${mail.uid}`, from: sender(mail), subject: mail.envelope?.subject ?? "",
              receivedAt: (mail.envelope?.date instanceof Date && !Number.isNaN(mail.envelope.date.getTime()) ? mail.envelope.date : new Date(now)).toISOString(),
              text: await bodyText(mail.source) });
          }
          if (relayed.length) await watchMail(env, deps, relayed);
          // Where each mail lies, and whether it is answered already - on the kept row, also when it was kept from another folder.
          for (const [i, mail] of mails.entries()) {
            const r = relayed[i]!;
            await db.prepare(`UPDATE board_mail SET folder = ?, uid_validity = ?, uid = ?, message_id = COALESCE(?, message_id), reply_address = COALESCE(?, reply_address)
              WHERE message_ref = ? OR (sender = ? AND subject = ? AND received_at_ms / 60000 = ? / 60000)`)
              .bind(path, box.uidValidity, mail.uid, lower(mail.envelope?.messageId) || null, firstAddress(mail.envelope?.replyTo) || firstAddress(mail.envelope?.from) || null,
                r.ref, r.from.slice(0, 320), (r.subject || "(intet emne)").slice(0, 500), Date.parse(r.receivedAt)).run();
            const how = answeredFolders.has(path) ? "mappe" : answeredFlag(mail) ? "markeret" : null;
            if (how) {
              const row = await db.prepare("SELECT id FROM board_mail WHERE folder = ? AND uid_validity = ? AND uid = ?").bind(path, box.uidValidity, mail.uid).first<{ id: number }>();
              if (row) { await markAnswered(db, row.id, now, how); status.answered++; }
            }
          }
          status.relayed += relayed.length;
          room -= batch.length;
          const last = batch.length ? batch[batch.length - 1]! : after === null ? Math.max(0, box.uidNext - 1) : after;
          await watermark(path, box.uidValidity, last);
        }
        // The mails here still without an answer: marked answered since, or lying in "Besvarede".
        const here = waiting.map(row => ({ row, at: location(row)! })).filter(w => w.at.uidValidity === box.uidValidity);
        if (here.length) {
          const flagged = answeredFolders.has(path) ? here.map(w => w.at.uid) : (await open.fetch(here.map(w => w.at.uid), { body: false })).filter(answeredFlag).map(m => m.uid);
          for (const w of here.filter(w => flagged.includes(w.at.uid))) { await markAnswered(db, w.row.id, now, answeredFolders.has(path) ? "mappe" : "markeret"); status.answered++; }
        }
      }

      // Sent mail: only who it went to, its subject and which mail it answers - kept to find the answers, never shown.
      await progress("sendt");
      let sentRoom = MAX_SENT_PER_RUN;
      for (const path of sent) {
        if (sentRoom <= 0) break;
        const box = await open.open(path).catch(error => { console.warn("team_mail_sent_unreadable", path, error instanceof Error ? error.message : error); return null; });
        if (!box) continue;
        const { after, uids } = await newUids(marks.get(path), box, SENT_LOOKBACK_MS);
        const batch = uids.slice(0, sentRoom);
        for (const mail of await open.fetch(batch, { body: false })) {
          const to = [...(mail.envelope?.to ?? []), ...(mail.envelope?.cc ?? [])].map(a => lower(a.address)).filter(Boolean);
          // The name the mail program puts on the answer ("Gitta | Hjerterum") tells Saga who on the team answers whom (cockpit/enquiries.ts autoAssignMail).
          await db.prepare(`INSERT OR IGNORE INTO team_mail_sent (ref, message_id, in_reply_to, refs, recipients, subject, sent_at_ms, from_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(`${path}:${box.uidValidity}:${mail.uid}`, lower(mail.envelope?.messageId) || null, lower(mail.envelope?.inReplyTo) || null, lower(mail.references) || null,
              to.join(" "), mail.envelope?.subject ?? "", mail.envelope?.date instanceof Date && !Number.isNaN(mail.envelope.date.getTime()) ? mail.envelope.date.getTime() : now,
              (mail.envelope?.from?.[0]?.name ?? "").trim().slice(0, 120) || null).run();
        }
        sentRoom -= batch.length;
        await watermark(path, box.uidValidity, batch.length ? batch[batch.length - 1]! : after === null ? Math.max(0, box.uidNext - 1) : after);
      }
      status.answered += await matchSentAnswers(db, now, account.address);
      await progress("færdig");
    })(), limit]);
  } catch (error) {
    status.error = (error instanceof Error ? error.message : String(error)).slice(0, 200) || "unknown_error";
  } finally {
    clearTimeout(timer);
    await (session as ImapSession | null)?.close().catch(() => undefined);
  }
  await recordMailWatch(db, status, deps.now());
  return { read: status.relayed, answered: status.answered, ...(status.error ? { error: status.error } : {}) };
}

/** A mail is answered when a mail in Sent replies to it (In-Reply-To or References), or went to the address an answer
 * goes to after it came - with the same subject, or to at most three people (a newsletter to many answers no one). */
export async function matchSentAnswers(db: D1Database, nowMs: number, ownAddress: string): Promise<number> {
  const [rows, sent] = await Promise.all([
    db.prepare(`SELECT id, message_ref, sender, subject, received_at_ms, message_id, reply_address, folder, uid_validity, uid, preview FROM board_mail
      WHERE answered_at_ms IS NULL AND answered_how IS NULL AND received_at_ms >= ? ORDER BY received_at_ms DESC LIMIT 500`).bind(nowMs - ANSWER_WINDOW_MS).all<Unanswered>().then(r => r.results ?? []),
    db.prepare("SELECT message_id, in_reply_to, refs, recipients, subject, sent_at_ms, from_name FROM team_mail_sent WHERE sent_at_ms >= ? ORDER BY sent_at_ms")
      .bind(nowMs - ANSWER_WINDOW_MS - SENT_LOOKBACK_MS).all<{ message_id: string | null; in_reply_to: string | null; refs: string | null; recipients: string; subject: string; sent_at_ms: number; from_name: string | null }>().then(r => r.results ?? []),
  ]);
  let answered = 0;
  for (const row of rows) {
    const id = row.message_id?.toLowerCase() ?? "";
    const target = replyTarget({ reply_address: row.reply_address, sender: row.sender, preview: row.preview ?? "" }, ownAddress);
    const reply = sent.find(s => s.sent_at_ms >= row.received_at_ms - 60_000 && (
      (id && (s.in_reply_to === id || (s.refs ?? "").includes(id))) ||
      (target && s.recipients.split(" ").includes(target.to) && (sameSubject(s.subject) === sameSubject(row.subject) || s.recipients.split(" ").length <= 3))));
    if (reply) {
      await markAnswered(db, row.id, reply.sent_at_ms, "svar"); answered++;
      if (reply.from_name) await db.prepare("UPDATE board_mail SET answered_by = ? WHERE id = ? AND answered_by IS NULL").bind(reply.from_name, row.id).run();
    }
  }
  return answered;
}

/** Requested: "her og nu skal der bare lande en e-mail med alle oplysningerne i vores fællesmail team@holistisk.org". A
 * booking request from prisberegneren is laid straight into team@'s own inbox (IMAP APPEND), unread, with the sender's
 * address as Reply-To - nothing leaves Hjerterum and nothing is sent from team@. Saga's next read sees it like any mail. */
/** The mailbox opened and closed again, nothing written: the calculator's probe (beregner/handler.ts) proves the request
 * would have landed. */
export async function verifyTeamInbox(env: SagaEnv, db: D1Database, opener: ImapOpener = imapflowOpener): Promise<{ address: string }> {
  const account = await teamMailAccount(db);
  if (!account) throw new Error("team_mail_not_connected");
  const password = await openPassword(env, account.password_sealed);
  const session = await opener({ host: account.imap_host, user: account.address, password }).catch(error => { throw loginError(error); });
  try { if (!session.append) throw new Error("mail_append_unavailable"); }
  finally { await session.close().catch(() => undefined); }
  return { address: account.address };
}

export async function deliverToTeamInbox(env: SagaEnv, db: D1Database, raw: Uint8Array, opener: ImapOpener = imapflowOpener): Promise<{ address: string }> {
  const account = await teamMailAccount(db);
  if (!account) throw new Error("team_mail_not_connected");
  const password = await openPassword(env, account.password_sealed);
  const session = await opener({ host: account.imap_host, user: account.address, password }).catch(error => { throw loginError(error); });
  try {
    if (!session.append) throw new Error("mail_append_unavailable");
    await session.append(raw);
  } finally { await session.close().catch(() => undefined); }
  return { address: account.address };
}
