import type { D1Database } from "../db.js";
import { recordMailWatch } from "./connections.js";
import type { SagaDeps, SagaEnv } from "./env.js";
import { watchMail } from "./saga.js";

/** Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Hjerterum reads its own mailbox
 * (team@) itself, instead of having it handed over from outside: the chair connects it in the cockpit (Posthus), the
 * password is kept sealed with a key only Hjerterum holds, and Saga reads the inbox in every run. Read-only: the inbox is
 * opened read-only, nothing is marked, moved or sent. Every run records what it saw, or its error (connections.ts). */

export const TEAM_MAIL_HOST = "imap.one.com";
/** The first read reaches this far back, so the mails since the old hand-over stopped come too. */
const FIRST_LOOKBACK_MS = 30 * 24 * 3_600_000;
const MAX_PER_RUN = 25;
const RUN_LIMIT_MS = 40_000;
const MAX_SOURCE_BYTES = 256 * 1024;

export type TeamMailAccount = { address: string; imap_host: string; password_sealed: string; uid_validity: string | null; last_uid: number | null; connected_by: string; connected_at_ms: number };

/** The slice of an IMAP client Saga uses - ImapFlow in the worker, a fake in tests. */
export type FetchedMail = { uid: number; envelope?: { date?: Date; subject?: string; from?: Array<{ name?: string; address?: string }> }; source?: Uint8Array };
export type ImapSession = {
  open(): Promise<{ uidValidity: string; uidNext: number }>;
  search(query: { since?: Date; uid?: string }): Promise<number[]>;
  fetch(uids: number[]): Promise<FetchedMail[]>;
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
    async open() {
      const box = await client.mailboxOpen("INBOX", { readOnly: true });
      return { uidValidity: String(box.uidValidity), uidNext: Number(box.uidNext) };
    },
    async search(query) { const found = await client.search(query, { uid: true }); return Array.isArray(found) ? found : []; },
    async fetch(uids) {
      const mails: FetchedMail[] = [];
      if (!uids.length) return mails;
      for await (const message of client.fetch(uids.join(","), { uid: true, envelope: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: true })) {
        mails.push({ uid: message.uid, ...(message.envelope ? { envelope: message.envelope as NonNullable<FetchedMail["envelope"]> } : {}), ...(message.source ? { source: message.source } : {}) });
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
  await db.prepare(`INSERT INTO team_mail_account (id, address, imap_host, password_sealed, uid_validity, last_uid, connected_by, connected_at_ms)
    VALUES (1, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET address = excluded.address, imap_host = excluded.imap_host,
    password_sealed = excluded.password_sealed, connected_by = excluded.connected_by, connected_at_ms = excluded.connected_at_ms,
    uid_validity = CASE WHEN team_mail_account.address = excluded.address THEN team_mail_account.uid_validity END,
    last_uid = CASE WHEN team_mail_account.address = excluded.address THEN team_mail_account.last_uid END`)
    .bind(address, TEAM_MAIL_HOST, sealed, input.by, input.nowMs).run();
}

export async function disconnectTeamMail(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("DELETE FROM team_mail_account WHERE id = 1").run();
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

/** One run: the new mails in the inbox to Saga (each once), the watermark moved, and what happened recorded. */
export async function readTeamMail(env: SagaEnv, deps: SagaDeps, db: D1Database, opener: ImapOpener = imapflowOpener): Promise<{ read: number; error?: string }> {
  const account = await teamMailAccount(db);
  if (!account) return { read: 0 };
  const status = { connected: true, listed: 0, relayed: 0, error: "" };
  let session: ImapSession | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("read_timeout")), RUN_LIMIT_MS); });
  try {
    await Promise.race([(async () => {
      const password = await openPassword(env, account.password_sealed);
      session = await opener({ host: account.imap_host, user: account.address, password }).catch(error => { throw loginError(error); });
      const box = await session.open();
      // A changed UIDVALIDITY means the old numbers mean nothing: start again from the lookback.
      const fresh = account.uid_validity !== box.uidValidity || account.last_uid === null;
      const uids = (fresh ? await session.search({ since: new Date(deps.now() - FIRST_LOOKBACK_MS) }) : await session.search({ uid: `${account.last_uid! + 1}:*` }))
        .filter(uid => fresh || uid > account.last_uid!).sort((a, b) => a - b);
      status.listed = uids.length;
      const batch = uids.slice(0, MAX_PER_RUN);
      const mails = await session.fetch(batch);
      const relayed = [];
      for (const mail of mails.sort((a, b) => a.uid - b.uid)) {
        relayed.push({ ref: `imap:${box.uidValidity}:${mail.uid}`, from: sender(mail), subject: mail.envelope?.subject ?? "",
          receivedAt: (mail.envelope?.date instanceof Date && !Number.isNaN(mail.envelope.date.getTime()) ? mail.envelope.date : new Date(deps.now())).toISOString(),
          text: await bodyText(mail.source) });
      }
      if (relayed.length) await watchMail(env, deps, relayed);
      status.relayed = relayed.length;
      const last = batch.length ? batch[batch.length - 1]! : fresh ? Math.max(0, box.uidNext - 1) : account.last_uid!;
      await db.prepare("UPDATE team_mail_account SET uid_validity = ?, last_uid = ? WHERE id = 1").bind(box.uidValidity, last).run();
    })(), limit]);
  } catch (error) {
    status.error = (error instanceof Error ? error.message : String(error)).slice(0, 200) || "unknown_error";
  } finally {
    clearTimeout(timer);
    await (session as ImapSession | null)?.close().catch(() => undefined);
  }
  await recordMailWatch(db, status, deps.now());
  return { read: status.relayed, ...(status.error ? { error: status.error } : {}) };
}

/** Requested: "her og nu skal der bare lande en e-mail med alle oplysningerne i vores fællesmail team@holistisk.org". A
 * booking request from prisberegneren is laid straight into team@'s own inbox (IMAP APPEND), unread, with the sender's
 * address as Reply-To - nothing leaves Hjerterum and nothing is sent from team@. Saga's next read sees it like any mail. */
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
