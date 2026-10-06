import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "./env.js";

/** Requested: "Skal jeg slette lyden, når referatet er godkendt og kun beholde transskriptionen?" - "Bare der hvor man også uploader lyd" - "Det er fint - så længe referatet er lavet".
 *
 * The audio that is uploaded or recorded in the cockpit waits in R2 (BOARD_RECORDINGS). Once the minutes are made it is not needed any more, and a
 * recording of people's voices should not be kept longer than it has to be: it is deleted 14 days after the minutes were last touched (time to correct
 * them and, if need be, to make them again). Only when the minutes exist: a recording that failed, was rejected or is still waiting is the only copy of
 * the meeting and is never deleted. The transcript and the minutes stay on the row. Files on Google Drive and Telegram voice messages are not Saga's to
 * delete and are not touched. */

const DAY = 86_400_000;
export const KEEP_AFTER_MINUTES_DAYS = 14;

/** Once a day. Returns how many recordings were deleted. */
export async function scheduledRecordingCleanup(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<number> {
  const bucket = env.BOARD_RECORDINGS;
  if (!bucket?.delete) return 0;
  const now = deps.now();
  if (!(await claim("saga_recording_cleanup", Math.floor(now / DAY)))) return 0;
  const due = await db.prepare(`SELECT id, source_file_id FROM board_minutes WHERE source = 'upload' AND audio_deleted_at_ms IS NULL AND status = 'approved'
    AND draft_markdown IS NOT NULL AND TRIM(draft_markdown) <> '' AND transcript IS NOT NULL AND updated_at_ms < ? ORDER BY updated_at_ms LIMIT 50`)
    .bind(now - KEEP_AFTER_MINUTES_DAYS * DAY).all<{ id: number; source_file_id: string }>().then(r => r.results ?? []);
  let deleted = 0;
  for (const row of due) {
    try {
      await bucket.delete(row.source_file_id);
      await db.prepare("UPDATE board_minutes SET audio_deleted_at_ms = ? WHERE id = ?").bind(now, row.id).run();
      deleted++;
    } catch (error) { console.warn("saga_recording_delete_failed", row.id, error instanceof Error ? error.message : error); }
  }
  return deleted;
}
