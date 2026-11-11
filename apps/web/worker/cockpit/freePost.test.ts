import { setSiteLive } from "../public-site.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, publishDue, pullEarlier, socialPosts } from "../social/social.js";
import type { EventMediaBucket } from "../event-files.js";
import { fromDanish, jpegSize } from "./prFreePost.js";

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
    // Facebook and Instagram, for what goes out from the cockpit at once.
    const graph: Array<{ path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      graph.push({ path: url.slice(GRAPH.length).split("?")[0]!, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      return new Response(JSON.stringify(init?.method === "POST" ? { id: `id-${graph.length}` } : { status_code: "FINISHED", data: [] }));
    };
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(fetcher, NOW));
    const form = (fields: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x); return f; };
    return { db, env, services, call, form, graph };
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

  // Requested (the chair, 11 Nov 2026): "Jeg mangler at kunne uploade et billede, der allerede er færdigt, direkte i et nyt opslag."
  const jpg = (width: number, height: number) => {
    const b = new Uint8Array(3000);
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    b.set([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03], 20);
    return b;
  };

  it("reads a jpg's size", () => {
    expect(jpegSize(jpg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
    expect(jpegSize(new Uint8Array(2000).fill(0x89))).toBeNull();
  });

  it("takes a finished picture straight into the post", async () => {
    const { db, call, form } = await setup();
    const fields = (picture: Uint8Array, channel: string[] = ["facebook", "instagram"]) => {
      const f = form({ titel: "Konkurrence", tekst: "Vind et klippekort", at: "2026-11-13T18:00", channel, do: "gem" });
      f.append("billede", new File([picture.slice()], "konkurrence.jpg", { type: "image/jpeg" }));
      return f;
    };
    expect(await (await call("/pr/nyt-opslag")).text()).toContain('enctype="multipart/form-data"');
    // A story-shaped picture: not on Instagram - said, and nothing made.
    const tall = await call("/pr/nyt-opslag", { method: "POST", body: fields(jpg(1080, 1920)) });
    expect(tall.status).toBe(400);
    expect(await tall.text()).toContain("1080×1920");
    // Not a picture.
    expect((await call("/pr/nyt-opslag", { method: "POST", body: fields(new Uint8Array(2000).fill(1)) })).status).toBe(400);
    expect(await socialPosts(db, "kind = 'event'")).toEqual([]);
    // On Facebook alone, the tall one is fine.
    expect((await call("/pr/nyt-opslag", { method: "POST", body: fields(jpg(1080, 1920), ["facebook"]) })).status).toBe(303);
    const saved = await call("/pr/nyt-opslag", { method: "POST", body: fields(jpg(1080, 1350)) });
    const [, post] = await socialPosts(db, "kind = 'event'", [], "id");
    expect(saved.headers.get("location")).toBe(`/pr/uge?uge=2026-11-09#opslag-${post!.id}`);
    expect(post).toMatchObject({ status: "draft", channels: ["facebook", "instagram"], source: { free: true, design: true } });
    expect(post!.images[0]).toMatch(/^https:\/\/www\.hjerterum\.info\/api\/social-designs\/[0-9a-f]{32}\.jpg$/);
    expect(await (await call("/pr/uge?uge=2026-11-09")).text()).toContain(`href="/plakater/frit-${post!.id}">Ret billedet i editoren`);
  });

  // Requested (the chair, 11 Nov 2026): "Jeg skal kunne publicere allerede fra side 1 hvis jeg vil".
  it("is published at once from the first page, or approved for its time", async () => {
    const { db, call, form, graph } = await setup();
    const fields = (doing: string, channel: string[], picture?: Uint8Array) => {
      const f = form({ titel: "Konkurrence", tekst: "Vind et klippekort", at: "2026-11-13T18:00", channel, do: doing });
      if (picture) f.append("billede", new File([picture.slice()], "konkurrence.jpg", { type: "image/jpeg" }));
      return f;
    };
    // Instagram needs a picture.
    const bare = await call("/pr/nyt-opslag", { method: "POST", body: fields("nu", ["facebook", "instagram"]) });
    expect(bare.status).toBe(400);
    expect(await bare.text()).toContain("Instagram kræver et billede");
    expect(await socialPosts(db, "kind = 'event'")).toEqual([]);
    // "Publicér nu": out now on both, whatever the time field said.
    const now = await call("/pr/nyt-opslag", { method: "POST", body: fields("nu", ["facebook", "instagram"], jpg(1080, 1350)) });
    const [sent] = await socialPosts(db, "kind = 'event'");
    expect(now.headers.get("location")).toBe(`/pr/uge?uge=2026-11-09&besked=publiceret#opslag-${sent!.id}`);
    expect(sent).toMatchObject({ status: "published", publish_at_ms: NOW, approved_by: "Jacob Hauge" });
    expect(graph.some(c => c.path === "/755/photos")).toBe(true);
    expect(graph.some(c => c.path === "/17841/media_publish")).toBe(true);
    // "Godkend til tidspunktet": approved, out on Friday.
    graph.length = 0;
    const later = await call("/pr/nyt-opslag", { method: "POST", body: fields("godkend", ["facebook"]) });
    const [, approved] = await socialPosts(db, "kind = 'event'", [], "id");
    expect(later.headers.get("location")).toBe(`/pr/uge?uge=2026-11-09&besked=godkendt#opslag-${approved!.id}`);
    expect(approved).toMatchObject({ status: "approved", publish_at_ms: Date.parse("2026-11-13T17:00:00Z") });
    expect(graph).toEqual([]);
  });

  // Reported (the chair, 11 Nov 2026): "Der står intet billede, men jeg har lige uploadet det?"
  it("takes a finished picture on the post's card, and shows no event buttons there", async () => {
    const { db, call, form } = await setup();
    await call("/pr/nyt-opslag", { method: "POST", body: form({ titel: "Konkurrence", tekst: "Vind", at: "2026-11-13T18:00", channel: ["facebook", "instagram"], do: "gem" }) });
    const [post] = await socialPosts(db, "kind = 'event'");
    const card = await (await call("/pr/uge?uge=2026-11-09")).text();
    expect(card).toContain(`action="/pr/opslag/${post!.id}/billede"`);
    expect(card).toContain("Dit tidspunkt:");
    expect(card).not.toContain("Uden video");
    expect(card).not.toContain('value="kort"');
    const upload = (picture: Uint8Array) => { const f = new FormData(); f.append("billede", new File([picture.slice()], "a.jpg", { type: "image/jpeg" })); return call(`/pr/opslag/${post!.id}/billede`, { method: "POST", body: f }); };
    expect((await upload(jpg(1080, 1920))).headers.get("location")).toBe(`/pr/uge?uge=2026-11-09&fejl=billede-ig#opslag-${post!.id}`);
    expect((await socialPosts(db, "kind = 'event'"))[0]!.images).toEqual([]);
    expect((await upload(jpg(1080, 1350))).headers.get("location")).toBe(`/pr/uge?uge=2026-11-09&besked=billede#opslag-${post!.id}`);
    const [after] = await socialPosts(db, "kind = 'event'");
    expect(after).toMatchObject({ status: "draft", source: { free: true, design: true } });
    expect(after!.images[0]).toMatch(/\/api\/social-designs\/[0-9a-f]{32}\.jpg$/);
    expect(await (await call("/pr/uge?uge=2026-11-09&fejl=billede-ig")).text()).toContain("Instagram tager kun billeder");
  });
});
