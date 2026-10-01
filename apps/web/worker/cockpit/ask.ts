import type { D1Database } from "../db.js";
import { complete, type ChatMessage } from "../saga/ai.js";
import { minutesDocText } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { trimMinutesDoc } from "../saga/picture.js";
import { COCKPIT_SYSTEM } from "../saga/prompts.js";
import { recentBoardMessages } from "../saga/store.js";
import { parseMembershipWorksRss } from "../external-events.js";
import { allDecisions, approvedMinutes, boardPicture, meetings } from "./data.js";
import { STATUTES } from "./statutes.js";

/** Requested: "Saga skal også være tilgængelig i chat (højre bund), så man kan spørge hende om alt fra
 * vedtægter, beslutninger, sager, events og medlemmer". A board member asks in the cockpit and gets
 * the answer there, only to themselves. Saga answers from what the board already has: the statutes,
 * the approved minutes and the minutes document, the decisions, meetings and agendas, her picture of
 * the board, its Telegram group, the house's events, and the member numbers - never a single
 * member's name or contact details, and never team@'s mail or drafts waiting for the chair. */

export const DAILY_QUESTIONS = 100;
const DAY = 86_400_000;
const time = (ms: number) => new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);

export type AskTurn = { role: "user" | "assistant"; content: string };

/** The conversation as the page sends it: at most the last six turns, each cut to 2000 characters. */
export function askInput(body: unknown): { question: string; history: AskTurn[] } | null {
  const data = body && typeof body === "object" ? body as { question?: unknown; history?: unknown } : {};
  const question = typeof data.question === "string" ? data.question.trim().slice(0, 1500) : "";
  if (!question) return null;
  const history = (Array.isArray(data.history) ? data.history : []).slice(-6)
    .map(turn => turn as { role?: unknown; content?: unknown })
    .filter(turn => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim())
    .map(turn => ({ role: turn.role as AskTurn["role"], content: String(turn.content).slice(0, 2000) }));
  return { question, history };
}

export async function questionsToday(db: D1Database, nowMs: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM cockpit_questions WHERE created_at_ms >= ?").bind(nowMs - DAY).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Member numbers only: how many by status, from the platform and from MembershipWorks. */
async function memberNumbers(db: D1Database): Promise<string> {
  const [own, imported] = await Promise.all([
    db.prepare("SELECT status, tier, COUNT(*) AS n FROM members GROUP BY status, tier ORDER BY n DESC").all<{ status: string; tier: string; n: number }>().catch(() => null),
    db.prepare("SELECT status, COALESCE(membership_level, '') AS level, COUNT(*) AS n FROM external_memberships GROUP BY status, level ORDER BY n DESC").all<{ status: string; level: string; n: number }>().catch(() => null)
  ]);
  const lines = [...(own?.results ?? []).map(r => `- Hjerterums platform: ${r.n} med status ${r.status} (${r.tier})`),
    ...(imported?.results ?? []).map(r => `- MembershipWorks: ${r.n} med status ${r.status}${r.level ? ` (${r.level})` : ""}`)];
  return lines.length ? lines.join("\n") : "(ingen medlemstal)";
}

/** The house's events: the public MembershipWorks calendar and the rooms booked by teachers, the next 60 days. */
async function events(db: D1Database, deps: SagaDeps, nowMs: number): Promise<string> {
  const [feed, rooms] = await Promise.all([
    deps.fetcher("https://api.membershipworks.com/v2/events?_op=rss&org=22308", { headers: { accept: "application/rss+xml, application/xml" }, signal: AbortSignal.timeout(5000) })
      .then(async response => response.ok ? parseMembershipWorksRss(await response.text()) : []).catch(() => []),
    db.prepare("SELECT title, teacher_name, starts_at_ms FROM room_bookings WHERE starts_at_ms >= ? AND starts_at_ms < ? ORDER BY starts_at_ms LIMIT 60")
      .bind(nowMs - DAY, nowMs + 60 * DAY).all<{ title: string; teacher_name: string; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => [])
  ]);
  const upcoming = feed.filter(e => { const at = Date.parse(e.startsAt); return at >= nowMs - DAY && at < nowMs + 60 * DAY; }).slice(0, 60);
  return [...upcoming.map(e => `- ${time(Date.parse(e.startsAt))}: ${e.title}${e.host ? ` (${e.host})` : ""}${e.location ? `, ${e.location}` : ""}`),
    ...rooms.map(r => `- ${time(r.starts_at_ms)}: ${r.title} (lokale booket af ${r.teacher_name})`)].join("\n") || "(ingen kommende arrangementer fundet)";
}

async function context(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<string> {
  const now = deps.now();
  const [minutes, { picture }, list, chat, members, house, doc] = await Promise.all([approvedMinutes(db, 40), boardPicture(db, now), meetings(db),
    env.SAGA_BOARD_CHAT_ID ? recentBoardMessages(db, env.SAGA_BOARD_CHAT_ID, now - 60 * DAY, 400) : Promise.resolve([]), memberNumbers(db), events(db, deps, now),
    env.GOOGLE_MINUTES_DOC_ID ? minutesDocText(env, deps).then(text => trimMinutesDoc(text.trim(), 25_000)).catch(() => "") : Promise.resolve("")]);
  const d = picture?.document;
  const parts = [
    `I DAG: ${new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}`,
    `VEDTÆGTER:\n${STATUTES}`,
    `BESLUTNINGER (nyeste først):\n${allDecisions(minutes, picture).slice(0, 60).map(x => `- ${x.date ? `${x.date}: ` : ""}${x.topic ? `${x.topic}: ` : ""}${x.text}`).join("\n") || "(ingen)"}`,
    `MØDER OG DAGSORDENER:\n${list.slice(0, 20).map(m => `- ${m.meeting_date}${m.start_time ? ` kl. ${m.start_time}` : ""}${m.place ? `, ${m.place}` : ""}: ${m.agenda.split("\n").join("; ") || "ingen dagsorden"}`).join("\n") || "(ingen i cockpittet)"}`,
    d ? `SAGER OG STATUS (Sagas overblik):\n${[...d.openThreads.map(t => `- Hængeparti (${t.status}, siden ${t.since}): ${t.text}`), ...d.tasks.map(t => `- Opgave: ${t.who} - ${t.what}${t.due ? ` - ${t.due}` : ""}`),
      ...d.proposals.map(p => `- Forslag${p.by ? ` fra ${p.by}` : ""}: ${p.text}`), ...d.dates.map(x => `- Dato ${x.date}: ${x.what}`), ...d.figures.map(f => `- Nøgletal ${f.label}: ${f.value}${f.date ? ` (${f.date})` : ""}`),
      ...(picture?.topics ?? []).map(t => `- Emne i gruppen (${t.status}): ${t.title}${t.note ? ` - ${t.note}` : ""}`)].join("\n")}` : "",
    `MEDLEMSTAL:\n${members}`,
    `ARRANGEMENTER I HUSET:\n${house}`,
    `GODKENDTE REFERATER:\n${minutes.slice(0, 5).map(m => `--- Referat ${m.meeting_date ?? ""} ---\n${m.draft_markdown ?? ""}`).join("\n\n") || "(ingen)"}`,
    doc ? `BESTYRELSENS REFERATDOKUMENT:\n${doc}` : "",
    `BESTYRELSENS CHAT (seneste 60 dage):\n${chat.map(m => `[${time(m.sent_at_ms)}] ${m.author_name}: ${m.text}`).join("\n") || "(ingen beskeder)"}`
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Saga's answer as HTML (escaped by the Markdown renderer), and the question kept for the daily limit. */
export async function askSaga(env: SagaEnv, deps: SagaDeps, db: D1Database, who: string | null, input: { question: string; history: AskTurn[] }): Promise<string> {
  const messages: ChatMessage[] = [{ role: "system", content: `${COCKPIT_SYSTEM}\n\n${await context(env, deps, db)}` }, ...input.history, { role: "user", content: `${who ? `${who} spørger` : "Spørgsmål"}: ${input.question}` }];
  const answer = await complete(env, deps, messages);
  const now = deps.now();
  await db.prepare("INSERT INTO cockpit_questions (asked_by, question, answer, created_at_ms) VALUES (?, ?, ?, ?)").bind(who, input.question, answer.slice(0, 8000), now).run();
  await db.prepare("DELETE FROM cockpit_questions WHERE created_at_ms < ?").bind(now - 90 * DAY).run();
  return /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(answer))?.[1] ?? "";
}
