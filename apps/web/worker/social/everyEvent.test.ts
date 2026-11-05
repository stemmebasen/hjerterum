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
    // No two posts at the same time (the skipped one's slot is free again, so the new event may take it), three a day at most.
    const live = after.filter(p => p.status !== "skipped");
    expect(new Set(live.map(p => p.publish_at_ms)).size).toBe(15);
    const perDay = new Map<string, number>(); for (const p of live) { const d = new Date(p.publish_at_ms! + 3_600_000).toISOString().slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
    expect(services.telegram("sendMessage").filter(c => JSON.stringify(c.body).includes("et forslag til et opslag om et nyt event"))).toHaveLength(1);
    // Once an hour; nothing new, nothing more.
    expect(await topUpWeeks(env as never, deps(services.fetcher, saturday + 60_000), db)).toBe(0);
    expect(await topUpWeeks(env as never, deps(services.fetcher, saturday + 3_600_000), db)).toBe(0);
    // Requested: "Saga kommer med forslag til samtlige events, der bliver skeduleret" - an event weeks ahead gets its proposal at once (its week's
    // "Ugens events" waits for Thursday), and a class that comes back is told about in the week before.
    await add("SFfar", "Retreat", "2026-11-28T09:00:00Z");
    await add("SFy3", "Yoga", "2026-11-26T07:00:00Z");
    expect(await topUpWeeks(env as never, deps(services.fetcher, saturday + 2 * 3_600_000), db)).toBe(2);
    const far = (await socialPosts(db, "kind = 'event' AND week = '2026-W48'"));
    // Weeks ahead, not the day before (the proposals whose time passed without a yes have the first days again).
    expect(far.find(p => p.source.key === "mw:SFfar")!.publish_at_ms!).toBeLessThan(Date.parse("2026-11-20T00:00:00Z"));
    expect(far.find(p => p.source.key === "mw:SFy3")!.publish_at_ms!).toBeGreaterThanOrEqual(Date.parse("2026-11-19T07:00:00Z"));
    expect(await socialPosts(db, "kind = 'week' AND week = '2026-W48'")).toHaveLength(0);
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

  // Requested (5 Nov 2026): "Altså i PR - også i pr kalenderen": Saga's proposal for an event that is then cancelled leaves the PR calendar at once.
  it("sets aside a waiting proposal as soon as its event is cancelled, long before its time", async () => {
    const { db, env, services, add } = await setup();
    await add("SFa", "Dans", "2026-11-10T18:00:00Z");
    await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-11-09");
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "draft" });
    await db.prepare("UPDATE house_events SET removed_at_ms = 1 WHERE id = 'SFa'").run();
    await runSocialJob(env as never, deps(services.fetcher, THURSDAY + 600_000));
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "skipped" });
  });
});
