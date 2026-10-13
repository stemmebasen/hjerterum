import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { askSaga } from "./ask.js";
import { sagaTimeSince } from "./boardNow.js";
import { saveBoardMessage, saveOverview } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookies } from "../saga/test-support.js";

// Reported (Douglas): his to-do "Reply to: Thumbs up to sending the event email as it is, or should the list be changed to only
// highlighted events" sent him nowhere to answer, and Saga said "your to-do list is empty right now".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-13T10:30:00Z"); // Tuesday 12:30 in Copenhagen
const DAY = 86_400_000;
const QUESTION = "Thumbs up to sending the event email as it is, or should the list be changed to only highlighted events?";

async function setup(ai: (system: string, user: string) => string = () => "Svar.") {
  const db = testDatabase();
  for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Douglas"].entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - 3 * DAY, fromAssistant: false });
  await saveBoardMessage(db, { chatId: BOARD, messageId: 41, author: "Jacob Hauge", authorId: "200", text: `Douglas: ${QUESTION}`, sentAtMs: NOW - DAY, fromAssistant: false });
  await saveBoardMessage(db, { chatId: BOARD, messageId: 42, author: "Lisbeth", authorId: "201", text: "Godmorgen", sentAtMs: NOW - DAY + 60_000, fromAssistant: false });
  const picture = { summary: "Roligt.", temperature: { level: "god", why: "" }, topics: [],
    document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] },
    forJacob: [], forMembers: [{ key: "d1", to: ["Douglas"], kind: "spørgsmål", text: QUESTION, source: "telegram", from: "Jacob", since: "2026-10-12" }] };
  await saveOverview(db, picture.summary, NOW - 2 * 3_600_000, { data: JSON.stringify(picture), docHash: "x" });
  const services = fakeServices({ ai });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, env, services, call, as: await memberCookies(session) };
}

describe("what waits on a member", () => {
  it("links a question from the group to where it was asked", async () => {
    const { call, as } = await setup();
    const todos = await (await call("/opgaver", { cookie: as("Douglas") })).text();
    expect(todos).toContain(`Svar på: ${QUESTION}`);
    expect(todos).toContain('Fra Telegram gruppen · <a href="https://t.me/c/222/41" target="_blank" rel="noopener">Svar i gruppen →</a>');
  });

  it("lets Saga see the same list as Dine opgaver", async () => {
    let input = "";
    const { db, env, services } = await setup((system, user) => { input = `${system}\n${user}`; return "Du skal svare Jacob om event-mailen."; });
    await askSaga(env, deps(services.fetcher, NOW), db, "Douglas", { question: "What are my to-dos?", history: [] }, "", "en");
    expect(input).toContain("DET VENTER OGSÅ PÅ DOUGLAS");
    expect(input).toContain(`- Svar på: ${QUESTION} (spurgt af Jacob) - Fra Telegram gruppen, svares i Telegram-gruppen`);
  });

  it("writes Bestyrelsen lige nu at once when asked, at most every ten minutes", async () => {
    let calls = 0;
    const { db, call, as } = await setup(() => { calls++; return "Jacob spørger Douglas om event-mailen."; });
    const first = await call("/lige-nu", { method: "POST", cookie: as("Lisbeth") });
    expect(first.headers.get("location")).toBe("/");
    expect(calls).toBe(1);
    expect((await db.prepare("SELECT text FROM board_now ORDER BY id DESC").first<{ text: string }>())?.text).toBe("Jacob spørger Douglas om event-mailen.");
    await call("/lige-nu", { method: "POST", cookie: as("Douglas") });
    expect(calls).toBe(1);
    expect(await (await call("/", { cookie: as("Lisbeth") })).text()).toContain('<form method="post" action="/lige-nu"');
  });

  // Asked: "opdateres Sagas overblik ikke også baseret på nyeste chats?" - from 07, 12 and 17 (weekends 07), as Bestyrelsen lige nu.
  it("knows the time Saga's overview and Bestyrelsen lige nu belong to", () => {
    const at = (local: string) => Date.parse(`2026-10-${local}:00+02:00`);
    expect(sagaTimeSince(at("13T06:59"), true)).toBeNull();
    expect(sagaTimeSince(at("13T07:40"), true)).toBe(at("13T07:00"));
    expect(sagaTimeSince(at("13T12:30"), true)).toBe(at("13T12:00"));
    expect(sagaTimeSince(at("13T21:59"), true)).toBe(at("13T17:00"));
    expect(sagaTimeSince(at("13T22:00"), true)).toBeNull();
    expect(sagaTimeSince(at("17T15:00"), true)).toBe(at("17T07:00"));
    expect(sagaTimeSince(at("17T15:00"), false)).toBeNull();
  });
});
