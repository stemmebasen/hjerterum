import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { LINK_MINUTES, linkHash, newLinkToken } from "./auth.js";

/** Requested: "Hvordan kan vi sikre os, at kontoen, når først den er identificeret, bliver låst fast til
 * den enkelte bruger?" - "1.". A board member writes /login to Saga in a private Telegram chat (or taps
 * the button on the cockpit's login page, which opens that chat). Saga knows them by their Telegram
 * account and answers with a link that logs in as them - once, within 15 minutes. Nobody can ask for
 * someone else's link, and the name cannot be changed afterwards. */

export const isLoginRequest = (text: string) => /^\/(?:login|start\s+login)\b/i.test(text.trim());

/** The board member behind a Telegram account: their name in the board's chat (or the chair). */
export async function memberByTelegram(env: SagaEnv, db: D1Database, telegramId: string): Promise<string | null> {
  if (!env.SAGA_BOARD_CHAT_ID) return null;
  const row = await db.prepare(`SELECT author_name FROM board_messages WHERE chat_id = ? AND author_telegram_id = ? AND from_assistant = 0
    ORDER BY sent_at_ms DESC LIMIT 1`).bind(env.SAGA_BOARD_CHAT_ID, telegramId).first<{ author_name: string }>();
  return row?.author_name ?? null;
}

export async function createLoginLink(db: D1Database, member: string, telegramId: string, nowMs: number): Promise<string> {
  const token = newLinkToken();
  await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(await linkHash(token), member, telegramId, nowMs, nowMs + LINK_MINUTES * 60_000).run();
  await db.prepare("DELETE FROM cockpit_login_links WHERE expires_at_ms < ?").bind(nowMs - 86_400_000).run();
  return token;
}

/** The member a link is for, while it is unused and in time. */
export async function linkMember(db: D1Database, token: string, nowMs: number): Promise<string | null> {
  const row = await db.prepare("SELECT member FROM cockpit_login_links WHERE token_hash = ? AND used_at_ms IS NULL AND expires_at_ms > ?").bind(await linkHash(token), nowMs).first<{ member: string }>();
  return row?.member ?? null;
}

/** Uses the link: only the first press counts. */
export async function useLink(db: D1Database, token: string, nowMs: number): Promise<string | null> {
  const member = await linkMember(db, token, nowMs);
  if (!member) return null;
  const result = await db.prepare("UPDATE cockpit_login_links SET used_at_ms = ? WHERE token_hash = ? AND used_at_ms IS NULL").bind(nowMs, await linkHash(token)).run();
  return Number(result.meta?.changes ?? 0) === 1 ? member : null;
}

export async function signedOutAfter(db: D1Database, member: string): Promise<number> {
  return (await db.prepare("SELECT after_ms FROM cockpit_signouts WHERE member = ?").bind(member).first<{ after_ms: number }>())?.after_ms ?? 0;
}
export async function signOutMember(db: D1Database, member: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_signouts (member, after_ms) VALUES (?, ?) ON CONFLICT(member) DO UPDATE SET after_ms = excluded.after_ms").bind(member, nowMs).run();
}

/** Saga's answer to /login in a private chat. */
export async function answerLoginRequest(env: SagaEnv, deps: SagaDeps, db: D1Database, chatId: string, telegramId: string): Promise<void> {
  const telegram = telegramClient(env, deps);
  const member = await memberByTelegram(env, db, telegramId);
  if (!member) { await telegram.sendMessage(chatId, "Login til cockpittet er kun for Hjerterums bestyrelse. Er du med i bestyrelsen, så skriv først en besked i bestyrelsens gruppe, og prøv igen."); return; }
  if (!env.COCKPIT_URL) { await telegram.sendMessage(chatId, "Cockpittet har ikke fået sin adresse endnu. Prøv igen senere."); return; }
  const token = await createLoginLink(db, member, telegramId, deps.now());
  await telegram.sendMessage(chatId, `Hej ${member.split(/\s+/)[0]}. Her er dit personlige login til bestyrelsens cockpit. Det virker én gang inden for ${LINK_MINUTES} minutter - del det ikke:\n${env.COCKPIT_URL.replace(/\/+$/, "")}/login/link/${token}`);
}
