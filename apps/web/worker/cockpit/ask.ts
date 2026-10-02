import type { D1Database } from "../db.js";
import { complete, type ChatMessage } from "../saga/ai.js";
import { minutesDocText } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { trimMinutesDoc } from "../saga/picture.js";
import { COCKPIT_SYSTEM } from "../saga/prompts.js";
import { recentBoardMessages } from "../saga/store.js";
import { parseMembershipWorksRss } from "../external-events.js";
import { comingEvents, EVENTS_FEED, eventStats, searchEvents, type HouseEvent } from "./events.js";
import { allDecisions, approvedMinutes, boardPicture, meetingOn, meetings, saveMeeting } from "./data.js";
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

const STOP = new Set(["hvad", "hvem", "hvor", "hvornår", "hvilke", "hvilken", "hvilket", "hvordan", "hvorfor", "mange", "nogle", "noget", "nogen", "havde", "haft", "have", "har", "været",
  "være", "sidst", "sidste", "næste", "kommende", "arrangement", "arrangementer", "event", "events", "begivenhed", "begivenheder", "afholdt", "holdt", "huset", "hjerterum", "eller",
  "også", "med", "fra", "efter", "inden", "før", "over", "under", "mellem", "omkring", "gang", "gange", "første", "ofte", "kan", "skal", "vil", "der", "det", "den", "dem", "deres",
  "jeg", "vi", "vores", "dig", "din", "saga", "undervist", "underviste", "underviser", "undervisere", "uger", "uge", "måned", "måneder", "året", "år", "dage", "dag"]);
const DATE = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric" });
const eventLine = (e: HouseEvent) => `- ${DATE.format(e.starts_at_ms)}: ${e.title}${e.host ? ` (${e.host})` : ""}${e.category ? ` [${e.category}]` : ""}${e.removed_at_ms ? " - fjernet fra kalenderen" : ""}`;

/** The house's events for Saga: what is coming, the numbers since 2019, and the archive's events that
 * match the question's words (and year) - the whole history is too long to send every time. */
async function events(db: D1Database, deps: SagaDeps, nowMs: number, question: string): Promise<string> {
  const year = Number(/\b(20[12]\d)\b/.exec(question)?.[1] ?? 0) || null;
  const words = (question.toLocaleLowerCase("da-DK").match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(w => !STOP.has(w) && !/^20[12]\d$/.test(w)).slice(0, 5);
  const [coming, stats, rooms] = await Promise.all([comingEvents(db, nowMs, 60, 60).catch(() => []), eventStats(db, nowMs).catch(() => null),
    db.prepare("SELECT title, teacher_name, starts_at_ms FROM room_bookings WHERE starts_at_ms >= ? AND starts_at_ms < ? ORDER BY starts_at_ms LIMIT 60")
      .bind(nowMs - DAY, nowMs + 60 * DAY).all<{ title: string; teacher_name: string; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => [])]);
  const found = new Map<string, HouseEvent>();
  for (const word of words) for (const e of await searchEvents(db, word, { year, limit: 30 }).catch(() => [])) found.set(e.id, e);
  if (year && !words.length) for (const e of await searchEvents(db, "", { year, limit: 80 }).catch(() => [])) found.set(e.id, e);
  // Before the archive is filled, the coming events come straight from the calendar.
  const live = coming.length ? [] : await deps.fetcher(EVENTS_FEED, { headers: { accept: "application/rss+xml, application/xml" }, signal: AbortSignal.timeout(5000) })
    .then(async response => response.ok ? parseMembershipWorksRss(await response.text()) : []).catch(() => []);
  const parts = [
    stats?.total ? `Antal i alt siden ${stats.first ? new Date(stats.first).getUTCFullYear() : "2019"}: ${stats.total}. Pr. år: ${stats.byYear.map(b => `${b.year}: ${b.n}`).join(", ")}.`
      + `${stats.hosts.length ? ` Mest aktive det seneste år: ${stats.hosts.map(h => `${h.host} (${h.n})`).join(", ")}.` : ""} Kategorier: ${stats.categories.map(c => `${c.category} (${c.n})`).join(", ")}.` : "",
    `KOMMENDE (60 dage):\n${[...coming.map(eventLine), ...live.filter(e => Date.parse(e.startsAt) < nowMs + 60 * DAY).slice(0, 60).map(e => `- ${DATE.format(Date.parse(e.startsAt))}: ${e.title}`),
      ...rooms.map(r => `- ${DATE.format(r.starts_at_ms)}: ${r.title} (lokale booket af ${r.teacher_name})`)].join("\n") || "(ingen)"}`,
    found.size ? `FUNDET I ARKIVET (${words.join(", ")}${year ? `, ${year}` : ""}; højst 30 pr. ord, nyeste først):\n${[...found.values()].sort((a, b) => b.starts_at_ms - a.starts_at_ms).slice(0, 120).map(eventLine).join("\n")}` : ""
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Requested: "Sørg for at Saga har indsigt i al materiale tilgængeligt". Everything Saga knows about
 * the board, for the question asked - in the cockpit and when the chair asks her in Telegram. */
export async function boardKnowledge(env: SagaEnv, deps: SagaDeps, db: D1Database, question: string): Promise<string> {
  const now = deps.now();
  const [minutes, { picture }, list, chat, members, house, doc] = await Promise.all([approvedMinutes(db, 40), boardPicture(db, now), meetings(db),
    env.SAGA_BOARD_CHAT_ID ? recentBoardMessages(db, env.SAGA_BOARD_CHAT_ID, now - 60 * DAY, 400) : Promise.resolve([]), memberNumbers(db), events(db, deps, now, question),
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
    `ARRANGEMENTER I HUSET (Hjerterums kalender på holistisk.org):\n${house}`,
    `GODKENDTE REFERATER, nyeste først - det første er den gældende sandhed:\n${minutes.slice(0, 8).map((m, i) => `--- ${i === 0 ? "NYESTE REFERAT (gældende)" : "Referat"} ${m.meeting_date ?? ""} ---\n${m.draft_markdown ?? ""}`).join("\n\n") || "(ingen)"}`,
    doc ? `BESTYRELSENS REFERATDOKUMENT:\n${doc}` : "",
    `BESTYRELSENS CHAT (seneste 60 dage):\n${chat.map(m => `[${time(m.sent_at_ms)}] ${m.author_name}: ${m.text}`).join("\n") || "(ingen beskeder)"}`
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Saga's answer as HTML (escaped by the Markdown renderer), and the question kept for the daily limit. */
export async function askSaga(env: SagaEnv, deps: SagaDeps, db: D1Database, who: string | null, input: { question: string; history: AskTurn[] }, base = ""): Promise<string> {
  const messages: ChatMessage[] = [{ role: "system", content: `${COCKPIT_SYSTEM}\n\n${await boardKnowledge(env, deps, db, [...input.history.filter(t => t.role === "user").map(t => t.content), input.question].join(" "))}` }, ...input.history, { role: "user", content: `${who ? `${who} spørger` : "Spørgsmål"}: ${input.question}` }];
  const now = deps.now();
  const answer = await applyMeeting(db, await complete(env, deps, messages), who, now, base);
  await db.prepare("INSERT INTO cockpit_questions (asked_by, question, answer, created_at_ms) VALUES (?, ?, ?, ?)").bind(who, input.question, answer.slice(0, 8000), now).run();
  await db.prepare("DELETE FROM cockpit_questions WHERE created_at_ms < ?").bind(now - 90 * DAY).run();
  return /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(answer))?.[1] ?? "";
}

/** Requested: "Sæt næste møde til torsdag d. 15. oktober kl. 13.30" - "Hun skal blot gøre hvad jeg siger."
 * Saga's [[MØDE ...]] line becomes the meeting in the cockpit's calendar (a move takes the old date's
 * meeting along, agenda and all), and the line becomes a confirmation with a link. */
const DANISH_DATE = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export async function applyMeeting(db: D1Database, answer: string, who: string | null, nowMs: number, base = ""): Promise<string> {
  const line = /\[\[MØDE\s+([^\]]*)\]\]/i.exec(answer);
  if (!line) return answer;
  const field = (name: string) => new RegExp(`${name}=(.+?)(?=\\s+(?:dato|tid|sted|fra)=|$)`, "i").exec(line[1]!)?.[1]?.trim() ?? "";
  const date = field("dato"), time = field("tid").replace(".", ":"), place = field("sted").slice(0, 200), from = field("fra");
  const text = answer.replace(line[0], "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return text;
  const existing = (/^\d{4}-\d{2}-\d{2}$/.test(from) ? await meetingOn(db, from) : null) ?? await meetingOn(db, date);
  const id = await saveMeeting(db, { date, time: /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0") : existing?.start_time ?? "",
    place: place || existing?.place || "", agenda: existing?.agenda ?? "" }, who ?? "Saga", nowMs, existing?.id);
  const day = DANISH_DATE.format(new Date(`${date}T12:00:00Z`));
  const what = !existing ? "Sat i kalenderen:" : existing.meeting_date !== date ? "Mødet er flyttet til" : "Mødet er opdateret:";
  return `${text}\n\n✓ ${what} ${day}${time ? ` kl. ${time}` : ""}${place ? `, ${place}` : ""} - [se mødet](${base}/moder/${id})`;
}
