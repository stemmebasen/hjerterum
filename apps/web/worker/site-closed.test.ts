import { describe, expect, it } from "vitest";
import { siteClosedResponse, PREVIEW_COOKIE } from "./site-closed.js";
import { handleCockpitRequest } from "./cockpit/handler.js";
import { previewValue } from "./cockpit/auth.js";
import { deps, fakeServices, personalCookie, sagaEnv, testDatabase, memberCookie } from "./saga/test-support.js";
import { saveBoardMessage } from "./saga/store.js";
import { BOARD, OWNER } from "./saga/test-support.js";

// The chair (27 Nov 2026): "Siden skal nu kun kunne ses af Douglas og jeg" - "Alle i board admin kan se".
const NOW = Date.parse("2026-11-27T10:00:00Z");
const SECRET = "bot-token";
const env = { SITE_CLOSED: "1", SAGA_TELEGRAM_BOT_TOKEN: SECRET };
const get = (url: string, headers: Record<string, string> = {}) => siteClosedResponse(new Request(url, { headers }), env, NOW);

describe("the closed website", () => {
  it("shows everyone the 'opens soon' page on the website and the member pages, not to search engines - and leaves admin and the API open", async () => {
    for (const url of ["https://www.hjerterum.info/", "https://www.hjerterum.info/events", "https://medlem.hjerterum.info/member-portal", "https://www.hjerterum.info/beregner"]) {
      const r = (await get(url))!;
      expect(r.status, url).toBe(503);
      expect(r.headers.get("x-robots-tag")).toContain("noindex");
      expect(await r.text()).toContain("åbner snart");
    }
    expect(await (await get("https://www.hjerterum.info/robots.txt"))!.text()).toContain("Disallow: /");
    for (const url of ["https://admin.hjerterum.info/", "https://www.hjerterum.info/api/saga/telegram", "https://www.hjerterum.info/api/stripe/member-webhook", "https://www.hjerterum.info/api/social-reels/abcdefgh.mp4"])
      expect(await get(url), url).toBeNull();
    // Open again when it is not closed.
    expect(await siteClosedResponse(new Request("https://www.hjerterum.info/"), {}, NOW)).toBeNull();
  });

  it("lets in whoever has a key from admin, on www and medlem alike - and nobody with a false or old key", async () => {
    const token = await previewValue(SECRET, "Douglas Crawford", NOW);
    const given = (await get(`https://www.hjerterum.info/__adgang?t=${encodeURIComponent(token)}`))!;
    expect(given.status).toBe(302);
    const set = given.headers.get("set-cookie")!;
    expect(set).toContain(`${PREVIEW_COOKIE}=`);
    expect(set).toContain("Domain=hjerterum.info");
    expect(set).toContain("HttpOnly");
    const cookie = set.split(";")[0]!;
    expect(await get("https://www.hjerterum.info/events", { cookie })).toBeNull();
    expect(await get("https://medlem.hjerterum.info/member-portal", { cookie })).toBeNull();
    expect((await get("https://www.hjerterum.info/__adgang?t=wrong"))!.status).toBe(403);
    expect((await get("https://www.hjerterum.info/", { cookie: `${PREVIEW_COOKIE}=${token.slice(0, -2)}xx` }))!.status).toBe(503);
    // The key ends after 30 days.
    expect((await siteClosedResponse(new Request("https://www.hjerterum.info/", { headers: { cookie } }), env, NOW + 31 * 86_400_000))!.status).toBe(503);
  });

  it("gives the key from admin to the chair and Douglas only", async () => {
    const db = testDatabase();
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Douglas Crawford", "202"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const services = fakeServices();
    const cockpitEnv = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" } as never);
    const call = (path: string, cookie: string) => handleCockpitRequest(new Request(`https://admin.hjerterum.info${path}`, { redirect: "manual", headers: { cookie } }), cockpitEnv, deps(services.fetcher, NOW));
    const form = new FormData(); form.append("password", "hjerte-2026");
    const session = ((await handleCockpitRequest(new Request("https://admin.hjerterum.info/login", { method: "POST", body: form, headers: { origin: "https://admin.hjerterum.info" } }), cockpitEnv, deps(services.fetcher, NOW))).headers.get("set-cookie") ?? "").split(";")[0]!;
    for (const who of [await personalCookie("Jacob Hauge", NOW), await personalCookie("Douglas Crawford", NOW)]) {
      const r = await call("/hjemmeside-adgang", who);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toMatch(/^https:\/\/www\.hjerterum\.info\/__adgang\?t=/);
    }
    expect((await call("/hjemmeside-adgang", await memberCookie(session, "Lisbeth"))).status).toBe(403);
  });
});
