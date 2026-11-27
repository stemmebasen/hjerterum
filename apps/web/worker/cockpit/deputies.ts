import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { signedOutAfter, signOutMember } from "./personalLogin.js";

/** Requested: "Hvordan kan vi lave login til vores frivillige og suppleanter." - "Lad os starte med suppleant adgang". Changed by the chair
 * (1 Nov 2026): "Vedr. suppleanter, så skal de have adgang til samme viden, men kan blot ikke stemme" - "Suppleanter har i øvrigt kun læseadgang".
 *
 * A deputy is someone in the deputies' Telegram group (SAGA_DEPUTY_CHAT_ID). They write /login to Saga like the board, and get a login of
 * their own kind (a cookie signed for another purpose than the board's, cockpit/auth.ts). With it they see admin as the board does - the
 * same pages, minutes, decisions and Saga - under their own name with "(suppleant)" after it, and read only: the handler refuses every
 * change but logging out, the language and asking Saga (who answers, but does nothing for them), and deputyView takes the forms out. */

export const DEPUTY = "suppleant";
/** The key a deputy is signed out under: never the same as a board member's, even with the same name. */
export const deputyKey = (member: string) => `${DEPUTY}:${member}`;

/** Saga notes who writes in the deputies' group - their Telegram account and name, never the text. */
export async function recordDeputy(db: D1Database, telegramId: string, name: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO cockpit_deputies (telegram_id, name, seen_at_ms, first_seen_at_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, seen_at_ms = excluded.seen_at_ms`).bind(telegramId, name.slice(0, 80), nowMs, nowMs).run();
}

/** The deputy behind a Telegram account, when the deputies' group is set up and they have written there. */
export async function deputyByTelegram(env: SagaEnv, db: D1Database, telegramId: string): Promise<string | null> {
  if (!env.SAGA_DEPUTY_CHAT_ID) return null;
  const row = await db.prepare("SELECT name FROM cockpit_deputies WHERE telegram_id = ?").bind(telegramId).first<{ name: string }>().catch(() => null);
  return row?.name ?? null;
}

/** Whether the person is in the deputies' group right now: true / false, or null when Telegram could not say. */
export async function stillDeputy(env: SagaEnv, deps: SagaDeps, telegramId: string): Promise<boolean | null> {
  if (!env.SAGA_DEPUTY_CHAT_ID) return false;
  try {
    const member = await telegramClient(env, deps).getChatMember(env.SAGA_DEPUTY_CHAT_ID, telegramId);
    return ["creator", "administrator", "member"].includes(member.status) || (member.status === "restricted" && member.is_member === true);
  } catch { return null; }
}

/** Once an hour: a deputy who has left the deputies' group is signed out on every device. Nothing happens if Telegram cannot say. */
export async function scheduledDeputyAccess(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  if (!env.SAGA_DEPUTY_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return;
  if (!(await claim("saga_deputy_access", Math.floor(deps.now() / 3_600_000)))) return;
  const people = await db.prepare("SELECT telegram_id, name FROM cockpit_deputies").all<{ telegram_id: string; name: string }>().then(r => r.results ?? []);
  for (const person of people) {
    if (await stillDeputy(env, deps, person.telegram_id) !== false) continue;
    const key = deputyKey(person.name);
    const last = await db.prepare("SELECT MAX(used_at_ms) AS at FROM cockpit_login_links WHERE member = ? AND role = 'suppleant' AND used_at_ms IS NOT NULL").bind(person.name).first<{ at: number | null }>();
    if ((last?.at ?? 0) > await signedOutAfter(db, key)) await signOutMember(db, key, deps.now());
  }
}

/** A deputy's login is valid while it was given after their last sign-out. */
export async function deputyStillOpen(db: D1Database, member: string, issuedMs: number): Promise<boolean> {
  return issuedMs > await signedOutAfter(db, deputyKey(member));
}

// ---- What a deputy sees ----

/** The name a deputy goes by in admin: never a board member's, even when they share a first name - so nothing a deputy reads is
 * mistaken for something a board member did, and no board member's own lists or approvals open to them. */
export const deputyWho = (member: string) => `${member} (suppleant)`;

/** Then (the chair, 26 Nov 2026): "Suppleanter må gerne se den fulde board admin uden begrænsninger. De må bare ikke stemme." A deputy uses admin as a
 * board member does - the member list too, creating and changing - but does not vote, record a vote taken at a meeting, or approve the minutes (the
 * board's own acts). The chair's own powers stay the chair's (authority.ts). */
export const DEPUTY_BLOCKED: RegExp[] = [/^\/afstemninger\/stem$/, /^\/afstemninger\/moede$/, /^\/referat\/\d+\/(godkend|rettelse)$/];
export const deputyMayNot = (path: string) => DEPUTY_BLOCKED.some(r => r.test(path));

const DEPUTY_NOTE = `<div class="deputy-note" style="max-width:1100px;margin:14px auto 0;padding:10px 16px;border-radius:12px;background:var(--panel,rgba(127,127,127,.12));font-size:14px">Du er logget ind som suppleant: du har samme adgang som bestyrelsen, men kan ikke stemme eller godkende referater.</div>`;

/** A page as a deputy gets it: the forms to vote and to approve the minutes are taken out (the handler refuses those POSTs anyway), and a line under
 * the header says why. */
export function deputyView(page: string): string {
  const blocked = (open: string) => { const action = (/\baction="([^"]*)"/.exec(open)?.[1] ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/cockpit(?=\/)/, "").split("?")[0]!; return deputyMayNot(action); };
  const stripped = page.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, form => {
    const open = /^<form\b[^>]*>/i.exec(form)?.[0] ?? "";
    return /\bmethod="post"/i.test(open) && blocked(open) ? "" : form;
  }).replace(/<span class="state todo">Du mangler at stemme<\/span>/g, `<span class="state">Til afstemning</span>`)
    // A fold whose form was taken out ("Jeg kan ikke godkende det") goes too.
    .replace(/<details\b[^>]*>\s*<summary>[^<]*<\/summary>\s*<\/details>/gi, "");
  const at = stripped.indexOf("</header>");
  return at < 0 ? stripped : `${stripped.slice(0, at + 9)}${DEPUTY_NOTE}${stripped.slice(at + 9)}`;
}
