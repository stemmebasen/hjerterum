import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { boardKnowledge } from "./ask.js";
import { addAgendaPoints, boardPicture, meetings, nextTeamMeeting, type Meeting } from "./data.js";
import { proposals } from "./votes.js";

/** Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." Saga reads what
 * the board has - the minutes (postponed points, tasks to follow up), the open threads, the coming dates,
 * the group and team@ - and suggests the agenda for this meeting. Nothing is saved: the suggestion goes
 * into the agenda field, where the board edits it and presses Gem. */

const SYSTEM = "Du er Saga, assistent for bestyrelsen i foreningen Hjerterum. Foreslå dagsordenen til et bestyrelsesmøde ud fra materialet nedenfor. "
  + "Tag kun punkter med, der har grundlag i materialet: udsatte punkter, opfølgning på opgaver og beslutninger, hængepartier, kommende datoer og frister (fx generalforsamling), "
  + "og emner rejst i gruppen eller i mails til team@. "
  // Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde" and "Hvis næste møde forslår Saga det som punkt på næste dagsorden".
  + "Et afstemningsforslag, der er markeret ØNSKES DRØFTET PÅ ET MØDE, skal med som eget punkt (med forslagets titel og hvem der ønsker det drøftet). Et forslag, der er markeret AFSTEMNING PÅ NÆSTE MØDE, skal altid med som eget punkt (\"Afstemning: …\" med forslagets titel og hvem der har stillet det), så bestyrelsen kan stemme om det på mødet. Opfind intet. Start med \"Godkendelse af dagsorden\" og \"Godkendelse af referat fra sidste møde\", slut med \"Eventuelt\". "
  + "Højst 12 punkter, hvert en kort linje på dansk (gerne med hvem der fremlægger, når det står i materialet). "
  + 'Svar KUN med JSON: {"items":["...","..."]}.';

export async function suggestAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, meeting: Meeting): Promise<string[]> {
  const question = `Forslag til dagsorden til teammødet ${meeting.meeting_date}${meeting.agenda.trim() ? ` (allerede på dagsordenen: ${meeting.agenda.split("\n").join("; ")})` : ""}`;
  const answer = await complete(env, deps, [{ role: "system", content: `${SYSTEM}\n\n${await boardKnowledge(env, deps, db, question)}` }, { role: "user", content: question }]);
  let items: unknown = null;
  try { items = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { items?: unknown } | null)?.items; } catch { items = null; }
  if (!Array.isArray(items)) throw new Error("agenda_unreadable");
  const out = items.filter((x): x is string => typeof x === "string").map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 12);
  return withMeetingProposals(out, (await proposals(db, deps.now()).catch(() => [])).filter(p => p.status === "open" && p.mode === "moede"));
}

/** Requested: "Hvis næste møde forslår Saga det som punkt på næste dagsorden": a proposal to be voted on at the next meeting is on the suggestion, whatever
 * the model made of it - added before "Eventuelt" when it is not there already (the cap of 12 yields to it). */
export function withMeetingProposals(items: string[], forMeeting: Array<{ title: string; created_by: string }>): string[] {
  const key = (text: string) => text.toLowerCase().replace(/\s+/g, " ");
  const missing = forMeeting.filter(p => !items.some(i => key(i).includes(key(p.title))));
  if (!missing.length) return items;
  const last = items.length && /^eventuelt\b/i.test(items[items.length - 1]!) ? items.pop()! : null;
  const added = missing.map(p => `Afstemning: ${p.title} (stillet af ${p.created_by.split(/\s+/)[0]})`.slice(0, 200));
  return [...items.slice(0, Math.max(0, 12 - added.length - (last ? 1 : 0))), ...added, ...(last ? [last] : [])];
}

/** Requested: "Seriens [Sagas] forslag til næste teammøde skal fremgå, når man kommer ind på siden. Disse forslag skal genereres én gang i døgnet." Saga's points for the next team meeting: her own suggestion
 * from the minutes document (no AI) and what she makes of the material (one AI call), put on the agenda as her points - once a day, from five in the morning, for the next meeting that is said to be a
 * team meeting, and never for another. A point deleted with the cross is gone (it takes no AI call) and may come again in a later suggestion - that is the point of a fresh one every day. Returns how many points were added. */
export async function scheduledAgendaSuggestion(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<number> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return 0;
  const now = deps.now();
  if (Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", hourCycle: "h23" }).format(now)) < 5) return 0;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
  const next = nextTeamMeeting(await meetings(db), today);
  if (!next || !(await claim(`cockpit_agenda_suggest_${next.id}`, Math.floor(now / 86_400_000)))) return 0;
  return suggestForTeamMeeting(env, deps, db, next);
}

/** The points for one team meeting: the document's suggestion, then the AI's - the second is left out when it fails, the first still stands. */
export async function suggestForTeamMeeting(env: SagaEnv, deps: SagaDeps, db: D1Database, meeting: Meeting): Promise<number> {
  const now = deps.now();
  let added = await addAgendaPoints(db, meeting.id, (await boardPicture(db, now)).picture?.document.nextAgenda ?? [], "Saga", now, true);
  const fresh = await db.prepare("SELECT agenda FROM board_meetings WHERE id = ?").bind(meeting.id).first<{ agenda: string }>();
  added += await addAgendaPoints(db, meeting.id, await suggestAgenda(env, deps, db, { ...meeting, agenda: fresh?.agenda ?? meeting.agenda }), "Saga", now, true);
  return added;
}
