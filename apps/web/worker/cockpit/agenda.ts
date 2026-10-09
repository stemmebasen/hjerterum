import type { D1Database } from "../db.js";
import { completeAs } from "../saga/ai.js";
import { postsToBoard, SAGA_NAME, type SagaDeps, type SagaEnv } from "../saga/env.js";
import { saveBoardMessage } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";
import { boardKnowledge } from "./ask.js";
import { addAgendaPoints, agendaPoints, boardPicture, meetings, nextTeamMeeting, rolesLine, SAGA_POINTS, sagaRoom, type Meeting } from "./data.js";
import { translateTexts } from "./translate.js";
import { proposals } from "./votes.js";

/** Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." Saga reads what
 * the board has - the minutes (postponed points, tasks to follow up), the open threads, the coming dates,
 * the group and team@ - and suggests the agenda for this meeting. Nothing is saved: the suggestion goes
 * into the agenda field, where the board edits it and presses Gem. */

const system = (limit: number) => "Du er Saga, assistent for bestyrelsen i foreningen Hjerterum. Foreslå dagsordenen til et bestyrelsesmøde ud fra materialet nedenfor. "
  + "Tag kun punkter med, der har grundlag i materialet: udsatte punkter, opfølgning på opgaver og beslutninger, hængepartier, kommende datoer og frister (fx generalforsamling), "
  + "og emner rejst i gruppen eller i mails til team@. "
  // Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde" and "Hvis næste møde forslår Saga det som punkt på næste dagsorden".
  + "Et afstemningsforslag, der er markeret ØNSKES DRØFTET PÅ ET MØDE, skal med som eget punkt (med forslagets titel og hvem der ønsker det drøftet). Et forslag, der er markeret AFSTEMNING PÅ NÆSTE MØDE, skal altid med som eget punkt (\"Afstemning: …\" med forslagets titel og hvem der har stillet det), så bestyrelsen kan stemme om det på mødet. Opfind intet. Start med \"Godkendelse af dagsorden\" og \"Godkendelse af referat fra sidste møde\", slut med \"Eventuelt\". "
  // Requested: "det er alt for voldsomt med så mange forslag. Hun bør prioritere de fem vigtigste.": she has room for a few points, so she chooses - and does not repeat the routine points the board puts on itself.
  + `Du har kun plads til ${limit} ${limit === 1 ? "punkt" : "punkter"}, så vælg de ${limit === 1 ? "vigtigste" : `${limit} vigtigste`}, og sæt det vigtigste først: det, der haster mest, eller som skal afgøres, før andet kan komme videre. `
  + "Slå punkter, der handler om det samme, sammen til ét - fx en opfølgning på noget, der også står som udsat. Tag ikke de faste punkter med (godkendelse af dagsorden og af referat, eventuelt): dem sætter bestyrelsen selv på. "
  + `Højst ${limit} punkter, hvert en kort linje på dansk (gerne med hvem der fremlægger, når det står i materialet). `
  + 'Svar KUN med JSON: {"items":["...","..."]}.';

export async function suggestAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, meeting: Meeting, limit = sagaRoom(meeting), fromDocument: string[] = []): Promise<string[]> {
  if (limit <= 0) return [];
  const there = agendaPoints(meeting.agenda);
  const question = `Forslag til dagsorden til teammødet ${meeting.meeting_date}${there.length ? ` (allerede på dagsordenen: ${there.join("; ")})` : ""}`
    + (fromDocument.length ? `\nReferatets forslag til næste dagsorden (vælg blandt dem og resten af materialet, ikke alle): ${fromDocument.join("; ")}` : "");
  const answer = await completeAs("dagsorden")(env, deps, [{ role: "system", content: `${system(limit)}\n\n${await boardKnowledge(env, deps, db, question)}` }, { role: "user", content: question }]);
  let items: unknown = null;
  try { items = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { items?: unknown } | null)?.items; } catch { items = null; }
  if (!Array.isArray(items)) throw new Error("agenda_unreadable");
  const out = items.filter((x): x is string => typeof x === "string").map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, limit);
  return withMeetingProposals(out, (await proposals(db, deps.now()).catch(() => [])).filter(p => p.status === "open" && p.mode === "moede"), limit, there);
}

/** Requested: "Hvis næste møde forslår Saga det som punkt på næste dagsorden": a proposal to be voted on at the next meeting is on the suggestion, whatever
 * the model made of it - added before "Eventuelt" when it is not there already, on the suggestion or on the agenda (the limit yields to it: it pushes out the model's last point). */
export function withMeetingProposals(items: string[], forMeeting: Array<{ title: string; created_by: string }>, max = SAGA_POINTS, onAgenda: string[] = []): string[] {
  const key = (text: string) => text.toLowerCase().replace(/\s+/g, " ");
  const missing = forMeeting.filter(p => ![...items, ...onAgenda].some(i => key(i).includes(key(p.title))));
  if (!missing.length) return items;
  const last = items.length && /^eventuelt\b/i.test(items[items.length - 1]!) ? items.pop()! : null;
  const added = missing.map(p => `Afstemning: ${p.title} (stillet af ${p.created_by.split(/\s+/)[0]})`.slice(0, 200)).slice(0, max);
  const room = Math.max(0, max - added.length);
  return [...items.slice(0, Math.max(0, room - (last && room > 0 ? 1 : 0))), ...added, ...(last && room > 0 ? [last] : [])];
}

const warnEnglish = (error: unknown) => console.warn("cockpit_agenda_english_failed", error instanceof Error ? error.message : error);
const sagaPointsOf = (row: { agenda: string; agenda_saga: string } | null) => row ? agendaPoints(row.agenda_saga).filter(p => agendaPoints(row.agenda).includes(p)) : [];

/** Requested: "Saga should come with suggestions in either Danish AND English depending on what language was picked": her points are made in English with the Danish ones - kept by the Danish text's hash, in the same
 * translations the pages use, so a member who reads in English sees them in English at once, and a Danish reader the Danish. Returns how many were translated. */
export async function englishAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, meetingId: number): Promise<number> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return 0;
  const row = await db.prepare("SELECT agenda, agenda_saga FROM board_meetings WHERE id = ?").bind(meetingId).first<{ agenda: string; agenda_saga: string }>();
  const points = sagaPointsOf(row);
  return points.length ? translateTexts(env, deps, db, points) : 0;
}

/** After a request that put her points on the agenda: the English is made in the background (the round makes it within five minutes when there is no background to make it in). */
export function englishLater(env: SagaEnv, deps: SagaDeps, db: D1Database, meetingId: number): void {
  deps.waitUntil?.(englishAgenda(env, deps, db, meetingId).catch(warnEnglish));
}

/** Requested: "Hun bør prioritere de fem vigtigste.": Saga reads the minutes document's suggestion with the rest of the material and chooses the points that are missing up to five (one AI call) - what
 * she makes of it, not the document's list on top of her own. When the AI fails, the first of the document's points stand in for them. */
export async function suggestForTeamMeeting(env: SagaEnv, deps: SagaDeps, db: D1Database, meeting: Meeting): Promise<number> {
  const now = deps.now();
  const fresh = await db.prepare("SELECT agenda, agenda_saga FROM board_meetings WHERE id = ?").bind(meeting.id).first<{ agenda: string; agenda_saga: string }>();
  const current: Meeting = { ...meeting, agenda: fresh?.agenda ?? meeting.agenda, agenda_saga: fresh?.agenda_saga ?? meeting.agenda_saga ?? "" };
  const room = sagaRoom(current);
  if (!room) return 0;
  const document = (await boardPicture(db, now)).picture?.document.nextAgenda ?? [];
  let added = 0;
  try {
    added = await addAgendaPoints(db, meeting.id, await suggestAgenda(env, deps, db, current, room, document), "Saga", now, true);
  } catch (error) {
    added = await addAgendaPoints(db, meeting.id, document, "Saga", now, true);
    if (!added) throw error;
    console.warn("cockpit_agenda_failed", error instanceof Error ? error.message : error);
  }
  if (added) await englishAgenda(env, deps, db, meeting.id).catch(warnEnglish);
  return added;
}

/** Requested: "Om morgenen for teammødet skal Saga sende en besked til gruppen om, at dagsordenen er klar, og at vi ses klokken xx. Og det ville være fint, hvis hun kan sende et direkte link til dagsordenen."
 * The words are fixed - no AI - and the link goes straight to the agenda on the meeting's page. */
export function agendaReadyText(env: SagaEnv, meeting: Meeting): string {
  const points = agendaPoints(meeting.agenda), shown = points.slice(0, 12);
  const link = env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}/moder/${meeting.id}#dagsorden` : "";
  const list = `${shown.map((p, i) => `${i + 1}. ${p}`).join("\n")}${points.length > shown.length ? `\n... og ${points.length - shown.length} punkter mere` : ""}`;
  return `God morgen 🙂 Dagsordenen til dagens teammøde er klar (${points.length} ${points.length === 1 ? "punkt" : "punkter"}), og vi ses ${meeting.start_time ? `kl. ${meeting.start_time}` : "i dag"}${meeting.place ? ` - ${meeting.place}` : ""}.${rolesLine(meeting) ? `\n${rolesLine(meeting)}` : ""}\n\n${list}${link ? `\n\nSe dagsordenen her: ${link}` : ""}`;
}

/** In Saga's round: on the day of a team meeting, from 08:00 and until it begins (12:00 when it has no time), once - and only when the agenda has points. She writes in the board's group only when she
 * is allowed to (SAGA_BOARD_POSTING); a send that fails is tried again in the next round. Returns whether she wrote. */
export async function scheduledAgendaReminder(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<boolean> {
  if (!postsToBoard(env) || !env.SAGA_BOARD_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return false;
  const now = deps.now();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes < 8 * 60) return false;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
  const meeting = (await meetings(db)).find(m => m.kind === "team" && m.meeting_date === today);
  if (!meeting || !agendaPoints(meeting.agenda).length) return false;
  const start = /^(\d{2}):(\d{2})$/.exec(meeting.start_time ?? "");
  if (minutes >= (start ? Number(start[1]) * 60 + Number(start[2]) : 12 * 60)) return false;
  const key = `cockpit_agenda_ready_${meeting.id}`;
  if (!(await claim(key, 0))) return false;
  try {
    const text = agendaReadyText(env, meeting);
    const sent = await telegramClient(env, deps).sendMessage(env.SAGA_BOARD_CHAT_ID, text);
    await saveBoardMessage(db, { chatId: env.SAGA_BOARD_CHAT_ID, messageId: sent.message_id, author: SAGA_NAME, authorId: null, text, sentAtMs: now, fromAssistant: true });
    return true;
  } catch (error) {
    await db.prepare("DELETE FROM job_claims WHERE job_key = ? AND scheduled_for_ms = 0").bind(key).run().catch(() => undefined);
    throw error;
  }
}
