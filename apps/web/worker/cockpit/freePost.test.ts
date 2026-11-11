import { setSiteLive } from "../public-site.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, publishDue, pullEarlier, socialPosts } from "../social/social.js";
import type { EventMediaBucket } from "../event-files.js";
import { fromDanish } from "./prFreePost.js";

// Requested (the chair, 11 Nov 2026): "What if I want to create a post about a contest? Can I also do that in the system?" - "Ja" to "Nyt opslag".
const ORIGIN = "https://admin.hjerterum.example";
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-11T09:00:00Z");

describe("a post of the chair's own (Nyt opslag)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(ai = () => "{}") {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    await setSiteLive(db, true, "test", 0);
    const services = fakeServices({ ai });
    const objects = new Map<string, Uint8Array>();
    const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null, delete: async () => undefined } as unknown as EventMediaBucket;
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", EVENT_MEDIA: media } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x); return f; };
    return { db, env, services, call, form };
  }

  it("reads Danish time", () => {
    expect(fromDanish("2026-11-20T18:00")).toBe(Date.parse("2026-11-20T17:00:00Z"));
    expect(fromDanish("2026-07-01T09:30")).toBe(Date.parse("2026-07-01T07:30:00Z"));
    expect(fromDanish("i morgen")).toBeNull();
  });

  it("is made from the form, gets its picture in the editor, and goes out when approved", async () => {
    const { db, env, services, call, form } = await setup();
    const page = await (await call("/pr/nyt-opslag")).text();
    expect(page).toContain('action="/pr/nyt-opslag"');
    expect(page).toContain('value="instagram"');
    // The way in, from the calendar and Ugens opslag.
    expect(await (await call("/pr/kalender")).text()).toContain('href="/pr/nyt-opslag"');
    const made = await call("/pr/nyt-opslag", { method: "POST", body: form({ titel: "Konkurrence: vind et klippekort", tekst: "🌿 Vind et klippekort!\n\nDel og tag en ven.", instagram: "🌿 Vind et klippekort! #hjerterum",
      link: "", at: "2026-11-13T18:00", channel: ["facebook", "instagram"], do: "billede" }) });
    expect(made.status).toBe(303);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(made.headers.get("location")).toBe(`/plakater/frit-${post!.id}`);
    expect(post).toMatchObject({ status: "draft", week: "2026-W46", channels: ["facebook", "instagram"], link: null, images: [], publish_at_ms: Date.parse("2026-11-13T17:00:00Z"),
      source: { free: true, title: "Konkurrence: vind et klippekort", instagramText: "🌿 Vind et klippekort! #hjerterum" } });
    // Saga leaves its time alone.
    await pullEarlier(db, NOW);
    expect((await socialPosts(db, "kind = 'event'"))[0]!.publish_at_ms).toBe(Date.parse("2026-11-13T17:00:00Z"));
    // The editor knows it, and its picture goes into the post.
    const data = await (await call(`/plakater/frit-${post!.id}/data`)).json() as { free: boolean; post: { title: string; image: string | null }; back: string };
    expect(data).toMatchObject({ free: true, post: { title: "Konkurrence: vind et klippekort", image: null }, back: `/pr/uge?uge=2026-11-09#opslag-${post!.id}` });
    expect((await call(`/plakater/frit-${post!.id}/video`, { method: "POST" })).status).toBe(404);
    const jpg = new Uint8Array(4000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
    const used = await (await call(`/plakater/frit-${post!.id}/opslag`, { method: "POST", body: jpg })).json() as { url: string; back: string };
    expect(used.url).toMatch(/^https:\/\/www\.hjerterum\.info\/api\/social-designs\/[0-9a-f]{32}\.jpg$/);
    // Opened again in the editor, the picture is fetched from here.
    expect((await (await call(`/plakater/frit-${post!.id}/data`)).json() as { post: { image: string } }).post.image).toBe(new URL(used.url).pathname);
    // On its card in Ugens opslag, with the way back to the editor.
    const week = await (await call("/pr/uge?uge=2026-11-09")).text();
    expect(week).toContain("Konkurrence: vind et klippekort");
    expect(week).toContain(`href="/plakater/frit-${post!.id}">Ret billedet i editoren`);
    // Approved and out: the picture with the chair's words on Facebook, the Instagram words on Instagram.
    await db.prepare("UPDATE social_posts SET status = 'approved', publish_at_ms = ? WHERE id = ?").bind(NOW + 60_000, post!.id).run();
    const graph: Array<{ path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const [path] = url.slice(GRAPH.length).split("?");
      graph.push({ path: path!, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      return new Response(JSON.stringify(init?.method === "POST" ? { id: `id-${graph.length}` } : { status_code: "FINISHED", data: [] }));
    };
    await publishDue(env as never, deps(fetcher, NOW + 120_000), db);
    const fb = graph.find(c => c.path === "/755/photos")!;
    expect(fb.params).toMatchObject({ url: used.url });
    expect(fb.params.message ?? fb.params.caption).toContain("Del og tag en ven.");
    const ig = graph.find(c => c.path === "/17841/media")!;
    expect(ig.params).toMatchObject({ image_url: used.url, caption: "🌿 Vind et klippekort! #hjerterum" });
    expect((await socialPosts(db, "kind = 'event'"))[0]!.status).toBe("published");
  });

  it("can be saved without a picture, for Facebook only, and refuses a time that has passed", async () => {
    const { db, call, form } = await setup();
    const past = await call("/pr/nyt-opslag", { method: "POST", body: form({ titel: "Hilsen", tekst: "Godt nytår", at: "2026-11-10T18:00", channel: "facebook", do: "gem" }) });
    expect(past.status).toBe(400);
    // What the chair wrote is kept.
    expect(await past.text()).toContain(">Godt nytår</textarea>");
    expect(await socialPosts(db, "kind = 'event'")).toEqual([]);
    const saved = await call("/pr/nyt-opslag", { method: "POST", body: form({ titel: "Hilsen", tekst: "Godt nytår", link: "https://www.hjerterum.info/", at: "2026-11-20T09:00", channel: "facebook", do: "gem" }) });
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(saved.headers.get("location")).toBe(`/pr/uge?uge=2026-11-16#opslag-${post!.id}`);
    expect(post).toMatchObject({ channels: ["facebook"], link: "https://www.hjerterum.info/", source: { free: true, title: "Hilsen", instagramText: "Godt nytår" } });
  });

  it("gets Saga's words from the chair's few lines", async () => {
    const { call, form } = await setup(() => JSON.stringify({ facebook: "🌿 Vind et klippekort!\n\nDel og tag en ven.", instagram: "🌿 Vind! #hjerterum" }));
    const answer = await (await call("/pr/nyt-opslag/forslag", { method: "POST", body: form({ kort: "Konkurrence om et klippekort" }) })).json();
    expect(answer).toEqual({ facebook: "🌿 Vind et klippekort!\n\nDel og tag en ven.", instagram: "🌿 Vind! #hjerterum" });
  });
});
