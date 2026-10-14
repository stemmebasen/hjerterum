import { describe, expect, it } from "vitest";
import { askInput, askSagaMarkdown, boardKnowledge, LONG_VIEW, sectionsFor } from "./ask.js";
import { meetingOn, saveMeeting } from "./data.js";
import { setMemberLang } from "./i18n.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, OWNER } from "../saga/test-support.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "kan der ikke kun sendes det relevante med for det pågældende spørgsmål?" and "en vurdering af det, der kommer tilbage ... et nyt kald, hvis vi mangler mere info, helt automatisk".
const NOW = Date.parse("2026-10-09T10:00:00Z");

describe("Saga keeps the conversation, and puts a point on the agenda when asked", () => {
  // Requested: "Når man beder saga putte et punkt på dagsordenen skal hun hjælpe med det. Hun skal spørge om noget hvis hun er i tvivl." -
  // and asked: "Kan hun ikke huske beskedhistorik i chatten?" after a bare "Ja" was answered as if nothing came before it.
  it("answers a bare 'Ja' with the conversation before it, even when the browser lost it, and sets the point on the meeting's agenda", async () => {
    const db = testDatabase();
    await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "Hjerterum", agenda: "Økonomi" }, "Jacob Hauge", NOW);
    const firsts: string[] = [];
    let answers = ["Skal punktet på teammødet torsdag 15. oktober?", "Godt, det er sat på.\n[[DAGSORDEN dato=2026-10-15 punkt=Nøgler: hvem har hvilke, og hvem mangler]]"];
    const services = fakeServices({ ai: (_system, first) => { firsts.push(first); return answers.shift() ?? "Svar."; } });
    const env = sagaEnv(db);
    const conversation = "c0nversation1";
    expect(askInput({ question: "Ja", history: [], conversation })).toEqual({ question: "Ja", history: [], conversation });
    await askSagaMarkdown(env, deps(services.fetcher, NOW), db, "Jacob Hauge", { question: "Sæt nøglerne på dagsordenen", history: [], conversation });
    const out = await askSagaMarkdown(env, deps(services.fetcher, NOW + 60_000), db, "Jacob Hauge", { question: "Ja", history: [], conversation });
    // The second call starts with the first question - the server kept it.
    expect(firsts[1]).toBe("Sæt nøglerne på dagsordenen");
    expect(out).toContain("✓ Sat på dagsordenen torsdag 15. oktober: Nøgler: hvem har hvilke, og hvem mangler");
    expect((await meetingOn(db, "2026-10-15"))?.agenda).toBe("Økonomi\nNøgler: hvem har hvilke, og hvem mangler");
    // Another conversation does not see it; nor does a meeting that is not there get a point.
    answers = ["[[DAGSORDEN dato=2026-10-22 punkt=Kaffe]]"];
    expect(await askSagaMarkdown(env, deps(services.fetcher, NOW + 120_000), db, "Jacob Hauge", { question: "Sæt kaffe på", history: [], conversation: "another-one" }))
      .toContain("Der er intet møde torsdag 22. oktober i kalenderen");
    expect(firsts[2]).toContain("Sæt kaffe på");
  });
});

describe("Saga writes to a board member privately when asked", () => {
  // Asked: "Why can't she DM the others? And if I ask her to do something, she should do it because I'm the chairman and super admin."
  it("sends her [[BESKED]] line to that member on Telegram, knows the chair is asking, and knows each member's language", async () => {
    const db = testDatabase();
    for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Douglas Crawford", "203"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await setMemberLang(db, "Douglas Crawford", "en", NOW);
    let system = "", first = "";
    const services = fakeServices({ ai: (s, f) => { system = s; first = f; return "Done.\n[[BESKED til=Douglas: Jacob asked me to say thank you for all the good work you do. 🧡]]\n[[BESKED til=Nobody: Hej]]"; } });
    const out = await askSagaMarkdown(sagaEnv(db), deps(services.fetcher, NOW), db, "Jacob Hauge", { question: "Send an encouraging message to Douglas directly on Telegram", history: [] });
    expect(first).toContain("Jacob Hauge (formand og superadmin) spørger");
    expect(system).toContain("BESTYRELSENS SPROG (det sprog, hver har valgt i admin):\nDouglas Crawford: engelsk\nJacob Hauge: dansk");
    expect(services.telegram("sendMessage").map(m => m.body)).toMatchObject([{ chat_id: "203", text: "Jacob asked me to say thank you for all the good work you do. 🧡" }]);
    expect(out).toContain("✓ Sendt privat til Douglas:\n\n> Jacob asked me to say thank you for all the good work you do. 🧡");
    expect(out).toContain("Jeg kender ingen Nobody i bestyrelsens gruppe, så beskeden er ikke sendt.");
  });
});

describe("Saga writes in the board's group when asked", () => {
  // Asked in admin: "Kan du spørge i telegram gruppen om nogen har nogle punkter til dagsordenen i morgen?" - she answered that she could not.
  it("sends her [[GRUPPEN]] line to the group, keeps it with the group's messages, and says so", async () => {
    const db = testDatabase();
    const services = fakeServices({ ai: () => "Det spørger jeg om.\n[[GRUPPEN: Jacob spørger: Har I punkter til dagsordenen til mødet i morgen kl. 13.30? Skriv dem gerne her i aften.]]" });
    const env = sagaEnv(db);
    const out = await askSagaMarkdown(env, deps(services.fetcher, NOW), db, "Jacob Hauge", { question: "Kan du spørge i telegram gruppen om nogen har nogle punkter til dagsordenen i morgen?", history: [] });
    expect(services.telegram("sendMessage").map(m => (m.body as { text: string }).text)).toEqual(["Jacob spørger: Har I punkter til dagsordenen til mødet i morgen kl. 13.30? Skriv dem gerne her i aften."]);
    expect(out).toBe("Det spørger jeg om.\n\n✓ Sendt i bestyrelsens Telegram-gruppe:\n\n> Jacob spørger: Har I punkter til dagsordenen til mødet i morgen kl. 13.30? Skriv dem gerne her i aften.");
    expect(await db.prepare("SELECT author_name, from_assistant FROM board_messages").all()).toMatchObject({ results: [{ author_name: "Saga", from_assistant: 1 }] });
    // Without knowing who asks, nothing is sent.
    await askSagaMarkdown(env, deps(services.fetcher, NOW), db, null, { question: "Skriv i gruppen", history: [] });
    expect(services.telegram("sendMessage")).toHaveLength(1);
  });
});

describe("only what the question needs", () => {
  // Reported: "Jeg har bedt om hjælp til at holde en tale om hjerterum det sidste år, men Saga siger, at hun kun kan se tilbage til juni,
  // selvom Google-dokumentet indeholder informationer helt tilbage."
  it("gives the whole minutes document to a question about the year, and only the newest of it otherwise", async () => {
    const months = ["10/2025", "11/2025", "12/2025", "1/2026", "2/2026", "3/2026", "4/2026", "5/2026", "6/2026", "7/2026", "8/2026", "9/2026"];
    const doc = months.map(m => `Dato for møde: 5/${m}\nMødet i ${m}: ${"Vi talte om husets drift og planer. ".repeat(110)}`).reverse().join("\n\n");
    const db = testDatabase();
    const env = sagaEnv(db, { GOOGLE_MINUTES_DOC_ID: "open-doc" });
    const docFetch: typeof fetch = async () => new Response(doc, { headers: { "content-type": "text/plain; charset=utf-8" } });
    expect(LONG_VIEW.test("Kan du hjælpe mig med en tale om Hjerterum det sidste år?")).toBe(true);
    expect(LONG_VIEW.test("Hvornår er næste møde?")).toBe(false);
    const speech = await boardKnowledge(env, deps(docFetch, NOW), db, "Kan du hjælpe mig med en tale om Hjerterum det sidste år?", new Set());
    expect(speech).toContain("Mødet i 10/2025");
    expect(speech).not.toContain("Ældre møder ikke medtaget");
    const short = await boardKnowledge(env, deps(docFetch, NOW), db, "Hvad stod der i dokumentet om driften?", new Set(["referatdokument"]));
    expect(short).toContain("Mødet i 9/2026");
    expect(short).not.toContain("Mødet i 10/2025");
    expect(short).toContain("Ældre møder ikke medtaget");
  });

  it("picks the heavy parts from the words of the question and of the turns before it", () => {
    expect([...sectionsFor("Hvad koster et medlemskab?")].sort()).toEqual(["hjemmeside", "leje", "medlemskab"].filter(k => k !== "leje").sort());
    expect(sectionsFor("Hvornår skal forslag til GF være inde?").has("vedtaegter")).toBe(true);
    expect(sectionsFor("Hvad skrev Lisbeth i gruppen?").has("chat")).toBe(true);
    expect(sectionsFor("Hvem har ansvar for nøglerne?").has("mail")).toBe(false);
    expect([...sectionsFor("Hej")]).toEqual([]);
    // A follow-up keeps the topic of the question before it.
    expect(sectionsFor("Hvad siger vedtægterne om stemmeret? Og hvad med suppleanterne?").has("vedtaegter")).toBe(true);
  });

  it("leaves the heavy parts out unless they are named - and gives the whole pack when nothing is said", async () => {
    const db = testDatabase();
    const env = sagaEnv(db);
    const services = fakeServices({});
    const small = await boardKnowledge(env, deps(services.fetcher, NOW), db, "Hvem har ansvar?", new Set());
    expect(small).toContain("ANSVARSOMRÅDER I BESTYRELSEN");
    expect(small).not.toContain("VEDTÆGTER:");
    expect(small).not.toContain("MEDLEMSKAB - TYPER");
    expect(small).not.toContain("HJERTERUMS MAIL");
    const withStatutes = await boardKnowledge(env, deps(services.fetcher, NOW), db, "Hvem har ansvar?", new Set(["vedtaegter"]));
    expect(withStatutes).toContain("VEDTÆGTER:");
    const whole = await boardKnowledge(env, deps(services.fetcher, NOW), db, "Hvem har ansvar?");
    for (const part of ["VEDTÆGTER:", "FORENINGSRET", "MEDLEMSKAB - TYPER", "LEJE AF SALEN"]) expect(whole).toContain(part);
    expect(whole.length).toBeGreaterThan(small.length * 2);
  });

  it("asks again, automatically, with the parts Saga says she misses - once - and the member only sees the second answer", async () => {
    const db = testDatabase();
    const systems: string[] = [];
    let answers = ["[[MANGLER: vedtaegter]]", "Ifølge § 6 er fristen to uger."];
    const services = fakeServices({ ai: system => { systems.push(system); return answers.shift() ?? "Svar."; } });
    const env = sagaEnv(db);
    const out = await askSagaMarkdown(env, deps(services.fetcher, NOW), db, "Lisbeth", { question: "Hvornår skal noget være inde?", history: [] });
    expect(out).toBe("Ifølge § 6 er fristen to uger.");
    expect(systems).toHaveLength(2);
    expect(systems[0]).toContain("DU HAR KUN FÅET DE DELE AF VIDEN");
    expect(systems[0]).not.toContain("VEDTÆGTER:");
    expect(systems[1]).toContain("VEDTÆGTER:");
    expect(await db.prepare("SELECT answer FROM cockpit_questions").all()).toMatchObject({ results: [{ answer: "Ifølge § 6 er fristen to uger." }] });

    // [[MANGLER]] with no names: the whole pack. And a second marker is never followed again - it is removed from the answer.
    systems.length = 0;
    answers = ["[[MANGLER]]", "Her er svaret.[[MANGLER]]"];
    expect(await askSagaMarkdown(env, deps(services.fetcher, NOW), db, "Lisbeth", { question: "Hvad ved vi?", history: [] })).toBe("Her er svaret.");
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain("VEDTÆGTER:");
    expect(systems[1]).not.toContain("DU HAR KUN FÅET");

    // An ordinary answer is one call.
    systems.length = 0;
    answers = ["Et svar."];
    await askSagaMarkdown(env, deps(services.fetcher, NOW), db, "Lisbeth", { question: "Hvem har ansvar?", history: [] });
    expect(systems).toHaveLength(1);
    // The calls are told apart in the usage log.
    expect(await db.prepare("SELECT purpose, COUNT(*) AS n FROM ai_usage GROUP BY purpose ORDER BY purpose").all()).toMatchObject({ results: [{ purpose: "spoergsmaal", n: 3 }, { purpose: "spoergsmaal-udvidet", n: 2 }] });
  });
});
