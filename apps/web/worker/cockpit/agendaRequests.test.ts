import { describe, expect, it } from "vitest";
import { AGENDA_ASK, agendaRequests } from "./agenda.js";
import { saveBoardMessage } from "../saga/store.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Asked: "Saga [har] ikke inkluderet mit forslag i Telegram-gruppen om at drøfte rabat til Hjerteland. Er det ikke meningen, at hun skal fange det?"
const NOW = Date.parse("2026-10-12T10:00:00Z");
const JACOB = "Så vidt jeg husker, mindst 15 % medlemsrabat på billetter. Men vi skal lige snakke om Hjerteland igen og se om aftalen stadig giver mening. Lad os få det på dagsorden.";

describe("a wish in the group to have something on the agenda", () => {
  it("is recognised only when someone asks for the agenda or the meeting", () => {
    expect(AGENDA_ASK.test(JACOB)).toBe(true);
    expect(AGENDA_ASK.test("Kan vi tage det op på næste møde?")).toBe(true);
    expect(AGENDA_ASK.test("Jeg vil gerne drøfte prisen på Hjerteland på næste møde")).toBe(true);
    expect(AGENDA_ASK.test("Hvad er aftalen med Hjerteland?")).toBe(false);
  });

  it("puts it on the next team meeting as the asker's own point, once", async () => {
    const db = testDatabase();
    const asked: string[] = [];
    const services = fakeServices({ ai: (_sys, user) => { asked.push(user); return '{"point":"Hjerteland-aftalen: giver medlemsrabatten stadig mening"}'; } });
    const env = sagaEnv(db);
    await db.prepare("INSERT INTO board_meetings (meeting_date, start_time, agenda, kind, created_at_ms, updated_at_ms) VALUES ('2026-10-15', '19:00', 'Julefest', 'team', ?, ?)").bind(NOW, NOW).run();
    await saveBoardMessage(db, { chatId: env.SAGA_BOARD_CHAT_ID!, messageId: 1, author: "Frederik", authorId: "2", text: "Hvad er aftalen med Hjerteland?", sentAtMs: NOW - 7_200_000 });
    await saveBoardMessage(db, { chatId: env.SAGA_BOARD_CHAT_ID!, messageId: 2, author: "Jacob Hauge", authorId: "1", text: JACOB, sentAtMs: NOW - 600_000 });
    const claimed = new Set<string>();
    const claim = async (key: string) => { if (claimed.has(key)) return false; claimed.add(key); return true; };
    expect(await agendaRequests(env, deps(services.fetcher, NOW), db, claim)).toBe(1);
    expect(await agendaRequests(env, deps(services.fetcher, NOW + 300_000), db, claim)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Frederik: Hvad er aftalen med Hjerteland?");
    const row = await db.prepare("SELECT agenda, agenda_saga, agenda_authors FROM board_meetings").first<{ agenda: string; agenda_saga: string; agenda_authors: string }>();
    expect(row!.agenda).toBe("Velkommen\nJulefest\nHjerteland-aftalen: giver medlemsrabatten stadig mening (ønsket af Jacob)\nEvt.");
    expect(row!.agenda_saga).toBe("");
    expect(JSON.parse(row!.agenda_authors)).toMatchObject({ "Hjerteland-aftalen: giver medlemsrabatten stadig mening (ønsket af Jacob)": "Jacob Hauge" });
  });
});
