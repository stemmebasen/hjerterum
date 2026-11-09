import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, publishDue, setPostCarousel, socialPosts } from "./social.js";

// Requested (the chair, 10 Nov 2026): "Kan citatdesignet laves til en karrusel med tre blade, som jeg så vælger?" - "Tre citater, du vælger".
const GRAPH = "https://graph.facebook.com/v25.0";
const AT = Date.parse("2026-11-12T10:00:00Z");
const slide = (n: number) => `https://www.hjerterum.info/api/social-designs/${String(n).repeat(32)}.jpg`;

describe("a quote carousel", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W47:mw:SFa', '2026-W47', '["facebook","instagram"]', 'Kom til healing.', 'https://www.hjerterum.info/events/a', '["https://x.example/event.jpg"]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFa", title: "Healing", startsMs: AT + 5 * 86_400_000, video: "https://x.example/v.mp4" }), AT).run();
    const calls: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    let n = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (!url.startsWith(GRAPH)) return new Response("{}", { status: 404 });
      const path = url.slice(GRAPH.length).split("?")[0]!;
      calls.push({ method, path, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      if (method === "GET") return new Response(JSON.stringify({ status_code: "FINISHED", data: [] }));
      return new Response(JSON.stringify({ id: `id-${++n}` }));
    };
    return { db, env, calls, fetcher };
  }

  it("goes out as three pictures in one Facebook post and a carousel on Instagram - no video", async () => {
    const { db, env, calls, fetcher } = await setup();
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(await setPostCarousel(db, post!.id, [slide(1), slide(2), slide(3)], AT)).toBe(true);
    const [made] = await socialPosts(db, "kind = 'event'");
    expect(made).toMatchObject({ status: "draft", images: [slide(1), slide(2), slide(3)], source: { design: true, noVideo: true, noFacebookVideo: true, eventImage: "https://x.example/event.jpg" } });
    await db.prepare("UPDATE social_posts SET status = 'approved' WHERE id = ?").bind(post!.id).run();
    await publishDue(env as never, deps(fetcher, AT + 60_000), db);
    const photos = calls.filter(c => c.path === "/755/photos");
    expect(photos.map(c => [c.params.url, c.params.published])).toEqual([[slide(1), "false"], [slide(2), "false"], [slide(3), "false"]]);
    const feed = calls.find(c => c.path === "/755/feed")!;
    expect(Object.keys(feed.params).filter(k => k.startsWith("attached_media"))).toHaveLength(3);
    expect(feed.params.message).toContain("Kom til healing.");
    expect(calls.filter(c => c.path === "/17841/media" && c.params.is_carousel_item === "true")).toHaveLength(3);
    expect(calls.find(c => c.path === "/17841/media" && c.params.media_type === "CAROUSEL")).toBeTruthy();
    expect(calls.some(c => c.path === "/755/videos" || c.params.media_type === "REELS")).toBe(false);
    expect((await socialPosts(db, "kind = 'event'"))[0]!.status).toBe("published");
  });

  it("takes only slides stored here, two to ten", async () => {
    const { db, env, fetcher } = await setup();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: AT - 86_400_000, fromAssistant: false });
    const HEX = "0123456789abcdef01234567";
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, content_hash, updated_at_ms) VALUES (?, 'Healing', ?, 'h', 0)`).bind(`SF${HEX}`, AT + 5 * 86_400_000).run();
    await db.prepare("UPDATE social_posts SET source = json_set(source, '$.key', ?)").bind(`mw:SF${HEX}`).run();
    const cookie = await personalCookie("Jacob Hauge", AT - 3_600_000);
    const call = (urls: string[]) => handleCockpitRequest(new Request(`https://admin.hjerterum.example/plakater/${HEX}/karrusel`, { method: "POST", body: JSON.stringify({ urls }),
      headers: { cookie, origin: "https://admin.hjerterum.example", "content-type": "application/json" } }), env, deps(fetcher, AT));
    expect((await call([slide(1), "https://evil.example/x.jpg"])).status).toBe(400);
    expect((await call([slide(1)])).status).toBe(400);
    expect((await call([slide(1), slide(2), slide(3)])).status).toBe(200);
    expect((await socialPosts(db, "kind = 'event'"))[0]!.images).toEqual([slide(1), slide(2), slide(3)]);
  });
});
