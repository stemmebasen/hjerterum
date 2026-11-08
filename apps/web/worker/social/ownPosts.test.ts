import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { aboutEvent, connectSocial, findOwnPosts, socialPosts } from "./social.js";

// Asked (the chair, 8 Nov 2026): "bliver de manuelle posts jeg laver også registreret i kalenderen så vi ikke lægger dobbelt ind?"
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-08T19:00:00Z");
const STARTS = NOW + 10 * 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "+0000");

describe("the chair's own posts on Facebook and Instagram", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells which event a post is about: its Facebook event, its page, or its title", () => {
    const event = { title: "Somatisk Yin Yoga, Ansigtsyoga og Meditation", fbLink: "https://www.facebook.com/events/1367400668890819/", links: ["https://www.hjerterum.info/events/somatisk"] };
    expect(aboutEvent("Kom med!", ["https://www.facebook.com/events/1367400668890819/"], event)).toBe(true);
    expect(aboutEvent("Læs mere på hjerterum.info/events/somatisk", [], event)).toBe(true);
    expect(aboutEvent("🌿 Somatisk Yin Yoga på søndag ✨", [], event)).toBe(true);
    expect(aboutEvent("Yoga på søndag", [], event)).toBe(false);
    // Not the list of all events.
    expect(aboutEvent("Se alle events på holistisk.org/events/", [], { ...event, fbLink: null, links: ["https://holistisk.org/events/"] })).toBe(false);
  });

  it("puts a post about a coming event in the calendar, and takes Saga's proposal near it off - not the one a week later", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    const post = (key: string, at: number, extra: Record<string, unknown>, status = "draft", published = "{}", publishedAt: number | null = null) =>
      db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, published, published_at_ms, created_at_ms, updated_at_ms)
        VALUES ('event', ?, '2026-W47', '["facebook","instagram"]', 'Kom til lydbad.', 'https://www.hjerterum.info/events/a', '[]', ?, ?, ?, ?, ?, 0, 0)`)
        .bind(key, JSON.stringify({ key: "mw:SFa", title: "Lydbad med gongs", startsMs: STARTS, ...extra }), at, status, published, publishedAt).run();
    await post("event:2026-W47:mw:SFa", NOW + 86_400_000, { shout: 1, shouts: 2 });
    await post("event:2026-W47:mw:SFa:2", NOW + 7 * 86_400_000, { shout: 2, shouts: 2 });
    // One Saga made herself (a video: its post has an id of its own on the page).
    await post("event:2026-W46:mw:SFb", NOW - 86_400_000, { title: "Andet" }, "published", '{"facebook":"9001234567"}', NOW - 2 * 3_600_000);
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0]!;
      if (path === "/755/posts") return new Response(JSON.stringify({ data: [
        { id: "755_77", created_time: iso(NOW - 3_600_000), message: "🌿 Lydbad med gongs - kom og mærk roen", permalink_url: "https://www.facebook.com/755/posts/77" },
        { id: "755_78", created_time: iso(NOW - 2 * 3_600_000 + 60_000), message: "Lydbad med gongs (Sagas video)" },
        { id: "755_79", created_time: iso(NOW - 5 * 3_600_000), message: "God søndag fra Hjerterum" },
        // Saga's video of yesterday: on the page at another time than she noted, its address the video's.
        { id: "755_80", created_time: iso(NOW - 30 * 3_600_000), message: "Lydbad med gongs - en video", permalink_url: "https://www.facebook.com/reel/9001234567/" }] }));
      if (path === "/17841/media") return new Response(JSON.stringify({ data: [{ id: "1799", caption: "Lydbad med gongs ✨ link i bio", timestamp: iso(NOW - 30 * 60_000), permalink: "https://www.instagram.com/p/X/" }] }));
      return new Response("{}", { status: 404 });
    };
    expect(await findOwnPosts(env as never, deps(fetcher, NOW), db)).toBe(2);
    const own = await socialPosts(db, "source_key LIKE 'own:%'", [], "id");
    expect(own.map(p => [p.source_key, p.status, p.channels])).toEqual([["own:facebook:755_77", "published", ["facebook"]], ["own:instagram:1799", "published", ["instagram"]]]);
    expect(own[0]).toMatchObject({ source: { key: "mw:SFa", own: true }, published: { facebook: "755_77", facebook_link: "https://www.facebook.com/755/posts/77" } });
    expect((await socialPosts(db, "source_key = 'event:2026-W47:mw:SFa'"))[0]!.status).toBe("skipped");
    expect((await socialPosts(db, "source_key = 'event:2026-W47:mw:SFa:2'"))[0]).toMatchObject({ status: "draft", channels: ["facebook", "instagram"] });
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("dit eget opslag"))).toBe(true);
    // Once.
    expect(await findOwnPosts(env as never, deps(fetcher, NOW + 60_000), db)).toBe(0);
  });
});
