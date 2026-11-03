import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, planWeek, runSocialJob, socialPosts, topUpWeeks } from "./social.js";

// Requested (the chair, 3 Nov 2026): "Kan vi systematisk sørge for at alle events deles mindst én gang. Vi kan vel godt dele et event selvom det ikke er
// oprettet som en begivenhed."
const THURSDAY = Date.parse("2026-11-05T09:00:00Z");

describe("every event shared at least once", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: null, igUsername: null }, "Jacob Hauge", 0);
    const add = (id: string, title: string, iso: string) => db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Kasper', 'x', 0)`).bind(id, title, Date.parse(iso)).run();
    return { db, env, services, add };
  }

  it("gives every event of the week its post, a weekly class once, and adds the events that come later - and only those", async () => {
    const { db, env, services, add } = await setup();
    for (let i = 0; i < 14; i++) await add(`SF${i}`, `Workshop ${i}`, `2026-11-${String(9 + (i % 7)).padStart(2, "0")}T${String(16 + (i % 3)).padStart(2, "0")}:00:00Z`);
    await add("SFy1", "Yoga", "2026-11-10T07:00:00Z");
    await add("SFy2", "Yoga", "2026-11-12T07:00:00Z");
    const plan = await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-11-09");
    expect(plan).toMatchObject({ events: 15, fresh: 15 });
    const posts = await socialPosts(db, "week = '2026-W46' AND kind = 'event'");
    expect(posts).toHaveLength(15);
    expect(new Set(posts.map(p => p.publish_at_ms)).size).toBe(15);
    // The chair skips one; a new event comes to the calendar on Saturday.
    await db.prepare("UPDATE social_posts SET status = 'skipped' WHERE source_key = 'event:2026-W46:mw:SF3'").run();
    await add("SFnew", "Ny lydhealing", "2026-11-13T18:00:00Z");
    const saturday = Date.parse("2026-11-07T10:00:00Z");
    expect(await topUpWeeks(env as never, deps(services.fetcher, saturday), db)).toBe(1);
    const after = await socialPosts(db, "week = '2026-W46' AND kind = 'event'");
    expect(after).toHaveLength(16);
    expect(after.find(p => p.source.key === "mw:SFnew")).toMatchObject({ status: "draft" });
    expect(after.find(p => p.source.key === "mw:SF3")).toMatchObject({ status: "skipped" });
    // Its slot is free: no two posts at the same time.
    expect(new Set(after.map(p => p.publish_at_ms)).size).toBe(16);
    expect(services.telegram("sendMessage").filter(c => JSON.stringify(c.body).includes("Ét nyt event"))).toHaveLength(1);
    // Once per three hours, and a week that has not been planned is left alone.
    expect(await topUpWeeks(env as never, deps(services.fetcher, saturday + 3_600_000), db)).toBe(0);
    expect(await socialPosts(db, "week = '2026-W47'")).toHaveLength(0);
  });

  it("never posts about an event that has been cancelled or removed", async () => {
    const { db, env, services, add } = await setup();
    await add("SFa", "Dans", "2026-11-10T18:00:00Z");
    await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-11-09");
    await db.prepare("UPDATE social_posts SET status = 'approved'").run();
    await db.prepare("UPDATE house_events SET removed_at_ms = 1 WHERE id = 'SFa'").run();
    const [post] = await socialPosts(db, "kind = 'event'");
    await runSocialJob(env as never, deps(services.fetcher, post!.publish_at_ms! + 60_000));
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "skipped", error: "Eventet er aflyst eller fjernet fra kalenderen" });
  });
});
