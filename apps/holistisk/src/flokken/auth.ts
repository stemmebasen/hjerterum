import type { D1Database } from "../db.js";

/** Flokken's login: a member is a first name and a personal code. No e-mail, phone or other personal data is kept.
 * The code is shown once when the member is created and is the only way to log in on another device; only its SHA-256
 * is stored (the code has 60 random bits, so a plain hash is enough). A login is a random session token in an
 * HttpOnly cookie, stored as a hash with an expiry. */

export type Member = { id: string; first_name: string; created_at: number };

export const SESSION_COOKIE = "flok_session";
const SESSION_DAYS = 90;
/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomChars(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n * 2));
  let out = "";
  // Rejection sampling keeps every letter equally likely.
  for (const b of bytes) {
    if (out.length === n) break;
    if (b < 248) out += ALPHABET[b % ALPHABET.length];
  }
  return out.length === n ? out : out + randomChars(n - out.length);
}

/** "K7QF-29MX-T4HD" */
export const newCode = (): string => { const c = randomChars(12); return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`; };

/** What a person typed, as the canonical code, or null when it cannot be one. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O").replace(/[1IL]/g, "");
  if (c.length !== 12 || [...c].some(ch => !ALPHABET.includes(ch))) return null;
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** A first name as shown to the other members of a flock: letters, spaces, hyphens and apostrophes, at most 30. */
export function cleanFirstName(input: string): string | null {
  const name = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 30 || !/^[\p{L}][\p{L}\p{M}' -]*$/u.test(name)) return null;
  return name;
}

export async function createMember(db: D1Database, firstName: string, now: number): Promise<{ member: Member; code: string }> {
  const code = newCode();
  const member = { id: crypto.randomUUID(), first_name: firstName, created_at: now };
  await db.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .bind(member.id, member.first_name, await sha256(code), now, now).run();
  return { member, code };
}

export async function memberByCode(db: D1Database, code: string): Promise<Member | null> {
  return db.prepare("SELECT id, first_name, created_at FROM members WHERE code_hash = ?").bind(await sha256(code)).first<Member>();
}

/** Starts a session; returns the Set-Cookie header value. */
export async function startSession(db: D1Database, memberId: string, now: number): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await db.batch([
    db.prepare("DELETE FROM member_sessions WHERE member_id = ? AND expires_at < ?").bind(memberId, now),
    db.prepare("INSERT INTO member_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), memberId, now, now + SESSION_DAYS * 86_400_000)
  ]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

export const clearSessionCookie = (): string => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(cookie);
  return m?.[1] ?? null;
}

export async function currentMember(db: D1Database, request: Request, now: number): Promise<Member | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare(`SELECT m.id, m.first_name, m.created_at FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256(token), now).first<Member>();
}

export async function endSession(db: D1Database, request: Request): Promise<void> {
  const token = sessionToken(request);
  if (token) await db.prepare("DELETE FROM member_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

/** Forms post only from the portal's own pages: the browser's Origin (or Referer) must be this site. */
export function sameOrigin(request: Request, own = new URL(request.url).origin): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === own;
  const referer = request.headers.get("referer");
  try { return !!referer && new URL(referer).origin === own; } catch { return false; }
}

/** A path on this site to go back to after logging in; anything else becomes "/flokke". */
export function safeNext(value: string | null | undefined): string {
  return value && /^\/(?!\/)[A-Za-z0-9/_.?=&%-]{0,200}$/.test(value) ? value : "/flokke";
}

/** Constant-time comparison for bearer tokens. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
