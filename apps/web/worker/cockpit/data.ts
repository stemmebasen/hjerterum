import type { D1Database } from "../db.js";
import type { SagaEnv } from "../saga/env.js";
import { section, strictSection } from "../saga/markdown.js";
import { addressedTo, groupActivity, parsePicture, telegramLink, type BoardPicture } from "../saga/picture.js";
import { latestOverview, latestWeeklySummary, ownerDone, recentBoardMessages, type Minutes } from "../saga/store.js";

/** What the board cockpit shows, read from Saga's own tables: her picture of the board, the minutes
 * the chair has approved, the meetings and agendas written in the cockpit, and the decisions and
 * tasks in them. Drafts waiting for the chair's approval are counted, never shown. */

export type MeetingKind = "team" | "andet";
export type Meeting = { id: number; meeting_date: string; start_time: string | null; place: string | null; agenda: string; updated_at_ms: number; updated_by: string | null; agenda_saga?: string; kind?: MeetingKind | null; leader?: string | null; moderator?: string | null; agenda_authors?: string };
export type Task = { who: string; what: string; due: string; meeting: string; source: "referat" | "dokument" | "formand" };
export type Decision = { text: string; date: string; topic: string; source: "referat" | "dokument" | "afstemning"; minutesId: number | null; voteId?: number; atMeeting?: boolean; kind?: "beslutning" | "aftale"; kindBy?: string };
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
  const rows = await db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, agenda_saga, agenda_authors, kind, leader, moderator, updated_at_ms, updated_by FROM board_meetings ORDER BY meeting_date DESC, id DESC LIMIT 200`).all<Meeting>();
  return rows.results ?? [];
}

export const meetingOn = (db: D1Database, day: string) =>
  db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, agenda_saga, agenda_authors, kind, leader, moderator, updated_at_ms, updated_by FROM board_meetings WHERE meeting_date = ? ORDER BY id DESC LIMIT 1`).bind(day).first<Meeting>();

export const meeting = (db: D1Database, id: number) =>
  db.prepare(`SELECT id, meeting_date, start_time, ${PLACE}, agenda, agenda_saga, agenda_authors, kind, leader, moderator, updated_at_ms, updated_by FROM board_meetings WHERE id = ?`).bind(id).first<Meeting>();

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
/** `agenda` is left out when the form does not carry it: the points of the agenda are added and deleted one by one (addAgendaPoints, removeAgendaPoint). */
export type MeetingInput = { date: string; time: string; place: string; agenda?: string; kind?: MeetingKind; leader?: string; moderator?: string };

/** One point of an agenda: one line, no numbering or bullet, at most 200 characters - never running text. */
export const cleanPoint = (text: string) => text.replace(/\s+/g, " ").trim().replace(/^(\d+[.)]|[-*•])\s+/, "").slice(0, 200);
export const agendaPoints = (agenda: string | null | undefined) => (agenda ?? "").split("\n").map(line => line.trim()).filter(Boolean);

/** A meeting as written in the cockpit form; null when the date is not a real day. */
export function meetingInput(form: FormData): MeetingInput | null {
  const date = String(form.get("meeting_date") ?? "").trim();
  const time = String(form.get("start_time") ?? "").trim();
  if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return null;
  return { date, time: TIME.test(time) ? time : "", place: String(form.get("place") ?? "").trim().slice(0, 200),
    // A ticked "Teammøde" sends kind=team; an unticked one sends nothing, so the form says it carried the box (kind_sent) - then it is "andet". A form without the box leaves the kind alone.
    ...(form.get("kind") === "team" || form.get("kind") === "andet" ? { kind: form.get("kind") as MeetingKind } : form.has("kind_sent") ? { kind: "andet" as const } : {}),
    // Requested: "Der skal i øvrigt kunne vælges en Mødeleder og Ordstyrer.": a name from the board, or "" for none; left out, they stay as they were.
    ...(form.has("leader") ? { leader: String(form.get("leader") ?? "").trim().slice(0, 100) } : {}), ...(form.has("moderator") ? { moderator: String(form.get("moderator") ?? "").trim().slice(0, 100) } : {}),
    ...(form.has("agenda") ? { agenda: String(form.get("agenda") ?? "").replace(/\r\n/g, "\n").split("\n").map(cleanPoint).filter(Boolean).slice(0, 40).join("\n").slice(0, 8000) } : {}) };
}

export async function saveMeeting(db: D1Database, input: MeetingInput, who: string, nowMs: number, id?: number): Promise<number> {
  if (id) {
    // What the form leaves out stays as it was: the agenda (its points are added and deleted one by one) and the kind of meeting.
    const sets = ["meeting_date = ?", "start_time = ?", "place = ?", "updated_at_ms = ?", "updated_by = ?"], values: Array<string | number | null> = [input.date, input.time || null, input.place || DEFAULT_PLACE, nowMs, who || null];
    if (input.agenda !== undefined) { sets.push("agenda = ?"); values.push(input.agenda); }
    if (input.kind) { sets.push("kind = ?"); values.push(input.kind); }
    if (input.leader !== undefined) { sets.push("leader = ?"); values.push(input.leader || null); }
    if (input.moderator !== undefined) { sets.push("moderator = ?"); values.push(input.moderator || null); }
    await db.prepare(`UPDATE board_meetings SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
    return id;
  }
  const result = await db.prepare(`INSERT INTO board_meetings (meeting_date, start_time, place, agenda, kind, leader, moderator, created_at_ms, updated_at_ms, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.date, input.time || null, input.place || DEFAULT_PLACE, input.agenda ?? "", input.kind ?? null, input.leader || null, input.moderator || null, nowMs, nowMs, who || null).run();
  return Number(result.meta?.last_row_id);
}

/** What the board's own words say about a meeting Saga found: the weekly meeting (team- or bestyrelsesmøde) is a team meeting, a general assembly or an info meeting is not; otherwise "" - then the board says. */
export const guessKind = (what: string): MeetingKind | "" =>
  /team|bestyrelsesmøde/i.test(what) ? "team" : /generalforsamling|infomøde|workshop|fest\b|kursus|arrangement|åbent hus/i.test(what) ? "andet" : "";

/** "Mødeleder: Frederik · Ordstyrer: Lisbeth" - first names; "" when no one is picked. */
export function rolesLine(m: Pick<Meeting, "leader" | "moderator">): string {
  const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
  return [first(m.leader) && `Mødeleder: ${first(m.leader)}`, first(m.moderator) && `Ordstyrer: ${first(m.moderator)}`].filter(Boolean).join(" · ");
}

/** The next team meeting: the earliest meeting from today on that is said to be one. */
export const nextTeamMeeting = (list: Meeting[], today: string): Meeting | null =>
  list.filter(m => m.kind === "team" && m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;

/** Who made each point of an agenda: {"point": "name"}. A point of Saga's is in `agenda_saga` instead; an old point has no author. */
export function agendaAuthors(raw: string | null | undefined): Record<string, string> {
  try {
    const data = JSON.parse(raw || "{}") as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? Object.fromEntries(Object.entries(data as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")) : {};
  } catch { return {}; }
}

/** Requested: "det er alt for voldsomt med så mange forslag. Hun bør prioritere de fem vigtigste.": Saga never has more than this many points on one agenda at a time. */
export const SAGA_POINTS = 5;

/** How many more points Saga may put on this agenda: five at a time, counting hers that are still there. One deleted with the cross, or rewritten by a member, is no longer hers and frees a place; the board's own points do not count. */
export function sagaRoom(m: { agenda: string; agenda_saga?: string }): number {
  const points = new Set(agendaPoints(m.agenda));
  return Math.max(0, SAGA_POINTS - agendaPoints(m.agenda_saga ?? "").filter(p => points.has(p)).length);
}

/** Adds points at the bottom of a meeting's agenda - the ones already there are not added twice. `fromSaga` marks them as hers, until they are deleted - and stops at the five she may have (`sagaRoom`). Returns how many were added. */
export async function addAgendaPoints(db: D1Database, id: number, texts: string[], who: string, nowMs: number, fromSaga = false): Promise<number> {
  const m = await db.prepare("SELECT agenda, agenda_saga, agenda_authors FROM board_meetings WHERE id = ?").bind(id).first<{ agenda: string; agenda_saga: string; agenda_authors: string }>();
  if (!m) return 0;
  const points = agendaPoints(m.agenda), saga = agendaPoints(m.agenda_saga), authors = agendaAuthors(m.agenda_authors), seen = new Set(points.map(p => p.toLowerCase()));
  let added = 0, room = fromSaga ? sagaRoom(m) : Infinity;
  for (const text of texts.map(cleanPoint).filter(Boolean)) {
    if (room <= 0) break;
    if (points.length >= 40 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase()); points.push(text); added++;
    if (fromSaga) { saga.push(text); room--; } else if (who) authors[text] = who;
  }
  if (added) await db.prepare("UPDATE board_meetings SET agenda = ?, agenda_saga = ?, agenda_authors = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?").bind(points.join("\n"), saga.join("\n"), JSON.stringify(authors), nowMs, who || null, id).run();
  return added;
}

/** Edits one point of the agenda in place (the pencil): the new text takes the old one's place. A point of Saga's that a member has rewritten is theirs now - it loses her mark.
 * False when the old point is not there, the new text is empty, or another point already says the same. */
export async function editAgendaPoint(db: D1Database, id: number, oldText: string, newText: string, who: string, nowMs: number): Promise<boolean> {
  const m = await db.prepare("SELECT agenda, agenda_saga, agenda_authors FROM board_meetings WHERE id = ?").bind(id).first<{ agenda: string; agenda_saga: string; agenda_authors: string }>();
  const before = cleanPoint(oldText), after = cleanPoint(newText);
  if (!m || !before || !after) return false;
  const points = agendaPoints(m.agenda), at = points.findIndex(p => p === before);
  if (at < 0) return false;
  if (after === before) return true;
  if (points.some((p, i) => i !== at && p.toLowerCase() === after.toLowerCase())) return false;
  points[at] = after;
  // The one who made the point stays its maker; a point of Saga's that a member rewrote is the member's now.
  const authors = agendaAuthors(m.agenda_authors), maker = authors[before] ?? (agendaPoints(m.agenda_saga).includes(before) ? who : "");
  delete authors[before];
  if (maker) authors[after] = maker;
  await db.prepare("UPDATE board_meetings SET agenda = ?, agenda_saga = ?, agenda_authors = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?")
    .bind(points.join("\n"), agendaPoints(m.agenda_saga).filter(p => p !== before).join("\n"), JSON.stringify(authors), nowMs, who || null, id).run();
  return true;
}

/** Requested: "man skal i øvrigt også kunne flytte punkterne op og ned. Helst drag and drop." The points in the order the board gave them. A point that has been added or deleted meanwhile does not break it:
 * the ones given and still there come first, in the given order; the ones that were not given follow in their old order. False when nothing changed. */
export async function reorderAgendaPoints(db: D1Database, id: number, order: string[], who: string, nowMs: number): Promise<boolean> {
  const m = await db.prepare("SELECT agenda FROM board_meetings WHERE id = ?").bind(id).first<{ agenda: string }>();
  if (!m) return false;
  const current = agendaPoints(m.agenda), given = [...new Set(order.map(cleanPoint).filter(p => current.includes(p)))];
  const next = [...given, ...current.filter(p => !given.includes(p))];
  if (next.join("\n") === current.join("\n")) return false;
  await db.prepare("UPDATE board_meetings SET agenda = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?").bind(next.join("\n"), nowMs, who || null, id).run();
  return true;
}

/** Deletes one point of the agenda (the cross). False when it is not there. */
export async function removeAgendaPoint(db: D1Database, id: number, text: string, who: string, nowMs: number): Promise<boolean> {
  const m = await db.prepare("SELECT agenda, agenda_saga, agenda_authors FROM board_meetings WHERE id = ?").bind(id).first<{ agenda: string; agenda_saga: string; agenda_authors: string }>();
  const point = cleanPoint(text);
  if (!m || !point) return false;
  const points = agendaPoints(m.agenda), at = points.findIndex(p => p === point);
  if (at < 0) return false;
  points.splice(at, 1);
  const authors = agendaAuthors(m.agenda_authors);
  delete authors[point];
  // Deleting takes no AI call. What Saga suggested may come again in her next suggestion - that is how she makes a fresh one.
  await db.prepare("UPDATE board_meetings SET agenda = ?, agenda_saga = ?, agenda_authors = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?")
    .bind(points.join("\n"), agendaPoints(m.agenda_saga).filter(p => p !== point).join("\n"), JSON.stringify(authors), nowMs, who || null, id).run();
  return true;
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

const GROUPS = /^(?:alle|alle sammen|bestyrelsen|hele bestyrelsen|teamet|de ansatte|de tre ansatte|begge|ansatte)$/i;
/** Whether a task's "hvem" is people: first names (a surname may follow), a few of them ("Lisbeth, Gitta og Frederik"), "Alle" or a group - and not a topic ("Fast fremtidig rengøringsordning"). Empty is for everyone. */
export function looksLikeWho(text: string): boolean {
  const who = text.trim();
  if (!who) return true;
  // A capitalised word is a name unless it ends like a common noun ("-ordning", "-else", "-hed", "-skab", "-tion" ...): "Rengøringsordning" is a topic, "Henning" is not.
  return who.split(/\s*(?:,|&|\/|\bog\b|\bsamt\b)\s*/i).filter(Boolean).every(part => GROUPS.test(part) || (/^\p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){0,2}$/u.test(part) && !/(?:ordning|else|hed|skab|tion|plan|møde|system|forslag|arrangement|aftale|event|fest)$/i.test(part)));
}
/** A task whose "hvem" is really a topic is for everyone - and the topic stays in the text: "Alle: Fast fremtidig rengøringsordning: tages op igen", not a person called "Fast fremtidig rengøringsordning". */
export function sensibleWho<T extends { who: string; what: string }>(task: T): T {
  return looksLikeWho(task.who) ? task : { ...task, who: "", what: [task.who.trim(), task.what].filter(Boolean).join(": ") };
}

/** "- <hvem> - <hvad> - <hvornår>", as Saga writes the tasks in her minutes. */
export function minutesTasks(minutes: ApprovedMinutes): Task[] {
  return bullets(section(minutes.draft_markdown ?? "", /opgaver/i)).map(line => {
    const parts = line.split(/\s+[-–—]\s+/);
    const [who, what, due] = parts.length >= 3 ? [parts[0]!, parts.slice(1, -1).join(" - "), parts.at(-1)!] : parts.length === 2 ? [parts[0]!, parts[1]!, ""] : ["", line, ""];
    return sensibleWho({ who: who.trim(), what: what.trim(), due: /ingen frist/i.test(due) ? "" : due.trim(), meeting: minutes.meeting_date ?? "", source: "referat" as const });
  }).filter(task => task.what);
}

export function minutesDecisions(minutes: ApprovedMinutes): Decision[] {
  return bullets(section(minutes.draft_markdown ?? "", /beslutninger/i)).filter(line => !/^ingen beslutning/i.test(line))
    .map(text => ({ text, date: minutes.meeting_date ?? "", topic: "", source: "referat" as const, minutesId: minutes.id }));
}

/** Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler": the section "## Aftaler" of the minutes - what was agreed informally, not decided by the board. */
export function minutesAgreements(minutes: ApprovedMinutes): Decision[] {
  return bullets(strictSection(minutes.draft_markdown ?? "", /^aftaler$/i)).filter(line => !/^ingen aftaler/i.test(line))
    .map(text => ({ text, date: minutes.meeting_date ?? "", topic: "", source: "referat" as const, minutesId: minutes.id, kind: "aftale" as const }));
}

/** Every task: from the approved minutes, and the ones Saga found in the minutes document. */
export function allTasks(minutes: ApprovedMinutes[], picture: BoardPicture | null): Task[] {
  const seen = new Set<string>(), out: Task[] = [];
  const add = (task: Task) => { const key = `${task.who}|${task.what}`.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(task); } };
  for (const m of minutes) for (const task of minutesTasks(m)) add(task);
  // The document's own reading of a task the approved minutes already hold is not shown twice.
  const norm = (text: string) => text.toLocaleLowerCase("da-DK").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const fromMinutes = [...out];
  for (const raw of picture?.document.tasks ?? []) {
    const t = sensibleWho({ ...raw, who: raw.who ?? "" });
    const what = norm(t.what);
    if (fromMinutes.some(m => norm(m.who) === norm(t.who) && (norm(m.what).includes(what) || what.includes(norm(m.what))))) continue;
    add({ who: t.who, what: t.what, due: t.due, meeting: t.since, source: "dokument" });
  }
  return out;
}

/** Every decision and informal agreement, newest first: the approved minutes', then those Saga found in the document (sort them with `withKinds`, decisionKinds.ts). */
export function allDecisions(minutes: ApprovedMinutes[], picture: BoardPicture | null): Decision[] {
  const seen = new Set<string>(), out: Decision[] = [];
  const add = (decision: Decision) => { const key = decision.text.toLowerCase().replace(/\s+/g, " "); if (!seen.has(key)) { seen.add(key); out.push(decision); } };
  for (const m of minutes) for (const decision of [...minutesDecisions(m), ...minutesAgreements(m)]) add(decision);
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

/** How many board members have approved each minutes (only the ones that were approved, not corrections) - for the decisions list, where a laurel stands only by what the whole board has approved. */
export async function approvalCounts(db: D1Database): Promise<Map<number, number>> {
  const rows = (await db.prepare("SELECT minutes_id, COUNT(*) AS n FROM board_minutes_signoffs WHERE status = 'approved' GROUP BY minutes_id").all<{ minutes_id: number; n: number }>().catch(() => ({ results: [] as Array<{ minutes_id: number; n: number }> }))).results ?? [];
  return new Map(rows.map(r => [r.minutes_id, r.n]));
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

/** Where Saga found an item for the chair, as the line under it says. Requested: the front page should read "Svar på: Hvem skal
 * spørges som suppleant, og hvordan afgøres det? Lisbeth foreslår Maria Ravbæk Larsen og Philip Lenbroch" / "Fra Telegram gruppen".
 * What was agreed at a meeting (the minutes or the minutes document) says when instead - see `agreedLabel`. */
export const SAGA_SOURCE: Record<string, string> = { telegram: "Fra Telegram gruppen", mail: "Fra team@" };

const SHORT_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A meeting's day as YYYY-MM-DD, from the minutes' "2026-10-01" or the minutes document's "17/9" or "17/9/26" (no year: this year); "" if it is neither. */
export function meetingDayIso(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (!short) return "";
  const year = short[3] ? (short[3].length === 2 ? `20${short[3]}` : short[3]) : TASKS_SINCE.slice(0, 4);
  return `${year}-${short[2]!.padStart(2, "0")}-${short[1]!.padStart(2, "0")}`;
}
/** Requested: "Her bliver det for upræcist med referatdokumentet. Kan der ikke stå 'Aftalt på mødet d. dato'" - under what came out of a meeting. */
export function agreedLabel(meeting: string | null | undefined): string {
  const day = meetingDayIso(meeting);
  return day ? `Aftalt på mødet d. ${SHORT_DAY.format(new Date(`${day}T12:00:00Z`))}` : "Aftalt på et møde";
}
/** The line under one of Saga's items: where she found it, or - from the minutes document - when it was agreed. */
export const sagaSource = (item: { source: string; since?: string }, fallback = "") => item.source === "dokument" ? agreedLabel(item.since) : SAGA_SOURCE[item.source] ?? fallback;

/** Saga's wording without the full stop she ends it with. */
export const withoutStop = (text: string) => text.replace(/\s*\.\s*$/, "").trim();

/** A minutes task's lasting name: the meeting, who and what - the same task in the same minutes. */
/** Requested: "Til mig bør ordlyden ikke være: Ser på automatisk opsætning af nyhedsbrev ... Sender preview-link ... Men:
 * Se på ... Send preview-link". A task reads as an instruction: the verb it starts with in the present tense ("ser",
 * "sender") is shown in the imperative ("se", "send"). Only known verbs - a noun like "Billeder" is left alone. Shown
 * only: the task's key stays its original text, so what was checked off stays checked off. */
const IMPERATIVE: Record<string, string> = Object.fromEntries(Object.entries({
  ser: "se", går: "gå", får: "få", står: "stå", tager: "tag", giver: "giv", siger: "sig", beder: "bed", overtager: "overtag", gennemgår: "gennemgå", foreslår: "foreslå",
  sender: "send", laver: "lav", kontakter: "kontakt", undersøger: "undersøg", skriver: "skriv", booker: "book", ringer: "ring", tjekker: "tjek", opdaterer: "opdater",
  bestiller: "bestil", holder: "hold", finder: "find", spørger: "spørg", følger: "følg", forbereder: "forbered", sørger: "sørg", inviterer: "inviter", planlægger: "planlæg",
  deler: "del", lægger: "læg", mailer: "mail", svarer: "svar", afklarer: "afklar", arrangerer: "arranger", opretter: "opret", retter: "ret", køber: "køb", betaler: "betal",
  fakturerer: "fakturer", sætter: "sæt", henter: "hent", afleverer: "aflever", aftaler: "aftal", beregner: "beregn", udarbejder: "udarbejd", koordinerer: "koordiner",
  rydder: "ryd", printer: "print", uploader: "upload", beslutter: "beslut", informerer: "informer", påminder: "påmind", minder: "mind", bruger: "brug",
  præsenterer: "præsenter", fremlægger: "fremlæg", udsender: "udsend", opsætter: "opsæt", tilmelder: "tilmeld", afmelder: "afmeld", kigger: "kig", taler: "tal",
  hjælper: "hjælp", samler: "saml", organiserer: "organiser", åbner: "åbn", lukker: "luk", flytter: "flyt", kører: "kør", vender: "vend", melder: "meld", tester: "test",
  skaffer: "skaf", afholder: "afhold", indkalder: "indkald", udfylder: "udfyld", opfordrer: "opfordr", tænker: "tænk", overvejer: "overvej", vurderer: "vurder",
  forhører: "forhør", søger: "søg", sletter: "slet", tilføjer: "tilføj", fjerner: "fjern", afslutter: "afslut", starter: "start", udskifter: "udskift", reparerer: "reparer"
}));
export function imperative(text: string): string {
  const match = /^(\s*)([\p{L}]+)/u.exec(text);
  if (!match) return text;
  const word = match[2]!, form = IMPERATIVE[word.toLocaleLowerCase("da-DK")];
  if (!form) return text;
  const shown = word.charAt(0) === word.charAt(0).toLocaleUpperCase("da-DK") ? form.charAt(0).toLocaleUpperCase("da-DK") + form.slice(1) : form;
  return match[1] + shown + text.slice(match[0].length);
}

export const taskKey = (task: Task) => `${task.meeting}|${task.who}|${task.what}`.toLocaleLowerCase("da-DK").replace(/\s+/g, " ").trim().slice(0, 400);

/** Requested: "Man skal kunne skrive en opgave til alle også". An item written to "Alle" is on every
 * member's list, and whoever does it checks it off for everyone. */
export const EVERYONE = "Alle";
export async function todosFor(db: D1Database, owner: string): Promise<Todo[]> {
  const rows = await db.prepare("SELECT id, owner, text, due, created_by, created_at_ms, done_at_ms FROM cockpit_todos WHERE owner IN (?, 'Alle') ORDER BY done_at_ms IS NOT NULL, COALESCE(due, '9999') , created_at_ms DESC LIMIT 300")
    .bind(owner).all<Todo>();
  return rows.results ?? [];
}

/** Saga's questions and tasks for one board member (not the chair's own list from the overview): those written to them by name,
 * and those for all of them, minus what they have ticked off. Same shape as the chair's list. */
export async function sagaItemsFor(db: D1Database, picture: BoardPicture | null, member: string): Promise<BoardPicture["forJacob"]> {
  const mine = (picture?.forMembers ?? []).filter(f => addressedTo(f.to, member));
  if (!mine.length) return [];
  const done = new Set((await db.prepare("SELECT item_key FROM cockpit_saga_done WHERE member = ?").bind(member).all<{ item_key: string }>().then(r => r.results ?? []).catch(() => [])).map(r => r.item_key));
  return mine.filter(f => !done.has(f.key)).map(({ key, kind, text, source, from, since }) => ({ key, kind, text, source, from, since }));
}

export async function markMemberDone(db: D1Database, member: string, key: string, text: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_saga_done (member, item_key, text, done_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(member, item_key) DO UPDATE SET done_at_ms = excluded.done_at_ms")
    .bind(member, key, text.slice(0, 300), nowMs).run();
}

/** What the members have ticked off lately, for Saga: "Gitta: Svar kommunen". */
export async function memberDoneForSaga(db: D1Database, sinceMs: number): Promise<Array<{ member: string; text: string }>> {
  return db.prepare("SELECT member, text FROM cockpit_saga_done WHERE done_at_ms >= ? ORDER BY done_at_ms DESC LIMIT 60").bind(sinceMs).all<{ member: string; text: string }>().then(r => r.results ?? []).catch(() => []);
}

/** Requested: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked" - what each board member is responsible
 * for, in their own words (at most 600 characters). */
export const MAX_RESPONSIBILITIES = 600;

export async function responsibilities(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare("SELECT member, text FROM cockpit_responsibilities").all<{ member: string; text: string }>().then(r => r.results ?? []).catch(() => []);
  return new Map(rows.map(r => [r.member, r.text]));
}

/** The member's own words, trimmed; an empty text changes nothing (the field is required - it is not cleared by accident). */
export async function setResponsibilities(db: D1Database, member: string, text: string, nowMs: number): Promise<boolean> {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_RESPONSIBILITIES);
  if (!clean) return false;
  await db.prepare("INSERT INTO cockpit_responsibilities (member, text, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(member) DO UPDATE SET text = excluded.text, updated_at_ms = excluded.updated_at_ms")
    .bind(member, clean, nowMs).run();
  return true;
}

/** What Saga reads about who is responsible for what; a member who has not written yet is listed as such, so she can ask. */
export function responsibilitiesForSaga(names: string[], written: Map<string, string>): string {
  const lines = names.map(name => `- ${name}: ${written.get(name)?.replace(/\s*\n\s*/g, "; ") ?? "(har ikke skrevet sine ansvarsområder endnu)"}`);
  return lines.join("\n") || "(ingen i bestyrelsen er kendt endnu)";
}

/** The words of a line without capitals, punctuation and spacing: "Ring til udlejer." and "ring  til udlejer" are the same. */
const sameLine = (text: string) => text.toLocaleLowerCase("da-DK").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Requested: "Please also delete duplicates when it comes to to-dos." A to-do that is already on the owner's list (the same words, still open) is not written again.
 * Returns false when it was already there. */
export async function addTodo(db: D1Database, input: { owner: string; text: string; due: string | null; createdBy: string }, nowMs: number): Promise<boolean> {
  const open = await db.prepare("SELECT text FROM cockpit_todos WHERE owner = ? AND done_at_ms IS NULL").bind(input.owner).all<{ text: string }>().then(r => r.results ?? []);
  if (open.some(t => sameLine(t.text) === sameLine(input.text))) return false;
  await db.prepare("INSERT INTO cockpit_todos (owner, text, due, created_by, created_at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(input.owner, input.text, input.due, input.createdBy, nowMs).run();
  return true;
}

/** The to-dos that are on a list twice - the same owner, the same words, both still open - are deleted: the oldest stays. What is checked off is not touched.
 * Returns how many were deleted. */
export async function removeDuplicateTodos(db: D1Database): Promise<number> {
  const open = await db.prepare("SELECT id, owner, text FROM cockpit_todos WHERE done_at_ms IS NULL ORDER BY created_at_ms, id").all<{ id: number; owner: string; text: string }>().then(r => r.results ?? []);
  const seen = new Set<string>(), extra: number[] = [];
  for (const todo of open) {
    const key = `${todo.owner}\n${sameLine(todo.text)}`;
    if (seen.has(key)) extra.push(todo.id); else seen.add(key);
  }
  for (const id of extra) await db.prepare("DELETE FROM cockpit_todos WHERE id = ?").bind(id).run();
  return extra.length;
}

/** One line per person and task: the same task from the minutes and from the minutes document (or twice in the same minutes) is shown once. */
export function uniqueTasks(tasks: Task[]): Task[] {
  const kept: Task[] = [];
  for (const task of tasks) if (!kept.some(k => k.who.trim().toLocaleLowerCase("da-DK") === task.who.trim().toLocaleLowerCase("da-DK") && sameTask(k.what, task.what))) kept.push(task);
  return kept;
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
 * for den fælles oversigt i fem dage, hvorefter hele linjen arkiveres" - later "after 7 days". Who checked each minutes task off, and when. */
export async function taskChecksByKey(db: D1Database): Promise<Map<string, { by: string; at: number }>> {
  // A task a member removed from their own list is not done: it is never shown as checked on the shared list.
  const rows = await db.prepare("SELECT task_key, owner, done_at_ms FROM cockpit_task_checks WHERE removed = 0 ORDER BY done_at_ms ASC").all<{ task_key: string; owner: string; done_at_ms: number }>();
  return new Map((rows.results ?? []).map(r => [r.task_key, { by: r.owner, at: r.done_at_ms }]));
}

/** The tasks a member removed from their own list. */
export async function removedTasks(db: D1Database, owner: string): Promise<Set<string>> {
  const rows = await db.prepare("SELECT task_key FROM cockpit_task_checks WHERE owner = ? AND removed = 1").bind(owner).all<{ task_key: string }>().catch(() => ({ results: [] as Array<{ task_key: string }> }));
  return new Set((rows.results ?? []).map(r => r.task_key));
}

export async function removeTaskFor(db: D1Database, owner: string, key: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_task_checks (owner, task_key, done_at_ms, removed) VALUES (?, ?, ?, 1) ON CONFLICT(owner, task_key) DO UPDATE SET done_at_ms = excluded.done_at_ms, removed = 1")
    .bind(owner, key, nowMs).run();
}

/** Requested: "make sure that there are no duplicates in the to-dos". The same task comes from the approved minutes, from
 * Saga's reading of the minutes document and from Saga's list for the chair, each in its own words ("Send sidste besked
 * til Thomas Emil (kopi til Douglas) og bloker ham derefter", "Sende sidste besked til Thomas Emil og blokere ham").
 * Two lines are the same task when most of the shorter one's words (by their first four letters) are in the other. */
const STOP = new Set(["og", "til", "på", "at", "en", "et", "de", "den", "det", "med", "for", "af", "om", "som", "der", "fra", "har", "ham", "hun",
  "nye", "nyt", "ny", "the", "and", "evt", "kan", "skal", "vil", "efter", "inden", "senest", "derefter"]);
export function taskWords(text: string): Set<string> {
  return new Set((text.toLocaleLowerCase("da-DK").match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.slice(0, 4)));
}
export function sameTask(a: string, b: string): boolean {
  const x = taskWords(a), y = taskWords(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size) return false;
  const shared = [...small].filter(w => big.has(w)).length;
  return shared >= Math.min(3, small.size) && shared / small.size >= 0.6;
}

/** One line per task: the first of each group of the same task is shown, the rest go with it (checked or removed together). */
export function mergeSame<T>(items: T[], text: (item: T) => string): Array<{ item: T; twins: T[] }> {
  const groups: Array<{ item: T; twins: T[] }> = [];
  for (const item of items) {
    const group = groups.find(g => sameTask(text(g.item), text(item)));
    if (group) group.twins.push(item); else groups.push({ item, twins: [] });
  }
  return groups;
}

export async function setTaskChecked(db: D1Database, owner: string, key: string, done: boolean, nowMs: number): Promise<void> {
  if (done) await db.prepare("INSERT INTO cockpit_task_checks (owner, task_key, done_at_ms, removed) VALUES (?, ?, ?, 0) ON CONFLICT(owner, task_key) DO UPDATE SET done_at_ms = excluded.done_at_ms, removed = 0").bind(owner, key, nowMs).run();
  else await db.prepare("DELETE FROM cockpit_task_checks WHERE owner = ? AND task_key = ?").bind(owner, key).run();
}

/** Requested: "Det er vigtigt, at det er de nyeste opgaver, der er øverst. Desuden ... alle påmindelser fra
 * før i går ikke fremgår af listen, så vi starter friskt" (2 October 2026). The list starts on 1 October:
 * tasks from earlier minutes and items written before then are not shown; the newest come first. */
export const TASKS_SINCE = "2026-10-01";
const SINCE_MS = Date.parse(`${TASKS_SINCE}T00:00:00+02:00`);
/** A task's day as YYYY-MM-DD: the minutes' meeting date, or the minutes document's "17/9" (this year). */
export const taskDay = (task: Task): string => meetingDayIso(task.meeting);
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
