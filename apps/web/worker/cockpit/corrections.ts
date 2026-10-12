import type { D1Database } from "../db.js";
import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { POINT_SYSTEM } from "../saga/prompts.js";
import { getMinutes, updateMinutes } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";

/** Requested: "Der skal ved hvert punkt være mulighed for hvert medlem af indsende rettelse - herefter vil
 * Saga omskrive punktet. Hun skal spørge hvis hun er usikker på hvad der menes." A member corrects one
 * point in the cockpit; Saga rewrites that point (and the decisions and tasks it changes) from the
 * correction and the recording's transcript, or asks the member when she is unsure. A rewrite starts
 * the board's sign-offs over, and the chair is told privately. Nothing is posted in the group. */

export type Correction = { id: number; minutes_id: number; point: number; member: string; correction: string; status: "pending" | "applied" | "question" | "failed";
  question: string | null; answer: string | null; note: string | null; attempts: number; created_at_ms: number; updated_at_ms: number };

const COLUMNS = "id, minutes_id, point, member, correction, status, question, answer, note, attempts, created_at_ms, updated_at_ms";

export async function corrections(db: D1Database, minutesId: number): Promise<Correction[]> {
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM board_minutes_corrections WHERE minutes_id = ? ORDER BY created_at_ms`).bind(minutesId).all<Correction>();
  return rows.results ?? [];
}

/** Reported: the same correction sent four times gave four questions - "Der skal ikke være to spørgsmål
 * åbne på samme tid." A member has at most one open correction per point: a new one joins it (the same
 * text twice is one), and Saga reads them together. */
export async function addCorrection(db: D1Database, minutesId: number, point: number, member: string, text: string, nowMs: number): Promise<number> {
  const open = await db.prepare(`SELECT id, correction FROM board_minutes_corrections WHERE minutes_id = ? AND point = ? AND member = ? AND status IN ('pending', 'question')
    ORDER BY id DESC LIMIT 1`).bind(minutesId, point, member).first<{ id: number; correction: string }>();
  if (open) {
    const same = open.correction.split(/\n+/).some(part => part.trim().toLocaleLowerCase("da-DK") === text.trim().toLocaleLowerCase("da-DK"));
    if (!same) await db.prepare(`UPDATE board_minutes_corrections SET correction = substr(correction || char(10) || ?, 1, 4000), status = 'pending', question = NULL, attempts = 0, updated_at_ms = ? WHERE id = ?`)
      .bind(text, nowMs, open.id).run();
    await closeDuplicates(db, open.id);
    return open.id;
  }
  const result = await db.prepare(`INSERT INTO board_minutes_corrections (minutes_id, point, member, correction, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(minutesId, point, member, text, nowMs, nowMs).run();
  return Number(result.meta?.last_row_id);
}

export async function answerQuestion(db: D1Database, id: number, member: string, answer: string, nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE board_minutes_corrections SET answer = ?, status = 'pending', attempts = 0, updated_at_ms = ? WHERE id = ? AND member = ? AND status = 'question'")
    .bind(answer, nowMs, id, member).run();
  const answered = Number(result.meta?.changes ?? 0) === 1;
  if (answered) await closeDuplicates(db, id);
  return answered;
}

/** Open questions left from before a point was corrected (the same correction sent several times) are
 * closed: once a member's correction of a point is made, nothing older of theirs on it stays open. */
export async function closeSettled(db: D1Database, minutesId: number): Promise<void> {
  await db.prepare(`DELETE FROM board_minutes_corrections WHERE minutes_id = ? AND status IN ('pending', 'question')
    AND EXISTS (SELECT 1 FROM board_minutes_corrections done WHERE done.minutes_id = board_minutes_corrections.minutes_id AND done.point = board_minutes_corrections.point
      AND done.member = board_minutes_corrections.member AND done.status = 'applied' AND done.updated_at_ms >= board_minutes_corrections.created_at_ms)`).bind(minutesId).run();
}

/** The member's other open corrections on the same point are the same errand: only this one stays. */
async function closeDuplicates(db: D1Database, keepId: number): Promise<void> {
  await db.prepare(`DELETE FROM board_minutes_corrections WHERE id != ? AND status IN ('pending', 'question')
    AND (minutes_id, point, member) = (SELECT minutes_id, point, member FROM board_minutes_corrections WHERE id = ?)`).bind(keepId, keepId).run();
}

const lines = (text: string) => text.split(/\r?\n/);

/** The "## <title>" section's line range (content only), or null. */
function sectionRange(all: string[], title: RegExp): [number, number] | null {
  const start = all.findIndex(line => /^##\s+/.test(line) && !/^###/.test(line) && title.test(line));
  if (start < 0) return null;
  const end = all.findIndex((line, i) => i > start && /^##\s+/.test(line) && !/^###/.test(line));
  return [start + 1, end < 0 ? all.length : end];
}

/** The minutes with the n-th "### " point under "## Punkter" replaced; null when there is no such point. */
export function replacePoint(markdown: string, point: number, block: string): string | null {
  const all = lines(markdown), range = sectionRange(all, /punkter/i);
  if (!range) return null;
  const heads = all.map((line, i) => ({ line, i })).filter(({ line, i }) => i >= range[0] && i < range[1] && /^###\s+/.test(line)).map(({ i }) => i);
  const at = heads[point - 1];
  if (at === undefined) return null;
  const end = heads[point] ?? range[1];
  const next = end < all.length && all[end - 1]?.trim() === "" ? end - 1 : end;
  return [...all.slice(0, at), ...lines(block.trim()), ...all.slice(next)].join("\n");
}

function replaceList(markdown: string, title: RegExp, items: string[]): string {
  const all = lines(markdown), range = sectionRange(all, title);
  if (!range) return markdown;
  const body = items.map(item => `- ${item.replace(/^\s*[-*]\s+/, "").trim()}`).filter(item => item.length > 2);
  return [...all.slice(0, range[0]), ...(body.length ? body : ["- Ingen"]), "", ...all.slice(range[1])].join("\n").replace(/\n{3,}/g, "\n\n");
}

type Answer = { action: "rewrite"; point: string; decisions: string[] | null; tasks: string[] | null; summary: string } | { action: "ask"; question: string };

export function parseAnswer(text: string, point: number): Answer | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const list = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).slice(0, 40) : null;
    if (data.action === "ask" && typeof data.question === "string" && data.question.trim()) return { action: "ask", question: data.question.trim().slice(0, 600) };
    if (data.action === "rewrite" && typeof data.point === "string" && new RegExp(`^###\\s+${point}[.)]?\\s`).test(data.point.trim())) {
      return { action: "rewrite", point: data.point.trim().slice(0, 6000), decisions: list(data.decisions), tasks: list(data.tasks),
        summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 300) : "" };
    }
    return null;
  } catch { return null; }
}

/** Saga handles one correction: the point rewritten, or her question to the member. */
export async function handleCorrection(env: SagaEnv, deps: SagaDeps, id: number): Promise<Correction["status"]> {
  const db = env.DB!;
  const row = await db.prepare(`SELECT ${COLUMNS} FROM board_minutes_corrections WHERE id = ? AND status = 'pending'`).bind(id).first<Correction>();
  if (!row) return "failed";
  await db.prepare("UPDATE board_minutes_corrections SET attempts = attempts + 1, updated_at_ms = ? WHERE id = ?").bind(deps.now(), id).run();
  const minutes = await getMinutes(db, row.minutes_id);
  if (!minutes?.draft_markdown) return "failed";
  const answer = parseAnswer(await completeAs("rettelse", false, 3000)(env, deps, [{ role: "system", content: POINT_SYSTEM }, { role: "user", content: [
    `REFERAT:\n${minutes.draft_markdown}`, `PUNKT: ${row.point}`, `RETTELSE FRA ${row.member}:\n${row.correction}`,
    row.question ? `DIT SPØRGSMÅL: ${row.question}\nSVAR FRA ${row.member}: ${row.answer ?? ""}` : "",
    minutes.transcript ? `KILDE (til opslag):\n${minutes.transcript.slice(0, 60_000)}` : ""].filter(Boolean).join("\n\n") }]), row.point);
  const now = deps.now();
  if (!answer) {
    const final = row.attempts + 1 >= 3;
    await db.prepare("UPDATE board_minutes_corrections SET status = ?, updated_at_ms = ? WHERE id = ?").bind(final ? "failed" : "pending", now, id).run();
    return final ? "failed" : "pending";
  }
  // Requested: "Undgår vi at det gøres så kompliceret fremover?" - one question at most: once the member
  // has answered, Saga rewrites; a second question becomes a note that she could not.
  if (answer.action === "ask" && row.answer) {
    await db.prepare("UPDATE board_minutes_corrections SET status = 'failed', updated_at_ms = ? WHERE id = ?").bind(now, id).run();
    return "failed";
  }
  if (answer.action === "ask") {
    await db.prepare("UPDATE board_minutes_corrections SET status = 'question', question = ?, answer = NULL, updated_at_ms = ? WHERE id = ?").bind(answer.question, now, id).run();
    return "question";
  }
  let text = replacePoint(minutes.draft_markdown, row.point, answer.point);
  if (!text) { await db.prepare("UPDATE board_minutes_corrections SET status = 'failed', updated_at_ms = ? WHERE id = ?").bind(now, id).run(); return "failed"; }
  if (answer.decisions) text = replaceList(text, /beslutninger/i, answer.decisions);
  if (answer.tasks) text = replaceList(text, /opgaver/i, answer.tasks);
  await updateMinutes(db, row.minutes_id, { draft: text }, now);
  await db.prepare("UPDATE board_minutes_corrections SET status = 'applied', note = ?, updated_at_ms = ? WHERE id = ?").bind(answer.summary || null, now, id).run();
  // Requested: "spørgsmålene skal lukke helt når rettelsen er lavet" - nothing about this point stays open for them.
  await closeDuplicates(db, id);
  await db.prepare("DELETE FROM board_minutes_signoffs WHERE minutes_id = ?").bind(row.minutes_id).run();
  if (env.SAGA_TELEGRAM_BOT_TOKEN && env.SAGA_OWNER_TELEGRAM_ID) {
    const link = env.COCKPIT_URL ? `\n${env.COCKPIT_URL.replace(/\/+$/, "")}/referat/${row.minutes_id}` : "";
    await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `${row.member} rettede punkt ${row.point} i referatet${minutes.meeting_date ? ` fra ${minutes.meeting_date}` : ""}, og jeg har omskrevet det: ${answer.summary || "se referatet"}.${link}`).catch(() => undefined);
  }
  return "applied";
}

/** From the cron: corrections whose rewrite did not finish while the member waited. */
export async function handlePendingCorrections(env: SagaEnv, deps: SagaDeps): Promise<void> {
  if (!env.DB || !env.AI_API_KEY || !env.AI_MODEL) return;
  const rows = await env.DB.prepare("SELECT id FROM board_minutes_corrections WHERE status = 'pending' AND attempts < 3 AND updated_at_ms < ? ORDER BY created_at_ms LIMIT 3")
    .bind(deps.now() - 2 * 60_000).all<{ id: number }>();
  for (const row of rows.results ?? []) await handleCorrection(env, deps, row.id).catch(error => console.warn("correction_failed", error instanceof Error ? error.message : error));
}
