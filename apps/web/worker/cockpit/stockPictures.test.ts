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

async function setup(key: string | undefined) {
  const db = testDatabase();
  const objects = new Map<string, Uint8Array>();
  const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null, delete: async () => undefined };
  const env = sagaEnv(db, { EVENT_MEDIA: media, ...(key ? { PEXELS_API_KEY: key } : {}) } as never);
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
    const found = await (await call(`/plakater/${HEX}/billedsoeg?kilde=pexels`)).json() as { ready: boolean; query: string; ideas: string[]; results: Array<{ id: string; credit: string }> };
    // Without Saga, the event's kind: a sound bath.
    expect(found).toMatchObject({ ready: true, query: "singing bowl", results: [{ id: "123", credit: "Foto: Ida / Pexels" }] });
    const got = await (await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "pexels", id: "123" }) })).json() as { url: string };
    expect(got.url).toMatch(/^\/plakater\/billede\/materiale\/\d+$/);
    expect(asked).toContain("https://images.pexels.com/photos/123/l.jpeg");
    expect((await studioData(db, HEX, NOW))!.eventPictures.some(p => p.url === got.url)).toBe(true);
    // The free art: both collections, CC0.
    const art = await (await call(`/plakater/${HEX}/billedsoeg?kilde=kunst&q=flowers`)).json() as { results: Array<{ source: string; credit: string }> };
    expect(art.results.map(r => r.source)).toEqual(["aic", "met"]);
    expect(art.results[0]!.credit).toContain("CC0");
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "aic", id: "3c27b499-af56-f0d5-93b5-a7f2f1ad5813" }) })).status).toBe(200);
    // Only by id - never an address from the browser.
    expect((await call(`/plakater/${HEX}/billede-hent`, { method: "POST", body: JSON.stringify({ source: "aic", id: "https://evil.example/x.jpg" }) })).status).toBe(404);
  });

  it("says Pexels is not connected while its key is missing, and the art works without one", async () => {
    const { call } = await setup(undefined);
    expect(await (await call(`/plakater/${HEX}/billedsoeg?kilde=pexels`)).json()).toMatchObject({ ready: false, results: [] });
    expect(((await (await call(`/plakater/${HEX}/billedsoeg?kilde=kunst`)).json()) as { results: unknown[] }).results.length).toBe(2);
  });
});
