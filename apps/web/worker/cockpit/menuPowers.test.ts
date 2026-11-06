import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Reported (the chair, 3 Nov 2026): "Der er kun Posthus derinde, ikke PR og Some" - on Overblik, Møder and Status the menu was made before the
// chair's powers were known, so every item that needs one was taken out there.
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-03T12:00:00Z");

describe("the menu's items for the chair", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are there on every page for the chair, and on none for the others", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db);
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const page = async (path: string, cookie: string) => (await handleCockpitRequest(new Request(ORIGIN + path, { headers: { cookie } }), env, deps(services.fetcher, NOW))).text();
    const chair = await personalCookie("Jacob Hauge", NOW), lisbeth = await personalCookie("Lisbeth", NOW);
    for (const path of ["/", "/moder", "/status", "/posthus", "/arrangementer"]) {
      const mine = await page(path, chair);
      for (const item of ["/pr", "/arrangementer/nyhedsbrev", "/arrangementer/mail", "/filarkiv", "/medlemskab"]) expect(mine, `${path} ${item}`).toContain(`href="${item}"`);
      expect(mine).not.toContain("data-power=");
      const hers = await page(path, lisbeth);
      for (const item of ["/pr", "/arrangementer/nyhedsbrev"]) expect(hers, `${path} ${item}`).not.toContain(`href="${item}"`);
      // The file archive is the board's (the chair, 6 Nov 2026: "Åbn filerne for bestyrelsen").
      expect(hers, `${path} /filarkiv`).toContain('href="/filarkiv"');
    }
  });
});
