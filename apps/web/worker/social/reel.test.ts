import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, runSocialJob, socialPosts } from "./social.js";
import site from "../config-entry.js";

// Requested (the chair, 3 Nov 2026): "Alt der kan automatiseres skal automatiseres" - "Ugens events" as a reel. The weekly job
// (.github/workflows/ugens-reel.yml, .github/scripts/weekly-reel.py) lays the reel in social_posts as a draft; this is what happens after.
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
    // What the weekly job writes (weekly-reel.py insert.sql).
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
    const page = await (await handleCockpitRequest(new Request("https://admin.hjerterum.example/pr?uge=2026-11-09", { headers: { cookie } }), env, deps(async () => new Response("{}"), Date.parse("2026-11-05T10:00:00Z")))).text();
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
    const made = graph.filter(c => c.path === "/17841/media");
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
});
