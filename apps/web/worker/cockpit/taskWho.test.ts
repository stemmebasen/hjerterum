import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { allTasks, looksLikeWho, minutesTasks, sensibleWho, type ApprovedMinutes } from "./data.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookies } from "../saga/test-support.js";

// A line in the minutes from the board's own document: "Fast fremtidig rengøringsordning - tages op igen - ingen frist aftalt" - a topic stood where the one who does it should, and the page
// showed it as a person (a filter button, "Fast fremtidig rengøringsordning", with the task "Tages op igen").
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-07T10:00:00Z");
const MINUTES = `# Referat - bestyrelsesmøde 17. september 2026
## Opgaver
- Jacob - Bestil en grundig rengøring hurtigst muligt - hurtigst muligt
- Lisbeth, Gitta, Frederik - Møde om opgavefordeling - efter mødet
- Fast fremtidig rengøringsordning - tages op igen - ingen frist aftalt
- Inge Kindberg - Send tilbuddet videre - ingen frist aftalt
- Alle - Læs budgettet - ingen frist aftalt`;
const minutes = { id: 3, source: "document", meeting_date: "2026-09-17", draft_markdown: MINUTES, drive_document_url: null, created_at_ms: 1, updated_at_ms: 1 } as ApprovedMinutes;

describe("who a task is for", () => {
  it("takes first names, a few of them, a group or 'Alle' for people - and a topic for a topic", () => {
    for (const who of ["Jacob", "Lisbeth, Gitta, Frederik", "Jacob og Douglas", "Lisbeth og Gitta", "Inge Kindberg", "Alle", "alle", "Bestyrelsen", "De tre ansatte", "Jacob/Douglas", "", "Mari-Anne", "Åse"])
      expect(looksLikeWho(who), who).toBe(true);
    for (const who of ["Fast fremtidig rengøringsordning", "Rengøringsordning", "tages op igen", "Nyt system: preview", "Julefest valg af dato", "Jacob sender", "Lokaleleje 2027"])
      expect(looksLikeWho(who), who).toBe(false);
    expect(sensibleWho({ who: "Fast fremtidig rengøringsordning", what: "tages op igen" })).toEqual({ who: "", what: "Fast fremtidig rengøringsordning: tages op igen" });
    expect(sensibleWho({ who: "Lisbeth", what: "Skriv forslag" })).toEqual({ who: "Lisbeth", what: "Skriv forslag" });
  });

  it("reads a line whose 'hvem' is a topic as a task for everyone, with the topic in the text - from the minutes and from Saga's reading of the document", () => {
    const tasks = minutesTasks(minutes);
    expect(tasks.map(t => [t.who, t.what])).toEqual([
      ["Jacob", "Bestil en grundig rengøring hurtigst muligt"], ["Lisbeth, Gitta, Frederik", "Møde om opgavefordeling"], ["", "Fast fremtidig rengøringsordning: tages op igen"],
      ["Inge Kindberg", "Send tilbuddet videre"], ["Alle", "Læs budgettet"]]);
    const fromDocument = allTasks([], { document: { tasks: [{ who: "Fast fremtidig rengøringsordning", what: "Tages op igen", due: "", since: "2026-09-17" }, { who: "Gitta", what: "Lav event-mail", due: "", since: "2026-09-17" }] } } as never);
    expect(fromDocument.map(t => [t.who, t.what])).toEqual([["", "Fast fremtidig rengøringsordning: Tages op igen"], ["Gitta", "Lav event-mail"]]);
  });

  it("shows no person called after a topic on the page of tasks", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta", "Frederik"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await db.prepare("INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms) VALUES ('document', 'd1', 'doc', 'approved', '2026-09-17', ?, 1, 1)").bind(MINUTES).run();
    const services = fakeServices({});
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const as = await memberCookies(((await handleCockpitRequest(new Request(ORIGIN + "/login", { method: "POST", body: login, headers: { origin: ORIGIN } }), env, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!);
    const page = await (await call("/opgaver", { cookie: as("Lisbeth") })).text();
    expect(page).toContain("Fast fremtidig rengøringsordning: tages op igen");
    expect(page).not.toContain('data-who="Fast fremtidig rengøringsordning"');
    expect(page).toContain('data-who="Alle"');
    expect(page.match(/class="who-filter"/g)).toHaveLength(1);
  });
});
