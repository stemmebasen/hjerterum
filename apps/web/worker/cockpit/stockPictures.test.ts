import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { studioData } from "./posterStudio.js";

// Asked (the chair, 6 Nov 2026): "Vi skal gøre det kreative værksted langt bedre og med flere designs ... lad os koble pexels api på" - and "Kunst og botanik (CC0)".
const NOW = Date.parse("2026-11-06T12:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";
const HEX = "6ae8cff06e0ca88f0503bf74";
const JPEG = (() => { const b = new Uint8Array(60_000); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; })();

async function setup(key: string | undefined, more: Record<string, string> = {}) {
  const db = testDatabase();
  const objects = new Map<string, Uint8Array>();
  const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null, delete: async () => undefined };
  const env = sagaEnv(db, { EVENT_MEDIA: media, ...(key ? { PEXELS_API_KEY: key } : {}), ...more } as never);
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, description, content_hash, updated_at_ms) VALUES (?, 'Lydbad med gongs', ?, 'Kasper', 'Gongs og syngeskåle.', 'x', 0)")
    .bind(`SF${HEX}`, NOW + 10 * 86_400_000).run();
  const asked: string[] = [];
  const services = fakeServices({ ai: () => "{}" });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    asked.push(url);
    const json = (d: unknown) => new Response(JSON.stringify(d));
    if (url.startsWith("https://api.pexels.com/v1/search")) {
      expect(new Headers(init?.headers).get("authorization")).toBe("pexels-key");
      return json({ photos: [{ id: 123, url: "https://www.pexels.com/photo/123/", alt: "Syngeskål", photographer: "Ida", src: { medium: "https://images.pexels.com/photos/123/m.jpeg" } }] });
    }
    if (url === "https://api.pexels.com/v1/photos/123") return json({ photographer: "Ida", src: { large2x: "https://images.pexels.com/photos/123/l.jpeg" } });
    if (url.startsWith("https://api.artic.edu/")) return json({ data: [{ id: 7, title: "Water Lilies", artist_title: "Claude Monet", image_id: "3c27b499-af56-f0d5-93b5-a7f2f1ad5813", is_public_domain: true }] });
    if (url.includes("/collection/v1/search")) return json({ objectIDs: [45] });
    if (url.endsWith("/collection/v1/objects/45")) return json({ objectID: 45, title: "Pæoner", isPublicDomain: true, primaryImageSmall: "https://images.metmuseum.org/s.jpg", primaryImage: "https://images.metmuseum.org/l.jpg" });
    if (url.startsWith("https://api.unsplash.com/search/photos")) return json({ results: [{ id: "abcDEF12", alt_description: "Tea", urls: { small: "https://images.unsplash.com/photo-1?w=400" }, user: { name: "Mia" }, links: { html: "https://unsplash.com/photos/abcDEF12" } }] });
    if (url === "https://api.unsplash.com/photos/abcDEF12") return json({ urls: { raw: "https://images.unsplash.com/photo-1?ixid=x" }, user: { name: "Mia" }, links: { download_location: "https://api.unsplash.com/photos/abcDEF12/download?ixid=x" } });
    if (url.startsWith("https://api.unsplash.com/photos/abcDEF12/download")) return json({ url: "x" });
    if (url.startsWith("https://pixabay.com/api/")) { const type = new URL(url).searchParams.get("image_type") ?? "photo";
      return json({ hits: [{ id: type === "vector" ? 3 : type === "illustration" ? 2 : 1, webformatURL: `https://pixabay.com/get/${type}_640.jpg`, largeImageURL: `https://pixabay.com/get/${type}_1280.jpg`, user: "Ole", pageURL: "https://pixabay.com/x", tags: "leaves" }] }); }
    if (url.startsWith("https://api.openverse.org/v1/images/?")) return json({ results: [{ id: "9d6e1f3a-1111-2222-3333-444455556666", title: "Fern", creator: "Anna Atkins", license: "pdm", thumbnail: "https://api.openverse.org/v1/images/9d6e1f3a-1111-2222-3333-444455556666/thumb/", url: "https://upload.wikimedia.org/fern.jpg" },
      { id: "aaaaaaaa-1111-2222-3333-444455556666", title: "Kun med navn", license: "by", thumbnail: "https://api.openverse.org/v1/images/x/thumb/", url: "https://x.example/y.jpg" }] });
    if (url === "https://api.openverse.org/v1/images/9d6e1f3a-1111-2222-3333-444455556666/") return json({ id: "9d6e1f3a-1111-2222-3333-444455556666", license: "pdm", url: "https://upload.wikimedia.org/fern.jpg", source: "wikimedia" });
    if (url.startsWith("https://images.unsplash.com/") || url.startsWith("https://pixabay.com/get/") || url === "https://upload.wikimedia.org/fern.jpg") return new Response(JPEG);
    if (url.startsWith("https://images.pexels.com/") || url.startsWith("https://www.artic.edu/iiif/") || url.startsWith("https://images.metmuseum.org/")) return new Response(JPEG);
    return services.fetcher(input, init);
  };
  const cookie = await personalCookie("Jacob Hauge", NOW);
  const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN, "content-type": "application/json" } : {}) } }), env, deps(fetcher, NOW));
  return { db, call, asked };
}

describe("pictures from Pexels and free art in Plakater og opslag", () => {
  it("searches Saga's idea, fetches the chosen one by its id and keeps it with the event", async () => {
    const { db, call, asked } = await setup("pexels-key");
    const found = await (await call(`/plakater/${HEX}/billedsoeg?kilde=foto`)).json() as { ready: boolean; missing: string[]; query: string; ideas: string[]; results: Array<{ id: string; credit: string }> };
    // Without Saga, the event's kind: a sound bath. Unsplash and Pixabay have no keys here: named.
    expect(found).toMatchObject({ ready: true, missing: ["Unsplash", "Pixabay"], query: "singing bowl", results: [{ id: "123", credit: "Foto: Ida / Pexels" }] });
    const got = await (await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "pexels", id: "123" }) })).json() as { url: string };
    expect(got.url).toMatch(/^\/plakater\/billede\/materiale\/\d+$/);
    expect(asked).toContain("https://images.pexels.com/photos/123/l.jpeg");
    expect((await studioData(db, HEX, NOW))!.eventPictures.some(p => p.url === got.url)).toBe(true);
    // The free art: both collections, CC0.
    const art = await (await call(`/plakater/${HEX}/billedsoeg?kilde=kunst&q=flowers`)).json() as { results: Array<{ source: string; credit: string }> };
    // Openverse: only what is free of names (public domain, CC0).
    expect(art.results.map(r => r.source)).toEqual(["aic", "met", "openverse"]);
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "openverse", id: "9d6e1f3a-1111-2222-3333-444455556666" }) })).status).toBe(200);
    expect(art.results[0]!.credit).toContain("CC0");
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "aic", id: "3c27b499-af56-f0d5-93b5-a7f2f1ad5813" }) })).status).toBe(200);
    // Only by id - never an address from the browser.
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "aic", id: "https://evil.example/x.jpg" }) })).status).toBe(404);
  });

  it("says which sources are not connected, and the art works without keys", async () => {
    const { call } = await setup(undefined);
    expect(await (await call(`/plakater/${HEX}/billedsoeg?kilde=foto`)).json()).toMatchObject({ ready: false, missing: ["Pexels", "Unsplash", "Pixabay"], results: [] });
    expect(await (await call(`/plakater/${HEX}/billedsoeg?kilde=illustration`)).json()).toMatchObject({ ready: false, missing: ["Pixabay"] });
    expect(((await (await call(`/plakater/${HEX}/billedsoeg?kilde=kunst`)).json()) as { results: unknown[] }).results.length).toBe(3);
  });

  // "Men også de andre. Så mange tools vi kan få som gør variationen bedre."
  it("mixes Pexels, Unsplash and Pixabay in the photos, and gives Pixabay's illustrations and vectors", async () => {
    const { call, asked } = await setup("pexels-key", { UNSPLASH_ACCESS_KEY: "u-key", PIXABAY_API_KEY: "p-key" });
    const photos = await (await call(`/plakater/${HEX}/billedsoeg?kilde=foto&q=tea`)).json() as { missing: string[]; results: Array<{ source: string }> };
    expect(photos.missing).toEqual([]);
    expect(photos.results.map(r => r.source)).toEqual(["pexels", "unsplash", "pixabay"]);
    const drawn = await (await call(`/plakater/${HEX}/billedsoeg?kilde=illustration&q=leaves`)).json() as { results: Array<{ id: string; credit: string }> };
    expect(drawn.results.map(r => r.id)).toEqual(["2", "3"]);
    expect(drawn.results[0]!.credit).toBe("Illustration: Ole / Pixabay");
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "unsplash", id: "abcDEF12" }) })).status).toBe(200);
    // Unsplash is told its photo is used, and the poster gets it in a fitting size.
    expect(asked.some(u => u.startsWith("https://api.unsplash.com/photos/abcDEF12/download"))).toBe(true);
    expect(asked).toContain("https://images.unsplash.com/photo-1?ixid=x&w=1800&q=85&fm=jpg");
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "pixabay", id: "2" }) })).status).toBe(200);
  });
});
