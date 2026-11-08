import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, deleteOldEventPosts, setDeleteOld, socialPosts } from "./social.js";

// Requested (the chair, 8 Nov 2026): "Can we automatically delete reels that are outdated the day after the event has ended?" - "Alt, men lad os sikre at
// det altid er et event opslag tilbage - det mest populære".
const GRAPH = "https://graph.facebook.com/v25.0";
const STARTS = Date.parse("2026-11-01T18:00:00Z");
// 10.30 Danish time the day after.
const NOW = Date.parse("2026-11-02T09:30:00Z");

describe("an event's old posts taken down the day after", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(scores: Record<string, number | "gone" | "error"> = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    const post = (key: string, channels: string[], published: Record<string, string>, at: number, extra: Record<string, unknown> = {}) =>
      db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, published, published_at_ms, created_at_ms, updated_at_ms)
        VALUES ('event', ?, '2026-W44', ?, 'Kom til lydbad.', 'https://www.hjerterum.info/events/a', '[]', ?, ?, 'published', ?, ?, 0, 0)`)
        .bind(key, JSON.stringify(channels), JSON.stringify({ key: "mw:SFa", title: "Lydbad", startsMs: STARTS, ...extra }), at, JSON.stringify(published), at).run();
    await post("event:2026-W44:mw:SFa", ["facebook", "instagram"], { facebook: "755_1", instagram: "1781" }, STARTS - 14 * 86_400_000, { shout: 1 });
    await post("event:2026-W44:mw:SFa:2", ["facebook", "instagram"], { facebook: "755_2", instagram: "1782" }, STARTS - 7 * 86_400_000, { shout: 2 });
    await post("event:2026-W44:mw:SFa:x", ["facebook"], { facebook: "755_3" }, STARTS - 3 * 86_400_000, { fbEventShare: true });
    const all: Record<string, number | "gone" | "error"> = { "755_1": 6, "755_2": 2, "755_3": 10, "1781": 3, "1782": 1, ...scores };
    const calls: Array<{ method: string; path: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0]!, method = init?.method ?? "GET";
      calls.push({ method, path });
      const score = all[path.slice(1)];
      if (score === "gone") return new Response(JSON.stringify({ error: { message: "Unsupported get request. Object with ID does not exist", code: 100 } }), { status: 400 });
      if (score === "error") return new Response(JSON.stringify({ error: { message: "Please retry", code: 2 } }), { status: 500 });
      if (method === "DELETE") return new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify(path.startsWith("/178") ? { like_count: score, comments_count: 0 } : { reactions: { summary: { total_count: score } }, comments: { summary: { total_count: 0 } } }));
    };
    return { db, env, services, fetcher, calls };
  }
  const deletes = (calls: Array<{ method: string; path: string }>) => calls.filter(c => c.method === "DELETE").map(c => c.path).sort();

  it("is not done unless the chair has turned it on", async () => {
    const { db, env, fetcher, calls } = await setup();
    expect(await deleteOldEventPosts(env as never, deps(fetcher, NOW), db)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("waits until 10.00 the day after the event", async () => {
    const { db, env, fetcher, calls } = await setup();
    await setDeleteOld(db, true, "Jacob Hauge", NOW);
    expect(await deleteOldEventPosts(env as never, deps(fetcher, Date.parse("2026-11-02T08:30:00Z")), db)).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  it("takes down all but the most popular post on each medium, and tells the chair", async () => {
    const { db, env, services, fetcher, calls } = await setup();
    await setDeleteOld(db, true, "Jacob Hauge", NOW);
    expect(await deleteOldEventPosts(env as never, deps(fetcher, NOW), db)).toBe(3);
    // Facebook keeps the shared event (10), Instagram the first post (3).
    expect(deletes(calls)).toEqual(["/1782", "/755_1", "/755_2"]);
    const posts = await socialPosts(db, "kind = 'event'", [], "id");
    expect(posts.map(p => p.source.deleted ?? {})).toEqual([{ facebook: NOW }, { facebook: NOW, instagram: NOW }, {}]);
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("slettet 3 gamle opslag"))).toBe(true);
    // Once done, nothing more.
    calls.length = 0;
    expect(await deleteOldEventPosts(env as never, deps(fetcher, NOW + 3_600_000), db)).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  it("takes nothing down on a medium where a post's popularity cannot be read", async () => {
    const { db, env, fetcher, calls } = await setup({ "755_2": "error" });
    await setDeleteOld(db, true, "Jacob Hauge", NOW);
    await deleteOldEventPosts(env as never, deps(fetcher, NOW), db);
    expect(deletes(calls)).toEqual(["/1782"]);
  });

  it("counts a post taken down by hand as gone, and keeps the most popular of the rest", async () => {
    const { db, env, fetcher, calls } = await setup({ "755_3": "gone" });
    await setDeleteOld(db, true, "Jacob Hauge", NOW);
    await deleteOldEventPosts(env as never, deps(fetcher, NOW), db);
    expect(deletes(calls)).toEqual(["/1782", "/755_2"]);
  });
});
