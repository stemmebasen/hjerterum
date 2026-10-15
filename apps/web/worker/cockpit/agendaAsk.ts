import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { isAssocMeeting } from "./assocEvents.js";
import { agendaPoints, meetings, rolesLine, type Meeting } from "./data.js";
import { copenhagenMs } from "./eventDesk.js";
import { memberLang, type Lang } from "./i18n.js";
import { askSagaMarkdown, DAILY_QUESTIONS, questionsToday, type AskTurn } from "./ask.js";
import { memberByTelegram, stillOnBoard } from "./personalLogin.js";

/** Requested: "24 hours before a team meeting she should write to each and every board member directly and ask if they have anything to add to
 * the agenda and she should tell them that they can just write it to her in the chat and she will add it" - "Is there any way that she can write
 * in that language that the member has chosen in admin?" A private Telegram message to each board member, in the language they chose in admin
 * (Profil), a day before each team meeting; what they write back to her privately is answered as in admin's chat, and a point goes on the agenda. */

const HOUR = 3_600_000;
const ZONE = "Europe/Copenhagen";
const DAY_DA = new Intl.DateTimeFormat("da-DK", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const DAY_EN = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

const startOf = (m: Meeting) => copenhagenMs(m.meeting_date, m.start_time && /^\d{2}:\d{2}$/.test(m.start_time) ? m.start_time : "12:00");
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function agendaAskText(lang: Lang, member: string, m: Meeting, link: string): string {
  const date = new Date(`${m.meeting_date}T12:00:00Z`), time = m.start_time ? m.start_time.replace(":", ".") : "";
  if (lang === "en") return `Hi ${first(member)} 🙂 Tomorrow, ${DAY_EN.format(date)}${time ? ` at ${time}` : ""}, we have a team meeting${m.place ? ` (${m.place})` : ""}. `
    + `Is there anything you would like to add to the agenda? Just write it to me here in the chat, and I will add it.${link ? `\n\nThe agenda so far: ${link}` : ""}`;
  return `Hej ${first(member)} 🙂 I morgen, ${DAY_DA.format(date)}${time ? ` kl. ${time}` : ""}, har vi teammøde${m.place ? ` (${m.place})` : ""}. `
    + `Har du noget, der skal på dagsordenen? Skriv det bare til mig her i chatten, så sætter jeg det på.${link ? `\n\nDagsordenen indtil nu: ${link}` : ""}`;
}

/** Every round: a team meeting starting in 2-24 hours gets its question to each board member, once. Who cannot be written to (they have never
 * opened a chat with Saga) is told to the chair, once per meeting. */
export async function scheduledAgendaAsk(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<number> {
  if (!env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return 0;
  const now = deps.now();
  const next = (await meetings(db)).filter(m => !isAssocMeeting(m)).map(m => ({ m, start: startOf(m) }))
    .filter(x => x.start - 24 * HOUR <= now && now < x.start - 2 * HOUR).sort((a, b) => a.start - b.start)[0];
  if (!next || !(await claim(`agenda_ask_${next.m.meeting_date}`, next.m.id))) return 0;
  const people = (await db.prepare(`SELECT author_name, author_telegram_id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
    GROUP BY author_telegram_id ORDER BY author_name`).bind(env.SAGA_BOARD_CHAT_ID).all<{ author_name: string; author_telegram_id: string }>()).results ?? [];
  const telegram = telegramClient(env, deps), link = env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}/moder/${next.m.id}` : "";
  const missed: string[] = [];
  let sent = 0;
  for (const person of people) {
    if (await stillOnBoard(env, deps, person.author_telegram_id) === false) continue;
    const text = agendaAskText(await memberLang(db, person.author_name), person.author_name, next.m, link);
    const ok = await telegram.sendMessage(person.author_telegram_id, text).then(() => true, () => false);
    if (!ok) { missed.push(first(person.author_name)); continue; }
    await db.prepare("INSERT OR REPLACE INTO agenda_asks (telegram_id, member, meeting_id, meeting_start_ms, text, sent_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(person.author_telegram_id, person.author_name, next.m.id, next.start, text, now).run();
    sent++;
  }
  if (missed.length && env.SAGA_OWNER_TELEGRAM_ID) await telegram.sendMessage(env.SAGA_OWNER_TELEGRAM_ID,
    `Jeg kunne ikke skrive privat til ${missed.join(", ")} om dagsordenen - de skal først åbne en chat med mig (skrive /start til mig i Telegram).`).catch(() => undefined);
  return sent;
}

/** The question she sent this person about a meeting that has not begun yet. */
async function openAsk(db: D1Database, telegramId: string, nowMs: number) {
  return db.prepare("SELECT member, meeting_id, text FROM agenda_asks WHERE telegram_id = ? AND meeting_start_ms > ? ORDER BY sent_at_ms DESC LIMIT 1")
    .bind(telegramId, nowMs).first<{ member: string; meeting_id: number; text: string }>().catch(() => null);
}

/** Admin's Markdown as Telegram's plain text: links as "text: url", no stars. */
export const plainForTelegram = (markdown: string) => markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s+/gm, "");

/** A board member writes to Saga privately: answered as in admin's chat, in their language. The chair's private chat stays his own (minutes,
 * summaries, questions) - except while her question about a coming meeting is open, when he answers it like everyone else. False when this is
 * not hers to answer here. */
export async function answerMemberPrivately(env: SagaEnv, deps: SagaDeps, db: D1Database, telegramId: string, text: string, replying = false): Promise<boolean> {
  const now = deps.now();
  const member = await memberByTelegram(env, db, telegramId);
  if (!member) return false;
  const ask = await openAsk(db, telegramId, now);
  // His replies to minutes and posts waiting for his approval stay his.
  if (env.SAGA_OWNER_TELEGRAM_ID && telegramId === env.SAGA_OWNER_TELEGRAM_ID && (!ask || replying)) return false;
  const telegram = telegramClient(env, deps);
  if (await stillOnBoard(env, deps, telegramId) === false) return true;
  const lang = await memberLang(db, member);
  if (!env.AI_API_KEY || !env.AI_MODEL || await questionsToday(db, now) >= DAILY_QUESTIONS) {
    await telegram.sendMessage(telegramId, lang === "en" ? "I cannot answer right now - please try again later, or add it in admin under Møder." : "Jeg kan ikke svare lige nu - prøv igen senere, eller skriv det i admin under Møder.").catch(() => undefined);
    return true;
  }
  // What she asked is the start of the conversation, so "Budget for the Christmas party" is read as a point for that meeting.
  const context: AskTurn[] = ask ? [{ role: "user", content: lang === "en" ? "(What you wrote to me privately in Telegram:)" : "(Det, du skrev til mig privat i Telegram:)" }, { role: "assistant", content: ask.text }] : [];
  const base = env.COCKPIT_URL ? env.COCKPIT_URL.replace(/\/+$/, "") : "";
  const answer = await askSagaMarkdown(env, deps, db, member, { question: text.slice(0, 1500), history: [], conversation: `tg-${telegramId}`, context }, base, lang)
    .catch(() => lang === "en" ? "I could not answer right now. Please try again in a moment." : "Jeg kunne ikke svare lige nu. Prøv igen om lidt.");
  await telegram.sendMessage(telegramId, plainForTelegram(answer)).catch(() => undefined);
  return true;
}

/** Requested: "Mødelederen skal have sendt den færdige dagsorden en halv time inden start på telegram." Half an hour before a team meeting the
 * leader gets the agenda as it stands then, privately, in their own language; with no leader picked (or one Saga cannot write to) the chair gets it. Once. */
export function leaderAgendaText(lang: Lang, member: string, m: Meeting, link: string, forLeader: boolean): string {
  const points = agendaPoints(m.agenda).map((p, i) => `${i + 1}. ${p}`).join("\n");
  const time = m.start_time ? m.start_time.replace(":", ".") : "";
  if (lang === "en") return `Hi ${first(member)} 🙂 ${forLeader ? "You are leading today's team meeting" : "Today's team meeting has no meeting leader yet"}${time ? ` at ${time}` : ""}${m.place ? ` (${m.place})` : ""}. Here is the final agenda:\n\n${points || "(no points)"}`
    + `${rolesLine(m) ? `\n\n${rolesLine(m)}` : ""}${link ? `\n\nOn the meeting's page: ${link}` : ""}`;
  return `Hej ${first(member)} 🙂 ${forLeader ? "Du er mødeleder på dagens teammøde" : "Dagens teammøde har ingen mødeleder endnu"}${time ? ` kl. ${time}` : ""}${m.place ? ` (${m.place})` : ""}. Her er den færdige dagsorden:\n\n${points || "(ingen punkter)"}`
    + `${rolesLine(m) ? `\n\n${rolesLine(m)}` : ""}${link ? `\n\nPå mødets side: ${link}` : ""}`;
}

export async function scheduledLeaderAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<boolean> {
  if (!env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return false;
  const now = deps.now();
  const next = (await meetings(db)).filter(m => m.kind === "team" && m.start_time && /^\d{2}:\d{2}$/.test(m.start_time)).map(m => ({ m, start: startOf(m) }))
    .filter(x => x.start - 30 * 60_000 <= now && now < x.start).sort((a, b) => a.start - b.start)[0];
  if (!next || !(await claim(`agenda_leader_${next.m.meeting_date}`, next.m.id))) return false;
  const people = (await db.prepare(`SELECT author_name, MAX(author_telegram_id) AS id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
    GROUP BY author_name`).bind(env.SAGA_BOARD_CHAT_ID).all<{ author_name: string; id: string }>()).results ?? [];
  const lower = (s: string) => s.trim().toLocaleLowerCase("da-DK");
  const leader = next.m.leader ? people.find(p => lower(p.author_name) === lower(next.m.leader!)) ?? people.find(p => lower(first(p.author_name)) === lower(first(next.m.leader!))) : undefined;
  const chair = env.SAGA_OWNER_TELEGRAM_ID ? people.find(p => p.id === env.SAGA_OWNER_TELEGRAM_ID) : undefined;
  const telegram = telegramClient(env, deps), link = env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}/moder/${next.m.id}#dagsorden` : "";
  if (leader) {
    const ok = await telegram.sendMessage(leader.id, leaderAgendaText(await memberLang(db, leader.author_name), leader.author_name, next.m, link, true)).then(() => true, () => false);
    if (ok) return true;
    if (env.SAGA_OWNER_TELEGRAM_ID && leader.id !== env.SAGA_OWNER_TELEGRAM_ID) await telegram.sendMessage(env.SAGA_OWNER_TELEGRAM_ID,
      `Jeg kunne ikke sende dagsordenen privat til ${first(leader.author_name)} (mødeleder) - de skal først skrive /start til mig i Telegram.`).catch(() => undefined);
  }
  if (!env.SAGA_OWNER_TELEGRAM_ID || (leader && leader.id === env.SAGA_OWNER_TELEGRAM_ID)) return false;
  const name = chair?.author_name ?? "Jacob";
  await telegram.sendMessage(env.SAGA_OWNER_TELEGRAM_ID, leaderAgendaText(await memberLang(db, name), name, next.m, link, Boolean(leader))).catch(() => undefined);
  return true;
}
