import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { outcome } from "./votes.js";
import { saveMeeting } from "./data.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";

// Requested: "Vi skal også finde plads til et nyt punkt - \"Opret forslag til afstemning\". Her er ideen: Man kan komme med et
// forslag, og så kan bestyrelsesmedlemmerne digitalt stemme for det. Ved flertal er forslaget vedtaget. Når et forslag er
// stillet, skal hvert bestyrelsesmedlem have punktet på sin to do."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");
const DAY = 86_400_000;
const ballots = (...votes: Array<"for" | "imod" | "undlader">) => votes.map(vote => ({ vote }));

describe("digital votes in the board", () => {
  it("adopts at more than half of the board, rejects when a majority can no longer come or at the deadline", () => {
    const p = { members: 5, deadline_ms: NOW + 7 * DAY };
    expect(outcome(p, ballots("for", "for"), NOW)).toBe("open");
    expect(outcome(p, ballots("for", "for", "for"), NOW)).toBe("adopted");
    expect(outcome(p, ballots("imod", "imod", "undlader"), NOW)).toBe("rejected");
    expect(outcome(p, ballots("for", "imod", "undlader"), NOW)).toBe("open");
    expect(outcome(p, ballots("for", "for"), NOW + 8 * DAY)).toBe("rejected");
    expect(outcome({ members: 4, deadline_ms: NOW + DAY }, ballots("for", "for"), NOW)).toBe("open");
    expect(outcome({ members: 4, deadline_ms: NOW + DAY }, ballots("for", "for", "for"), NOW)).toBe("adopted");
  });

  // Requested: "Der, hvor man skriver forslag, skal være lidt tydeligere på siden. Den skal i hvert fald ikke ligge i bunden. Derudover skal forslaget fremgå på alles
  // forside, eventuelt i en lidt anden farve, som dog passer til farveskemaet."
  it("has the form for a proposal first on Beslutninger, and shows an open proposal on everyone's front page where they can vote", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    const services = fakeServices({ ai: () => "Svar." });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);

    // The form is the first card, above what is up for vote and the decisions - with or without a proposal.
    const empty = await (await call("/beslutninger", { cookie: as("Gitta") })).text();
    expect(empty).toContain('<div class="card propose" id="nyt">');
    expect(empty.indexOf('id="nyt"')).toBeLessThan(empty.indexOf("<h2>Besluttet</h2>"));
    expect(await (await call("/", { cookie: as("Gitta") })).text()).not.toContain('id="forslag"');

    await call("/afstemninger/ny", { method: "POST", cookie: as("Lisbeth"), body: form({ title: "Vi åbner salen om søndagen", text: "", days: "7" }) });
    const page = await (await call("/beslutninger", { cookie: as("Gitta") })).text();
    expect(page.indexOf('id="nyt"')).toBeLessThan(page.indexOf('id="afstemning"'));
    expect(page.indexOf('id="afstemning"')).toBeLessThan(page.indexOf("<h2>Besluttet</h2>"));
    expect(page.indexOf("Stem for")).toBeLessThan(page.indexOf("<h2>Besluttet</h2>"));

    // On everyone's front page, in the accent-tinted card, with the vote buttons that bring the member back to the card.
    for (const who of ["Jacob Hauge", "Lisbeth", "Gitta"]) {
      const front = await (await call("/", { cookie: as(who) })).text();
      expect(front, who).toContain('<section class="panel votes-panel" id="forslag">');
      expect(front, who).toContain('<a href="/beslutninger#p1">Vi åbner salen om søndagen</a>');
      expect(front, who).toContain("Stillet af Lisbeth");
      expect(front, who).toContain('<input type="hidden" name="back" value="forside">');
      expect(front, who).toContain("Du mangler at stemme");
    }
    const voted = await call("/afstemninger/stem", { method: "POST", cookie: as("Lisbeth"), body: form({ id: "1", vote: "for", back: "forside" }) });
    expect(voted.headers.get("location")).toBe("/#forslag");
    const lisbeth = await (await call("/", { cookie: as("Lisbeth") })).text();
    const card = lisbeth.slice(lisbeth.indexOf('id="forslag"'), lisbeth.indexOf('id="forslag"') + 3000);
    expect(card).not.toContain("Du mangler at stemme");
    expect(card).toContain('<button name="vote" value="for" class="" aria-pressed="true">Stem for</button>');
    expect(card).toContain("1 for, 0 imod, 0 undlader sig af 3");
    expect(await (await call("/", { cookie: as("Gitta") })).text()).toContain("Du mangler at stemme");
    // From Beslutninger a vote still goes back to Beslutninger.
    expect((await call("/afstemninger/stem", { method: "POST", cookie: as("Gitta"), body: form({ id: "1", vote: "for" }) })).headers.get("location")).toBe("/beslutninger?besked=stemt#p1");
    // Decided: gone from the front page.
    expect(await (await call("/", { cookie: as("Jacob Hauge") })).text()).not.toContain('id="forslag"');
  });

  it("puts a new proposal on every member's to-do until they have voted, and adopts it at a majority", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    const services = fakeServices({ ai: () => "Svar." });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);

    // Requested: "Beslutninger og Afstemninger skal merges" - one page; the old address leads there.
    expect(await (await call("/", { cookie: as("Lisbeth") })).text()).not.toContain('href="/afstemninger">Afstemninger</a>');
    expect((await call("/afstemninger?besked=ny", { cookie: as("Lisbeth") })).headers.get("location")).toBe("/beslutninger?besked=ny");
    const made = await call("/afstemninger/ny", { method: "POST", cookie: as("Lisbeth"), body: form({ title: "Vi forlænger prøveperioden til 1. december", text: "Flere nye medlemmer.", days: "7" }) });
    expect(made.headers.get("location")).toContain("besked=ny");

    // On everyone's to-do - also the proposer's - until they vote.
    for (const who of ["Jacob Hauge", "Lisbeth", "Gitta"]) {
      expect(await (await call("/opgaver", { cookie: as(who) })).text()).toContain("Stem om: Vi forlænger prøveperioden til 1. december");
      expect(await (await call("/", { cookie: as(who) })).text()).toContain("Stem om: Vi forlænger prøveperioden");
    }
    const page = await (await call("/beslutninger", { cookie: as("Gitta") })).text();
    expect(page).toContain("vedtaget ved 2 stemmer for");
    expect(page).toContain("Stem for");

    await call("/afstemninger/stem", { method: "POST", cookie: as("Lisbeth"), body: form({ id: "1", vote: "for" }) });
    expect(await (await call("/opgaver", { cookie: as("Lisbeth") })).text()).not.toContain("Stem om:");
    expect(await (await call("/opgaver", { cookie: as("Gitta") })).text()).toContain("Stem om:");
    await call("/afstemninger/stem", { method: "POST", cookie: as("Gitta"), body: form({ id: "1", vote: "for" }) });

    expect(await db.prepare("SELECT status FROM board_proposals WHERE id = 1").first()).toEqual({ status: "adopted" });
    // Decided: off the last member's to-do, on the list of decisions, and no more votes.
    expect(await (await call("/opgaver", { cookie: as("Jacob Hauge") })).text()).not.toContain("Stem om:");
    const decisions = await (await call("/beslutninger", { cookie: as("Jacob Hauge") })).text();
    expect(decisions).toContain("Vi forlænger prøveperioden til 1. december");
    expect(decisions).toContain('href="#p1">Afstemning</a>');
    expect(decisions).toContain('<article class="prop" id="p1">');
    const late = await call("/afstemninger/stem", { method: "POST", cookie: as("Jacob Hauge"), body: form({ id: "1", vote: "imod" }) });
    expect(late.headers.get("location")).toContain("besked=afgjort");
    // Requested: "Giv det et flot badge \"GODKENDT\" ved godkendelse".
    expect(await (await call("/beslutninger", { cookie: as("Jacob Hauge") })).text()).toContain('<span class="approved-badge">');
    expect(decisions).toContain("GODKENDT</span>");
  });

  it("lets a member note that they want to discuss a proposal at a meeting, for Saga's agenda, while the vote goes on", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    let agendaPrompt = "";
    const services = fakeServices({ ai: system => { agendaPrompt = system; return '{"items":["Godkendelse af dagsorden"]}'; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);

    await call("/afstemninger/ny", { method: "POST", cookie: as("Lisbeth"), body: form({ title: "Vi holder åbent hus i november", text: "", days: "7" }) });
    expect(await (await call("/beslutninger", { cookie: as("Gitta") })).text()).toContain("Jeg ønsker at drøfte dette på et møde");
    const noted = await call("/afstemninger/droeft", { method: "POST", cookie: as("Gitta"), body: form({ id: "1" }) });
    expect(noted.headers.get("location")).toContain("besked=droeft");
    const page = await (await call("/beslutninger", { cookie: as("Jacob Hauge") })).text();
    expect(page).toContain("Ønskes drøftet på et møde af Gitta");
    expect(page).toContain("Stem for");
    expect(await (await call("/opgaver", { cookie: as("Gitta") })).text()).toContain("Stem om: Vi holder åbent hus i november");

    // Saga's agenda suggestion sees it.
    const meetingId = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "" }, "Jacob Hauge", NOW);
    await call(`/moder/${meetingId}/forslag`, { method: "POST", cookie: as("Jacob Hauge") });
    expect(agendaPrompt).toContain("Vi holder åbent hus i november (forslag fra Lisbeth)");
    expect(agendaPrompt).toContain("ØNSKES DRØFTET PÅ ET MØDE af Gitta");

    // Pressed again, it is taken back.
    expect((await call("/afstemninger/droeft", { method: "POST", cookie: as("Gitta"), body: form({ id: "1" }) })).headers.get("location")).toContain("besked=ikkedroeft");
    expect(await (await call("/beslutninger", { cookie: as("Jacob Hauge") })).text()).not.toContain("Ønskes drøftet på et møde af");
  });
});
