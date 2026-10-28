import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { LINK_MINUTES, linkHash, loginCodeHash, newLinkToken, newLoginCode } from "./auth.js";
import { deputyByTelegram, stillDeputy } from "./deputies.js";

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

/** Requested: "Ja" to letting Saga ask Telegram whether the person is in the board's group right now - so a member who is taken out of the group
 * loses access by themselves. true / false, or null when Telegram could not say. The chair's own account always counts. */
export async function stillOnBoard(env: SagaEnv, deps: SagaDeps, telegramId: string): Promise<boolean | null> {
  if (env.SAGA_OWNER_TELEGRAM_ID && telegramId === env.SAGA_OWNER_TELEGRAM_ID) return true;
  if (!env.SAGA_BOARD_CHAT_ID) return null;
  try {
    const member = await telegramClient(env, deps).getChatMember(env.SAGA_BOARD_CHAT_ID, telegramId);
    return ["creator", "administrator", "member"].includes(member.status) || (member.status === "restricted" && member.is_member === true);
  } catch { return null; }
}

/** Signs a member out of every device once, unless they are already signed out and have not used a link since. */
export async function closeIfOpen(db: D1Database, member: string, nowMs: number): Promise<boolean> {
  const [after, last] = await Promise.all([signedOutAfter(db, member),
    db.prepare("SELECT MAX(used_at_ms) AS at FROM cockpit_login_links WHERE member = ? AND used_at_ms IS NOT NULL").bind(member).first<{ at: number | null }>()]);
  if ((last?.at ?? 0) <= after) return false;
  await signOutMember(db, member, nowMs);
  return true;
}

/** Once an hour: whoever is no longer in the board's group is signed out, and cannot get a new link. Nothing happens if Telegram cannot say. */
export async function scheduledBoardAccess(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  if (!env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return;
  if (!(await claim("saga_board_access", Math.floor(deps.now() / 3_600_000)))) return;
  const people = await db.prepare(`SELECT author_name, author_telegram_id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
    GROUP BY author_telegram_id`).bind(env.SAGA_BOARD_CHAT_ID).all<{ author_name: string; author_telegram_id: string }>().then(r => r.results ?? []);
  for (const person of people) {
    if (await stillOnBoard(env, deps, person.author_telegram_id) === false) await closeIfOpen(db, person.author_name, deps.now());
  }
}

/** A login for one member: a link (opens in Telegram's own browser) and a code (typed in the member's usual browser). Either, once. */
/** Who logs in: a board member, or a deputy (cockpit/deputies.ts). */
export type LoginRole = "bestyrelse" | "suppleant";

export async function createLoginLink(db: D1Database, secret: string, member: string, telegramId: string, nowMs: number, role: LoginRole = "bestyrelse"): Promise<{ token: string; code: string }> {
  const token = newLinkToken(), code = newLoginCode();
  await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, code_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await linkHash(token), member, telegramId, nowMs, nowMs + LINK_MINUTES * 60_000, await loginCodeHash(secret, code), role === "suppleant" ? "suppleant" : null).run();
  await db.prepare("DELETE FROM cockpit_login_links WHERE expires_at_ms < ?").bind(nowMs - 86_400_000).run();
  return { token, code };
}

/** The member a link is for, while it is unused and in time. */
export async function linkMember(db: D1Database, token: string, nowMs: number): Promise<string | null> {
  return (await linkLogin(db, token, nowMs))?.member ?? null;
}

/** The member and role a link is for, while it is unused and in time. */
export async function linkLogin(db: D1Database, token: string, nowMs: number): Promise<{ member: string; role: LoginRole } | null> {
  const row = await db.prepare("SELECT member, role FROM cockpit_login_links WHERE token_hash = ? AND used_at_ms IS NULL AND expires_at_ms > ?").bind(await linkHash(token), nowMs).first<{ member: string; role: string | null }>();
  return row ? { member: row.member, role: row.role === "suppleant" ? "suppleant" : "bestyrelse" } : null;
}

/** Uses the code typed on the login page: the member it belongs to, while it is unused and in time - and then the link beside it is used up too. */
export async function useCode(db: D1Database, secret: string, code: string, nowMs: number): Promise<string | null> {
  return (await useCodeAs(db, secret, code, nowMs))?.member ?? null;
}
export async function useCodeAs(db: D1Database, secret: string, code: string, nowMs: number): Promise<{ member: string; role: LoginRole } | null> {
  const hash = await loginCodeHash(secret, code);
  const row = await db.prepare("SELECT token_hash, member, role FROM cockpit_login_links WHERE code_hash = ? AND used_at_ms IS NULL AND expires_at_ms > ?").bind(hash, nowMs).first<{ token_hash: string; member: string; role: string | null }>();
  if (!row) return null;
  const result = await db.prepare("UPDATE cockpit_login_links SET used_at_ms = ? WHERE token_hash = ? AND used_at_ms IS NULL").bind(nowMs, row.token_hash).run();
  return Number(result.meta?.changes ?? 0) === 1 ? { member: row.member, role: row.role === "suppleant" ? "suppleant" : "bestyrelse" } : null;
}

/** Uses the link: only the first press counts. */
export async function useLink(db: D1Database, token: string, nowMs: number): Promise<string | null> {
  return (await useLinkAs(db, token, nowMs))?.member ?? null;
}
export async function useLinkAs(db: D1Database, token: string, nowMs: number): Promise<{ member: string; role: LoginRole } | null> {
  const login = await linkLogin(db, token, nowMs);
  if (!login) return null;
  const result = await db.prepare("UPDATE cockpit_login_links SET used_at_ms = ? WHERE token_hash = ? AND used_at_ms IS NULL").bind(nowMs, await linkHash(token)).run();
  return Number(result.meta?.changes ?? 0) === 1 ? login : null;
}

export async function signedOutAfter(db: D1Database, member: string): Promise<number> {
  return (await db.prepare("SELECT after_ms FROM cockpit_signouts WHERE member = ?").bind(member).first<{ after_ms: number }>())?.after_ms ?? 0;
}
export async function signOutMember(db: D1Database, member: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_signouts (member, after_ms) VALUES (?, ?) ON CONFLICT(member) DO UPDATE SET after_ms = excluded.after_ms").bind(member, nowMs).run();
}

/** Saga's answer to /login in a private chat. Someone in the board's group gets the board's login; otherwise someone in the deputies'
 * group gets a deputy's login (cockpit/deputies.ts) - requested: "Lad os starte med suppleant adgang". */
export async function answerLoginRequest(env: SagaEnv, deps: SagaDeps, db: D1Database, chatId: string, telegramId: string): Promise<void> {
  const telegram = telegramClient(env, deps);
  const member = await memberByTelegram(env, db, telegramId);
  // Only someone who is in the group right now: a member who was taken out loses access even though their old messages are still there.
  const present = member ? await stillOnBoard(env, deps, telegramId) : false;
  if (member && present === null) { await telegram.sendMessage(chatId, "Jeg kan ikke tjekke lige nu, om du er med i bestyrelsens gruppe. Prøv igen om lidt."); return; }
  if (member && present === false) await closeIfOpen(db, member, deps.now());
  if (!member || present === false) {
    // Not (or no longer) on the board: perhaps a deputy.
    const deputy = await deputyByTelegram(env, db, telegramId);
    const deputyHere = deputy ? await stillDeputy(env, deps, telegramId) : false;
    if (deputy && deputyHere === null) { await telegram.sendMessage(chatId, "Jeg kan ikke tjekke lige nu, om du er med i suppleanternes gruppe. Prøv igen om lidt."); return; }
    if (deputy && deputyHere) { await sendLogin(env, deps, db, chatId, telegramId, deputy, "suppleant"); return; }
    if (member) { await telegram.sendMessage(chatId, "Du er ikke længere med i bestyrelsens gruppe, så jeg kan ikke give dig login til admin. Er det en fejl, så skriv til formanden."); return; }
    await telegram.sendMessage(chatId, "Login til admin er kun for Hjerterums bestyrelse og suppleanter. Er du med, så skriv først en besked i din gruppe, og prøv igen.");
    return;
  }
  await sendLogin(env, deps, db, chatId, telegramId, member, "bestyrelse");
}

async function sendLogin(env: SagaEnv, deps: SagaDeps, db: D1Database, chatId: string, telegramId: string, member: string, role: LoginRole): Promise<void> {
  const telegram = telegramClient(env, deps);
  if (!env.COCKPIT_URL) { await telegram.sendMessage(chatId, "Admin har ikke fået sin adresse endnu. Prøv igen senere."); return; }
  const { token, code } = await createLoginLink(db, env.SAGA_TELEGRAM_BOT_TOKEN ?? "", member, telegramId, deps.now(), role);
  const address = env.COCKPIT_URL.replace(/\/+$/, "");
  // Requested after: "Det er som om, jeg bliver logget ind i Telegrams egen browser." The link logs in Telegram's browser; the code logs in the usual one.
  await telegram.sendMessage(chatId, `Hej ${escapeHtml(member.split(/\s+/)[0] ?? "")}. Her er dit personlige login til ${role === "suppleant" ? "admin som suppleant" : "bestyrelsens admin"}. Det virker én gang inden for ${LINK_MINUTES} minutter - del det ikke.\n\n`
    + `Åbn linket:\n${address}/login/link/${token}\n\n`
    + `Åbner det i Telegrams egen browser, og vil du logge ind i din almindelige browser (Safari, Chrome ...)? Gå så til ${address.replace(/^https?:\/\//, "")} og skriv koden:\n<code>${code.slice(0, 4)} ${code.slice(4)}</code>`, { html: true });
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
