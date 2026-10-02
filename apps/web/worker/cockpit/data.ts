import type { D1Database } from "../db.js";
import type { SagaEnv } from "../saga/env.js";
import { section } from "../saga/markdown.js";
import { groupActivity, parsePicture, telegramLink, type BoardPicture } from "../saga/picture.js";
import { latestOverview, latestWeeklySummary, ownerDone, recentBoardMessages, type Minutes } from "../saga/store.js";

/** What the board cockpit shows, read from Saga's own tables: her picture of the board, the minutes
 * the chair has approved, the meetings and agendas written in the cockpit, and the decisions and
 * tasks in them. Drafts waiting for the chair's approval are counted, never shown. */

export type Meeting = { id: number; meeting_date: string; start_time: string | null; place: string | null; agenda: string; updated_at_ms: number; updated_by: string | null };
export type Task = { who: string; what: string; due: string; meeting: string; source: "referat" | "dokument" | "formand" };
export type Decision = { text: string; date: string; topic: string; source: "referat" | "dokument" | "afstemning"; minutesId: number | null; voteId?: number };
export type ApprovedMinutes = Pick<Minutes, "id" | "source" | "meeting_date" | "draft_markdown" | "drive_document_url" | "created_at_ms"> & { updated_at_ms: number; transcript?: string | null };

const MINUTES = "id, source, meeting_date, draft_markdown, drive_document_url, created_at_ms, updated_at_ms";

export async function approvedMinutes(db: D1Database, limit = 200): Promise<ApprovedMinutes[]> {
  const rows = await db.prepare(`SELECT ${MINUTES} FROM board_minutes WHERE status = 'approved' AND draft_markdown IS NOT NULL
    ORDER BY COALESCE(meeting_date, '') DESC, created_at_ms DESC LIMIT ?`).bind(limit).all<ApprovedMinutes>();
  return rows.results ?? [];
}

export async function approvedMinutesById(db: D1Database, id: number): Promise<ApprovedMinutes | null> {
  return db.prepare(`SELECT ${MINUTES}, CASE WHEN source = 'document' THEN transcript END AS transcript FROM board_minutes WHERE id = ? AND status = 'approved' AND draft_markdown IS NOT NULL`).bind(id).first<ApprovedMinutes>();
}

/** Recordings being turned into minutes, and drafts waiting for the chair - counted only. */
export async function minutesInProgress(db: D1Database): Promise<{ working: number; waiting: number }> {
  const row = await db.prepare(`SELECT SUM(CASE WHEN status IN ('queued', 'transcribing') THEN 1 ELSE 0 END) AS working,
    SUM(CASE WHEN status = 'drafted' THEN 1 ELSE 0 END) AS waiting FROM board_minutes`).first<{ working: number | null; waiting: number | null }>();
  return { working: Number(row?.working ?? 0), waiting: Number(row?.waiting ?? 0) };
}

/** Where each meeting's minutes are when they are not approved yet: the newest upload per date. */
export async function minutesStatusByDate(db: D1Database): Promise<Map<string, "working" | "waiting" | "failed">> {
  const rows = await db.prepare(`SELECT meeting_date, status FROM board_minutes WHERE meeting_date IS NOT NULL AND status IN ('queued', 'transcribing', 'drafted', 'failed')
    ORDER BY created_at_ms`).all<{ meeting_date: string; status: string }>();
  const out = new Map<string, "working" | "waiting" | "failed">();
  for (const row of rows.results ?? []) out.set(row.meeting_date, row.status === "drafted" ? "waiting" : row.status === "failed" ? "failed" : "working");
  return out;
}

/** Requested: "Default lokation: Hjerterum, Guldsmedgade 26B, 8000 Aarhus". */
export const DEFAULT_PLACE = "Hjerterum, Guldsmedgade 26B, 8000 Aarhus";
const PLACE = `COALESCE(NULLIF(TRIM(place), ''), '${DEFAULT_PLACE}') AS place`;

export async function meetings(db: D1Database): Promise<Meeting[]> {
  const rows = await db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, updated_at_ms, updated_by FROM board_meetings ORDER BY meeting_date DESC, id DESC LIMIT 200`).all<Meeting>();
  return rows.results ?? [];
}

export const meetingOn = (db: D1Database, day: string) =>
  db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, updated_at_ms, updated_by FROM board_meetings WHERE meeting_date = ? ORDER BY id DESC LIMIT 1`).bind(day).first<Meeting>();

export const meeting = (db: D1Database, id: number) =>
  db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, updated_at_ms, updated_by FROM board_meetings WHERE id = ?`).bind(id).first<Meeting>();

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
export type MeetingInput = { date: string; time: string; place: string; agenda: string };

/** A meeting as written in the cockpit form; null when the date is not a real day. */
export function meetingInput(form: FormData): MeetingInput | null {
  const date = String(form.get("meeting_date") ?? "").trim();
  const time = String(form.get("start_time") ?? "").trim();
  if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return null;
  return { date, time: TIME.test(time) ? time : "", place: String(form.get("place") ?? "").trim().slice(0, 200),
    agenda: String(form.get("agenda") ?? "").replace(/\r\n/g, "\n").split("\n").map(line => line.trim().replace(/^(\d+[.)]|[-*•])\s+/, "")).filter(Boolean).slice(0, 40).join("\n").slice(0, 8000) };
}

export async function saveMeeting(db: D1Database, input: MeetingInput, who: string, nowMs: number, id?: number): Promise<number> {
  if (id) {
    await db.prepare("UPDATE board_meetings SET meeting_date = ?, start_time = ?, place = ?, agenda = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?")
      .bind(input.date, input.time || null, input.place || DEFAULT_PLACE, input.agenda, nowMs, who || null, id).run();
    return id;
  }
  const result = await db.prepare(`INSERT INTO board_meetings (meeting_date, start_time, place, agenda, created_at_ms, updated_at_ms, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(input.date, input.time || null, input.place || DEFAULT_PLACE, input.agenda, nowMs, nowMs, who || null).run();
  return Number(result.meta?.last_row_id);
}

export async function deleteMeeting(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM board_meetings WHERE id = ?").bind(id).run();
}

/** The board as the cockpit knows it: everyone who has written in the board's group, with the chair
 * marked (the one Telegram id that is Saga's owner). */
export async function boardMembers(env: SagaEnv, db: D1Database): Promise<{ names: string[]; chair: string | null }> {
  if (!env.SAGA_BOARD_CHAT_ID) return { names: [], chair: null };
  const rows = await db.prepare(`SELECT author_name, MAX(author_telegram_id) AS author_telegram_id FROM board_messages
    WHERE chat_id = ? AND from_assistant = 0 GROUP BY author_name ORDER BY author_name COLLATE NOCASE`).bind(env.SAGA_BOARD_CHAT_ID).all<{ author_name: string; author_telegram_id: string | null }>();
  const list = rows.results ?? [];
  const chair = list.find(row => env.SAGA_OWNER_TELEGRAM_ID && row.author_telegram_id === env.SAGA_OWNER_TELEGRAM_ID)?.author_name ?? null;
  return { names: list.map(row => row.author_name), chair };
}

/** Saga's latest picture of the board, without what the chair has already marked as done in Matrix. */
export async function boardPicture(db: D1Database, nowMs = Date.now()): Promise<{ picture: BoardPicture | null; summary: string | null; at: number | null }> {
  const overview = await latestOverview(db);
  if (!overview) return { picture: null, summary: null, at: null };
  let picture: BoardPicture | null = null;
  if (overview.data) {
    try { picture = parsePicture(overview.data); } catch { picture = null; }
  }
  if (picture?.forJacob.length) {
    const done = new Set((await ownerDone(db, nowMs - 60 * 86_400_000)).map(d => d.item_key));
    picture = { ...picture, forJacob: picture.forJacob.filter(f => !done.has(f.key)) };
  }
  return { picture, summary: picture?.summary ?? overview.text, at: overview.created_at_ms };
}

export type GroupNow = { activity: ReturnType<typeof groupActivity>; recent: Array<{ author: string; text: string; at: number; link: string | null }>; link: string | null };

/** The board's Telegram group the last two weeks, counted without AI - as on the chair's page in Matrix. */
export async function groupNow(env: SagaEnv, db: D1Database, nowMs: number): Promise<GroupNow | null> {
  const chat = env.SAGA_BOARD_CHAT_ID;
  if (!chat) return null;
  const fortnight = await recentBoardMessages(db, chat, nowMs - 14 * 86_400_000, 1000);
  return { activity: groupActivity(fortnight, nowMs),
    recent: fortnight.filter(m => !m.from_assistant).slice(-12).reverse().map(m => ({ author: m.author_name, text: m.text.slice(0, 600), at: m.sent_at_ms, link: telegramLink(chat, m.telegram_message_id) })),
    link: telegramLink(chat, fortnight.at(-1)?.telegram_message_id) };
}

export const weeklySummary = (db: D1Database) => latestWeeklySummary(db);

/** Board meetings Saga has found in the minutes document and the chat that are not in the calendar yet. */
export function sagaMeetings(picture: BoardPicture | null, list: Meeting[], today: string): Array<{ date: string; what: string }> {
  const planned = new Set(list.map(m => m.meeting_date));
  return (picture?.document.dates ?? []).filter(d => d.date >= today && !planned.has(d.date) && /møde|generalforsamling/i.test(d.what))
    .sort((a, b) => a.date.localeCompare(b.date)).filter((d, i, all) => all.findIndex(x => x.date === d.date) === i).slice(0, 4);
}

const bullets = (text: string) => text.split(/\r?\n/).map(line => /^\s*[-*]\s+(.*)$/.exec(line)?.[1]?.trim() ?? "").filter(Boolean);

/** "- <hvem> - <hvad> - <hvornår>", as Saga writes the tasks in her minutes. */
export function minutesTasks(minutes: ApprovedMinutes): Task[] {
  return bullets(section(minutes.draft_markdown ?? "", /opgaver/i)).map(line => {
    const parts = line.split(/\s+[-–—]\s+/);
    const [who, what, due] = parts.length >= 3 ? [parts[0]!, parts.slice(1, -1).join(" - "), parts.at(-1)!] : parts.length === 2 ? [parts[0]!, parts[1]!, ""] : ["", line, ""];
    return { who: who.trim(), what: what.trim(), due: /ingen frist/i.test(due) ? "" : due.trim(), meeting: minutes.meeting_date ?? "", source: "referat" as const };
  }).filter(task => task.what);
}

export function minutesDecisions(minutes: ApprovedMinutes): Decision[] {
  return bullets(section(minutes.draft_markdown ?? "", /beslutninger/i)).filter(line => !/^ingen beslutning/i.test(line))
    .map(text => ({ text, date: minutes.meeting_date ?? "", topic: "", source: "referat" as const, minutesId: minutes.id }));
}

/** Every task: from the approved minutes, and the ones Saga found in the minutes document. */
export function allTasks(minutes: ApprovedMinutes[], picture: BoardPicture | null): Task[] {
  const seen = new Set<string>(), out: Task[] = [];
  const add = (task: Task) => { const key = `${task.who}|${task.what}`.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(task); } };
  for (const m of minutes) for (const task of minutesTasks(m)) add(task);
  // The document's own reading of a task the approved minutes already hold is not shown twice.
  const norm = (text: string) => text.toLocaleLowerCase("da-DK").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const fromMinutes = [...out];
  for (const t of picture?.document.tasks ?? []) {
    const what = norm(t.what);
    if (fromMinutes.some(m => norm(m.who) === norm(t.who) && (norm(m.what).includes(what) || what.includes(norm(m.what))))) continue;
    add({ who: t.who, what: t.what, due: t.due, meeting: t.since, source: "dokument" });
  }
  return out;
}

/** Every decision, newest first: the approved minutes', then those Saga found in the document. */
export function allDecisions(minutes: ApprovedMinutes[], picture: BoardPicture | null): Decision[] {
  const seen = new Set<string>(), out: Decision[] = [];
  const add = (decision: Decision) => { const key = decision.text.toLowerCase().replace(/\s+/g, " "); if (!seen.has(key)) { seen.add(key); out.push(decision); } };
  for (const m of minutes) for (const decision of minutesDecisions(m)) add(decision);
  for (const d of picture?.document.decisions ?? []) add({ text: d.text, date: d.date, topic: d.topic, source: "dokument", minutesId: null });
  return out;
}

/** Every task by person, as "Hvem har hvad" in Matrix. */
export function tasksByPerson(tasks: Task[]): Array<{ who: string; tasks: Task[] }> {
  const groups = new Map<string, Task[]>();
  // Requested: '"Uden navn" kan vel kaldes "Alle"'.
  for (const task of tasks) { const who = task.who.trim() || EVERYONE; groups.set(who, [...(groups.get(who) ?? []), task]); }
  return [...groups].map(([who, list]) => ({ who, tasks: list })).sort((a, b) => b.tasks.length - a.tasks.length || a.who.localeCompare(b.who, "da"));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLocaleLowerCase("da-DK") ?? "";

/** The tasks that are this person's: their first name stands as a word in "hvem" (also in
 * "Lisbeth og Gitta"); a task for "alle" or "bestyrelsen" is everyone's. */
export function tasksFor(person: string, tasks: Task[]): Task[] {
  const name = firstName(person);
  if (!name) return [];
  return tasks.filter(task => {
    const who = task.who.toLocaleLowerCase("da-DK");
    return new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(who) || /\b(alle|bestyrelsen|hele bestyrelsen)\b/u.test(who);
  });
}

// ---- Requested: "Referatet skal op uden godkendelse, men alle medlemmer skal pinges til at godkende referatet" ----

export type Signoff = { member: string; status: "approved" | "correction"; comment: string | null; at_ms: number };

export async function signoffs(db: D1Database, minutesId: number): Promise<Signoff[]> {
  const rows = await db.prepare("SELECT member, status, comment, at_ms FROM board_minutes_signoffs WHERE minutes_id = ? ORDER BY at_ms").bind(minutesId).all<Signoff>();
  return rows.results ?? [];
}

export async function signOff(db: D1Database, minutesId: number, member: string, status: Signoff["status"], comment: string | null, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO board_minutes_signoffs (minutes_id, member, status, comment, at_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(minutes_id, member) DO UPDATE SET status = excluded.status, comment = excluded.comment, at_ms = excluded.at_ms`).bind(minutesId, member, status, comment, nowMs).run();
}

/** Saga's minutes from the last 90 days that this member has not yet approved (or asked to correct). */
export async function unsignedFor(db: D1Database, member: string, nowMs: number): Promise<ApprovedMinutes[]> {
  const rows = await db.prepare(`SELECT ${MINUTES} FROM board_minutes m WHERE status = 'approved' AND source != 'document' AND draft_markdown IS NOT NULL AND created_at_ms >= ?
    AND NOT EXISTS (SELECT 1 FROM board_minutes_signoffs s WHERE s.minutes_id = m.id AND s.member = ?) ORDER BY COALESCE(meeting_date, '') DESC LIMIT 10`).bind(nowMs - 90 * 86_400_000, member).all<ApprovedMinutes>();
  return rows.results ?? [];
}

// ---- Requested: "en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der er tildelt en. Man kan også selv skrive ind." ----

export type Todo = { id: number; owner: string; text: string; due: string | null; created_by: string; created_at_ms: number; done_at_ms: number | null };

/** A minutes task's lasting name: the meeting, who and what - the same task in the same minutes. */
export const taskKey = (task: Task) => `${task.meeting}|${task.who}|${task.what}`.toLocaleLowerCase("da-DK").replace(/\s+/g, " ").trim().slice(0, 400);

/** Requested: "Man skal kunne skrive en opgave til alle også". An item written to "Alle" is on every
 * member's list, and whoever does it checks it off for everyone. */
export const EVERYONE = "Alle";
export async function todosFor(db: D1Database, owner: string): Promise<Todo[]> {
  const rows = await db.prepare("SELECT id, owner, text, due, created_by, created_at_ms, done_at_ms FROM cockpit_todos WHERE owner IN (?, 'Alle') ORDER BY done_at_ms IS NOT NULL, COALESCE(due, '9999') , created_at_ms DESC LIMIT 300")
    .bind(owner).all<Todo>();
  return rows.results ?? [];
}

export async function addTodo(db: D1Database, input: { owner: string; text: string; due: string | null; createdBy: string }, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_todos (owner, text, due, created_by, created_at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(input.owner, input.text, input.due, input.createdBy, nowMs).run();
}

/** Only the owner checks an item off (or back on), and only the one who wrote it removes it. */
export async function setTodoDone(db: D1Database, id: number, owner: string, done: boolean, nowMs: number): Promise<void> {
  await db.prepare("UPDATE cockpit_todos SET done_at_ms = ? WHERE id = ? AND owner IN (?, 'Alle')").bind(done ? nowMs : null, id, owner).run();
}
export async function removeTodo(db: D1Database, id: number, who: string): Promise<void> {
  await db.prepare("DELETE FROM cockpit_todos WHERE id = ? AND (created_by = ? OR owner = ?)").bind(id, who, who).run();
}

export async function checkedTasks(db: D1Database, owner: string): Promise<Map<string, number>> {
  const rows = await db.prepare("SELECT task_key, done_at_ms FROM cockpit_task_checks WHERE owner = ?").bind(owner).all<{ task_key: string; done_at_ms: number }>();
  return new Map((rows.results ?? []).map(r => [r.task_key, r.done_at_ms]));
}

/** Requested: "når et bestyrelsesmedlem har løst en opgave og klikket flueben, så skal der være et flueben + dato ud
 * for den fælles oversigt i fem dage, hvorefter hele linjen arkiveres". Who checked each minutes task off, and when. */
export async function taskChecksByKey(db: D1Database): Promise<Map<string, { by: string; at: number }>> {
  const rows = await db.prepare("SELECT task_key, owner, done_at_ms FROM cockpit_task_checks ORDER BY done_at_ms ASC").all<{ task_key: string; owner: string; done_at_ms: number }>();
  return new Map((rows.results ?? []).map(r => [r.task_key, { by: r.owner, at: r.done_at_ms }]));
}

export async function setTaskChecked(db: D1Database, owner: string, key: string, done: boolean, nowMs: number): Promise<void> {
  if (done) await db.prepare("INSERT INTO cockpit_task_checks (owner, task_key, done_at_ms) VALUES (?, ?, ?) ON CONFLICT(owner, task_key) DO UPDATE SET done_at_ms = excluded.done_at_ms").bind(owner, key, nowMs).run();
  else await db.prepare("DELETE FROM cockpit_task_checks WHERE owner = ? AND task_key = ?").bind(owner, key).run();
}

/** Requested: "Det er vigtigt, at det er de nyeste opgaver, der er øverst. Desuden ... alle påmindelser fra
 * før i går ikke fremgår af listen, så vi starter friskt" (2 October 2026). The list starts on 1 October:
 * tasks from earlier minutes and items written before then are not shown; the newest come first. */
export const TASKS_SINCE = "2026-10-01";
const SINCE_MS = Date.parse(`${TASKS_SINCE}T00:00:00+02:00`);
/** A task's day as YYYY-MM-DD: the minutes' meeting date, or the minutes document's "17/9" (this year). */
export function taskDay(task: Task): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(task.meeting)) return task.meeting.slice(0, 10);
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(task.meeting.trim());
  if (!short) return "";
  const year = short[3] ? (short[3].length === 2 ? `20${short[3]}` : short[3]) : TASKS_SINCE.slice(0, 4);
  return `${year}-${short[2]!.padStart(2, "0")}-${short[1]!.padStart(2, "0")}`;
}
export function currentTasks(tasks: Task[]): Task[] {
  return tasks.map(task => ({ task, day: taskDay(task) })).filter(t => t.day >= TASKS_SINCE)
    .sort((a, b) => b.day.localeCompare(a.day)).map(t => t.task);
}
/** Requested: "Jeg synes godt, at det må være opgaver fra den sidste måned, der er samlet her" - the board's shared
 * list holds the tasks from the minutes of the last 30 days, newest first. */
export function lastMonthTasks(tasks: Task[], nowMs: number): Task[] {
  const since = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nowMs - 30 * 86_400_000);
  return tasks.map(task => ({ task, day: taskDay(task) })).filter(t => t.day && t.day >= since)
    .sort((a, b) => b.day.localeCompare(a.day)).map(t => t.task);
}
export const currentTodos = (todos: Todo[]) => todos.filter(t => t.created_at_ms >= SINCE_MS).sort((a, b) => b.created_at_ms - a.created_at_ms);

/** What is still open for this person: their minutes tasks not checked off, and their own items - newest first. */
export async function openFor(db: D1Database, owner: string, tasks: Task[]): Promise<{ tasks: Task[]; todos: Todo[] }> {
  const [checked, todos] = await Promise.all([checkedTasks(db, owner), todosFor(db, owner)]);
  return { tasks: currentTasks(tasksFor(owner, tasks)).filter(task => !checked.has(taskKey(task))), todos: currentTodos(todos).filter(t => t.done_at_ms === null) };
}
