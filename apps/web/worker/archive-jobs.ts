import type { D1Database } from "./db.js";
import { copies, pruneCopies } from "./archive.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { telegramClient } from "./saga/telegram.js";

/** In Saga's round (archive.ts): once a day the copies beyond what is kept are let go; on the 1st of each month from 09.00 the chair is reminded,
 * privately, to download the month's copy and keep it outside Cloudflare ("Bare dér, hvor det er nemmest at etablere"). */
export async function scheduledArchive(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  const bucket = env.ARCHIVE;
  if (!bucket) return;
  const now = deps.now();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(p => [p.type, p.value]));
  if (await claim("archive_prune", Math.floor(now / 86_400_000))) await pruneCopies(bucket).catch(error => console.warn("archive_prune_failed", error instanceof Error ? error.message : error));
  if (parts.day !== "01" || Number(parts.hour) < 9) return;
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return;
  if (!(await claim("archive_monthly_reminder", Number(`${parts.year}${parts.month}`)))) return;
  const newest = (await copies(bucket).catch(() => []))[0];
  const link = env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}/filarkiv?vis=kopier` : "admin → Filarkiv → Sikkerhedskopier";
  await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, newest
    ? `Det er den 1. 🗂️ Hent månedens kopi af Hjerterums database og gem den et sikkert sted uden for Cloudflare (fx på din computer): ${link}`
    : `Det er den 1. 🗂️ Der er endnu ingen natlig kopi af Hjerterums database i arkivet. Se ${link}`).catch(error => console.warn("archive_reminder_failed", error instanceof Error ? error.message : error));
  void db;
}
