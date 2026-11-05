import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, decidePost, socialPosts, topUpWeeks } from "./social.js";
import { dateOf, shoutWindows } from "./plan.js";

// Requested (the chair, 5 Nov 2026): "Hvert event får to shouts på hvert medie - 14-15 dage før og 7-8 dage før - altså i alt fire shouts (2 på insta og 2 på
// facebook). Dette skal planlægges. Hvis et event ikke er blevet delt ifølge planen (fordi jeg ikke har godkendt det) skal Saga replanlægge kommende events."
// Then: "udvider intervallerne med en dag" (14-16 and 7-9), "Hurtigst muligt + 7 dage", "Hver 4. uge" for weekly classes, "Alle fire på én gang".
const NOW = Date.parse("2026-11-05T09:00:00Z");
const DAY = 86_400_000;
const days = (w: { earliest: number; latest: number }) => [dateOf(w.earliest), dateOf(w.latest)];

describe("two posts on each medium for every event", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are planned 14-16 and 7-9 days before; later events get the first as soon as may be, and under a week one post", () => {
    const far = Date.parse("2026-12-05T18:00:00Z");
    expect(shoutWindows(far, NOW).map(days)).toEqual([["2026-11-19", "2026-11-21"], ["2026-11-26", "2026-11-28"]]);
    // Twelve days ahead: the first now (at the latest ten days before), the reminder a week before.
    expect(shoutWindows(NOW + 12 * DAY, NOW).map(days)).toEqual([["2026-11-05", "2026-11-07"], ["2026-11-08", "2026-11-10"]]);
    // Five days ahead: one, as soon as may be, the day before at the latest.
    expect(shoutWindows(NOW + 5 * DAY, NOW).map(days)).toEqual([["2026-11-05", "2026-11-09"]]);
  });

  it("are approved together, a weekly class gets its own posts every fourth week, and a post whose time passed is planned again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", 0);
    const add = (id: string, title: string, at: number) => db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Mira', 'x', 0)").bind(id, title, at).run();
    await add("SFretreat", "Retreat", Date.parse("2026-12-05T09:00:00Z"));
    for (const [i, d] of ["2026-11-25", "2026-12-02", "2026-12-09"].entries()) await add(`SFyoga${i}`, "Mediterende Yoga", Date.parse(`${d}T15:00:00Z`));
    await topUpWeeks(env as never, deps(services.fetcher, NOW), db);
    const posts = await socialPosts(db, "kind = 'event'", [], "json_extract(source, '$.startsMs'), json_extract(source, '$.shout')");
    // The retreat: two posts; the weekly yoga: the first of the three weeks only (with its two).
    expect(posts.map(p => `${p.source.key}#${p.source.shout}`)).toEqual(["mw:SFyoga0#1", "mw:SFyoga0#2", "mw:SFretreat#1", "mw:SFretreat#2"]);
    const [first, second] = posts.filter(p => p.source.key === "mw:SFretreat");
    expect(second!.text).toContain("Om en uge");
    // One yes for both.
    await decidePost(db, first!.id, "approve", "Jacob Hauge", NOW);
    expect((await socialPosts(db, "json_extract(source, '$.key') = 'mw:SFretreat'")).map(p => p.status)).toEqual(["approved", "approved"]);
    await decidePost(db, first!.id, "undo", "Jacob Hauge", NOW);
    expect((await socialPosts(db, "json_extract(source, '$.key') = 'mw:SFretreat'")).map(p => p.status)).toEqual(["draft", "draft"]);
    // Not approved in time: the first post is planned again inside its window (ten days before at the latest) ...
    const later = first!.publish_at_ms! + 3_600_000;
    await db.prepare("DELETE FROM job_claims WHERE job_key LIKE 'social_top_up%'").run();
    await topUpWeeks(env as never, deps(services.fetcher, later), db);
    const moved = (await socialPosts(db, "id = ?", [first!.id]))[0]!;
    expect(moved.status).toBe("draft");
    expect(moved.publish_at_ms!).toBeGreaterThan(later);
    expect(dateOf(moved.publish_at_ms!) <= "2026-11-25").toBe(true);
    // ... and set aside when its window has gone; the reminder stays.
    const gone = Date.parse("2026-11-26T12:00:00Z");
    await db.prepare("DELETE FROM job_claims WHERE job_key LIKE 'social_top_up%'").run();
    await topUpWeeks(env as never, deps(services.fetcher, gone), db);
    expect((await socialPosts(db, "id = ?", [first!.id]))[0]).toMatchObject({ status: "skipped", error: expect.stringContaining("2. opslag står tilbage") });
    expect((await socialPosts(db, "id = ?", [second!.id]))[0]!.status).toBe("draft");
  });
});
