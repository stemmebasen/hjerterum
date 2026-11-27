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

async function setup(chatMembers: Record<string, string> = {}, ai?: (system: string, user: string) => string) {
  const db = testDatabase();
  const services = fakeServices({ chatMembers, ...(ai ? { ai } : {}) });
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
  it("is given to a new deputy outside any group when the chair approves - Line and Kai (26 Nov 2026)", async () => {
    const { env, services, update, call, cookiesOf } = await setup();
    // In the deputies' group, but she has not written there yet: Line writes /login, Telegram says she is in the group, and the chair is asked.
    await update({ id: 401, type: "private" }, 401, "/login", "Line");
    const said = services.telegram("sendMessage").map(c => c.body as { chat_id: string; text: string });
    expect(said.find(b => String(b.chat_id) === OWNER)!.text).toContain("Line beder om login til admin som suppleant");
    expect(said.at(-1)!.text).toContain("Første gang skal formanden godkende dig");
    // The chair presses Godkend.
    await handleSagaRequest(new Request("https://hjerterum.test/api/saga/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
      body: JSON.stringify({ update_id: 2, callback_query: { id: "c1", from: { id: Number(OWNER), first_name: "Jacob" }, data: "approve:login:401" } }) }), env, deps(services.fetcher, NOW));
    await update({ id: 401, type: "private" }, 401, "/login", "Line");
    const sent = services.telegram("sendMessage").at(-1)!.body as { text: string };
    expect(sent.text).toContain("Hej Line");
    const path = /\/login\/link\/[A-Za-z0-9_-]+/.exec(sent.text)?.[0] ?? null;
    const line = cookiesOf(await call(path!, { method: "POST" }));
    expect(line).toContain("hjerterum_cockpit_deputy=");
    // The board's admin, member list included - but not the membership pages, which are the chair's and Douglas's.
    expect((await call("/medlemmer", { cookie: line })).status).toBe(200);
    expect((await call("/medlemskab", { cookie: line })).status).toBe(403);
  });

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
    // "Hvordan ved saga det er den rigtige Line og den rigtige Kai?" (the chair, 26 Nov 2026): the deputies' group is how - nobody outside it is even asked about.
    const { loginFor, services } = await setup({ "999": "left" });
    const { sent, path } = await loginFor(999);
    expect(sent.text).toContain("kun for Hjerterums bestyrelse og suppleanter");
    expect(services.telegram("sendMessage").some(c => String((c.body as { chat_id: string }).chat_id) === OWNER)).toBe(false);
    expect(path).toBeNull();
  });

  it("is refused to a deputy who has left the deputies' group", async () => {
    const { update, loginFor } = await setup({ "301": "left" });
    await update({ id: Number(DEPUTIES), type: "supergroup" }, 301, "Hej", "Signe");
    expect((await loginFor(301)).path).toBeNull();
  });

  // Changed again (the chair, 26 Nov 2026): "Suppleanter må gerne se den fulde board admin uden begrænsninger. De må bare ikke stemme".
  it("logs in with a cookie of its own and uses admin as the board does - under a name of its own, without voting", async () => {
    const { call, deputy } = await setup();
    const signe = await deputy();
    expect(signe).toContain("hjerterum_cockpit_deputy=");
    expect(signe).not.toContain("hjerterum_cockpit_person=");
    const home = await (await call("/", { cookie: signe })).text();
    expect(home).toContain("Signe (suppleant)");
    expect(home).toMatch(/class="avatar"[^>]*>S<\/a>/);
    expect(home).toContain("Du er logget ind som suppleant: du har samme adgang som bestyrelsen");
    for (const path of ["/posthus", "/opslag", "/beslutninger", "/moder", "/arrangementer"])
      expect((await call(path, { cookie: signe })).status, path).toBe(200);
    // The member list too, now.
    for (const path of ["/medlemmer", "/medlemmer/tal"]) expect((await call(path, { cookie: signe })).status, path).toBe(200);
    // The same minutes as the board - nothing to share first.
    const minutes = await (await call("/referat/1", { cookie: signe })).text();
    expect(minutes).toContain("Vi holder åbent hus i november");
    expect(minutes).toContain("Hemmeligt om økonomien");
    expect(minutes).not.toContain("Del med suppleanterne");
    expect(minutes).not.toContain("Jeg kan ikke godkende det");
    // The forms are theirs - but none to vote.
    const forms = [...home.matchAll(/<form\b[^>]*method="post"[^>]*action="([^"]*)"/gi), ...home.matchAll(/<form\b[^>]*action="([^"]*)"[^>]*method="post"/gi)].map(m => m[1]);
    expect(forms.some(a => a!.endsWith("/logout"))).toBe(true);
    expect(forms.some(a => /\/afstemninger\/(stem|moede)$/.test(a!))).toBe(false);
  });

  it("cannot vote or sign off the minutes - whatever is posted", async () => {
    const { db, call, deputy } = await setup();
    const signe = await deputy();
    for (const path of ["/afstemninger/stem", "/afstemninger/moede", "/referat/1/godkend", "/referat/1/rettelse"]) {
      const response = await call(path, { method: "POST", cookie: signe, body: (() => { const f = new FormData(); f.append("id", "1"); f.append("vote", "for"); f.append("comment", "x"); f.append("title", "x"); return f; })() });
      expect(response.status, path).toBe(303);
    }
    const signed = await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_signoffs").first<{ n: number }>();
    expect(signed?.n ?? 0).toBe(0);
    expect((await call("/referat/1?suppleant=1", { cookie: signe }).then(r => r.text()))).toContain("Som suppleant kan du læse referatet, men ikke godkende det");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_votes").first<{ n: number }>())?.n ?? 0).toBe(0);
  });

  it("asks Saga about the board's knowledge, as a board member does", async () => {
    const { call, deputy } = await setup({}, (system, user) => user.includes("Signe (suppleant)") && system.includes("Vi holder åbent hus i november")
      ? "Bestyrelsen har besluttet åbent hus i november." : "Ved det ikke.");
    const signe = await deputy();
    const response = await call("/saga", { method: "POST", cookie: signe, body: JSON.stringify({ question: "Hvad har bestyrelsen besluttet om november?", history: [] }) });
    const reply = await response.json() as { html?: string };
    expect(reply.html).toContain("åbent hus i november");
  });

  it("cannot be read as a board login, not even with a board member's name", async () => {
    const { call, update, loginFor, cookiesOf } = await setup();
    // A deputy who happens to be called Gitta, like the board member: in admin they are "Gitta (suppleant)", never Gitta.
    await update({ id: Number(DEPUTIES), type: "supergroup" }, 302, "Hej", "Gitta");
    const fake = cookiesOf(await call((await loginFor(302)).path!, { method: "POST" }));
    const home = await (await call("/", { cookie: fake })).text();
    expect(home).toContain("Gitta (suppleant)");
    expect((await call("/referat/1/godkend", { method: "POST", cookie: fake })).status).toBe(303);
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
