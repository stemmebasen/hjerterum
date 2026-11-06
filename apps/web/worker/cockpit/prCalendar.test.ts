import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, socialPost, socialPosts, topUpWeeks } from "../social/social.js";

// Requested (the chair, 3 Nov 2026): "Jeg synes, vi bør have en kalender til PR, hvor vi kan se, hvad der er planlagt hvornår, og Saga kommer med
// forslag til samtlige events, der bliver skeduleret."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";

describe("the PR calendar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows Saga's proposal for every coming event on the day it goes out, opening the picture and the finished post, and the chair may pick the time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", NOW);
    // Four weeks ahead: proposed at once, not the day before.
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, 'Aurabalancering', ?, 'Marianne', 'x', 0)`).bind(`SF${HEX}`, Date.parse("2026-12-05T12:00:00Z")).run();
    // "to shouts på hvert medie - 14-15 dage før og 7-8 dage før" (a day wider: 14-16 and 7-9): two posts, the first two weeks before.
    expect(await topUpWeeks(env as never, deps(services.fetcher, NOW), db)).toBe(2);
    const [post, reminder] = await socialPosts(db, "kind = 'event'");
    expect(new Date(post!.publish_at_ms!).toISOString()).toBe("2026-11-19T14:00:00.000Z");
    expect(reminder).toMatchObject({ source: { shout: 2 } });
    expect(new Date(reminder!.publish_at_ms!).toISOString().slice(0, 10) >= "2026-11-26").toBe(true);
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const page = await (await call("/pr/kalender")).text();
    expect(page).toContain("<h2>Kalender</h2>");
    expect(page).toContain(`href="/plakater/${HEX}?fra=%2Fpr%2Fkalender"`);
    expect(page).toMatch(/cal-item is-draft[^>]*><span class="cal-time">15\.00<\/span><b>Aurabalancering<\/b>/);
    expect(page).toContain("Tor 19/11");
    // "Og så savner jeg også en mulighed for at planlægge udsendingen": the chair's own time.
    const at = Date.parse("2026-11-20T18:00:00Z");
    expect((await call(`/plakater/${HEX}/publicer`, { method: "POST", body: JSON.stringify({ text: "Kom", channels: ["facebook"], at: Date.parse("2026-12-06T12:00:00Z") }) })).status).toBe(422);
    const done = await (await call(`/plakater/${HEX}/publicer`, { method: "POST", body: JSON.stringify({ text: "Kom", channels: ["facebook"], at }) })).json() as Record<string, unknown>;
    expect(done).toMatchObject({ ok: true, publishAtMs: at });
    expect(await socialPost(db, post!.id)).toMatchObject({ status: "approved", publish_at_ms: at });
    // "Alle fire på én gang": the reminder is approved with it.
    expect((await socialPost(db, reminder!.id))!.status).toBe("approved");
    const later = await (await call("/pr/kalender")).text();
    expect(later).toContain("Fre 20/11");
    // "kan sendt ikke hedde publiceret?" and the history: earlier weeks can be seen.
    expect(later).toContain("Publiceret");
    expect(later).toContain(`href="/pr/kalender?start=2026-09-14"`);
    expect(await (await call("/pr/kalender?start=2026-09-14")).text()).toContain("Uge 38");
  });

  it("puts the drafts with a picture made before Instagram was connected on Instagram too, once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", NOW);
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Lydhealing', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0)`).bind(`SF${HEX}`, Date.parse("2026-11-20T18:00:00Z")).run();
    // Planned while only Facebook was there (the balancing is claimed then too, so it is released for the test).
    await topUpWeeks(env as never, deps(services.fetcher, NOW), db);
    expect((await socialPosts(db, "kind = 'event'"))[0]!.channels).toEqual(["facebook"]);
    await db.prepare("DELETE FROM job_claims WHERE job_key = 'social_balance_retime'").run();
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(services.fetcher, NOW + 3_600_000), db);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ channels: ["facebook", "instagram"], source: { instagramText: expect.stringContaining("linket i bio") } });
  });
});
