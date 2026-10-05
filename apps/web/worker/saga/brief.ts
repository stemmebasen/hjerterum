import type { D1Database } from "../db.js";
import { awaitingVote } from "../cockpit/votes.js";
import { boardMembers, unsignedFor } from "../cockpit/data.js";
import { latestBoardNow } from "../cockpit/boardNow.js";
import { reviewCount } from "../cockpit/eventDesk.js";
import type { SagaEnv } from "./env.js";
import { mailWatch } from "./connections.js";
import { pendingForOwner, serviceStatus } from "./store.js";

/** Requested: "Byg en brief til Matrix' startside (Jacobs eget system). Matrix henter den mandag-fredag kl. 09, 12 og 16
 * dansk tid og ved tryk på Opdatér. Svar inden 20 sekunder." GET /api/saga/liva/brief (handler.ts, the same bearer secret
 * as the other /api/saga/liva/* calls).
 * What the chair must do or should soon: approvals, votes, minutes to sign, meetings, recordings that stalled, events
 * waiting for the board, and Saga's own connections - and her short mood line. Only what Hjerterum's own system can see;
 * nothing is made up, and a quiet day is an empty list. The chair's own tasks are not repeated: they are on Matrix' list
 * already (/api/saga/liva/chair-tasks). team@ is only ever counted (the chair does not handle it: no sender or subject). */

export type BriefAction = { kind: "open" | "write" | "run"; label: string; target?: string; prompt?: string };
export type BriefItem = { weight: "must" | "should" | "fyi"; text: string; why?: string; action?: BriefAction };
export type Brief = { at: string; lead?: string; items: BriefItem[] };

export const BRIEF_MAX_ITEMS = 10;
const DAY = 86_400_000;
/** One part that is slow or fails must not take the whole brief with it. */
const PART_TIMEOUT_MS = 8_000;

const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
const WORDS = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", timeZone: "UTC" });
/** "torsdag den 22. oktober" */
const dayWords = (iso: string) => WORDS.format(new Date(`${iso}T12:00:00Z`)).replace(/^(\S+) /, "$1 den ");
const dayShort = (iso: string) => SHORT.format(new Date(`${iso}T12:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cut at a word with an ellipsis, so a long title never breaks the limits. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,;:–-]+$/, "")}…`;
}

/** The brief never names Matrix (the reader is in it): a sentence that does is left out. */
const noMatrix = (text: string) => text.split(/(?<=[.!?])\s+/).filter(sentence => !/matrix/i.test(sentence)).join(" ");

const WEIGHT: Record<BriefItem["weight"], number> = { must: 0, should: 1, fyi: 2 };

function item(weight: BriefItem["weight"], text: string, options: { why?: string | undefined; action?: BriefAction | undefined } = {}): BriefItem {
  const out: BriefItem = { weight, text: clip(text, 240) };
  if (options.why) out.why = clip(options.why, 200);
  if (options.action) {
    const { kind, label, target, prompt } = options.action;
    out.action = { kind, label: clip(label, 40), ...(kind === "open" && target ? { target } : {}), ...(kind !== "open" && prompt ? { prompt: clip(prompt, 600) } : {}) };
  }
  return out;
}
const open = (label: string, target: string): BriefAction => ({ kind: "open", label, target });

async function part<T>(failed: string[], name: string, work: () => Promise<T> | T, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A thunk, so that even a throw while the query is being built is caught here and not lost.
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), PART_TIMEOUT_MS); })]);
  } catch (error) {
    console.warn("saga_brief_part_failed", name, error instanceof Error ? error.message : error);
    failed.push(name);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** The mood line: Saga's own short summary of what is going on (board_now), when it is no older than a day and a half. */
function lead(now: { text: string; at: number } | null, nowMs: number): string | undefined {
  if (!now || nowMs - now.at > 36 * 3_600_000) return undefined;
  const sentences = noMatrix(now.text.replace(/^[\s*•-]+/gm, "").replace(/\s+/g, " ").trim()).split(/(?<=[.!?])\s+/).filter(Boolean);
  const text = clip(sentences.slice(0, 2).join(" "), 300);
  return text || undefined;
}

export async function sagaBrief(env: SagaEnv, db: D1Database, nowMs: number): Promise<Brief> {
  const today = copenhagenDay(nowMs);
  const failed: string[] = [];
  const { chair } = await part(failed, "bestyrelsen", () => boardMembers(env, db), { names: [] as string[], chair: null as string | null });

  const [pending, votes, unsigned, mail, meetings, stuck, events, watch, ai, now] = await Promise.all([
    part(failed, "godkendelser", () => pendingForOwner(db), { posts: [], minutes: [] } as Awaited<ReturnType<typeof pendingForOwner>>),
    part(failed, "afstemninger", () => awaitingVote(db, chair, nowMs), []),
    part(failed, "referater til godkendelse", () => chair ? unsignedFor(db, chair, nowMs) : [], []),
    part(failed, "team@", () => db.prepare(`SELECT COUNT(*) AS n, MIN(received_at_ms) AS oldest FROM board_mail WHERE enquiry_kind IS NOT NULL AND handled_at_ms IS NULL
      AND answered_at_ms IS NULL AND received_at_ms >= ? AND received_at_ms <= ?`).bind(nowMs - 90 * DAY, nowMs - 3 * DAY).first<{ n: number; oldest: number | null }>(), null),
    part(failed, "møder", () => Promise.all([
      db.prepare("SELECT id, meeting_date, start_time, agenda FROM board_meetings WHERE meeting_date >= ? ORDER BY meeting_date, id DESC LIMIT 1").bind(today)
        .first<{ id: number; meeting_date: string; start_time: string | null; agenda: string }>(),
      db.prepare(`SELECT m.id, m.meeting_date FROM board_meetings m WHERE m.meeting_date < ? AND m.meeting_date >= ? AND NOT EXISTS (SELECT 1 FROM board_minutes b WHERE b.meeting_date = m.meeting_date
        AND b.status IN ('queued', 'transcribing', 'drafted', 'approved')) ORDER BY m.meeting_date DESC LIMIT 1`).bind(today, addDays(today, -21)).first<{ id: number; meeting_date: string }>()
    ]), [null, null] as const),
    part(failed, "optagelser", () => Promise.all([
      db.prepare("SELECT meeting_date, updated_at_ms FROM board_minutes WHERE status = 'failed' AND updated_at_ms >= ? ORDER BY updated_at_ms DESC LIMIT 1").bind(nowMs - 14 * DAY)
        .first<{ meeting_date: string | null; updated_at_ms: number }>(),
      db.prepare("SELECT meeting_date, updated_at_ms FROM board_minutes WHERE status IN ('queued', 'transcribing') AND updated_at_ms < ? AND updated_at_ms >= ? ORDER BY updated_at_ms LIMIT 1")
        .bind(nowMs - 2 * 3_600_000, nowMs - 7 * DAY).first<{ meeting_date: string | null; updated_at_ms: number }>()
    ]), [null, null] as const),
    part(failed, "events", () => Promise.all([reviewCount(db, nowMs),
      db.prepare("SELECT MIN(starts_at_ms) AS first FROM room_bookings WHERE status = 'scheduled' AND review_status IN ('pending', 'needs_board') AND ends_at_ms > ?").bind(nowMs).first<{ first: number | null }>()
    ]), [0, null] as const),
    part(failed, "team@-forbindelsen", () => mailWatch(db, nowMs), { state: "unknown", detail: "" } as Awaited<ReturnType<typeof mailWatch>>),
    part(failed, "Sagas AI", () => serviceStatus(db, "ai"), null),
    part(failed, "stemningen", () => latestBoardNow(db), null)
  ]);

  const items: BriefItem[] = [];

  // Approvals: the chair's yes is what lets minutes and posts go on.
  for (const m of pending.minutes.slice(0, 3)) {
    const waiting = Math.floor((nowMs - m.updated_at_ms) / DAY);
    items.push(item("must", `Referatet${m.meeting_date ? ` fra ${dayShort(m.meeting_date)}` : ""} venter på dit ja`,
      { why: `Saga har skrevet det ud fra optagelsen${waiting >= 1 ? `, og det har ventet i ${plural(waiting, "dag", "dage")}` : ""}. Det går først videre, når du godkender.`, action: open("Åbn Hjerterum", "hjerterum") }));
  }
  if (pending.posts.length) {
    items.push(item("must", pending.posts.length === 1 ? "Et opslag til bestyrelsens gruppe venter på dit ja" : `${pending.posts.length} opslag til bestyrelsens gruppe venter på dit ja`,
      { why: "Saga skriver ikke i gruppen uden din godkendelse.", action: open("Åbn Hjerterum", "hjerterum") }));
  }

  // Votes the chair has not yet cast.
  for (const p of votes.slice(0, 3)) {
    const day = copenhagenDay(p.deadline_ms), left = daysBetween(today, day);
    items.push(item(left <= 3 ? "must" : "should", `Afstemning: «${clip(p.title, 90)}» - frist ${left <= 0 ? "i dag" : left === 1 ? "i morgen" : dayWords(day)}`,
      { why: `${p.created_by} har stillet forslaget. Din stemme mangler.`, action: open("Afgiv din stemme", "cockpit:beslutninger") }));
  }

  // Minutes the chair has not yet signed off.
  if (unsigned.length) {
    const first = unsigned[0]!;
    const age = Math.floor((nowMs - first.created_at_ms) / DAY);
    items.push(item(age <= 14 ? "must" : "should", unsigned.length === 1 ? `Godkend referatet${first.meeting_date ? ` fra ${dayShort(first.meeting_date)}` : ""}` : `Godkend ${unsigned.length} referater`,
      { why: `Du er ikke blandt dem, der har godkendt ${unsigned.length === 1 ? "det" : "dem"} endnu.`, action: open("Læs og godkend", `cockpit:referat/${first.id}`) }));
  }

  // The next meeting: no agenda close to it is a thing to do; otherwise it is good to know.
  const [next, held] = meetings;
  if (next) {
    const left = daysBetween(today, next.meeting_date), agenda = next.agenda.split("\n").filter(line => line.trim()).length;
    const when = `${dayWords(next.meeting_date)}${next.start_time ? ` kl. ${next.start_time}` : ""}`;
    if (left <= 3 && !agenda) {
      items.push(item("should", `Mødet ${when} har ingen dagsorden`, { why: "Dagsordenen skal helst være sendt ud, før I mødes.",
        action: { kind: "write", label: "Foreslå dagsorden", prompt: `Foreslå en dagsorden til bestyrelsesmødet ${dayWords(next.meeting_date)}, ud fra det seneste referat og det, der er åbent.` } }));
    } else if (left <= 7) {
      items.push(item("fyi", `Næste bestyrelsesmøde: ${when}${agenda ? `, ${plural(agenda, "punkt", "punkter")} på dagsordenen` : ""}`, { action: open("Se mødet", `cockpit:moder/${next.id}`) }));
    }
  }
  if (held) {
    items.push(item("should", `Saga har ikke set noget referat eller nogen optagelse fra mødet ${dayShort(held.meeting_date)}`,
      { why: "Mødet står i kalenderen, men hverken en optagelse eller et referat er registreret.", action: open("Åbn møderne", `cockpit:moder/${held.id}`) }));
  }

  // Recordings that did not become minutes.
  const [failedRecording, stalledRecording] = stuck;
  if (failedRecording) {
    items.push(item("should", `Optagelsen${failedRecording.meeting_date ? ` fra ${dayShort(failedRecording.meeting_date)}` : ""} blev ikke til et referat`,
      { why: "Saga kunne ikke lave referatet. Prøv at lægge optagelsen op igen.", action: open("Åbn møderne", "cockpit:moder") }));
  } else if (stalledRecording) {
    items.push(item("should", `En optagelse${stalledRecording.meeting_date ? ` fra ${dayShort(stalledRecording.meeting_date)}` : ""} er gået i stå`,
      { why: `Den har ligget i behandling siden ${dayShort(copenhagenDay(stalledRecording.updated_at_ms))} uden at blive til et referat.`, action: open("Åbn møderne", "cockpit:moder") }));
  }

  // Important mails in team@ that have waited: only a count.
  if (mail && mail.n > 0 && mail.oldest) {
    const days = Math.floor((nowMs - mail.oldest) / DAY);
    items.push(item("should", `${plural(mail.n, "vigtig mail", "vigtige mails")} i team@ har ventet på svar i mere end tre dage`,
      { why: `Den ældste har ventet i ${plural(days, "dag", "dage")}. Hjerterum lover svar inden for 3-5 hverdage.`, action: open("Åbn posthuset", "cockpit:posthus") }));
  }

  // Member events waiting for the board's yes.
  const [reviews, firstReview] = events;
  if (reviews > 0) {
    const first = firstReview?.first ? copenhagenDay(firstReview.first) : null;
    items.push(item(first && daysBetween(today, first) <= 3 ? "must" : "should", `${plural(reviews, "medlems-event", "medlems-events")} venter på bestyrelsens godkendelse`,
      { why: first ? `Det første finder sted ${dayWords(first)}.` : undefined, action: open("Se events", "cockpit:arrangementer") }));
  }

  // Saga's own connections, as far as can be seen without calling out: a stopped mail watch, an AI that answers with errors.
  if (watch.state === "stale" || watch.state === "error") {
    items.push(item("should", watch.detail, { why: "Imens kan nye mails til team@ ikke blive vurderet.", action: open("Åbn posthuset", "cockpit:posthus") }));
  }
  if (ai && !ai.ok && nowMs - ai.at_ms < 3 * DAY) {
    items.push(item("should", "Sagas AI svarede med en fejl ved sidste forsøg", { why: "Så kan hun hverken vurdere mails eller skrive overblik.", action: open("Åbn Hjerterum", "hjerterum") }));
  }

  if (failed.length) items.push(item("fyi", `Saga kunne ikke læse ${[...new Set(failed)].slice(0, 3).join(", ")} lige nu, så listen kan mangle punkter`));

  items.sort((a, b) => WEIGHT[a.weight] - WEIGHT[b.weight]);
  const mood = lead(now, nowMs);
  const brief: Brief = { at: new Date(nowMs).toISOString(), items: items.slice(0, BRIEF_MAX_ITEMS) };
  const line = mood ?? (items.length ? undefined : "Intet, der kræver dig.");
  if (line) brief.lead = line;
  return brief;
}
