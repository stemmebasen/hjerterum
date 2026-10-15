import type { D1Database } from "../db.js";
import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { boardKnowledge } from "./ask.js";
import { isAssocMeeting } from "./assocEvents.js";
import { agendaClosed, agendaPoints, framedAgenda, meetings, type Meeting } from "./data.js";
import { copenhagenMs } from "./eventDesk.js";

/** Requested: "Hun skal selv prioritere hvad der virker til at haste mest på dagsordenen og hvad der kan vente til senere. Start altid med et
 * Velkommen punkt, samt slut med Evt." A day before a team meeting, and again three hours before it (with what came in since), Saga puts the
 * points between Velkommen and Evt. in order: what is most urgent first, what can wait last. Nothing is added or removed, and an agenda a member
 * has moved by hand since her last order is left in theirs (it still gets Velkommen and Evt.). One call to the middle model each time. */

const HOUR = 3_600_000;
const SYSTEM = "Du er Saga, assistent for bestyrelsen i foreningen Hjerterum. Du sætter punkterne på dagsordenen til et teammøde i rækkefølge efter, hvad der haster mest. "
  + "Først: det, der har en frist eller en dato snart, det, der skal afgøres, før andet kan komme videre, og det, der er udsat før. "
  + "Til sidst: orienteringer, idéer og det, der godt kan vente til et senere møde. Brug materialet nedenfor til at vurdere det. "
  + "Du må ikke tilføje, fjerne eller omformulere punkter. Svar KUN med JSON: {\"order\":[punkternes numre i den nye rækkefølge]} - hvert nummer præcis én gang.";

type Row = Meeting & { agenda_sorted_at_ms: number | null; agenda_moved_at_ms: number | null };

/** Puts one meeting's agenda in Saga's order. Returns whether the agenda changed. */
export async function prioritizeAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, id: number): Promise<boolean> {
  const now = deps.now();
  const m = await db.prepare("SELECT * FROM board_meetings WHERE id = ?").bind(id).first<Row>();
  if (!m) return false;
  const before = agendaPoints(m.agenda), framed = framedAgenda(before);
  const middle = framed.slice(1, -1);
  // Moved by hand since her last order (or before she ever ordered it): the member's order stands.
  const theirs = m.agenda_moved_at_ms !== null && m.agenda_moved_at_ms > (m.agenda_sorted_at_ms ?? 0);
  let ordered = middle;
  if (!theirs && middle.length > 1 && env.AI_API_KEY && env.AI_MODEL) {
    const question = `Dagsorden til teammødet ${m.meeting_date}:\n${middle.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
    // Reported: "Jeg kan ikke se, at velkommen og eventuelt er på endnu" - when the AI fails, the agenda still gets Velkommen and Evt.
    const answer = await completeAs("dagsorden-prioritet", "mid", 300)(env, deps, [{ role: "system", content: `${SYSTEM}\n\n${await boardKnowledge(env, deps, db, question, new Set())}` }, { role: "user", content: question }])
      .catch(error => { console.warn("cockpit_agenda_priority_failed", error instanceof Error ? error.message : error); return ""; });
    let order: unknown = null;
    try { order = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { order?: unknown } | null)?.order; } catch { order = null; }
    const picked = Array.isArray(order) ? [...new Set(order.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= middle.length))] : [];
    // What the answer left out keeps its place at the end - nothing is ever lost.
    if (picked.length) ordered = [...picked.map(n => middle[n - 1]!), ...middle.filter((_, i) => !picked.includes(i + 1))];
  }
  const agenda = [framed[0]!, ...ordered, framed[framed.length - 1]!];
  const changed = agenda.join("\n") !== before.join("\n");
  await db.prepare(`UPDATE board_meetings SET ${changed ? "agenda = ?, " : ""}agenda_sorted_at_ms = ? WHERE id = ?`).bind(...(changed ? [agenda.join("\n")] : []), theirs ? m.agenda_sorted_at_ms : now, id).run();
  return changed;
}

/** Every round, no AI: each coming team meeting's agenda has Velkommen first and Evt. last. Returns how many agendas were changed. */
export async function frameComingAgendas(db: D1Database, nowMs: number): Promise<number> {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nowMs);
  let changed = 0;
  for (const m of (await meetings(db)).filter(m => m.kind === "team" && m.meeting_date >= today && !agendaClosed(m, nowMs))) {
    const before = agendaPoints(m.agenda), agenda = framedAgenda(before);
    if (agenda.join("\n") === before.join("\n")) continue;
    await db.prepare("UPDATE board_meetings SET agenda = ? WHERE id = ?").bind(agenda.join("\n"), m.id).run();
    changed++;
  }
  return changed;
}

/** In Saga's round: the next team meeting within a day is put in order once at once, and once more from three hours before it. */
export async function scheduledAgendaPriority(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<boolean> {
  const now = deps.now();
  const next = (await meetings(db)).filter(m => m.kind === "team" || !isAssocMeeting(m))
    .map(m => ({ m, start: copenhagenMs(m.meeting_date, m.start_time && /^\d{2}:\d{2}$/.test(m.start_time) ? m.start_time : "12:00") }))
    .filter(x => x.start - 24 * HOUR <= now && now < x.start).sort((a, b) => a.start - b.start)[0];
  if (!next) return false;
  const round = now >= next.start - 3 * HOUR ? "sidste" : "foerste";
  if (!(await claim(`agenda_priority_${round}_${next.m.meeting_date}`, next.m.id))) return false;
  return prioritizeAgenda(env, deps, db, next.m.id);
}

