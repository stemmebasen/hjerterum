import { describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { answerLoginRequest, scheduledBoardAccess, stillOnBoard } from "./personalLogin.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested: "Ja" to letting Saga ask Telegram whether a person is in the board's group right now - a member taken out of the group loses access.

const NOW = Date.parse("2026-10-06T15:00:00Z");
const HOUR = 3_600_000;
const ORIGIN = "https://admin.hjerterum.example";

async function board(chatMembers: Record<string, string> = {}) {
  const db = testDatabase();
  const services = fakeServices({ chatMembers });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", COCKPIT_URL: ORIGIN });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  return { db, env, services };
}
const sent = (services: ReturnType<typeof fakeServices>) => services.calls.filter(c => c.url.endsWith("/sendMessage")).map(c => String((c.body as { text: string }).text));

describe("who is in the board's group right now", () => {
  it("reads Telegram's answer: in as member, administrator, creator or restricted-but-in; out as left or kicked; unknown when it cannot say", async () => {
    const { env } = await board();
    const ask = async (status: string, id = "201") => stillOnBoard(env, deps(fakeServices({ chatMembers: { [id]: status } }).fetcher, NOW), id);
    for (const status of ["member", "administrator", "creator"]) expect(await ask(status)).toBe(true);
    for (const status of ["left", "kicked"]) expect(await ask(status)).toBe(false);
    expect(await ask("error")).toBeNull();
    expect(await stillOnBoard(env, deps(fakeServices({ chatMembers: { [OWNER]: "left" } }).fetcher, NOW), OWNER)).toBe(true);
    const { SAGA_BOARD_CHAT_ID: _group, ...noGroup } = env;
    expect(await stillOnBoard(noGroup, deps(fakeServices().fetcher, NOW), "201")).toBeNull();
  });
});

describe("a login link from Saga", () => {
  it("goes to someone who is in the group, and not to someone who has left it or when Telegram cannot say", async () => {
    const { db, env, services } = await board({ "201": "member", "202": "left" });
    await answerLoginRequest(env, deps(services.fetcher, NOW), db, "201", "201");
    expect(sent(services).at(-1)).toContain("/login/link/");
    await answerLoginRequest(env, deps(services.fetcher, NOW), db, "202", "202");
    expect(sent(services).at(-1)).toContain("ikke længere med i bestyrelsens gruppe");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM cockpit_login_links WHERE member = 'Gitta'").first<{ n: number }>())!.n).toBe(0);

    const unsure = await board({ "202": "error" });
    await answerLoginRequest(unsure.env, deps(unsure.services.fetcher, NOW), unsure.db, "202", "202");
    expect(sent(unsure.services).at(-1)).toContain("Prøv igen om lidt");
    expect((await unsure.db.prepare("SELECT COUNT(*) AS n FROM cockpit_login_links").first<{ n: number }>())!.n).toBe(0);
    // The chair's own account always gets one.
    const away = await board({ [OWNER]: "left" });
    await answerLoginRequest(away.env, deps(away.services.fetcher, NOW), away.db, OWNER, OWNER);
    expect(sent(away.services).at(-1)).toContain("/login/link/");
  });
});

describe("the hourly check", () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

  it("signs out whoever has left the group - once - and leaves the others alone", async () => {
    const { db, env, services } = await board({ "201": "left" });
    const link = (member: string, id: string, at: number) => db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(`h-${member}`, member, id, at, at + 900_000, at).run();
    await link("Lisbeth", "201", NOW - 5 * HOUR);
    await link("Gitta", "202", NOW - 5 * HOUR);
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };

    await scheduledBoardAccess(env, deps(services.fetcher, NOW), db, claim);
    const rows = await db.prepare("SELECT member, after_ms FROM cockpit_signouts").all<{ member: string; after_ms: number }>();
    expect(rows.results).toEqual([{ member: "Lisbeth", after_ms: NOW }]);
    // The same hour runs once; the next hour does not move the date she was signed out.
    await scheduledBoardAccess(env, deps(services.fetcher, NOW + 60_000), db, claim);
    await scheduledBoardAccess(env, deps(services.fetcher, NOW + HOUR), db, claim);
    expect((await db.prepare("SELECT after_ms FROM cockpit_signouts WHERE member = 'Lisbeth'").first<{ after_ms: number }>())!.after_ms).toBe(NOW);
    // Telegram not answering changes nothing for anyone.
    const quiet = await board({ "201": "error", "202": "error" });
    await quiet.db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES ('x', 'Lisbeth', '201', ?, ?, ?)").bind(NOW - HOUR, NOW, NOW - HOUR).run();
    await scheduledBoardAccess(quiet.env, deps(quiet.services.fetcher, NOW), quiet.db, async () => true);
    expect((await quiet.db.prepare("SELECT COUNT(*) AS n FROM cockpit_signouts").first<{ n: number }>())!.n).toBe(0);
  });

  it("makes a login that was given before the member left stop working", async () => {
    const { db, env, services } = await board({ "201": "kicked" });
    const issued = NOW - 2 * HOUR;
    await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES ('h', 'Lisbeth', '201', ?, ?, ?)").bind(issued, issued + 900_000, issued).run();
    const cookie = await personalCookie("Lisbeth", issued);
    const open = (at: number) => handleCockpitRequest(new Request(`${ORIGIN}/`, { headers: { cookie } }), env, deps(services.fetcher, at));
    expect((await open(NOW - HOUR)).status).toBe(200);
    await scheduledBoardAccess(env, deps(services.fetcher, NOW), db, async () => true);
    expect((await open(NOW + 1000)).status).toBe(401);
  });
});
