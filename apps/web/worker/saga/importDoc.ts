import { completeAs } from "./ai.js";
import { minutesDocText, minutesDocUrl } from "./drive.js";
import type { SagaDeps, SagaEnv } from "./env.js";
import { section } from "./markdown.js";
import { splitMinutesDoc } from "./picture.js";
import { IMPORT_SYSTEM } from "./prompts.js";
import { claimJob, serviceStatus, setServiceStatus } from "./store.js";

/** Requested: "Vi skal også have indsat de sidste 10 referater ind i det nye system". The newest
 * meetings in the board's minutes document are taken over one by one, a couple per cron run on
 * weekdays: Saga puts each in the cockpit's template (the board's own words, nothing added) and
 * keeps the original text beside it; a meeting with only an agenda gives the cockpit its agenda.
 * Done after ten minutes, or when the newest 24 meetings have been looked at. */

export const IMPORT_COUNT = 10;
const LOOK_AT = 24;
const PER_RUN = 2;

type Imported = { hasMinutes: boolean; time: string; agenda: string[]; minutes: string };

export function parseImport(answer: string): Imported | null {
  const start = answer.indexOf("{"), end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
    const minutes = typeof data.minutes === "string" ? data.minutes.trim().slice(0, 30_000) : "";
    return { hasMinutes: data.hasMinutes === true && Boolean(minutes) && Boolean(section(minutes, /punkter/i)),
      time: typeof data.time === "string" && /^\d{1,2}[:.]\d{2}$/.test(data.time.trim()) ? data.time.trim().replace(".", ":").padStart(5, "0") : "",
      agenda: (Array.isArray(data.agenda) ? data.agenda : []).filter((a): a is string => typeof a === "string").map(a => a.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40), minutes };
  } catch { return null; }
}

export async function importDocMinutes(env: SagaEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db || !env.GOOGLE_MINUTES_DOC_ID || !env.AI_API_KEY || !env.AI_MODEL) return;
  const now = deps.now();
  // No AI on its own at the weekend.
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short" }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return;
  if ((await serviceStatus(db, "minutes_import"))?.ok) return;
  const count = async () => Number((await db.prepare("SELECT COUNT(*) AS n FROM board_minutes WHERE source = 'document'").first<{ n: number }>())?.n ?? 0);
  if (await count() >= IMPORT_COUNT) { await setServiceStatus(db, "minutes_import", true, `${IMPORT_COUNT} referater overført`, now); return; }
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
  const meetings = splitMinutesDoc(await minutesDocText(env, deps)).filter(m => m.day <= today).slice(0, LOOK_AT);
  let done = 0;
  for (const meeting of meetings) {
    if (done >= PER_RUN) return;
    if (!(await claimJob(db, `minutes_import:${meeting.day}`, 0, now))) continue;
    done++;
    const approved = await db.prepare("SELECT 1 AS x FROM board_minutes WHERE meeting_date = ? AND status = 'approved'").bind(meeting.day).first();
    if (approved) continue;
    let answer: string;
    try {
      answer = await completeAs("import-referat")(env, deps, [{ role: "system", content: IMPORT_SYSTEM },
        { role: "user", content: `Mødedato: ${meeting.day}\n\nFRA REFERATDOKUMENTET:\n${meeting.text.slice(0, 40_000)}` }]);
    } catch (error) {
      // The AI did not answer: the meeting is tried again at the next run.
      await db.prepare("DELETE FROM job_claims WHERE job_key = ?").bind(`minutes_import:${meeting.day}`).run();
      await setServiceStatus(db, "minutes_import", false, `${meeting.day}: ${error instanceof Error ? error.message : "ai_failed"}`, now);
      return;
    }
    const result = parseImport(answer);
    if (!result) { await setServiceStatus(db, "minutes_import", false, `${meeting.day}: kunne ikke læses`, now); continue; }
    const planned = await db.prepare("SELECT id FROM board_meetings WHERE meeting_date = ?").bind(meeting.day).first();
    if (!planned && result.agenda.length) {
      await db.prepare(`INSERT INTO board_meetings (meeting_date, start_time, place, agenda, created_at_ms, updated_at_ms, updated_by) VALUES (?, ?, NULL, ?, ?, ?, ?)`)
        .bind(meeting.day, result.time || null, result.agenda.join("\n"), now, now, "Saga (fra referatdokumentet)").run();
    }
    if (result.hasMinutes) {
      await db.prepare(`INSERT OR IGNORE INTO board_minutes (source, source_file_id, file_name, mime_type, status, meeting_date, transcript, draft_markdown, drive_document_url, created_at_ms, updated_at_ms)
        VALUES ('document', ?, 'Referatdokumentet', NULL, 'approved', ?, ?, ?, ?, ?, ?)`).bind(`doc:${meeting.day}`, meeting.day, meeting.text, result.minutes, minutesDocUrl(env), now, now).run();
    }
    const total = await count();
    await setServiceStatus(db, "minutes_import", total >= IMPORT_COUNT, `${total} af ${IMPORT_COUNT} referater overført (senest ${meeting.day})`, now);
    if (total >= IMPORT_COUNT) return;
  }
  // Every meeting looked at: what was there is in.
  await setServiceStatus(db, "minutes_import", true, `${await count()} referater overført`, now);
}
