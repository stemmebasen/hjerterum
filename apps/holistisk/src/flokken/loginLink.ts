import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { letter, mailConfigured, sendLogged } from "../mail.js";
import { cleanFirstName, createMember, sha256 } from "./auth.js";

/** Login by a link sent on e-mail, beside the personal code. Anyone with an e-mail on their profile, or who signed up
 * as a member with name and e-mail (/bliv-medlem), can ask for a link on /log-ind. The link works once, for an hour.
 * Opening it shows a page with a button; only pressing it logs in, so mail programs that open links to check them
 * do not use the link up. */

export const LINK_MINUTES = 60;
/** At most this many links per address per hour. */
const PER_HOUR = 3;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export const cleanEmail = (input: string): string | null => {
  const e = input.trim().toLowerCase();
  return e.length <= 160 && EMAIL.test(e) ? e : null;
};

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const validToken = (t: string | null | undefined): t is string => !!t && /^[A-Za-z0-9_-]{40,60}$/.test(t);
export const linkPath = (token: string) => `/log-ind/link?t=${token}`;

/** Makes a link for a profile (or, with memberId null, for a member sign-up without one). Returns the token. */
export async function createLoginLink(db: D1Database, email: string, memberId: string | null, next: string | null, expiresAt: number, now: number): Promise<string> {
  const token = newToken();
  await db.prepare("INSERT INTO login_links (token_hash, email, member_id, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), email, memberId, next, now, expiresAt).run();
  return token;
}

export type LinkRequest = { sent: true } | { error: "invalid" | "off" | "failed" };

/** Sends a login link to the address when it belongs to a profile or a member sign-up. The answer is the same whether
 * or not it does, so the form cannot be used to find out who is a member. */
export async function requestLoginLink(db: D1Database, env: Env, input: string, next: string, origin: string, now: number): Promise<LinkRequest> {
  const email = cleanEmail(input);
  if (!email) return { error: "invalid" };
  if (!mailConfigured(env)) return { error: "off" };
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM login_links WHERE email = ? AND created_at > ?").bind(email, now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_HOUR) return { sent: true };
  const member = await db.prepare("SELECT id, first_name FROM members WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string; first_name: string }>();
  const signup = member ? null : await db.prepare("SELECT name FROM membership_signups WHERE lower(email) = ? LIMIT 1").bind(email).first<{ name: string }>();
  if (!member && !signup) return { sent: true };
  const token = await createLoginLink(db, email, member?.id ?? null, next, now + LINK_MINUTES * 60_000, now);
  const name = member?.first_name ?? signup!.name.split(/\s+/)[0] ?? "";
  const mail = letter({
    to: email,
    subject: "Dit login-link til Socialklubben",
    greeting: name ? `Hej ${name}` : "Hej",
    paragraphs: ["Tryk på knappen for at logge ind på Socialklubben. Linket virker i en time, og kun én gang."],
    button: { label: "Log ind", url: origin + linkPath(token) },
    after: ["Har du ikke bedt om at logge ind, kan du bare se bort fra denne mail."]
  });
  const result = await sendLogged(db, env, "login", member?.id ?? null, mail, now);
  return result.ok ? { sent: true } : { error: "failed" };
}

export type LinkState = { ok: true; memberId: string | null; email: string; next: string | null } | { error: "used" | "expired" | "unknown" };

/** What a link is, without using it. */
export async function linkState(db: D1Database, token: string, now: number): Promise<LinkState> {
  const row = await db.prepare("SELECT email, member_id, next, expires_at, used_at FROM login_links WHERE token_hash = ?").bind(await sha256(token))
    .first<{ email: string; member_id: string | null; next: string | null; expires_at: number; used_at: number | null }>();
  if (!row) return { error: "unknown" };
  if (row.used_at) return { error: "used" };
  if (row.expires_at < now) return { error: "expired" };
  return { ok: true, memberId: row.member_id, email: row.email, next: row.next };
}

/** Uses a link: returns the member to log in (making a profile for a member sign-up that has none). */
export async function useLoginLink(db: D1Database, token: string, now: number): Promise<{ memberId: string; next: string | null; created: boolean } | { error: "used" | "expired" | "unknown" }> {
  const state = await linkState(db, token, now);
  if ("error" in state) return state;
  const taken = await db.prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?").bind(now, await sha256(token), now).run();
  if ((taken.meta?.changes ?? 0) !== 1) return { error: "used" };
  if (state.memberId) {
    const still = await db.prepare("SELECT id FROM members WHERE id = ?").bind(state.memberId).first<{ id: string }>();
    if (still) return { memberId: still.id, next: state.next, created: false };
  }
  const existing = await db.prepare("SELECT id FROM members WHERE lower(email) = ? LIMIT 1").bind(state.email).first<{ id: string }>();
  if (existing) return { memberId: existing.id, next: state.next, created: false };
  const signup = await db.prepare("SELECT name FROM membership_signups WHERE lower(email) = ? LIMIT 1").bind(state.email).first<{ name: string }>();
  if (!signup) return { error: "unknown" };
  const first = cleanFirstName(signup.name.split(/\s+/)[0] ?? "") ?? cleanFirstName(signup.name.slice(0, 30)) ?? "Medlem";
  const { member } = await createMember(db, first, now);
  await db.prepare("UPDATE members SET email = ? WHERE id = ?").bind(state.email, member.id).run();
  return { memberId: member.id, next: state.next, created: true };
}
