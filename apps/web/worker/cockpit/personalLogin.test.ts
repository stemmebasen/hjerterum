import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { handleSagaRequest } from "../saga/handler.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";
import type { SagaEnv } from "../saga/env.js";

// Requested: "Hvordan kan vi sikre os, at kontoen, når først den er identificeret, bliver låst fast til den
// enkelte bruger?" - "1." (a personal login link from Saga).
const ORIGIN = "https://admin.hjerterum.info";
const NOW = Date.parse("2026-10-02T10:00:00Z");

async function setup(extra: Partial<SagaEnv> = {}) {
  const db = testDatabase();
  const services = fakeServices();
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", COCKPIT_URL: ORIGIN, ...extra });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Gitta", "202"], ["Lisbeth", "201"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000 });
  const call = (path: string, init: RequestInit & { cookie?: string } = {}, now = NOW) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, now));
  const telegram = (from: number, text: string) => handleSagaRequest(new Request("https://hjerterum.test/api/saga/telegram", {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: NOW / 1000, chat: { id: from, type: "private" }, from: { id: from, first_name: "X" }, text } }) }), env, deps(services.fetcher, NOW));
  const linkFor = async (from: number) => {
    await telegram(from, "/start login");
    const sent = services.telegram("sendMessage").at(-1)?.body as { chat_id: number | string; text: string };
    return { sent, path: /\/login\/link\/[A-Za-z0-9_-]+/.exec(sent.text)?.[0] ?? null };
  };
  const cookiesOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(/,(?=\s*hjerterum_)/).map(c => c.split(";")[0]!.trim()).join("; ");
  return { db, env, services, call, telegram, linkFor, cookiesOf };
}

describe("a personal login from Saga", () => {
  it("is sent privately to a board member's own Telegram, and to no one else", async () => {
    const { linkFor, services, telegram } = await setup();
    const { sent, path } = await linkFor(202);
    expect(String(sent.chat_id)).toBe("202");
    expect(sent.text).toContain("Hej Gitta");
    expect(path).toBeTruthy();
    await telegram(999, "/login");
    const refused = services.telegram("sendMessage").at(-1)?.body as { chat_id: number; text: string };
    expect(refused.text).toContain("kun for Hjerterums bestyrelse");
    expect(refused.text).not.toContain("/login/link/");
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
  });

  it("logs in once as that member, who cannot be switched, and ends when the chair closes the access", async () => {
    const { call, linkFor, cookiesOf } = await setup();
    const { path } = await linkFor(202);
    // A look at the link (or Telegram's preview) logs no one in.
    const shown = await call(path!);
    expect(await shown.text()).toContain("Du logger ind som <strong>Gitta</strong>");
    const used = await call(path!, { method: "POST" });
    expect(used.status).toBe(303);
    const gitta = cookiesOf(used);
    expect(gitta).toContain("hjerterum_cockpit_person=");
    expect((await call(path!, { method: "POST" })).status).toBe(410);
    expect(await (await call(path!)).text()).toContain("Linket er brugt eller udløbet");

    // Gitta is Gitta: a who-cookie saying otherwise is ignored, and "Hvem er du?" is closed.
    const page = await (await call("/", { cookie: await memberCookie(gitta, "Lisbeth") })).text();
    expect(page).toContain("Hej Gitta");
    expect((await call("/hvem", { cookie: gitta })).headers.get("location")).toBe("/");
    expect(await (await call("/mere", { cookie: gitta })).text()).toContain("Logget ind som Gitta");
    expect(await (await call("/mere", { cookie: gitta })).text()).not.toContain("Luk adgang");
    expect((await call("/adgang", { method: "POST", cookie: gitta, body: (() => { const f = new FormData(); f.append("member", "Lisbeth"); return f; })() })).status).toBe(403);

    // The chair closes Gitta's access on every device.
    const chair = cookiesOf(await call((await linkFor(Number(OWNER))).path!, { method: "POST" }));
    const more = await (await call("/mere", { cookie: chair })).text();
    expect(more).toContain("Luk adgang");
    const form = new FormData(); form.append("member", "Gitta");
    expect((await call("/adgang", { method: "POST", cookie: chair, body: form }, NOW + 1)).headers.get("location")).toBe("/profil?lukket=Gitta");
    expect((await call("/", { cookie: gitta }, NOW + 2)).status).toBe(401);
  });

  it("an expired link does nothing, and the shared password can be switched off", async () => {
    const { call, linkFor } = await setup({ COCKPIT_SHARED_LOGIN: "off" });
    const { path } = await linkFor(201);
    expect((await call(path!, { method: "POST" }, NOW + 16 * 60_000)).status).toBe(410);
    const login = await (await call("/")).text();
    expect(login).toContain("Få dit login fra Saga på Telegram");
    expect(login).toContain("https://t.me/HjerterumSagaBot?start=login");
    expect(login).not.toContain("Fælles adgangskode");
    const form = new FormData(); form.append("password", "hjerte-2026");
    expect((await call("/login", { method: "POST", body: form })).status).toBe(503);
    const shared = await (await setup()).call("/");
    expect(await shared.text()).toContain("Fælles adgangskode");
  });
});
