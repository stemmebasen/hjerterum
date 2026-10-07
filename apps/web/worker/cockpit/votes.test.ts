import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { outcome } from "./votes.js";
import { withMeetingProposals } from "./agenda.js";
import { translateHtml } from "./i18n.js";
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

    // The form is the first thing on the page, above what is up for vote and the decisions - with or without a proposal. Requested: "'Opret forslag' fylder for meget nu.
    // Kan den være en fold-ud bjælke i højre side?" - a tab on the right edge, closed until pressed.
    const empty = await (await call("/beslutninger", { cookie: as("Gitta") })).text();
    expect(empty).toContain('<aside class="drawer" id="nyt" aria-label="Opret forslag"><button type="button" class="tab" aria-expanded="false" aria-controls="nyt-panel">');
    expect(empty).toContain('if(location.hash==="#nyt")set(true)');
    expect(empty).not.toContain('class="card propose"');
    expect(empty.indexOf('id="nyt"')).toBeLessThan(empty.indexOf("<h2>Besluttet</h2>"));
    expect(await (await call("/", { cookie: as("Gitta") })).text()).not.toContain('id="forslag"');
    // A quick button on every member's front page, whether or not a proposal is open.
    expect(await (await call("/", { cookie: as("Gitta") })).text()).toContain('<a class="button propose-btn" href="/beslutninger#nyt">+ Stil et forslag</a>');

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
    // Decided: the open card is gone from the front page, and what was voted in stands there for a week in a gold-edged card with a laurel.
    const done = await (await call("/", { cookie: as("Jacob Hauge") })).text();
    expect(done).not.toContain('id="forslag"');
    expect(done).toContain('<section class="panel adopted-panel" id="vedtaget">');
    expect(done).toContain('<svg class="laurel"');
    expect(done).toContain('<a href="/beslutninger#p1">Vi åbner salen om søndagen</a>');
    expect(done).toContain("GODKENDT</span>");
    // Requested: "Du må gerne få det til at se lidt højtideligt ud, når et forslag er stemt ind. Start et forslag enten med et badge eller en laurbær." - on Beslutninger too.
    const decided = await (await call("/beslutninger", { cookie: as("Jacob Hauge") })).text();
    expect(decided).toContain('<article class="prop adopted" id="p1"><div class="seal"><svg class="laurel"');
    expect(decided).toMatch(/<div class="pbody"><span class="approved-badge">[^]*GODKENDT<\/span><h3>Vi åbner salen om søndagen<\/h3>/);
    // After a week the front page no longer announces it.
    const later = await handleCockpitRequest(new Request(ORIGIN + "/", { headers: { cookie: as("Jacob Hauge") } }), env, deps(services.fetcher, NOW + 8 * DAY));
    expect(await later.text()).not.toContain('id="vedtaget"');
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
    expect(decisions).toContain('<article class="prop adopted" id="p1">');
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

  // Requested: "Når man stiller et forslag skal man kunne vælge om man ønsker digital afstemning eller afstemning på næste møde. Hvis næste møde forslår Saga det som punkt på næste dagsorden."
  it("lets the proposer choose between a digital vote and a vote at the next meeting, and puts the latter on Saga's agenda", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    let agendaPrompt = "";
    const services = fakeServices({ ai: system => { agendaPrompt = system; return '{"items":["Godkendelse af dagsorden","Eventuelt"]}'; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);
    const meetingId = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "" }, "Jacob Hauge", NOW);

    // The form asks how: digital (the default) or at the next meeting - which one's date is named.
    const formPage = await (await call("/beslutninger", { cookie: as("Lisbeth") })).text();
    expect(formPage).toContain('<input type="radio" name="mode" value="digital" checked>');
    expect(formPage).toContain('<input type="radio" name="mode" value="moede">');
    expect(formPage).toContain("Saga foreslår det som punkt på dagsordenen til mødet");

    const made = await call("/afstemninger/ny", { method: "POST", cookie: as("Lisbeth"), body: form({ title: "Vi hæver prisen på Lydbad", text: "Salen koster mere.", days: "7", mode: "moede" }) });
    expect(made.headers.get("location")).toBe("/beslutninger?besked=nymoede#p1");
    expect(await db.prepare("SELECT mode, status FROM board_proposals WHERE id = 1").first()).toEqual({ mode: "moede", status: "open" });

    // Not a to-do to vote on, no vote buttons, no deadline - it stands under "Til næste møde" on Beslutninger and on the front page.
    for (const who of ["Jacob Hauge", "Lisbeth", "Gitta"]) {
      expect(await (await call("/opgaver", { cookie: as(who) })).text(), who).not.toContain("Stem om:");
      const front = await (await call("/", { cookie: as(who) })).text();
      expect(front, who).toContain('<section class="panel votes-panel" id="moede">');
      expect(front, who).toContain('<a href="/beslutninger#p1">Vi hæver prisen på Lydbad</a>');
      expect(front, who).not.toContain('id="forslag"');
    }
    const page = await (await call("/beslutninger?besked=nymoede", { cookie: as("Gitta") })).text();
    expect(page).toContain('<div class="card" id="moede"><h2>Til næste møde');
    expect(page).toContain("Forslaget er stillet til næste møde");
    expect(page).toContain("stemmes om på næste møde");
    expect(page).not.toContain('id="afstemning"');
    expect(page).not.toContain("Stem for");
    expect(await (await call("/afstemninger/stem", { method: "POST", cookie: as("Gitta"), body: form({ id: "1", vote: "for" }) })).headers.get("location")).toContain("besked=afgjort");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_votes").first()).toEqual({ n: 0 });

    // No deadline closes it: weeks later it is still open.
    const later = await handleCockpitRequest(new Request(ORIGIN + "/beslutninger", { headers: { cookie: as("Gitta") } }), env, deps(services.fetcher, NOW + 20 * DAY));
    expect(await later.text()).toContain('id="moede"');
    expect(await db.prepare("SELECT status FROM board_proposals WHERE id = 1").first()).toEqual({ status: "open" });

    // Saga's suggestion for the agenda knows it - and has it on the list even when the model leaves it out.
    await call("/afstemninger/ny", { method: "POST", cookie: as("Gitta"), body: form({ title: "Vi holder åbent hus i november", text: "", days: "7" }) });
    const suggested = await call(`/moder/${meetingId}/forslag`, { method: "POST", cookie: as("Jacob Hauge") });
    expect(suggested.status).toBeLessThan(400);
    const suggestion = await suggested.text();
    expect(agendaPrompt).toContain("Vi hæver prisen på Lydbad (forslag fra Lisbeth): AFSTEMNING PÅ NÆSTE MØDE");
    expect(agendaPrompt).toContain("Vi holder åbent hus i november (forslag fra Gitta): Til afstemning");
    expect(agendaPrompt).not.toContain("Vi holder åbent hus i november (forslag fra Gitta): AFSTEMNING PÅ NÆSTE MØDE");
    expect(suggestion).toContain("Afstemning: Vi hæver prisen på Lydbad (stillet af Lisbeth)");
    expect(suggestion).not.toContain("Afstemning: Vi holder åbent hus");

    // After the meeting a board member notes the outcome: voted in at the meeting, with the laurel - and on the list of decisions, marked as from the meeting.
    const decided = await call("/afstemninger/moede", { method: "POST", cookie: as("Jacob Hauge"), body: form({ id: "1", result: "adopted" }) });
    expect(decided.headers.get("location")).toBe("/beslutninger?besked=moedevedtaget#p1");
    expect(await db.prepare("SELECT status FROM board_proposals WHERE id = 1").first()).toEqual({ status: "adopted" });
    expect((await call("/afstemninger/moede", { method: "POST", cookie: as("Jacob Hauge"), body: form({ id: "1", result: "rejected" }) })).headers.get("location")).toContain("besked=afgjort");
    // A digital proposal cannot be decided that way.
    expect((await call("/afstemninger/moede", { method: "POST", cookie: as("Jacob Hauge"), body: form({ id: "2", result: "adopted" }) })).headers.get("location")).toContain("besked=afgjort");
    const after = await (await call("/beslutninger", { cookie: as("Gitta") })).text();
    expect(after).toContain('<article class="prop adopted" id="p1"><div class="seal"><svg class="laurel"');
    expect(after).toContain("vedtaget på mødet");
    expect(after).toContain('href="#p1">Møde</a>');
    expect(await (await call("/", { cookie: as("Gitta") })).text()).toContain("Vedtaget på mødet");
  });

  // Requested: "Laurbær designet skal også vises på historiske beslutninger"
  it("shows the laurel on every historic decision - the votes with the badge too", async () => {
    const db = testDatabase();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth"].entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
    // A vote voted in a month ago (no longer on the front page), and one decision from the minutes.
    await db.prepare("INSERT INTO board_proposals (title, text, created_by, members, status, deadline_ms, decided_at_ms, created_at_ms) VALUES ('Vi bytter kalender', '', 'Lisbeth', 2, 'adopted', ?, ?, ?)").bind(NOW - 29 * DAY, NOW - 30 * DAY, NOW - 40 * DAY).run();
    await db.prepare("INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms) VALUES ('upload', 'f1', 'm.m4a', 'approved', '2026-09-10', ?, 1, 1)")
      .bind("# Referat\n## Beslutninger\n- Medlemskab koster 99 kr. om måneden").run();
    const services = fakeServices({ ai: () => "Svar." });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, cookie: string) => handleCockpitRequest(new Request(ORIGIN + path, { headers: { cookie } }), env, deps(services.fetcher, NOW));
    const form = new FormData(); form.append("password", "hjerte-2026");
    const session = ((await handleCockpitRequest(new Request(ORIGIN + "/login", { method: "POST", body: form, headers: { origin: ORIGIN } }), env, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = await memberCookies(session);
    const page = await (await call("/beslutninger", as("Lisbeth"))).text();
    const row = page.slice(page.indexOf('<table id="list"'), page.indexOf('</table>'));
    expect(row).toContain('<div class="dec"><span class="seal"><svg class="laurel"');
    expect(row).toMatch(/<div class="said"><span class="approved-badge">[^]*GODKENDT<\/span>Vi bytter kalender<\/div>/);
    // The decision from the minutes wears the laurel too, without the badge of a vote.
    expect(row).toMatch(/<div class="said">Medlemskab koster 99 kr\. om måneden<\/div>/);
    expect(row.match(/<svg class="laurel"/g)).toHaveLength(2);
    // The vote is old: not in the card of the last week, but folded among the decided votes - and still on the list of decisions with its laurel.
    expect(page).not.toContain('id="vedtaget"');
  });
});

describe("a proposal for the next meeting on Saga's agenda", () => {
  it("adds it before Eventuelt when the model left it out, and leaves it when it is already there", () => {
    const wanted = [{ title: "Vi hæver prisen på Lydbad", created_by: "Lisbeth Nielsen" }];
    expect(withMeetingProposals(["Godkendelse af dagsorden", "Eventuelt"], wanted)).toEqual(["Godkendelse af dagsorden", "Afstemning: Vi hæver prisen på Lydbad (stillet af Lisbeth)", "Eventuelt"]);
    expect(withMeetingProposals(["Godkendelse af dagsorden", "Afstemning: vi hæver  prisen på lydbad (Lisbeth)", "Eventuelt"], wanted)).toHaveLength(3);
    expect(withMeetingProposals(["Punkt"], wanted)).toEqual(["Punkt", "Afstemning: Vi hæver prisen på Lydbad (stillet af Lisbeth)"]);
    // Twelve points at most: the proposal pushes out the last of the others, and Eventuelt stays last.
    const twelve = Array.from({ length: 11 }, (_, i) => `Punkt ${i + 1}`).concat("Eventuelt");
    const out = withMeetingProposals(twelve, wanted);
    expect(out).toHaveLength(12);
    expect(out[10]).toContain("Afstemning: Vi hæver prisen på Lydbad");
    expect(out[11]).toBe("Eventuelt");
  });
});

describe("English for the proposal at the next meeting", () => {
  it("has the form, the card and the notes in English", () => {
    const en = translateHtml(`<button class="tab"><i>+</i>Opret forslag</button><label><b>På næste møde</b><span>Saga foreslår det som punkt på dagsordenen til mødet tor. 15. okt.</span></label>
<h2>Til næste møde</h2><p>Forslag, der stemmes om på det næste bestyrelsesmøde (tor. 15. okt.). Saga foreslår dem som punkter på dagsordenen.</p>
<div class="who">Stillet af Lisbeth 2. okt. · stemmes om på næste møde (tor. 15. okt.) - Saga sætter det på dagsordenen</div><div class="who">Stillet af Lisbeth 2. okt. · vedtaget på mødet 15. okt.</div>
<button>Vedtaget på mødet</button><span>Når mødet har stemt:</span>`);
    expect(en).toContain("<i>+</i>Create proposal</button>");
    expect(en).toContain("<b>At the next meeting</b>");
    expect(en).toContain("Saga suggests it as an item on the agenda for the meeting");
    expect(en).toContain("<h2>For the next meeting</h2>");
    expect(en).toContain("Proposals to be voted on at the next board meeting (");
    expect(en).toContain("voted on at the next meeting (");
    expect(en).toContain("Saga puts it on the agenda</div>");
    expect(en).toContain("Proposed by Lisbeth");
    expect(en).toContain("adopted at the meeting 15 Oct");
    expect(en).toContain("<button>Adopted at the meeting</button><span>When the meeting has voted:</span>");
    expect(en).not.toMatch(/stemmes|Saga sætter|på mødet|Opret/);
  });
});
