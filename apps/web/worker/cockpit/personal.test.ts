import { describe, expect, it } from "vitest";
import { applyPersonal, personalItems, soloTask } from "./personal.js";
import { addTodo } from "./data.js";
import { testDatabase } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Hun skal kunne rette i mit \"personlige\" cockpit, når jeg beder hende om det, men aldrig noget der vedrører andre eller
// hele foreningen uden alles samtykke." - after Saga said: "Jeg kan ikke rette opgaverne herfra".
const NOW = Date.parse("2026-10-02T10:00:00Z");
const MINUTES = "# Referat - bestyrelsesmøde 1. oktober 2026\n## Opgaver\n- Jacob - Sende sidste besked til Thomas Emil og blokere ham\n- Jacob - Sende sidste besked til Thomas Emil\n- Jacob og Douglas - Planlæg generalforsamlingen\n- Alle - Læs budgettet";

async function board(): Promise<D1Database> {
  const db = testDatabase();
  await db.prepare("INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms) VALUES ('upload', 'f1', 'm.m4a', 'approved', '2026-10-01', ?, ?, ?)").bind(MINUTES, NOW, NOW).run();
  return db;
}
const open = async (db: D1Database) => (await personalItems(db, "Jacob Hauge", NOW)).map(i => i.text.replace(/ - (fra referatet|på to-do-listen).*$/, ""));

describe("Saga in the asker's own cockpit", () => {
  it("knows a task that is the asker's alone from one shared with others or the whole board", () => {
    const task = (who: string) => ({ who, what: "x", due: "", meeting: "2026-10-01", source: "referat" as const });
    expect(soloTask(task("Jacob"), "Jacob Hauge")).toBe(true);
    expect(soloTask(task("Jacob og Douglas"), "Jacob Hauge")).toBe(false);
    expect(soloTask(task("Alle"), "Jacob Hauge")).toBe(false);
    expect(soloTask(task("Gitta"), "Jacob Hauge")).toBe(false);
  });

  it("checks off the stale duplicate, adds and changes the asker's own items - and refuses what concerns others", async () => {
    const db = await board();
    await addTodo(db, { owner: "Jacob Hauge", text: "Ring til udlejer", due: null, createdBy: "Jacob Hauge" }, NOW);
    await addTodo(db, { owner: "Jacob Hauge", text: "Send budget", due: null, createdBy: "Gitta" }, NOW);
    await addTodo(db, { owner: "Alle", text: "Svar på datoen", due: null, createdBy: "Gitta" }, NOW);
    const items = await personalItems(db, "Jacob Hauge", NOW);
    const ref = (text: string) => items.find(i => i.text.startsWith(text))!.ref;

    const answer = await applyPersonal(db, ["Det gør jeg.",
      `[[OPGAVE handling=klaret ref=${ref("Sende sidste besked til Thomas Emil og blokere ham")}]]`,
      "[[OPGAVE handling=ny tekst=Skriv til Douglas om nøglerne frist=2026-10-09]]",
      `[[OPGAVE handling=ret ref=${ref("Ring til udlejer")} tekst=Ring til udlejer om varmen]]`,
      `[[OPGAVE handling=slet ref=${ref("Send budget")}]]`,
      `[[OPGAVE handling=klaret ref=${ref("Planlæg generalforsamlingen")}]]`,
      `[[OPGAVE handling=klaret ref=${ref("Svar på datoen")}]]`,
      `[[OPGAVE handling=ret ref=${ref("Sende sidste besked til Thomas Emil - ")} tekst=Noget andet]]`].join("\n"), "Jacob Hauge", items, NOW, "/cockpit");

    expect(answer).toContain("Det gør jeg.");
    expect(answer).toContain("✓ Krydset af på din liste: Sende sidste besked til Thomas Emil og blokere ham");
    expect(answer).toContain("✓ Tilføjet til din liste: Skriv til Douglas om nøglerne");
    expect(answer).toContain("✓ Rettet på din liste: Ring til udlejer om varmen");
    expect(answer).toContain('✗ "Send budget" har en anden skrevet til dig - du kan krydse den af, men ikke ændre eller slette den.');
    expect(answer).toContain("er fælles med andre - den retter jeg ikke uden deres samtykke.");
    expect(answer).toContain('✗ "Svar på datoen" står på alles liste - den retter jeg ikke uden alles samtykke.');
    expect(answer).toContain('✗ "Sende sidste besked til Thomas Emil" kommer fra referatet - ordlyden ændres kun i referatet.');
    expect(answer).toContain("[Se din liste](/cockpit/opgaver)");
    expect(answer).not.toContain("[[OPGAVE");

    const after = await open(db);
    expect(after).not.toContain("Sende sidste besked til Thomas Emil og blokere ham");
    expect(after).toContain("Sende sidste besked til Thomas Emil");
    expect(after).toContain("Skriv til Douglas om nøglerne (frist: 2026-10-09)");
    expect(after).toContain("Ring til udlejer om varmen");
    expect(after).toContain("Send budget");
    expect(after).toContain("Svar på datoen");
    expect(after.some(t => t.startsWith("Planlæg generalforsamlingen"))).toBe(true);
    // Nobody else's list changed.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_task_checks WHERE owner <> 'Jacob Hauge'").first()).toEqual({ n: 0 });
  });

  it("changes nothing for someone who has not said who they are", async () => {
    const db = await board();
    const answer = await applyPersonal(db, "[[OPGAVE handling=ny tekst=Noget]]", null, [], NOW);
    expect(answer).toContain("✗ Vælg hvem du er");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_todos").first()).toEqual({ n: 0 });
  });
});
