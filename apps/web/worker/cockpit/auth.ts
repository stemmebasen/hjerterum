import type { D1Database } from "../db.js";

/** Requested: "Til start laver vi bare ét samlet login" - one password for the whole board, set by
 * the chair as the COCKPIT_PASSWORD secret. A login gives a signed cookie for 30 days; changing the
 * password signs everyone out. Ten wrong tries from one address in a quarter of an hour, and that
 * address waits until the next quarter. */

export const SESSION_COOKIE = "hjerterum_cockpit";
export const WHO_COOKIE = "hjerterum_cockpit_who";
export const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const encoder = new TextEncoder();

const base64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function key(purpose: string, secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(`hjerterum-cockpit:${purpose}:${secret}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
const sign = async (purpose: string, secret: string, value: string) => base64url(await crypto.subtle.sign("HMAC", await key(purpose, secret), encoder.encode(value)));

/** Same length, every byte compared: how long it takes says nothing about where they differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The given password against the board's, compared as keyed digests of equal length. */
export async function passwordMatches(given: string, password: string): Promise<boolean> {
  const [a, b] = await Promise.all([sign("compare", "fixed", given), sign("compare", "fixed", password)]);
  return sameText(a, b);
}

export async function sessionValue(password: string, nowMs: number): Promise<string> {
  const expires = String(nowMs + SESSION_DAYS * 86_400_000);
  return `${expires}.${await sign("session", password, expires)}`;
}

export async function validSession(password: string | undefined, value: string | undefined, nowMs: number): Promise<boolean> {
  if (!password || !value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) <= nowMs) return false;
  return sameText(signature, await sign("session", password, expires));
}

export function readCookies(request: Request): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) {
      const name = part.slice(0, at).trim();
      try { jar.set(name, decodeURIComponent(part.slice(at + 1).trim())); } catch { /* a broken cookie is ignored */ }
    }
  }
  return jar;
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

async function bucket(request: Request, nowMs: number): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = base64url(await crypto.subtle.digest("SHA-256", encoder.encode(`cockpit-ip:${address}`))).slice(0, 16);
  return `${digest}:${Math.floor(nowMs / WINDOW_MS)}`;
}

export async function loginBlocked(db: D1Database, request: Request, nowMs: number): Promise<boolean> {
  const row = await db.prepare("SELECT attempts FROM cockpit_login_attempts WHERE bucket = ?").bind(await bucket(request, nowMs)).first<{ attempts: number }>();
  return (row?.attempts ?? 0) >= MAX_FAILURES;
}

export async function recordFailedLogin(db: D1Database, request: Request, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO cockpit_login_attempts (bucket, attempts, at_ms) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1, at_ms = excluded.at_ms`).bind(await bucket(request, nowMs), nowMs).run();
  await db.prepare("DELETE FROM cockpit_login_attempts WHERE at_ms < ?").bind(nowMs - 24 * 3_600_000).run();
}

// ---- Requested: the account locked to the one member once identified - "1." (Saga's personal login link) ----

export const PERSON_COOKIE = "hjerterum_cockpit_person";
export const PERSON_DAYS = 180;
export const LINK_MINUTES = 15;
const b64 = (text: string) => btoa(String.fromCharCode(...encoder.encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

/** A signed login for one member: who, when it was given and when it ends. */
export async function personSessionValue(secret: string, member: string, nowMs: number): Promise<string> {
  const body = `${b64(member)}.${nowMs}.${nowMs + PERSON_DAYS * 86_400_000}`;
  return `${body}.${await sign("person", secret, body)}`;
}

export async function readPersonSession(secret: string | undefined, value: string | undefined, nowMs: number): Promise<{ member: string; issuedMs: number } | null> {
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || !/^\d+$/.test(parts[1]!) || !/^\d+$/.test(parts[2]!) || Number(parts[2]) <= nowMs) return null;
  const body = parts.slice(0, 3).join(".");
  if (!sameText(parts[3]!, await sign("person", secret, body))) return null;
  try { return { member: unb64(parts[0]!), issuedMs: Number(parts[1]) }; } catch { return null; }
}

export const linkHash = async (token: string) => base64url(await crypto.subtle.digest("SHA-256", encoder.encode(`cockpit-link:${token}`)));
export function newLinkToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64url(bytes.buffer);
}

/** Requested: "Once you have logged in, you can't change to another person. This is very important." With the shared
 * password the member says who they are once, and that choice is signed into this login: it is the member until they
 * log out. The name is bound to the session's expiry, so a new login asks again - and nothing can change it in between. */
export const MEMBER_COOKIE = "hjerterum_cockpit_member";

export async function sessionMemberValue(password: string, session: string, member: string): Promise<string> {
  const body = `${b64(member)}.${session.split(".")[0] ?? ""}`;
  return `${body}.${await sign("session-member", password, body)}`;
}

export async function readSessionMember(password: string | undefined, session: string | undefined, value: string | undefined): Promise<string | null> {
  if (!password || !session || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[1] !== session.split(".")[0]) return null;
  const body = `${parts[0]}.${parts[1]}`;
  if (!sameText(parts[2]!, await sign("session-member", password, body))) return null;
  try { return unb64(parts[0]!); } catch { return null; }
}
