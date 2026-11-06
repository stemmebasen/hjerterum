import { setSiteLive } from "../public-site.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, planWeek, publishDue, scanTags, socialPosts } from "./social.js";

// Requested (the chair, 3 Nov 2026): "Jeg vil rigtig gerne kunne dele simultant på begge medier, når som helst det er muligt."
const GRAPH = "https://graph.facebook.com/v25.0";
const THURSDAY = Date.parse("2026-11-05T09:00:00Z");

describe("both Facebook and Instagram, whenever possible", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts an event with a picture and a tagged Facebook post with a picture on both, and publishes them on both", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    // These posts are written for the day the new website is in use (public-site.ts).
    await setSiteLive(db, true, "test", 0);
    const services = fakeServices({ ai: () => "Tak, Kasper." });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", THURSDAY);
    const calls: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    let n = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const method = init?.method ?? "GET", [path, query] = url.slice(GRAPH.length).split("?");
      calls.push({ method, path: path!, params: Object.fromEntries(new URLSearchParams(method === "GET" ? query : String(init?.body ?? ""))) });
      const json = (d: unknown) => new Response(JSON.stringify(d));
      if (path === "/755/tagged") return json({ data: [{ id: "1_2", message: "Workshop", permalink_url: "https://www.facebook.com/k/posts/2", from: { name: "Kasper Holm" }, created_time: "2026-11-05T08:00:00+0000", full_picture: "https://scontent.example/p.jpg" }] });
      if (path === "/755/feed" && method === "POST") return json({ id: `fb-${++n}` });
      if (path === "/17841/media" && method === "POST") return json({ id: `c${++n}` });
      if (path === "/17841/media_publish") return json({ id: `ig-${++n}` });
      if (/^\/c\d+$/.test(path!)) return json({ status_code: "FINISHED" });
      return json({ data: [] });
    };
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES ('SFa', 'Dans', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0),
      ('SFb', 'Uden billede', ?, 'Kasper', NULL, 'x', 0)`).bind(Date.parse("2026-11-10T18:00:00Z"), Date.parse("2026-11-11T18:00:00Z")).run();
    await planWeek(env as never, deps(fetcher, THURSDAY), db, "2026-11-09");
    const events = await socialPosts(db, "kind = 'event'");
    expect(events.find(p => p.source.key === "mw:SFa")).toMatchObject({ channels: ["facebook", "instagram"], source: { instagramText: expect.stringContaining("via linket i bio") } });
    expect(events.find(p => p.source.key === "mw:SFb")).toMatchObject({ channels: ["facebook"] });
    await scanTags(env as never, deps(fetcher, THURSDAY), db);
    const [share] = await socialPosts(db, "kind = 'share'");
    expect(share).toMatchObject({ channels: ["facebook", "instagram"], source: { instagramText: expect.stringContaining("Foto: Kasper Holm") } });
    // Approved: each goes to both.
    await db.prepare("UPDATE social_posts SET status = 'approved', publish_at_ms = ?, source = json_remove(source, '$.instagramAtMs') WHERE source_key IN ('event:2026-W46:mw:SFa', 'facebook:1_2')").bind(THURSDAY + 60_000).run();
    await publishDue(env as never, deps(fetcher, THURSDAY + 120_000), db);
    expect(calls.filter(c => c.path === "/755/feed" && c.method === "POST")).toHaveLength(2);
    const photos = calls.filter(c => c.path === "/17841/media" && c.method === "POST").map(c => c.params.image_url);
    expect(photos.sort()).toEqual(["https://d1tif55lvfk8gc.cloudfront.net/a.jpg", "https://scontent.example/p.jpg"]);
    expect(calls.filter(c => c.path === "/17841/media_publish")).toHaveLength(2);
    expect((await socialPosts(db, "status = 'published'"))).toHaveLength(2);
  });
});
