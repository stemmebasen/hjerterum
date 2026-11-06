import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, scanTags, socialAccount, socialPosts } from "./social.js";
import { META_SCOPES } from "./meta.js";

// Requested (the chair, 6 Nov 2026): "Hvorfor dukker disse to ikke op i admin? Altså, hvorfor finder Saga dem ikke?" - a teacher's reel and another's
// Facebook video, sent to the page in Messenger. Answer: "Saga læser Messenger".
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-06T13:00:00Z");

describe("posts sent to Hjerterum in Messenger", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("become shares for the chair, each once - and a page not yet allowed to read messages says so plainly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "Tak, Mari-Anne 🍂" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW - 86_400_000);
    expect(META_SCOPES).toContain("pages_messaging");
    let allowed = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0];
      const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
      if (path === "/755/conversations") {
        if (!allowed) return json({ error: { message: "(#230) Requires pages_messaging permission to manage the object", code: 230 } }, 403);
        return json({ data: [
          { messages: { data: [
            { id: "m1", created_time: "2026-11-06T11:55:00+0000", from: { id: "900", name: "Mari-Anne Christoffersen" },
              message: "Hej Hjerterum.\n\nJeg har lavet en meditation på Instagram. Kunne I tænke jer at dele den? https://www.instagram.com/reel/DfZahAFRi3Z/?utm_source=ig_web_button_share_sheet\n\nEn lille pause til dig 🍂" },
            { id: "m0", created_time: "2026-11-06T11:56:00+0000", from: { id: "755", name: "Hjerterum" }, message: "Tak! https://www.instagram.com/reel/XYZ/" } ] } },
          { messages: { data: [
            { id: "m2", created_time: "2026-11-06T09:00:00+0000", from: { id: "901", name: "Signe Erritzøe" },
              attachments: { data: [{ type: "share", target: { url: "https://www.facebook.com/reel/1234567890" }, video_data: { preview_url: "https://scontent.example/v.jpg" } }] } } ] } },
        ] });
      }
      return json({ data: [] });
    };
    await scanTags(env as never, deps(fetcher, NOW), db);
    expect(await socialPosts(db, "kind = 'share'")).toHaveLength(0);
    expect((await socialAccount(db))!.check_error).toContain("Messenger kan ikke læses endnu");
    // Connected again with the new permission.
    allowed = true;
    await scanTags(env as never, deps(fetcher, NOW + 1_800_000), db);
    const shares = await socialPosts(db, "kind = 'share'", [], "id");
    expect(shares.map(p => p.source_key)).toEqual(["instagram:ig-DfZahAFRi3Z", "facebook:link-facebook.com/reel/1234567890"]);
    expect(shares[0]).toMatchObject({ status: "draft", channels: ["facebook"], link: "https://www.instagram.com/reel/DfZahAFRi3Z/",
      source: { author: "Mari-Anne Christoffersen", via: "messenger", media: "video", text: expect.stringContaining("En lille pause til dig") } });
    expect(shares[0]!.source.text).not.toContain("https://");
    expect(shares[1]).toMatchObject({ link: "https://www.facebook.com/reel/1234567890", images: ["https://scontent.example/v.jpg"], source: { author: "Signe Erritzøe", via: "messenger" } });
    expect((await socialAccount(db))!.check_error).toBeNull();
    // Found again: not twice.
    await scanTags(env as never, deps(fetcher, NOW + 3_600_000), db);
    expect(await socialPosts(db, "kind = 'share'")).toHaveLength(2);
  });
});
