import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { boardKnowledge } from "./ask.js";
import type { Meeting } from "./data.js";

/** Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." Saga reads what
 * the board has - the minutes (postponed points, tasks to follow up), the open threads, the coming dates,
 * the group and team@ - and suggests the agenda for this meeting. Nothing is saved: the suggestion goes
 * into the agenda field, where the board edits it and presses Gem. */

const SYSTEM = "Du er Saga, assistent for bestyrelsen i foreningen Hjerterum. Foreslå dagsordenen til et bestyrelsesmøde ud fra materialet nedenfor. "
  + "Tag kun punkter med, der har grundlag i materialet: udsatte punkter, opfølgning på opgaver og beslutninger, hængepartier, kommende datoer og frister (fx generalforsamling), "
  + "og emner rejst i gruppen eller i mails til team@. "
  // Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde".
  + "Et afstemningsforslag, der er markeret ØNSKES DRØFTET PÅ ET MØDE, skal med som eget punkt (med forslagets titel og hvem der ønsker det drøftet). Opfind intet. Start med \"Godkendelse af dagsorden\" og \"Godkendelse af referat fra sidste møde\", slut med \"Eventuelt\". "
  + "Højst 12 punkter, hvert en kort linje på dansk (gerne med hvem der fremlægger, når det står i materialet). "
  + 'Svar KUN med JSON: {"items":["...","..."]}.';

export async function suggestAgenda(env: SagaEnv, deps: SagaDeps, db: D1Database, meeting: Meeting): Promise<string[]> {
  const question = `Forslag til dagsorden til bestyrelsesmødet ${meeting.meeting_date}${meeting.agenda.trim() ? ` (allerede på dagsordenen: ${meeting.agenda.split("\n").join("; ")})` : ""}`;
  const answer = await complete(env, deps, [{ role: "system", content: `${SYSTEM}\n\n${await boardKnowledge(env, deps, db, question)}` }, { role: "user", content: question }]);
  let items: unknown = null;
  try { items = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as { items?: unknown } | null)?.items; } catch { items = null; }
  if (!Array.isArray(items)) throw new Error("agenda_unreadable");
  return items.filter((x): x is string => typeof x === "string").map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 12);
}
