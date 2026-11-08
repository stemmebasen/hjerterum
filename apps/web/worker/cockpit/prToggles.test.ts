import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, deleteOldOn, shareFacebookEventOn } from "../social/social.js";
import { siteLive } from "../public-site.js";

// Reported (the chair, 8 Nov 2026): "Jeg har klikket »Udgiv eventet selv« mange gange nu" - the form had already been read, so every press saved "off".
const AT = Date.parse("2026-11-08T12:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";

describe("the chair's settings in PR og SoMe → Overblik", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: AT - 86_400_000, fromAssistant: false });
    const cookie = await personalCookie("Jacob Hauge", AT - 3_600_000);
    const fetcher: typeof fetch = async () => new Response("{}", { status: 404 });
    const post = (path: string, fields: Record<string, string>) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, v);
      return handleCockpitRequest(new Request(ORIGIN + path, { method: "POST", body, headers: { cookie, origin: ORIGIN } }), env, deps(fetcher, AT));
    };
    return { db, post };
  }

  it("turns each on and off as pressed", async () => {
    const { db, post } = await setup();
    await post("/pr/del-begivenhed", { on: "1" });
    expect(await shareFacebookEventOn(db)).toBe(true);
    await post("/pr/slet-gamle", { on: "1" });
    expect(await deleteOldOn(db)).toBe(true);
    await post("/pr/hjemmeside", { live: "1" });
    expect(await siteLive(db)).toBe(true);
    await post("/pr/del-begivenhed", { on: "0" });
    expect(await shareFacebookEventOn(db)).toBe(false);
  });
});
