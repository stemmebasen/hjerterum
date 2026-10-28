import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { scheduledDeputyAccess } from "./deputies.js";
import { handleSagaRequest } from "../saga/handler.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Hvordan kan vi lave login til vores frivillige og suppleanter. De skal ikke have adgang til bestyrelsens interne diskussioner
// men må gerne se mere generelle ting." - "Lad os starte med suppleant adgang".
const ORIGIN = "https://admin.hjerterum.info";
const NOW = Date.parse("2026-10-28T10:00:00Z");
const DEPUTIES = "-100333";
const MINUTES = "# Referat\n\n## Beslutninger\n- Vi holder åbent hus i november\n\n## Drøftelser\n- Hemmeligt om økonomien";

async function setup(chatMembers: Record<string, string> = {}) {
  const db = testDatabase();
  const services = fakeServices({ chatMembers });
  const env = sagaEnv(db, { COCKPIT_URL: ORIGIN, SAGA_DEPUTY_CHAT_ID: DEPUTIES });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Gitta", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000 });
  await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
    VALUES ('upload', 'f1', 'm1', 'approved', '2026-10-20', ?, 1, 1), ('upload', 'f2', 'm2', 'approved', '2026-10-13', ?, 1, 1)`).bind(MINUTES, "# Internt\n\n## Beslutninger\n- Internt punkt").run();
  await db.prepare("INSERT INTO board_meetings (meeting_date, start_time, place, agenda, created_at_ms, updated_at_ms) VALUES ('2026-11-04', '19:00', 'Hjerterum', 'Velkommen\nÅbent hus\nEvt.', ?, ?)").bind(NOW, NOW).run();
  const call = (path: string, init: RequestInit & { cookie?: string } = {}, now = NOW) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, now));
  const update = (chat: { id: number; type: string }, from: number, text: string, first = "X") => handleSagaRequest(new Request("https://hjerterum.test/api/saga/telegram", {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: NOW / 1000, chat, from: { id: from, first_name: first }, text } }) }), env, deps(services.fetcher, NOW));
  const loginFor = async (from: number) => {
    await update({ id: from, type: "private" }, from, "/login");
    const sent = services.telegram("sendMessage").at(-1)?.body as { chat_id: number | string; text: string };
    const path = /\/login\/link\/[A-Za-z0-9_-]+/.exec(sent.text)?.[0] ?? null;
    return { sent, path };
  };
  const cookiesOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(/,(?=\s*hjerterum_)/).map(c => c.split(";")[0]!.trim()).join("; ");
  const deputy = async (from = 301, first = "Signe") => {
    await update({ id: Number(DEPUTIES), type: "supergroup" }, from, "Hej alle", first);
    const { path } = await loginFor(from);
    return cookiesOf(await call(path!, { method: "POST" }));
  };
  return { db, env, services, call, update, loginFor, cookiesOf, deputy };
}

describe("a deputy's login", () => {
  it("is given to someone in the deputies' group, and Saga keeps no text from that group", async () => {
    const { db, update, loginFor, services } = await setup();
    await update({ id: Number(DEPUTIES), type: "supergroup" }, 301, "Noget fortroligt fra suppleanterne", "Signe");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_messages WHERE text LIKE '%fortroligt%'").first<{ n: number }>()).toEqual({ n: 0 });
    expect(services.telegram("sendMessage")).toHaveLength(0);
    const { sent, path } = await loginFor(301);
    expect(String(sent.chat_id)).toBe("301");
    expect(sent.text).toContain("admin som suppleant");
    expect(path).toBeTruthy();
  });

  it("is refused to someone in neither group", async () => {
    const { loginFor } = await setup();
    const { sent, path } = await loginFor(999);
    expect(sent.text).toContain("kun for Hjerterums bestyrelse");
    expect(path).toBeNull();
  });

  it("is refused to a deputy who has left the deputies' group", async () => {
    const { update, loginFor } = await setup({ "301": "left" });
    await update({ id: Number(DEPUTIES), type: "supergroup" }, 301, "Hej", "Signe");
    expect((await loginFor(301)).path).toBeNull();
  });

  it("logs in with a cookie of its own, and shows the deputy's pages only", async () => {
    const { call, deputy } = await setup();
    const signe = await deputy();
    expect(signe).toContain("hjerterum_cockpit_deputy=");
    expect(signe).not.toContain("hjerterum_cockpit_person=");
    const home = await (await call("/", { cookie: signe })).text();
    expect(home).toContain("Hej Signe");
    expect(home).toContain("logget ind som suppleant");
    expect(home).not.toContain('href="/posthus"');
    expect(home).not.toContain('href="/opslag"');
    expect(home).not.toContain('action="/saga"');
    const meetings = await (await call("/moder", { cookie: signe })).text();
    expect(meetings).toContain("Åbent hus");
    expect(meetings).not.toContain("<form method=\"post\" action=\"/moder");
  });

  it("closes every board page, whatever address is typed", async () => {
    const { call, deputy } = await setup();
    const signe = await deputy();
    for (const path of ["/posthus", "/opslag", "/medlemmer", "/statistik", "/administratorer", "/samtaler", "/opgaver", "/hukommelse", "/formand/log", "/arkiv", "/status", "/moder/1", "/profil", "/arrangementer/undervisere"])
      expect((await call(path, { cookie: signe })).status, path).toBe(404);
    for (const path of ["/saga", "/opslag", "/afstemninger/stem", "/referat/1/godkend", "/referat/1/suppleanter", "/sprog"])
      expect((await call(path, { method: "POST", cookie: signe })).status, path).toBe(404);
  });

  it("sees minutes and their decisions only once the board has shared them", async () => {
    const { call, deputy, update, loginFor, cookiesOf } = await setup();
    const signe = await deputy();
    expect((await call("/referat/1", { cookie: signe })).status).toBe(404);
    expect(await (await call("/beslutninger", { cookie: signe })).text()).not.toContain("åbent hus i november");

    // Gitta (board) shares the minutes from her own login.
    await update({ id: Number(BOARD), type: "supergroup" }, 202, "Hej", "Gitta");
    const gitta = cookiesOf(await call((await loginFor(202)).path!, { method: "POST" }));
    expect(await (await call("/referat/1", { cookie: gitta })).text()).toContain("Del med suppleanterne");
    expect((await call("/referat/1/suppleanter", { method: "POST", cookie: gitta, body: (() => { const f = new FormData(); f.append("del", "ja"); return f; })() })).status).toBe(303);
    expect(await (await call("/referat/1", { cookie: gitta })).text()).toContain("Delt med suppleanterne af Gitta");

    const shared = await (await call("/referat/1", { cookie: signe })).text();
    expect(shared).toContain("Vi holder åbent hus i november");
    expect(await (await call("/beslutninger", { cookie: signe })).text()).toContain("Vi holder åbent hus i november");
    // The other minutes stay internal.
    expect((await call("/referat/2", { cookie: signe })).status).toBe(404);
    expect(await (await call("/beslutninger", { cookie: signe })).text()).not.toContain("Internt punkt");

    // Made internal again: gone for the deputy at once.
    await call("/referat/1/suppleanter", { method: "POST", cookie: gitta, body: (() => { const f = new FormData(); f.append("del", "nej"); return f; })() });
    expect((await call("/referat/1", { cookie: signe })).status).toBe(404);
  });

  it("cannot be read as a board login, not even with a board member's name", async () => {
    const { call, update, loginFor, cookiesOf } = await setup();
    // A deputy who happens to be called Gitta, like the board member.
    await update({ id: Number(DEPUTIES), type: "supergroup" }, 302, "Hej", "Gitta");
    const fake = cookiesOf(await call((await loginFor(302)).path!, { method: "POST" }));
    expect((await call("/posthus", { cookie: fake })).status).toBe(404);
    // Nor does renaming the deputy's cookie to the board's make it a board login.
    const renamed = fake.replace("hjerterum_cockpit_deputy=", "hjerterum_cockpit_person=");
    expect((await call("/posthus", { cookie: renamed })).status).toBe(401);
  });

  it("ends when the deputy leaves the deputies' group", async () => {
    const { db, env, call, deputy } = await setup();
    const signe = await deputy();
    expect((await call("/", { cookie: signe })).status).toBe(200);
    const later = NOW + 3_600_000;
    const left = fakeServices({ chatMembers: { "301": "left" } });
    await scheduledDeputyAccess(env, deps(left.fetcher, later), db, async () => true);
    expect((await call("/", { cookie: signe }, later + 1000)).status).toBe(401);
  });

  it("leaves the board's own login as it was", async () => {
    const { call, update, loginFor, cookiesOf } = await setup();
    await update({ id: Number(BOARD), type: "supergroup" }, 202, "Hej", "Gitta");
    const { sent, path } = await loginFor(202);
    expect(sent.text).toContain("bestyrelsens admin");
    const gitta = cookiesOf(await call(path!, { method: "POST" }));
    expect(gitta).toContain("hjerterum_cockpit_person=");
    expect(gitta).not.toContain("hjerterum_cockpit_deputy=");
    expect((await call("/posthus", { cookie: gitta })).status).toBe(200);
  });
});
