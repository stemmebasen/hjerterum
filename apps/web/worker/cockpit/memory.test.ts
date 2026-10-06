import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { allMemories, applyMemory, forget, MAX_BOARD_MEMORIES, memorySection, remember } from "./memory.js";
import { COCKPIT_SYSTEM } from "../saga/prompts.js";
import { BOARD, deps, fakeServices, memberCookie, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested by the chair: "Og vigtigt at Saga lærer af vores samtaler!" and "Hvis Saga tager fejl, så fortæl hende det".

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-06T14:00:00Z");

describe("what Saga remembers", () => {
  it("keeps a line about the member for them and a line about the house for everyone, and takes the lines out of the answer", async () => {
    const db = testDatabase();
    const answer = await applyMemory(db, "Det husker jeg! 🙂\n[[HUSK omfang=mig tekst=Vil have korte svar og kalder mig Jac]]\n[[HUSK omfang=alle tekst=Rengøringen kommer om tirsdagen]]", "Jacob Hauge", NOW);
    expect(answer).toBe("Det husker jeg! 🙂");
    const memories = await allMemories(db);
    expect(memories.map(m => [m.scope, m.member, m.text, m.learned_from]).sort()).toEqual([
      ["board", null, "Rengøringen kommer om tirsdagen", "Jacob Hauge"], ["member", "Jacob Hauge", "Vil have korte svar og kalder mig Jac", "Jacob Hauge"]]);
  });

  it("keeps the same thing once, ignores an empty line, cuts long text, and lets the oldest go at the limit", async () => {
    const db = testDatabase();
    await applyMemory(db, "[[HUSK omfang=alle tekst=Rengøringen kommer om tirsdagen]]", "Lisbeth", NOW);
    await applyMemory(db, "[[HUSK omfang=alle tekst=rengøringen kommer om tirsdagen!]] [[HUSK omfang=alle tekst=]]", "Gitta", NOW + 1);
    expect(await allMemories(db)).toHaveLength(1);
    await applyMemory(db, `[[HUSK omfang=alle tekst=${"x".repeat(500)}]]`, "Gitta", NOW + 2);
    expect((await allMemories(db))[0]!.text).toHaveLength(280);
    for (let i = 0; i < MAX_BOARD_MEMORIES + 5; i++) await remember(db, { scope: "board", member: null, text: `Erindring ${i}`, learnedFrom: "Gitta" }, NOW + 10 + i);
    const board = (await allMemories(db)).filter(m => m.scope === "board");
    expect(board).toHaveLength(MAX_BOARD_MEMORIES);
    expect(board.some(m => m.text === "Erindring 0")).toBe(false);
    expect(board[0]!.text).toBe(`Erindring ${MAX_BOARD_MEMORIES + 4}`);
  });

  it("writes nothing for someone Saga cannot identify, and says so", async () => {
    const db = testDatabase();
    const answer = await applyMemory(db, "Ja!\n[[HUSK omfang=alle tekst=Noget]]", null, NOW);
    expect(answer).toContain("Vælg hvem du er");
    expect(await allMemories(db)).toHaveLength(0);
  });

  it("gives Saga the house's memories and the asker's own - never another member's", async () => {
    const db = testDatabase();
    await remember(db, { scope: "board", member: null, text: "Rengøringen kommer om tirsdagen", learnedFrom: "Lisbeth" }, NOW);
    await remember(db, { scope: "member", member: "Gitta", text: "Kan lide korte svar", learnedFrom: "Gitta" }, NOW);
    await remember(db, { scope: "member", member: "Lisbeth", text: "Er vegetar", learnedFrom: "Lisbeth" }, NOW);
    const forGitta = await memorySection(db, "Gitta");
    expect(forGitta).toContain("DET, DU HAR LÆRT AF SAMTALERNE");
    expect(forGitta).toContain("- Rengøringen kommer om tirsdagen (fortalt af Lisbeth)");
    expect(forGitta).toContain("- Kan lide korte svar");
    expect(forGitta).not.toContain("Er vegetar");
    expect(await memorySection(testDatabase(), "Gitta")).toBe("");
  });

  it("lets a member forget their own, and only the chair forget the rest", async () => {
    const db = testDatabase();
    await remember(db, { scope: "board", member: null, text: "Husets", learnedFrom: "Lisbeth" }, NOW);
    await remember(db, { scope: "member", member: "Gitta", text: "Gittas", learnedFrom: "Gitta" }, NOW);
    await remember(db, { scope: "member", member: "Lisbeth", text: "Lisbeths", learnedFrom: "Lisbeth" }, NOW);
    const [husets, gittas, lisbeths] = ["Husets", "Gittas", "Lisbeths"].map(t => (async () => (await allMemories(db)).find(m => m.text === t)!.id)());
    expect(await forget(db, await husets!, "Gitta", false)).toBe(false);
    expect(await forget(db, await lisbeths!, "Gitta", false)).toBe(false);
    expect(await forget(db, await gittas!, "Gitta", false)).toBe(true);
    expect(await forget(db, await husets!, "Jacob Hauge", true)).toBe(true);
    expect((await allMemories(db)).map(m => m.text)).toEqual(["Lisbeths"]);
  });

  it("is asked of Saga in her instructions", () => {
    expect(COCKPIT_SYSTEM).toContain("DU LÆRER AF SAMTALERNE");
    expect(COCKPIT_SYSTEM).toContain("[[HUSK omfang=mig tekst=<én kort sætning>]]");
    expect(COCKPIT_SYSTEM).toContain("[[HUSK omfang=alle tekst=<én kort sætning>]]");
  });
});

describe("Saga learning in the cockpit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers what she is told, uses it for the next question, shows it on one page and lets only the right people remove it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const systems: string[] = [];
    const services = fakeServices({ ai: system => { systems.push(system); return systems.length === 1 ? "Det husker jeg! 🙂 [[HUSK omfang=alle tekst=Rengøringen kommer om tirsdagen]]\n[[HUSK omfang=mig tekst=Lisbeth vil have korte svar]]" : "Tirsdag!"; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const call = (path: string, init: { cookie?: string; form?: Record<string, string>; json?: unknown } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      method: init.form || init.json ? "POST" : "GET", body: init.form ? new URLSearchParams(init.form) : init.json ? JSON.stringify(init.json) : null,
      headers: { ...(init.form || init.json ? { origin: ORIGIN } : {}), ...(init.json ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const session = ((await call("/login", { form: { password: "hjerte-2026" } })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = (name: string) => memberCookie(session, name);

    const first = await (await call("/saga", { cookie: await as("Lisbeth"), json: { question: "Rengøringen kommer om tirsdagen, husk det", history: [] } })).json() as { html: string };
    expect(first.html).toContain("Det husker jeg!");
    expect(first.html).not.toContain("HUSK");
    // The next question - from someone else - gets the house's memory, but not Lisbeth's own.
    await call("/saga", { cookie: await as("Gitta"), json: { question: "Hvornår kommer rengøringen?", history: [] } });
    expect(systems[1]).toContain("- Rengøringen kommer om tirsdagen (fortalt af Lisbeth)");
    expect(systems[1]).not.toContain("Lisbeth vil have korte svar");
    await call("/saga", { cookie: await as("Lisbeth"), json: { question: "Og hvad ellers?", history: [] } });
    expect(systems[2]).toContain("Lisbeth vil have korte svar");

    // One page for all of it; the chat window invites members to correct her.
    const page = await (await call("/hukommelse", { cookie: await as("Gitta") })).text();
    expect(page).toContain("Rengøringen kommer om tirsdagen");
    expect(page).not.toContain("Lisbeth vil have korte svar");
    expect(page).not.toContain('action="/hukommelse/glem"');
    const front = await (await call("/", { cookie: await as("Gitta") })).text();
    expect(front).toContain("Hvis Saga tager fejl, så fortæl hende det - på den måde får vi bygget en klog og nyttig assistent med tiden.");
    expect(await (await call("/profil", { cookie: await as("Gitta") })).text()).toContain('href="/hukommelse"');

    const [house, lisbeths] = (await allMemories(db)).sort((a, b) => a.id - b.id).map(m => m.id);
    await call("/hukommelse/glem", { cookie: await as("Gitta"), form: { id: String(house) } });
    expect(await allMemories(db)).toHaveLength(2);
    // The chair's name picked with the shared password is just a member; with her personal login she sees and can forget everything.
    expect(await (await call("/hukommelse", { cookie: await as("Jacob Hauge") })).text()).not.toContain("Lisbeth vil have korte svar");
    await call("/hukommelse/glem", { cookie: await as("Jacob Hauge"), form: { id: String(house) } });
    expect(await allMemories(db)).toHaveLength(2);
    const chairCookie = await personalCookie("Jacob Hauge", NOW - 1000);
    expect(await (await call("/hukommelse", { cookie: chairCookie })).text()).toContain("Lisbeth vil have korte svar");
    await call("/hukommelse/glem", { cookie: chairCookie, form: { id: String(lisbeths) } });
    await call("/hukommelse/glem", { cookie: chairCookie, form: { id: String(house) } });
    expect(await allMemories(db)).toHaveLength(0);
    expect((await call("/hukommelse")).status).toBe(401);
  });
});
