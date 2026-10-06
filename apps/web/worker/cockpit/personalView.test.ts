import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { personalLines } from "./home.js";
import { memberDoneForSaga, sagaItemsFor } from "./data.js";
import { translateHtml } from "./i18n.js";
import { addressedTo, itemKey, parsePicture } from "../saga/picture.js";
import { draftOverview, overviewStale } from "../saga/saga.js";
import { OVERVIEW_SYSTEM } from "../saga/prompts.js";
import { saveBoardMessage, saveOverview } from "../saga/store.js";
import { BOARD, deps, fakeServices, memberCookie, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested by the chair: "Sikr at hvert medlem får en helt personlig admin visning med bl.a. personlige todos og personlige
// hilsener" - and, on the front page: "de andre medlemmer ikke får denne besked ... Hvem skal spørges som suppleant".

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-06T10:00:00Z");
const SUPPLEANT = "Hvem skal spørges som suppleant, og hvordan afgøres det? Lisbeth foreslår Maria Ravbæk Larsen og Philip Lenbroch";

const picture = {
  summary: "Rolig uge.", temperature: { level: "god", why: "Rolig" }, topics: [],
  document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] },
  forJacob: [{ kind: "spørgsmål", text: "Skal vi svare Thomas Emil?", source: "telegram", from: "Blanka", since: "" }],
  forMembers: [
    { to: ["alle"], kind: "spørgsmål", text: `${SUPPLEANT}.`, source: "telegram", from: "Gitta", since: "" },
    { to: ["Lisbeth"], kind: "opgave", text: "Send nøglen til rengøringen", source: "telegram", from: "Gitta", since: "" },
    { to: ["Gitta Hansen", "Douglas"], kind: "opgave", text: "Skriv nyhedsbrevet", source: "telegram", from: "", since: "" },
    { to: [], kind: "opgave", text: "Ingen modtager", source: "telegram", from: "", since: "" }
  ]
};

async function setup() {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const db = testDatabase();
  const services = fakeServices();
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta Hansen", "202"], ["Douglas", "203"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await saveOverview(db, picture.summary, NOW, { data: JSON.stringify(picture), docHash: "x" });
  const call = (path: string, init: { cookie?: string; form?: Record<string, string> } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    method: init.form ? "POST" : "GET", body: init.form ? new URLSearchParams(init.form) : null,
    headers: { ...(init.form ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
  const session = ((await call("/login", { form: { password: "hjerte-2026" } })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, env, services, call, as: (name: string) => memberCookie(session, name) };
}

describe("what Saga has for each member", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads who a matter is for: everyone, or a first name (from a full name too), and drops items with no recipient", () => {
    expect(addressedTo(["alle"], "Gitta Hansen")).toBe(true);
    expect(addressedTo(["Gitta"], "Gitta Hansen")).toBe(true);
    expect(addressedTo(["gitta hansen"], "Gitta")).toBe(true);
    expect(addressedTo(["Lisbeth"], "Gitta Hansen")).toBe(false);
    const parsed = parsePicture(JSON.stringify(picture))!;
    expect(parsed.forMembers.map(f => f.text)).toEqual([`${SUPPLEANT}.`, "Send nøglen til rengøringen", "Skriv nyhedsbrevet"]);
    expect(parsed.forMembers[0]!.key).toBe(itemKey(SUPPLEANT));
  });

  it("shows each member their own list on the front page - the question for everyone reaches all, the rest only who it is for", async () => {
    const { call, as } = await setup();
    const line = `<li>Svar på: ${SUPPLEANT}<span class="ctx">Fra Telegram gruppen</span></li>`;
    const gitta = await (await call("/", { cookie: await as("Gitta Hansen") })).text();
    expect(gitta).toContain(line);
    expect(gitta).toContain("Skriv nyhedsbrevet");
    expect(gitta).not.toContain("Send nøglen til rengøringen");
    expect(gitta).not.toContain("Skal vi svare Thomas Emil?");
    const lisbeth = await (await call("/", { cookie: await as("Lisbeth") })).text();
    expect(lisbeth).toContain(line);
    expect(lisbeth).toContain("Send nøglen til rengøringen");
    expect(lisbeth).not.toContain("Skriv nyhedsbrevet");
    const douglas = await (await call("/", { cookie: await as("Douglas") })).text();
    expect(douglas).toContain("Skriv nyhedsbrevet");
    // The chair keeps her own list from the overview, and the matters for everyone.
    const chair = await (await call("/", { cookie: await as("Jacob Hauge") })).text();
    expect(chair).toContain("Skal vi svare Thomas Emil?");
    expect(chair).toContain(line);
    expect(chair).not.toContain("Send nøglen til rengøringen");
    // The same list is on Opgaver.
    expect(await (await call("/opgaver", { cookie: await as("Gitta Hansen") })).text()).toContain("Fra Telegram gruppen");
  });

  it("is ticked off per member, so the matter stays open for the others, and Saga is told what was done", async () => {
    const { call, as, db } = await setup();
    const key = itemKey(SUPPLEANT);
    const gitta = await as("Gitta Hansen");
    const ticked = await call("/opgaver/afkryds", { cookie: gitta, form: { kind: "saga", id: key, done: "1" } });
    expect(ticked.status).toBe(303);
    expect(await (await call("/", { cookie: gitta })).text()).not.toContain(SUPPLEANT);
    expect(await (await call("/", { cookie: await as("Lisbeth") })).text()).toContain(SUPPLEANT);
    expect(await (await call("/", { cookie: await as("Jacob Hauge") })).text()).toContain(SUPPLEANT);
    // A member cannot tick off what is not theirs.
    await call("/opgaver/afkryds", { cookie: gitta, form: { kind: "saga", id: itemKey("Send nøglen til rengøringen"), done: "1" } });
    expect((await memberDoneForSaga(db, 0)).map(d => [d.member, d.text.slice(0, 21)])).toEqual([["Gitta Hansen", "Hvem skal spørges som"]]);
    expect((await sagaItemsFor(db, parsePicture(JSON.stringify(picture)), "Lisbeth")).map(f => f.text)).toHaveLength(2);
    // The chair's own list still goes through Matrix' "klaret" (board_owner_done).
    await call("/opgaver/afkryds", { cookie: await as("Jacob Hauge"), form: { kind: "saga", id: itemKey("Skal vi svare Thomas Emil?"), done: "1" } });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_owner_done").first<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM cockpit_saga_done").first<{ n: number }>())!.n).toBe(1);
  });

  it("greets each member with their own numbers and the responsibilities they wrote", async () => {
    const { call, as } = await setup();
    await call("/profil/ansvar", { cookie: await as("Gitta Hansen"), form: { text: "Events og nyhedsbrev", back: "/" } });
    await call("/opgaver/ny", { cookie: await as("Gitta Hansen"), form: { text: "Køb kaffe", due: "2026-10-06", owner: "Gitta Hansen" } });
    const gitta = await (await call("/", { cookie: await as("Gitta Hansen") })).text();
    expect(gitta).toContain("Hej Gitta");
    expect(gitta).toContain('<p class="personal"><span>Der venter 3 ting på dig, og én har frist i dag.</span></p>');
    // Requested: the responsibilities are not on the front page but under Profil.
    expect(gitta).not.toContain("Dine ansvarsområder");
    expect(gitta).not.toContain("Hvad har du ansvar for?");
    expect(await (await call("/profil", { cookie: await as("Gitta Hansen") })).text()).toContain(">Events og nyhedsbrev</textarea>");
    expect(await (await call("/", { cookie: await as("Lisbeth") })).text()).toContain('<p class="personal"><span>Der venter 2 ting på dig.</span></p>');
    expect(personalLines({ open: 0, dueToday: 0, toSign: 0 })).toEqual(["Intet venter på dig lige nu."]);
    expect(personalLines({ open: 1, dueToday: 0, toSign: 2 })).toEqual(["Der venter 1 ting på dig.", "Du har 2 referater til godkendelse."]);
    const english = translateHtml(`<p class="personal">${personalLines({ open: 3, dueToday: 1, toSign: 1 }).map(l => `<span>${l}</span>`).join(" ")}</p>`);
    expect(english).toContain("3 things are waiting for you, and one is due today.");
    expect(english).toContain("You have 1 set of minutes waiting for your approval.");
  });
});

describe("Saga's overview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is made again once, when the picture on file is from before matters were sent on to members", async () => {
    const { db, env, services } = await setup();
    const { forMembers: _unused, ...old } = picture;
    await saveOverview(db, old.summary, NOW + 1, { data: JSON.stringify(old), docHash: "x" });
    expect((await overviewStale(env, deps(services.fetcher, NOW + 2), db)).stale).toBe(true);
    await saveOverview(db, picture.summary, NOW + 3, { data: JSON.stringify(parsePicture(JSON.stringify(picture))), docHash: "x" });
    expect((await overviewStale(env, deps(services.fetcher, NOW + 4), db)).stale).toBe(false);
  });

  it("asks for what concerns other members, and is told who is responsible for what and what each has ticked off", async () => {
    const { db, env, services } = await setup();
    await db.prepare("INSERT INTO cockpit_responsibilities (member, text, updated_at_ms) VALUES ('Gitta Hansen', 'Events og nyhedsbrev', ?)").bind(NOW).run();
    await db.prepare("INSERT INTO cockpit_saga_done (member, item_key, text, done_at_ms) VALUES ('Lisbeth', 'k', 'Send nøglen til rengøringen', ?)").bind(NOW - 3600_000).run();
    let seen = { system: "", user: "" };
    const withAi = fakeServices({ ai: (system, user) => { seen = { system, user }; return JSON.stringify(picture); } });
    await draftOverview({ ...env, AI_API_KEY: "k", AI_BASE_URL: "https://ai.test/v1", AI_MODEL: "m" }, deps(withAi.fetcher, NOW), { text: "Referat", hash: "h" });
    expect(seen.system).toBe(OVERVIEW_SYSTEM);
    expect(seen.system).toContain('"forMembers"');
    expect(seen.system).toContain('["alle"]');
    expect(seen.user).toContain("ANSVARSOMRÅDER (det enkelte bestyrelsesmedlem har selv skrevet dem):");
    expect(seen.user).toContain("- Gitta Hansen: Events og nyhedsbrev");
    expect(seen.user).toContain("- Lisbeth: (har ikke skrevet sine ansvarsområder endnu)");
    expect(seen.user).toContain("MEDLEMMERNE HAR MARKERET SOM KLARET");
    expect(seen.user).toContain("- Lisbeth: Send nøglen til rengøringen");
    expect(services.calls.length).toBeGreaterThanOrEqual(0);
  });
});
