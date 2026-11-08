import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, publishDue, socialPosts } from "./social.js";

// Requested (the chair, 4 Nov 2026): the video templates - "Lad os få dem op". video/ (Remotion, .github/workflows/video-events.yml) lays a video on
// each event proposal that goes on Instagram; this is what happens after: the chair sees it, may keep the picture instead, and on Instagram it is a reel.
const GRAPH = "https://graph.facebook.com/v25.0";
const VIDEO = "https://www.hjerterum.info/api/social-reels/event-7-abcdef123456.mp4";
const AT = Date.parse("2026-11-09T14:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";

describe("an event's post with its video", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: AT - 86_400_000, fromAssistant: false });
    // A proposal as Saga makes it, with the video the job laid on it.
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W46:mw:SFa', '2026-W46', '["facebook","instagram"]', 'Kom til dans med Kasper.', 'https://www.hjerterum.info/events/a', '["https://d1tif55lvfk8gc.cloudfront.net/a.jpg"]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFa", title: "Dans", startsMs: AT + 2 * 86_400_000, host: "Kasper", instagramText: "Kom til dans med Kasper.\n\nlink i bio", video: VIDEO, videoTemplate: 1 }), AT).run();
    const graph: Array<{ path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return new Response("{}", { status: 404 });
      const [path] = url.slice(GRAPH.length).split("?");
      graph.push({ path: path!, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      if (path === "/17841/media") return new Response(JSON.stringify({ id: "c1" }));
      if (path === "/c1") return new Response(JSON.stringify({ status_code: "FINISHED" }));
      if (path === "/17841/media_publish") return new Response(JSON.stringify({ id: "ig1" }));
      return new Response(JSON.stringify({ id: "755_1" }));
    };
    const cookie = await personalCookie("Jacob Hauge", AT - 3_600_000);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(fetcher, AT - 3_600_000));
    return { db, env, graph, fetcher, call };
  }

  it("is shown to the chair and goes on Instagram as a reel, and on Facebook as a video (\"Videoen på begge\")", async () => {
    const { db, env, graph, fetcher, call } = await setup();
    const page = await (await call("/pr/uge?uge=2026-11-09")).text();
    expect(page).toContain(`<video src="${VIDEO}"`);
    expect(page).toContain("Video på Instagram");
    expect(page).toContain("Video på Facebook");
    const calendar = await (await call("/pr/kalender")).text();
    expect(calendar).toContain("IG ▶");
    expect(calendar).toContain("FB ▶");
    await db.prepare("UPDATE social_posts SET status = 'approved'").run();
    await publishDue(env as never, deps(fetcher, AT + 60_000), db);
    await publishDue(env as never, deps(fetcher, AT + 6 * 60_000), db);
    const reel = graph.find(c => c.path === "/17841/media")!;
    expect(reel.params).toMatchObject({ media_type: "REELS", video_url: VIDEO, caption: "Kom til dans med Kasper.\n\nlink i bio", thumb_offset: "4500" });
    // "Hvorfor er det, at vi ikke deler film på Facebook også?" - the video, with the words and the link.
    expect(graph.find(c => c.path === "/755/videos")!.params).toMatchObject({ file_url: VIDEO, description: "Kom til dans med Kasper.\n\nhttps://www.hjerterum.info/events/a" });
    expect(graph.some(c => c.path === "/755/feed" || c.path === "/755/photos")).toBe(false);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "published", published: { facebook: "755_1", instagram: "ig1" } });
  });

  it("keeps the picture on Facebook when the chair takes the video off there, or the page may not post videos yet", async () => {
    const { db, env, graph, fetcher, call } = await setup();
    const [post] = await socialPosts(db, "kind = 'event'");
    const form = new FormData(); form.append("do", "godkend"); form.append("text", post!.text); form.append("kanaler", "1"); form.append("channel", "facebook"); form.append("video_box", "1"); form.append("video", "1");
    await call(`/pr/opslag/${post!.id}`, { method: "POST", body: form });
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "approved", source: { noFacebookVideo: true } });
    await publishDue(env as never, deps(fetcher, AT + 60_000), db);
    expect(graph.some(c => c.path === "/755/videos")).toBe(false);
    expect(graph.some(c => c.path === "/755/feed")).toBe(true);
    // Without publish_video: the picture, not a failed post.
    const refusing: typeof fetch = async (input, init) => String(input).includes("/755/videos")
      ? new Response(JSON.stringify({ error: { message: "(#200) Requires publish_video permission", code: 200 } }), { status: 403 }) : fetcher(input, init);
    await db.prepare("UPDATE social_posts SET status = 'approved', published = '{}', source = json_remove(source, '$.noFacebookVideo')").run();
    graph.length = 0;
    await publishDue(env as never, deps(refusing, AT + 120_000), db);
    expect(graph.some(c => c.path === "/755/feed")).toBe(true);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "published", published: { facebook: "755_1" } });
  });

  it("keeps the picture on Instagram when the chair takes the video off", async () => {
    const { db, env, graph, fetcher, call } = await setup();
    const [post] = await socialPosts(db, "kind = 'event'");
    const form = new FormData(); form.append("do", "godkend"); form.append("text", post!.text); form.append("kanaler", "1"); form.append("channel", "facebook"); form.append("channel", "instagram"); form.append("video_box", "1");
    await call(`/pr/opslag/${post!.id}`, { method: "POST", body: form });
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "approved", source: { noVideo: true } });
    await publishDue(env as never, deps(fetcher, AT + 60_000), db);
    const made = graph.find(c => c.path === "/17841/media")!;
    expect(made.params.media_type).toBeUndefined();
    expect(made.params.image_url).toBe("https://d1tif55lvfk8gc.cloudfront.net/a.jpg");
  });

  // Reported (the chair, 8 Nov 2026): "Her er ingen mulighed for at afvælge video" - before Saga has made it.
  it("takes the video off before it is made: shown as a box, and no video afterwards", async () => {
    const { db, call } = await setup();
    const [post] = await socialPosts(db, "kind = 'event'");
    await db.prepare("UPDATE social_posts SET source = json_remove(source, '$.video', '$.videoTemplate') WHERE id = ?").bind(post!.id).run();
    const page = await (await call("/pr/uge?uge=2026-11-09")).text();
    expect(page).toContain("Uden video - brug billedet");
    const form = new FormData(); form.append("do", "gem"); form.append("text", post!.text); form.append("novideo_box", "1"); form.append("no_video", "1");
    await call(`/pr/opslag/${post!.id}`, { method: "POST", body: form });
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "draft", source: { noVideo: true, noFacebookVideo: true } });
    // Ticked off again: Saga may make the video.
    const again = new FormData(); again.append("do", "gem"); again.append("text", post!.text); again.append("novideo_box", "1");
    await call(`/pr/opslag/${post!.id}`, { method: "POST", body: again });
    const [after] = await socialPosts(db, "kind = 'event'");
    expect(after!.source.noVideo).toBeUndefined();
  });
});
