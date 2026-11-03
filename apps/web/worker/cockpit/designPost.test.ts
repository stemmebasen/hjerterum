import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, planWeek, publishDue, socialPosts } from "../social/social.js";
import type { EventMediaBucket } from "../event-files.js";
import site from "../config-entry.js";

// Requested (the chair, 3 Nov 2026): "I forhold til designskabelonerne skal vi kun bruge dem til sociale medier, og derfor er hele tanken, at jeg kan generere
// et design til et social media-post."
const ORIGIN = "https://admin.hjerterum.example";
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";

describe("a design from Plakater og opslag in an event's post", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("becomes the post's picture on Facebook and Instagram, and the post waits for the chair again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const objects = new Map<string, Uint8Array>();
    const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null, delete: async () => undefined } as unknown as EventMediaBucket;
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", EVENT_MEDIA: media } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Lydhealing', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.png', 'x', 0)`)
      .bind(`SF${HEX}`, Date.parse("2026-11-10T18:00:00Z")).run();
    await planWeek(env as never, deps(services.fetcher, NOW), db, "2026-11-09");
    const [before] = await socialPosts(db, "kind = 'event'");
    await db.prepare("UPDATE social_posts SET status = 'approved' WHERE id = ?").bind(before!.id).run();
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    // The studio knows the event's post.
    const data = await (await call(`/plakater/${HEX}/data`)).json() as { post: { id: number; monday: string } };
    expect(data.post).toMatchObject({ id: before!.id, monday: "2026-11-09" });
    // Not a jpg: refused.
    expect((await call(`/plakater/${HEX}/opslag`, { method: "POST", body: new Uint8Array(2000) })).status).toBe(422);
    const jpg = new Uint8Array(4000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
    const used = await (await call(`/plakater/${HEX}/opslag`, { method: "POST", body: jpg })).json() as { url: string };
    expect(used.url).toMatch(/^https:\/\/www\.hjerterum\.info\/api\/social-designs\/[0-9a-f]{32}\.jpg$/);
    const [after] = await socialPosts(db, "kind = 'event'");
    expect(after).toMatchObject({ status: "draft", images: [used.url], source: { design: true } });
    // The picture is public where Facebook and Instagram fetch it.
    const served = await site.fetch(new Request(used.url), { DB: db, EVENT_MEDIA: media, ASSETS: { fetch: async () => new Response("app") } } as never);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    // The week page shows it, with "Skift design".
    expect(await (await call("/pr/uge?uge=2026-11-09")).text()).toContain(`href="/plakater/${HEX}?fra=%2Fpr%2Fuge%3Fuge%3D2026-11-09%23opslag-${data.post.id}">Skift design`);
    // Approved and out: a photo post on Facebook with the link in its words, and the same picture on Instagram.
    await db.prepare("UPDATE social_posts SET status = 'approved', publish_at_ms = ? WHERE id = ?").bind(NOW + 60_000, after!.id).run();
    const graph: Array<{ path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const [path] = url.slice(GRAPH.length).split("?");
      graph.push({ path: path!, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      return new Response(JSON.stringify(path === "/755/photos" ? { id: "p1", post_id: "755_9" } : /^\/c/.test(path!) ? { status_code: "FINISHED" } : { id: path === "/17841/media" ? "c1" : "ig1" }));
    };
    await publishDue(env as never, deps(fetcher, NOW + 120_000), db);
    const photo = graph.find(c => c.path === "/755/photos")!;
    expect(photo.params).toMatchObject({ url: used.url, caption: expect.stringContaining("https://www.hjerterum.info/events/") });
    expect(graph.some(c => c.path === "/755/feed")).toBe(false);
    expect(graph.find(c => c.path === "/17841/media")!.params.image_url).toBe(used.url);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "published", published: { facebook: "755_9", instagram: "ig1" } });
  });

  // Requested: "så jeg får præsenteret et forslag. Jeg klikker på næste, og så kan jeg se det færdige opslag med billede og tekst, som jeg så kan publicere."
  it("publishes the finished post from the studio: the picture, the words as the chair left them, and at once when asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const objects = new Map<string, Uint8Array>();
    const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async () => null, delete: async () => undefined } as unknown as EventMediaBucket;
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", EVENT_MEDIA: media } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Lydhealing', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.png', 'x', 0)`)
      .bind(`SF${HEX}`, Date.parse("2026-11-10T18:00:00Z")).run();
    await planWeek(env as never, deps(services.fetcher, NOW), db, "2026-11-09");
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const data = await (await call(`/plakater/${HEX}/data`)).json() as { post: Record<string, unknown> };
    expect(data.post).toMatchObject({ channels: ["facebook", "instagram"], instagram: true, text: expect.any(String), instagramText: expect.stringContaining("hjerterum.info/events (link i bio)") });
    const jpg = new Uint8Array(4000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect((await call(`/plakater/${HEX}/opslag`, { method: "POST", body: jpg })).status).toBe(200);
    // No channel: refused, and nothing is approved.
    expect((await call(`/plakater/${HEX}/publicer`, { method: "POST", body: JSON.stringify({ text: "Kom og vær med", channels: [] }) })).status).toBe(422);
    const done = await (await call(`/plakater/${HEX}/publicer`, { method: "POST", body: JSON.stringify({ text: "Kom og vær med", instagramText: "Kom og vær med på Instagram", channels: ["facebook", "instagram"], now: true }) })).json() as Record<string, unknown>;
    expect(done).toMatchObject({ ok: true, publishAtMs: NOW, channels: ["facebook", "instagram"] });
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post).toMatchObject({ status: "approved", text: "Kom og vær med", publish_at_ms: NOW, approved_by: "Jacob Hauge", source: { design: true, instagramText: "Kom og vær med på Instagram" } });
    // A board member without the chair's login may not.
    const other = await handleCockpitRequest(new Request(ORIGIN + `/plakater/${HEX}/publicer`, { method: "POST", headers: { origin: ORIGIN }, body: "{}" }), env, deps(services.fetcher, NOW));
    expect(other.status).not.toBe(200);
  });
});
