import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, runSocialJob, socialPosts } from "./social.js";
import site from "../config-entry.js";

// Requested (the chair, 3 Nov 2026): "Alt der kan automatiseres skal automatiseres" - "Ugens events" as a reel. The weekly job
// (.github/workflows/ugens-reel.yml, video/jobs.mjs and video/render.mjs) lays the reel in social_posts as a draft; this is what happens after.
const GRAPH = "https://graph.facebook.com/v25.0";
const VIDEO = "https://www.hjerterum.info/api/social-reels/2026-w46-abcdef123456.mp4";
const AT = Date.parse("2026-11-09T15:30:00Z");

describe("Ugens events as a reel", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(statuses: string[]) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", META_APP_ID: "a", META_APP_SECRET: "b", COCKPIT_PASSWORD: "x", COCKPIT_SHARED_LOGIN: "off" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    // What the weekly job writes (video/jobs.mjs, the sql of the week job).
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('week', 'reel:2026-W46', '2026-W46', '["instagram"]', 'Ugens events i Hjerterum · uge 46', NULL, '[]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ format: "reel", video: VIDEO, events: [], collaborators: ["kasper.yoga"] }), AT).run();
    const graph: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    let media = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input), method = init?.method ?? "GET";
      if (!url.startsWith(GRAPH)) return new Response("{}", { status: 404 });
      const [path, query] = url.slice(GRAPH.length).split("?");
      graph.push({ method, path: path!, params: Object.fromEntries(new URLSearchParams(method === "GET" ? query : String(init?.body ?? ""))) });
      if (path === "/17841/media" && method === "POST") return new Response(JSON.stringify({ id: `reel-${++media}` }));
      if (/^\/reel-\d+$/.test(path!)) return new Response(JSON.stringify({ status_code: statuses.shift() ?? "FINISHED" }));
      if (path === "/17841/media_publish") return new Response(JSON.stringify({ id: "ig-reel" }));
      if (path === "/755/videos" && method === "POST") return new Response(JSON.stringify({ id: "fb-video" }));
      return new Response(JSON.stringify({ data: [] }));
    };
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: AT - 86_400_000, fromAssistant: false });
    return { db, env, graph, run: (now: number) => runSocialJob(env as never, deps(fetcher, now)) };
  }

  it("is the chair's to change and approve, keeps going to Instagram, and goes out once Instagram has worked on the video", async () => {
    const { db, env, graph, run } = await setup(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
    const [reel] = await socialPosts(db, "source_key = 'reel:2026-W46'");
    const cookie = await personalCookie("Jacob Hauge", AT - 3_600_000);
    const page = await (await handleCockpitRequest(new Request("https://admin.hjerterum.example/pr/uge?uge=2026-11-09", { headers: { cookie } }), env, deps(async () => new Response("{}"), Date.parse("2026-11-05T10:00:00Z")))).text();
    expect(page).toContain("Ugens events som reel");
    expect(page).toContain(`<video class="pr-reel" src="${VIDEO}"`);
    // Changed and approved in admin: still Instagram, new words, the invited teacher kept.
    const form = new FormData(); form.append("do", "godkend"); form.append("text", "Ugens reel"); form.append("collaborators", "@kasper.yoga, @anna.yoga");
    await handleCockpitRequest(new Request(`https://admin.hjerterum.example/pr/opslag/${reel!.id}`, { method: "POST", body: form, headers: { cookie, origin: "https://admin.hjerterum.example" } }), env, deps(async () => new Response("{}"), Date.parse("2026-11-05T10:00:00Z")));
    const [approved] = await socialPosts(db, `id = ${reel!.id}`);
    expect(approved).toMatchObject({ status: "approved", channels: ["instagram"], text: "Ugens reel", source: { collaborators: ["kasper.yoga", "anna.yoga"] } });
    // Its time comes: Instagram is given the video once, and asked how it goes until it is done.
    await run(AT + 60_000);
    expect((await socialPosts(db, `id = ${reel!.id}`))[0]).toMatchObject({ status: "approved", published: { instagram_container: "reel-1" } });
    await run(AT + 6 * 60_000);
    await run(AT + 11 * 60_000);
    await run(AT + 16 * 60_000);
    // Only the reel made (Saga also reads the page's own posts - findOwnPosts).
    const made = graph.filter(c => c.path === "/17841/media" && c.params.media_type);
    expect(made).toHaveLength(1);
    expect(made[0]!.params).toMatchObject({ media_type: "REELS", video_url: VIDEO, caption: "Ugens reel", share_to_feed: "true", collaborators: '["kasper.yoga","anna.yoga"]' });
    expect(graph.filter(c => c.path === "/17841/media_publish")).toHaveLength(1);
    expect((await socialPosts(db, `id = ${reel!.id}`))[0]).toMatchObject({ status: "published", published: { instagram: "ig-reel" } });
  });

  it("fails plainly when Instagram cannot use the video, and can be approved again", async () => {
    const { db, run } = await setup(["ERROR"]);
    await db.prepare("UPDATE social_posts SET status = 'approved' WHERE source_key = 'reel:2026-W46'").run();
    await run(AT + 60_000);
    const [failed] = await socialPosts(db, "source_key = 'reel:2026-W46'");
    expect(failed).toMatchObject({ status: "failed", error: "Instagram kunne ikke behandle videoen (ERROR)" });
    expect(failed!.published.instagram_container).toBeUndefined();
  });

  it("serves the video Instagram fetches, from its folder only", async () => {
    const env = { DB: testDatabase(), EVENT_MEDIA: { get: async (key: string) => key === "social/reels/2026-w46-abcdef123456.mp4" ? { body: new Blob([new Uint8Array([0, 0, 0, 24])]).stream(), size: 4 } : null }, ASSETS: { fetch: async () => new Response("app") } } as never;
    const ok = await site.fetch(new Request(VIDEO), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("video/mp4");
    expect((await site.fetch(new Request("https://www.hjerterum.info/api/social-reels/../../pr/x.mp4"), env)).headers.get("content-type")).not.toBe("video/mp4");
    expect((await site.fetch(new Request("https://www.hjerterum.info/api/social-reels/A_B.mp4"), env)).headers.get("content-type")).not.toBe("video/mp4");
    expect((await site.fetch(new Request("https://www.hjerterum.info/api/social-reels/2026-w46-ffffffffffff.mp4"), env)).status).toBe(404);
  });

  // Requested (the chair, 8 Nov 2026): "Lav dem forfra, og sikr der køres én gang på IG og en gang på FB kl. 7.30".
  it("goes on Facebook as a video too, and the week's picture post then stays home", async () => {
    const { db, env, graph, run } = await setup([]);
    await db.prepare(`UPDATE social_posts SET channels = '["facebook","instagram"]', text = 'Ugens events\n\nSe alle events og tilmeld dig via linket i bio.', status = 'approved', approved_by = 'Jacob Hauge', approved_at_ms = 0 WHERE source_key = 'reel:2026-W46'`).run();
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, approved_by, approved_at_ms, created_at_ms, updated_at_ms)
      VALUES ('week', 'week:2026-W46', '2026-W46', '["facebook","instagram"]', 'Ugens events', NULL, '["https://x.example/a.jpg","https://x.example/b.jpg"]', '{}', ?, 'approved', 'Jacob Hauge', 0, 0, 0)`).bind(AT).run();
    // One card in Ugens opslag: the reel, and the picture post as its stand-in.
    const cookie = await personalCookie("Jacob Hauge", AT - 3_600_000);
    const page = await (await handleCockpitRequest(new Request("https://admin.hjerterum.example/pr/uge?uge=2026-11-09", { headers: { cookie } }), env, deps(async () => new Response("{}"), AT - 3_600_000))).text();
    expect(page).toContain('<section class="pr-week-pair"><h3>Ugens events</h3>');
    expect(page).toContain("Reserve: Ugens events som billedopslag");
    // "Der er stadig begge typer ugens": one entry in the calendar too.
    const calendar = await (await handleCockpitRequest(new Request("https://admin.hjerterum.example/pr/kalender?start=2026-11-09", { headers: { cookie } }), env, deps(async () => new Response("{}"), AT - 3_600_000))).text();
    expect(calendar).toContain("Ugens events · reel");
    expect(calendar).not.toMatch(/Ugens events<\/b>/);
    await run(AT + 60_000);
    await run(AT + 6 * 60_000);
    expect((await socialPosts(db, "source_key = 'week:2026-W46'"))[0]).toMatchObject({ status: "skipped" });
    const video = graph.find(c => c.path === "/755/videos")!;
    expect(video.params).toMatchObject({ file_url: VIDEO });
    // The website's events in place of "linket i bio" (the old site until the new one is in use).
    expect(video.params.description).toMatch(/og tilmeld dig på (www\.hjerterum\.info|holistisk\.org)\/events/);
    expect(graph.filter(c => c.path === "/17841/media_publish")).toHaveLength(1);
    expect(graph.some(c => c.method === "POST" && (c.path === "/755/photos" || c.path === "/755/feed"))).toBe(false);
  });
});
