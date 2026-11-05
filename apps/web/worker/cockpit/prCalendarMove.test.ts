import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, movePost, socialPosts, topUpWeeks } from "../social/social.js";

// Requested (the chair, 5 Nov 2026): "På pr kalenderen må du gerne markere 'x dag til eventet'" and "det skal være muligt at jeg selv kan flytte
// entries rundt i kalenderen."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";

async function setUp(instagram: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const db = testDatabase();
  const services = fakeServices({ ai: () => "{}" });
  const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: instagram ? "17841" : null, igUsername: instagram ? "hjerterum_aarhus" : null }, "Jacob Hauge", NOW);
  await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Aurabalancering', ?, 'Marianne', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0)`)
    .bind(`SF${HEX}`, Date.parse("2026-11-20T18:00:00Z")).run();
  await topUpWeeks(env as never, deps(services.fetcher, NOW), db);
  const cookie = await personalCookie("Jacob Hauge", NOW);
  const call = (path: string, init: RequestInit & { json?: boolean } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.json ? { accept: "application/json" } : {}) }
  }), env, deps(services.fetcher, NOW));
  return { db, call };
}

describe("moving posts in the PR calendar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says how many days before the event a post goes out, and lets the chair move it to another day", async () => {
    const { db, call } = await setUp(false);
    const [post] = await socialPosts(db, "kind = 'event'");
    const page = await (await call("/pr/kalender")).text();
    expect(page).toMatch(/\d+ dage til eventet/);
    expect(page).toContain(`data-id="${post!.id}"`);
    expect(page).toContain(`action="/pr/kalender/flyt"`);

    // Dragged to the day before: kept a draft, at the new time.
    const at = Date.parse("2026-11-19T16:00:00Z");
    const form = (fields: Record<string, string>) => new URLSearchParams(fields);
    const moved = await call("/pr/kalender/flyt", { method: "POST", json: true, body: form({ id: String(post!.id), channel: "both", at: String(at) }) });
    expect(await moved.json()).toEqual({ ok: true });
    expect((await socialPosts(db, "id = ?", [post!.id]))[0]).toMatchObject({ publish_at_ms: at, status: post!.status });
    expect(await (await call("/pr/kalender")).text()).toContain("1 dag til eventet");

    // Not after the event (nor within its last hour), not in the past.
    const late = await call("/pr/kalender/flyt", { method: "POST", body: form({ id: String(post!.id), at: String(Date.parse("2026-11-21T10:00:00Z")), start: "2026-11-02" }) });
    expect(late.headers.get("location")).toBe("/pr/kalender?start=2026-11-02&fejl=tid");
    expect(await movePost(db, post!.id, "both", NOW - 86_400_000, NOW)).toBe("time");
    // A post already out is not moved.
    await db.prepare("UPDATE social_posts SET status = 'published'").run();
    expect(await movePost(db, post!.id, "both", at, NOW)).toBe("sent");
  });

  it("moves Instagram on its own when the event goes out at different times on the two", async () => {
    const { db } = await setUp(true);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post!.channels).toEqual(["facebook", "instagram"]);
    const fb = post!.publish_at_ms!;
    expect(post!.source.instagramAtMs).not.toBe(fb);
    const at = Date.parse("2026-11-18T17:00:00Z");
    expect(await movePost(db, post!.id, "instagram", at, NOW)).toBe("moved");
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ publish_at_ms: fb, source: { instagramAtMs: at } });
  });
});
