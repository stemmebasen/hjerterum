import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";

/** Requested (3 Nov 2026), after the security review: "Skal jeg rette punkt 1 til 7 nu" - "Ja".
 *
 * 1. Admin knew a person by the name they show in Telegram. Someone in the board's group could take another member's name - the chair's too - and
 *    ask Saga for a login in it. Now a name that another Telegram account has written under (or been let in with) gets no login, and the chair hears of it.
 * 2. Being in the board's or the deputies' group was all it took. Now the chair decides: a Telegram account that was not in the group before
 *    ACCESS_SINCE asks once, the chair gets Godkend / Afvis from Saga, and only then can it log in. Those already there keep their access. */

export type AccessRole = "bestyrelse" | "suppleant";
/** Accounts that wrote in their group before this day were already the board's and deputies' - they are let in as before. */
export const ACCESS_SINCE_MS = Date.parse("2026-11-04T00:00:00Z");

type AccessRow = { telegram_id: string; name: string; role: AccessRole; status: "pending" | "approved" | "rejected" };

async function accessRow(db: D1Database, telegramId: string): Promise<AccessRow | null> {
  return db.prepare("SELECT telegram_id, name, role, status FROM cockpit_access WHERE telegram_id = ?").bind(telegramId).first<AccessRow>().catch(() => null);
}

/** Whether the account was already in its group before the chair began to decide. */
async function knownBefore(env: SagaEnv, db: D1Database, telegramId: string, role: AccessRole): Promise<boolean> {
  const row = role === "suppleant"
    ? await db.prepare("SELECT first_seen_at_ms AS at FROM cockpit_deputies WHERE telegram_id = ?").bind(telegramId).first<{ at: number | null }>().catch(() => null)
    : await db.prepare("SELECT MIN(sent_at_ms) AS at FROM board_messages WHERE chat_id = ? AND author_telegram_id = ? AND from_assistant = 0").bind(env.SAGA_BOARD_CHAT_ID ?? "", telegramId).first<{ at: number | null }>();
  return typeof row?.at === "number" && row.at < ACCESS_SINCE_MS;
}

/** Whether another Telegram account goes by the same name in the group - or has been let in with it. */
export async function nameTaken(env: SagaEnv, db: D1Database, telegramId: string, name: string, role: AccessRole): Promise<boolean> {
  const other = role === "suppleant"
    ? await db.prepare("SELECT 1 AS x FROM cockpit_deputies WHERE name = ? AND telegram_id <> ? LIMIT 1").bind(name, telegramId).first().catch(() => null)
    : await db.prepare("SELECT 1 AS x FROM board_messages WHERE chat_id = ? AND author_name = ? AND author_telegram_id IS NOT NULL AND author_telegram_id <> ? AND from_assistant = 0 LIMIT 1")
      .bind(env.SAGA_BOARD_CHAT_ID ?? "", name, telegramId).first();
  if (other) return true;
  return Boolean(await db.prepare("SELECT 1 AS x FROM cockpit_access WHERE name = ? AND role = ? AND telegram_id <> ? AND status = 'approved' LIMIT 1").bind(name, role, telegramId).first().catch(() => null));
}

/** Without a word to anyone: whether the account may use admin and Saga's private answers. */
export async function hasAccess(env: SagaEnv, db: D1Database, telegramId: string, name: string, role: AccessRole): Promise<boolean> {
  if (env.SAGA_OWNER_TELEGRAM_ID && telegramId === env.SAGA_OWNER_TELEGRAM_ID) return true;
  if (await nameTaken(env, db, telegramId, name, role)) return false;
  const row = await accessRow(db, telegramId);
  if (row) return row.status === "approved";
  return knownBefore(env, db, telegramId, role);
}

/** Before Saga sends a login: true when the account may have it. Otherwise she has told the person why - and asked the chair when it is new. */
export async function checkAccess(env: SagaEnv, deps: SagaDeps, db: D1Database, chatId: string, telegramId: string, name: string, role: AccessRole): Promise<boolean> {
  const owner = env.SAGA_OWNER_TELEGRAM_ID;
  if (owner && telegramId === owner) return true;
  const telegram = telegramClient(env, deps);
  const now = deps.now();
  const group = role === "suppleant" ? "suppleanternes gruppe" : "bestyrelsens gruppe";
  if (await nameTaken(env, db, telegramId, name, role)) {
    if (owner) await telegram.sendMessage(owner, `Obs: en Telegram-konto (${telegramId}) bad om login til admin som "${name}", men det navn bruges allerede af en anden konto i ${group}. Jeg har ikke givet adgang.`).catch(() => undefined);
    await telegram.sendMessage(chatId, `Dit navn i Telegram (${name}) bruges også af en anden i ${group}, så jeg kan ikke give dig login. Skriv til formanden, så finder I ud af det.`);
    return false;
  }
  const row = await accessRow(db, telegramId);
  if (row?.status === "approved") return true;
  if (row?.status === "rejected") { await telegram.sendMessage(chatId, "Formanden har ikke givet dig adgang til admin. Er det en fejl, så skriv til formanden."); return false; }
  if (!row && await knownBefore(env, db, telegramId, role)) {
    await db.prepare("INSERT OR IGNORE INTO cockpit_access (telegram_id, name, role, status, asked_at_ms, decided_at_ms) VALUES (?, ?, ?, 'approved', ?, ?)").bind(telegramId, name, role, now, now).run();
    return true;
  }
  if (row?.status === "pending") { await telegram.sendMessage(chatId, "Du venter stadig på, at formanden godkender dig. Du får besked her, så snart det er sket."); return false; }
  if (!owner) { await telegram.sendMessage(chatId, "Formanden skal godkende dig først, men det kan ikke lade sig gøre lige nu. Prøv igen senere."); return false; }
  await db.prepare("INSERT INTO cockpit_access (telegram_id, name, role, status, asked_at_ms) VALUES (?, ?, ?, 'pending', ?)").bind(telegramId, name.slice(0, 80), role, now).run();
  await telegram.sendMessage(owner, `${name} beder om login til admin${role === "suppleant" ? " som suppleant" : ""} for første gang (fra ${group}). Skal ${name.split(/\s+/)[0]} have adgang?`,
    { buttons: [[{ text: "Godkend", callback_data: `approve:login:${telegramId}` }, { text: "Afvis", callback_data: `reject:login:${telegramId}` }]] });
  await telegram.sendMessage(chatId, "Første gang skal formanden godkende dig. Du får besked her, så snart det er sket.");
  return false;
}

/** The chair's Godkend / Afvis on a request for a first login. */
export async function decideAccess(env: SagaEnv, deps: SagaDeps, db: D1Database, telegramId: string, approve: boolean): Promise<string> {
  const row = await accessRow(db, telegramId);
  if (!row) return "Jeg kan ikke finde den anmodning.";
  await db.prepare("UPDATE cockpit_access SET status = ?, decided_at_ms = ? WHERE telegram_id = ?").bind(approve ? "approved" : "rejected", deps.now(), telegramId).run();
  await telegramClient(env, deps).sendMessage(telegramId, approve ? "Formanden har godkendt dig. Skriv /login, så får du dit login til admin." : "Formanden har ikke givet dig adgang til admin.").catch(() => undefined);
  return approve ? `${row.name} kan nu logge ind i admin.` : `${row.name} får ikke adgang til admin.`;
}
