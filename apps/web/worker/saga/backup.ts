import type { D1Database } from "../db.js";
import { driveAccessToken } from "./drive.js";
import type { SagaDeps, SagaEnv } from "./env.js";
import { claimJob, setServiceStatus } from "./store.js";
import { telegramClient } from "./telegram.js";

/** Requested: "Sørg for, at alle disse ting, der foregår i gruppen, og som kan være vigtige for fremtiden, gemmes sikkert én gang i døgnet.": once a day, in the night, everything the board has written and decided is copied to the board's Google Drive -
 * a second place, apart from Cloudflare. One JSON file a day; the last 30 are kept, the older ones are let go. It leaves out what is only for security (login links, attempts, sign-outs), the mail account's sealed password, and what can be made again (translations, claims, the AI log).
 * A copy that fails is shown on Sagas status page and told to the chair once a day; it is tried again every hour until it works. */
export const BACKUP_TABLES = [
  "board_messages", "board_mail", "board_minutes", "board_minutes_signoffs", "board_minutes_corrections", "board_minutes_next", "board_meetings", "board_proposals", "board_votes", "board_vote_discuss",
  "board_people", "board_post_drafts", "board_overviews", "board_owner_done", "cockpit_todos", "cockpit_task_checks", "cockpit_responsibilities", "cockpit_decision_kinds", "cockpit_member_stats",
  "cockpit_teachers", "cockpit_teacher_declined", "cockpit_event_drafts", "cockpit_saga_done", "cockpit_prefs", "saga_memories", "board_now"
] as const;
const KEEP = 30;
const PREFIX = "hjerterum-kopi-";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const PAGE = 2000;

/** Every row of the tables worth keeping, as plain data. A table that does not exist (yet) is left out, not an error. */
export async function exportBoardData(db: D1Database, nowMs: number): Promise<{ madeAt: string; tables: Record<string, unknown[]> }> {
  const tables: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const rows: unknown[] = [];
    try {
      for (let offset = 0; ; offset += PAGE) {
        const page = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, offset).all()).results ?? [];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    } catch { continue; }
    tables[table] = rows;
  }
  return { madeAt: new Date(nowMs).toISOString(), tables };
}

async function upload(env: SagaEnv, deps: SagaDeps, token: string, name: string, content: string): Promise<void> {
  const folder = env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || env.GOOGLE_DRIVE_MINUTES_FOLDER_ID;
  if (!folder) throw new Error("backup_folder_not_configured");
  const boundary = `kopi-${deps.now()}`;
  const body = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name, mimeType: "application/json", parents: [folder] }),
    `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", content, `--${boundary}--`, ""].join("\r\n");
  const response = await deps.fetcher(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body });
  const data = await response.json().catch(() => null) as { id?: string } | null;
  if (!response.ok || !data?.id) throw new Error(`backup_upload_failed: ${response.status}`);
}

/** The copies older than the last 30 are deleted - only files this job made (by name), in the folder. */
async function tidy(env: SagaEnv, deps: SagaDeps, token: string): Promise<void> {
  const folder = env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || env.GOOGLE_DRIVE_MINUTES_FOLDER_ID;
  if (!folder) return;
  const q = encodeURIComponent(`'${folder}' in parents and name contains '${PREFIX}' and trashed = false`);
  const response = await deps.fetcher(`${DRIVE}/files?q=${q}&orderBy=name%20desc&pageSize=100&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
  const files = ((await response.json().catch(() => null)) as { files?: Array<{ id: string; name: string }> } | null)?.files ?? [];
  for (const file of files.filter(f => f.name.startsWith(PREFIX)).slice(KEEP)) await deps.fetcher(`${DRIVE}/files/${encodeURIComponent(file.id)}?supportsAllDrives=true`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
}

/** In Saga's round: from three at night, once a day (tried again every hour until it has worked). Returns whether a copy was made. */
export async function scheduledBackup(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<boolean> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return false;
  const now = deps.now();
  const copenhagen = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => copenhagen.find(p => p.type === type)?.value ?? "";
  if (Number(part("hour")) < 3) return false;
  const day = `${part("year")}-${part("month")}-${part("day")}`, dayNumber = Math.floor(now / 86_400_000);
  if (await db.prepare("SELECT 1 AS hit FROM job_claims WHERE job_key = 'saga_backup_ok' AND scheduled_for_ms = ?").bind(dayNumber).first().catch(() => null)) return false;
  if (!(await claimJob(db, "saga_backup_try", Math.floor(now / 3_600_000), now))) return false;
  try {
    const data = await exportBoardData(db, now);
    const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
    const token = await driveAccessToken(env, deps);
    await upload(env, deps, token, `${PREFIX}${day}.json`, JSON.stringify(data));
    await claimJob(db, "saga_backup_ok", dayNumber, now);
    await setServiceStatus(db, "backup", true, `Kopien ${day} er lagt på Drev (${rows} rækker).`, now);
    await tidy(env, deps, token).catch(() => undefined);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "backup_failed";
    await setServiceStatus(db, "backup", false, message, now);
    // Once a day the chair is told - the later hours try again quietly.
    if (env.SAGA_TELEGRAM_BOT_TOKEN && env.SAGA_OWNER_TELEGRAM_ID && await claimJob(db, "saga_backup_alert", dayNumber, now)) {
      await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `⚠️ Den natlige kopi til Drev lykkedes ikke (${message}). Saga prøver igen hver time.`).catch(() => undefined);
    }
    return false;
  }
}
