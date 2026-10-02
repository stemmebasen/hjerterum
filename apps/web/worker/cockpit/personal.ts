import type { D1Database } from "../db.js";
import { addTodo, allTasks, approvedMinutes, boardPicture, EVERYONE, openFor, setTaskChecked, setTodoDone, taskKey, type Task, type Todo } from "./data.js";

/** Requested: "Hun skal kunne rette i mit \"personlige\" cockpit, når jeg beder hende om det, men aldrig noget der vedrører
 * andre eller hele foreningen uden alles samtykke." Saga changes only the asker's own list, and only an item that is the
 * asker's alone:
 * - a minutes task given to the asker alone: checked off (or opened again) - the same as the asker pressing the square;
 * - an item on the asker's to-do list written to the asker (not to "Alle"): checked off or opened again; and, when the
 *   asker wrote it, its wording or deadline changed or the item deleted;
 * - a new item on the asker's own list.
 * Never minutes, decisions, meetings' minutes, another member's task, a task shared with others or an item for "Alle". */

export type PersonalItem =
  | { ref: string; kind: "task"; text: string; key: string; solo: boolean }
  | { ref: string; kind: "todo"; text: string; id: number; mine: boolean; everyone: boolean };

const first = (name: string) => name.trim().split(/\s+/)[0]!.toLocaleLowerCase("da-DK");

/** A minutes task that is the asker's alone - not shared with others, the board or "alle". */
export function soloTask(task: Task, who: string): boolean {
  const names = task.who.toLocaleLowerCase("da-DK").split(/\s*(?:,|&|\+|\/|\bog\b)\s*/u).map(n => n.trim()).filter(Boolean);
  return names.length === 1 && !/\b(alle|bestyrelsen)\b/u.test(names[0]!) && first(names[0]!) === first(who);
}

export async function personalItems(db: D1Database, who: string, nowMs: number): Promise<PersonalItem[]> {
  const [minutes, { picture }] = await Promise.all([approvedMinutes(db), boardPicture(db, nowMs)]);
  const open = await openFor(db, who, allTasks(minutes, picture)).catch(() => ({ tasks: [] as Task[], todos: [] as Todo[] }));
  return [
    ...open.tasks.map((t, i): PersonalItem => ({ ref: `T${i + 1}`, kind: "task", key: taskKey(t), solo: soloTask(t, who),
      text: `${t.what}${t.due ? ` (frist: ${t.due})` : ""} - fra referatet ${t.meeting}${t.who && !soloTask(t, who) ? ` (fælles: ${t.who})` : ""}` })),
    ...open.todos.map((t): PersonalItem => ({ ref: `D${t.id}`, kind: "todo", id: t.id, mine: t.created_by === who && t.owner === who, everyone: t.owner === EVERYONE,
      text: `${t.text}${t.due ? ` (frist: ${t.due})` : ""} - på to-do-listen${t.owner === EVERYONE ? " til Alle" : ""}${t.created_by && t.created_by !== who ? `, skrevet af ${t.created_by}` : ""}` }))
  ];
}

export function personalSection(who: string, items: PersonalItem[]): string {
  return `\n\n${who.toUpperCase()}S ÅBNE OPGAVER (den der spørger; [ref] bruges kun i [[OPGAVE ...]]-linjer):\n${items.map(i => `- [${i.ref}] ${i.text}`).join("\n") || "(ingen åbne opgaver)"}`;
}

const ACTION = /\[\[OPGAVE\s+([^\]]*)\]\]/gi;
const field = (line: string, name: string) => new RegExp(`${name}=(.+?)(?=\\s+(?:handling|ref|tekst|frist)=|$)`, "i").exec(line)?.[1]?.trim() ?? "";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Saga's [[OPGAVE handling=... ref=... tekst=... frist=...]] lines, carried out within the rules above; each becomes a
 * short confirmation, or the reason it was not done. */
export async function applyPersonal(db: D1Database, answer: string, who: string | null, items: PersonalItem[], nowMs: number, base = ""): Promise<string> {
  const lines = [...answer.matchAll(ACTION)];
  if (!lines.length) return answer;
  const results: string[] = [];
  for (const line of lines) {
    const raw = line[1] ?? "";
    const action = field(raw, "handling").toLocaleLowerCase("da-DK");
    const ref = field(raw, "ref").replace(/^\[|\]$/g, "").toUpperCase();
    const text = field(raw, "tekst").replace(/\s+/g, " ").slice(0, 300);
    const due = field(raw, "frist");
    const item = items.find(i => i.ref === ref);
    results.push(await (async () => {
      if (!who) return "✗ Vælg hvem du er i cockpittet, før Saga kan rette i din liste.";
      if (action === "ny") {
        if (!text) return "✗ Den nye opgave mangler en tekst.";
        await addTodo(db, { owner: who, text, due: DAY.test(due) ? due : null, createdBy: who }, nowMs);
        return `✓ Tilføjet til din liste: ${text}`;
      }
      if (!item) return `✗ Fandt ikke opgaven ${ref || "(ingen ref)"} på din liste.`;
      const name = item.text.replace(/ - (fra referatet|på to-do-listen).*$/, "");
      if (item.kind === "task") {
        if (!item.solo) return `✗ "${name}" er fælles med andre - den retter jeg ikke uden deres samtykke.`;
        if (action === "klaret" || action === "fjern") { await setTaskChecked(db, who, item.key, true, nowMs); return `✓ Krydset af på din liste: ${name}`; }
        if (action === "genåbn" || action === "genaabn") { await setTaskChecked(db, who, item.key, false, nowMs); return `✓ Åbnet igen: ${name}`; }
        return `✗ "${name}" kommer fra referatet - ordlyden ændres kun i referatet.`;
      }
      if (item.everyone) return `✗ "${name}" står på alles liste - den retter jeg ikke uden alles samtykke.`;
      if (action === "klaret") { await setTodoDone(db, item.id, who, true, nowMs); return `✓ Krydset af på din liste: ${name}`; }
      if (action === "genåbn" || action === "genaabn") { await setTodoDone(db, item.id, who, false, nowMs); return `✓ Åbnet igen: ${name}`; }
      if (!item.mine) return `✗ "${name}" har en anden skrevet til dig - du kan krydse den af, men ikke ændre eller slette den.`;
      if (action === "slet" || action === "fjern") {
        await db.prepare("DELETE FROM cockpit_todos WHERE id = ? AND owner = ? AND created_by = ?").bind(item.id, who, who).run();
        return `✓ Slettet fra din liste: ${name}`;
      }
      if (action === "ret") {
        if (!text && !DAY.test(due)) return `✗ Hvad skal "${name}" rettes til?`;
        await db.prepare("UPDATE cockpit_todos SET text = COALESCE(?, text), due = COALESCE(?, due) WHERE id = ? AND owner = ? AND created_by = ?")
          .bind(text || null, DAY.test(due) ? due : null, item.id, who, who).run();
        return `✓ Rettet på din liste: ${text || name}${DAY.test(due) ? ` (frist ${due})` : ""}`;
      }
      return `✗ Ukendt handling "${action}".`;
    })());
  }
  const rest = answer.replace(ACTION, "").replace(/\n{3,}/g, "\n\n").trim();
  return `${rest}\n\n${results.join("\n")}\n\n[Se din liste](${base}/opgaver)`;
}
