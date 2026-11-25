import type { D1Database } from "./db.js";

/** Unsubscribing from Socialklubben's mails (Jake 2026-11-25). Every mail with an unsubscribe option carries a link
 * with the address's own token (table mail_prefs); the same token is the "fjern mig fra listen" link in the status
 * mails. An unsubscribed address gets no more mails, except those the person asks for there and then (a login link, the
 * answer to their own sign-up for the information meeting). */

export const UNSUBSCRIBE_PATH = "/afmeld";
export const WITHDRAW_PATH = "/afmeld/interesse";

/** Mails sent even to an unsubscribed address: the person has just asked for them. */
const ALWAYS_SENT = new Set(["login", "kontakt", "informationsmoede"]);
/** Mails without an unsubscribe link: a login link (asked for, and private), and the contact form (to our own inbox). */
const NO_LINK = new Set(["login", "kontakt"]);

export const hasUnsubscribeLink = (kind: string | undefined): boolean => !NO_LINK.has(kind ?? "");
export const sentWhenUnsubscribed = (kind: string | undefined): boolean => ALWAYS_SENT.has(kind ?? "");

const clean = (email: string) => email.trim().toLowerCase();
export const validMailToken = (t: string | null | undefined): t is string => !!t && /^[A-Za-z0-9_-]{30,60}$/.test(t);

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type MailPref = { email: string; token: string; unsubscribed_at: number | null };

/** The address's row, made the first time it is needed. */
export async function mailPref(db: D1Database, email: string, now: number): Promise<MailPref> {
  const e = clean(email);
  await db.prepare("INSERT OR IGNORE INTO mail_prefs (email, token, unsubscribed_at, created_at) VALUES (?, ?, NULL, ?)").bind(e, newToken(), now).run();
  return (await db.prepare("SELECT email, token, unsubscribed_at FROM mail_prefs WHERE email = ?").bind(e).first<MailPref>())!;
}

export async function prefByToken(db: D1Database, token: string): Promise<MailPref | null> {
  return db.prepare("SELECT email, token, unsubscribed_at FROM mail_prefs WHERE token = ?").bind(token).first<MailPref>();
}

export async function isUnsubscribed(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT unsubscribed_at FROM mail_prefs WHERE email = ?").bind(clean(email)).first<{ unsubscribed_at: number | null }>();
  return row?.unsubscribed_at != null;
}

export async function setUnsubscribed(db: D1Database, token: string, out: boolean, now: number): Promise<void> {
  await db.prepare(`UPDATE mail_prefs SET unsubscribed_at = ${out ? "COALESCE(unsubscribed_at, ?)" : "NULL"} WHERE token = ?`)
    .bind(...(out ? [now, token] : [token])).run();
}

/** The links for one address: to unsubscribe, and to take one arrangement's interest off the list. */
export const unsubscribeUrl = (siteUrl: string, token: string, lang: "da" | "en" = "da"): string =>
  `${siteUrl}${lang === "en" ? "/en/unsubscribe" : UNSUBSCRIBE_PATH}?t=${token}`;
export const withdrawUrl = (siteUrl: string, token: string, slug: string): string => `${siteUrl}${WITHDRAW_PATH}?t=${token}&a=${encodeURIComponent(slug)}`;
