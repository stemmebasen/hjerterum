import type { D1Database } from "../db.js";
import { SAGA_NAME, type SagaDeps, type SagaEnv } from "../saga/env.js";
import { saveBoardMessage } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";
import { isAssocMeeting } from "./assocEvents.js";
import { meeting, meetingHeading, meetings, saveMeeting, type Meeting } from "./data.js";
import { copenhagenMs } from "./eventDesk.js";
import { memberLang, type Lang } from "./i18n.js";
import { stillOnBoard } from "./personalLogin.js";

/** Requested: "The day after the last board meeting, a new mødeleder and ordstyrer will get chosen. Saga will be picking two and letting them know
 * directly. For mødelederen er det vigtigt at huske vedkommende på at gøre dagsordenen klar 3 dage inden." - from the whole board; "Saga må gerne
 * automatisk sætte teammøder op på torsdage i lige uger 13.30-15.30"; "Når hele gruppen får at vide hvem der er valgt, behøver individerne ikke at
 * få det at vide direkte" - "Men de skal mindes om at de er valgt nogle dage inden". The day after a team meeting (from 09) Saga picks the next
 * meeting's leader and moderator in turn and tells the group; three days before that meeting each of them is reminded privately, the leader to get
 * the agenda ready. */

const DAY = 86_400_000;
const ZONE = "Europe/Copenhagen";
const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(ms);
const copenhagenHour = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }).format(ms));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const lower = (s: string) => s.trim().toLocaleLowerCase("da-DK");
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && (lower(a!) === lower(b!) || lower(first(a)) === lower(first(b)));
const START = 9;

/** The ISO week of a day (YYYY-MM-DD). */
export function isoWeek(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  yearStart.setUTCDate(yearStart.getUTCDate() - ((yearStart.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((d.getTime() - yearStart.getTime()) / (7 * DAY));
}

/** The first Thursday in an even week after a day. */
export function nextEvenThursday(after: string): string {
  let day = addDays(after, 1);
  for (let i = 0; i < 21 && !(new Date(`${day}T12:00:00Z`).getUTCDay() === 4 && isoWeek(day) % 2 === 0); i++) day = addDays(day, 1);
  return day;
}

/** In turn: the one who has had the role longest ago (never first), then the one who has had the other role longest ago; never both roles, and not
 * the one who just had it. What is already set (the chair picked) stays. */
export function pickRoles(members: string[], history: Meeting[], keep: { leader?: string | null | undefined; moderator?: string | null | undefined }, last: Meeting | null, seed: number): { leader: string; moderator: string } {
  const n = members.length;
  const lastAs = (name: string, role: "leader" | "moderator") => history.filter(m => same(m[role], name)).map(m => m.meeting_date).sort().at(-1) ?? "";
  const rank = (name: string) => (members.indexOf(name) - (seed % Math.max(n, 1)) + n) % Math.max(n, 1);
  const order = (role: "leader" | "moderator", other: "leader" | "moderator") => (a: string, b: string) =>
    lastAs(a, role).localeCompare(lastAs(b, role)) || lastAs(a, other).localeCompare(lastAs(b, other)) || rank(a) - rank(b);
  const leader = keep.leader || members.filter(m => !(n > 2 && same(m, last?.leader))).sort(order("leader", "moderator"))[0] || "";
  const moderator = keep.moderator || members.filter(m => !same(m, leader) && !(n > 2 && same(m, last?.moderator))).sort(order("moderator", "leader"))[0] || "";
  return { leader, moderator };
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase("da-DK") + s.slice(1);
const where = (m: Meeting) => m.place ? ` i ${m.place.split(",")[0]!.trim()}` : "";

export function rolesGroupText(m: Meeting, link: string): string {
  return `Næste teammøde: ${lowerFirst(meetingHeading(m))}${where(m)} 🌿\nMødeleder: ${first(m.leader)} · Ordstyrer: ${first(m.moderator)}\n`
    + `${first(m.leader)}, jeg minder dig om at gøre dagsordenen klar 3 dage før.${link ? `\n${link}` : ""}`;
}

/** The board as Saga can reach it: everyone who has written in the group and is still in it. */
async function reachableBoard(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<Array<{ name: string; id: string }>> {
  const rows = (await db.prepare(`SELECT author_name AS name, MAX(author_telegram_id) AS id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
    GROUP BY author_name ORDER BY author_name COLLATE NOCASE`).bind(env.SAGA_BOARD_CHAT_ID).all<{ name: string; id: string }>()).results ?? [];
  const out: Array<{ name: string; id: string }> = [];
  for (const row of rows) if (await stillOnBoard(env, deps, row.id) !== false) out.push(row);
  return out;
}

const link = (env: SagaEnv, id: number) => env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}/moder/${id}` : "";

/** Every round from 09, the day after a team meeting (up to six days after, should a round be missed): once per meeting. */
export async function scheduledMeetingRoles(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<Meeting | null> {
  if (!env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return null;
  const now = deps.now(), today = copenhagenDay(now);
  if (copenhagenHour(now) < START) return null;
  const team = (await meetings(db)).filter(m => !isAssocMeeting(m));
  const last = team.filter(m => m.meeting_date < today && m.meeting_date >= addDays(today, -6)).sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))[0];
  if (!last || !(await claim(`meeting_roles_${last.meeting_date}`, last.id))) return null;
  let next = team.filter(m => m.meeting_date > last.meeting_date && m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;
  if (!next) {
    const id = await saveMeeting(db, { date: nextEvenThursday(last.meeting_date), time: "13:30", end: "15:30", place: last.place ?? "", kind: "team" }, SAGA_NAME, now);
    next = await meeting(db, id);
    if (!next) return null;
  }
  const board = await reachableBoard(env, deps, db);
  if (board.length < 2) return null;
  const history = team.filter(m => m.meeting_date <= last.meeting_date);
  const roles = pickRoles(board.map(b => b.name), history, { leader: next.leader, moderator: next.moderator }, last, next.id);
  if (!roles.leader || !roles.moderator) return null;
  if (roles.leader !== next.leader || roles.moderator !== next.moderator) {
    await db.prepare("UPDATE board_meetings SET leader = ?, moderator = ?, updated_at_ms = ?, updated_by = ? WHERE id = ?").bind(roles.leader, roles.moderator, now, SAGA_NAME, next.id).run();
    next = { ...next, ...roles };
  }
  const text = rolesGroupText(next, link(env, next.id));
  const sent = await telegramClient(env, deps).sendMessage(env.SAGA_BOARD_CHAT_ID, text).catch(() => null);
  if (sent) await saveBoardMessage(db, { chatId: env.SAGA_BOARD_CHAT_ID, messageId: sent.message_id, author: SAGA_NAME, authorId: null, text, sentAtMs: now, fromAssistant: true }).catch(() => undefined);
  return next;
}

const DAY_EN = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

export function roleReminderText(lang: Lang, member: string, m: Meeting, role: "leader" | "moderator", url: string): string {
  const time = m.start_time ? m.start_time.replace(":", ".") : "";
  if (lang === "en") {
    const when = `${DAY_EN.format(new Date(`${m.meeting_date}T12:00:00Z`))}${time ? ` at ${time}` : ""}`;
    return role === "leader"
      ? `Hi ${first(member)} 🙂 You are leading the team meeting on ${when}. Remember to get the agenda ready today - you can edit it here: ${url || "in admin under Møder"}, or just write the points to me here, and I will add them.`
      : `Hi ${first(member)} 🙂 Just a reminder: you are the moderator of the team meeting on ${when}. ${first(m.leader) ? `${first(m.leader)} is leading it. ` : ""}I will send you the agenda on the day.`;
  }
  const when = lowerFirst(meetingHeading(m));
  return role === "leader"
    ? `Hej ${first(member)} 🙂 Du er mødeleder på teammødet ${when}. Husk at gøre dagsordenen klar i dag - du kan rette den her: ${url || "i admin under Møder"}, eller bare skrive punkterne til mig her, så sætter jeg dem på.`
    : `Hej ${first(member)} 🙂 Lige en påmindelse: Du er ordstyrer på teammødet ${when}. ${first(m.leader) ? `${first(m.leader)} er mødeleder. ` : ""}Jeg sender dig dagsordenen på dagen.`;
}

/** Three days before a team meeting (from 09): its leader and its moderator are reminded privately, once. Who cannot be written to is told to the chair. */
export async function scheduledRoleReminders(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<number> {
  if (!env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return 0;
  const now = deps.now(), today = copenhagenDay(now);
  if (copenhagenHour(now) < START) return 0;
  const target = addDays(today, 3);
  const m = (await meetings(db)).find(x => x.meeting_date === target && !isAssocMeeting(x) && (x.leader || x.moderator));
  if (!m || !(await claim(`meeting_roles_reminder_${target}`, m.id))) return 0;
  const people = (await db.prepare(`SELECT author_name AS name, MAX(author_telegram_id) AS id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
    GROUP BY author_name`).bind(env.SAGA_BOARD_CHAT_ID).all<{ name: string; id: string }>()).results ?? [];
  const find = (name: string | null | undefined) => name ? people.find(p => lower(p.name) === lower(name)) ?? people.find(p => same(p.name, name)) : undefined;
  const telegram = telegramClient(env, deps), url = link(env, m.id) ? `${link(env, m.id)}#dagsorden` : "";
  const start = copenhagenMs(m.meeting_date, m.start_time && /^\d{2}:\d{2}$/.test(m.start_time) ? m.start_time : "12:00");
  let sent = 0;
  for (const role of ["leader", "moderator"] as const) {
    const person = find(m[role]);
    if (!person) continue;
    const text = roleReminderText(await memberLang(db, person.name), person.name, m, role, url);
    if (await telegram.sendMessage(person.id, text).then(() => true, () => false)) {
      sent++;
      // An answer in the private chat is read as an answer to this, so the leader's points go on this meeting's agenda.
      if (role === "leader") await db.prepare("INSERT OR REPLACE INTO agenda_asks (telegram_id, member, meeting_id, meeting_start_ms, text, sent_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(person.id, person.name, m.id, start, text, now).run().catch(() => undefined);
    } else if (env.SAGA_OWNER_TELEGRAM_ID && person.id !== env.SAGA_OWNER_TELEGRAM_ID) {
      await telegram.sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `Jeg kunne ikke minde ${first(person.name)} privat om at være ${role === "leader" ? "mødeleder" : "ordstyrer"} - de skal først skrive /start til mig i Telegram.`).catch(() => undefined);
    }
  }
  return sent;
}
