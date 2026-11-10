import { afterEach, describe, expect, it, vi } from "vitest";
import { levelDays } from "./level.js";
import { at, dateOf } from "./plan.js";

// Asked (the chair, 10 Nov 2026): "Det her ser helt ubalanceret ud. Der er kun ét opslag i morgen, men fem om et par dage." - "Hun må meget gerne fordele dem jævnt".
describe("levelling the days", () => {
  const now = at("2026-11-11", 6);
  const perDay = (fixed: Array<{ t: number }>, moved: Map<number, { fb: number | null; ig: number | null }>, posts: Array<{ id: number; fb: number | null; ig: number | null }>) => {
    const m = new Map<string, number>();
    for (const f of fixed) m.set(dateOf(f.t), (m.get(dateOf(f.t)) ?? 0) + 1);
    for (const p of posts) { const t = moved.get(p.id) ?? p; for (const x of new Set([t.fb, t.ig].filter((v): v is number => v !== null))) m.set(dateOf(x), (m.get(dateOf(x)) ?? 0) + 1); }
    return m;
  };

  it("spreads the proposals over the days they may go out on, Facebook and Instagram counted together", () => {
    // Five on the 14th (two posts with Instagram at its own time, one with both at once), one on the 12th.
    const posts = [
      { id: 1, fb: at("2026-11-14", 12), ig: at("2026-11-14", 15), earliest: now, latest: at("2026-11-20", 23, 59) },
      { id: 2, fb: at("2026-11-14", 9), ig: at("2026-11-14", 19, 30), earliest: now, latest: at("2026-11-20", 23, 59) },
      { id: 3, fb: at("2026-11-14", 17), ig: at("2026-11-14", 17), earliest: at("2026-11-13", 0), latest: at("2026-11-15", 23, 59) }
    ];
    const fixed = [{ id: 9, t: at("2026-11-12", 19, 30), channel: "fb" as const }];
    const moved = levelDays(fixed, posts, now, at("2026-11-17", 23, 59));
    const days = perDay(fixed, moved, posts);
    expect(Math.max(...days.values())).toBeLessThanOrEqual(2);
    // Each stays in its own window, and Instagram never before Facebook.
    for (const p of posts) {
      const t = moved.get(p.id) ?? p;
      expect(t.fb!).toBeGreaterThanOrEqual(p.earliest);
      expect(t.fb!).toBeLessThanOrEqual(p.latest);
      expect(t.ig!).toBeGreaterThanOrEqual(t.fb!);
    }
  });

  it("leaves days that are already even", () => {
    const posts = [{ id: 1, fb: at("2026-11-12", 12), ig: null, earliest: now, latest: at("2026-11-13", 23, 59) }];
    const fixed = [{ id: 9, t: at("2026-11-13", 12), channel: "fb" as const }];
    expect(levelDays(fixed, posts, now, at("2026-11-13", 23, 59)).size).toBe(0);
  });
});

describe("the morning's levelling in the database", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("moves only the proposals nobody approved or moved, and only from 11 November at 6, once a day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { testDatabase, deps, fakeServices, sagaEnv } = await import("../saga/test-support.js");
    const { connectSocial, levelDrafts, LEVEL_FROM_MS, socialPosts, topUpWeeks } = await import("./social.js");
    const db = testDatabase();
    const insert = (id: number, status: string, publishAt: number, startsMs: number, extra: Record<string, unknown> = {}) =>
      db.prepare("INSERT INTO social_posts (id, kind, source_key, channels, text, images, source, publish_at_ms, status, created_at_ms, updated_at_ms) VALUES (?, 'event', ?, '[\"facebook\"]', 'x', '[]', ?, ?, ?, 0, 0)")
        .bind(id, `k${id}`, JSON.stringify({ title: `E${id}`, startsMs, shout: 1, ...extra }), publishAt, status).run();
    const event = at("2026-11-20", 19);
    // Four on the 15th: two proposals, one the chair moved there, one approved.
    await insert(1, "draft", at("2026-11-15", 9), event);
    await insert(2, "draft", at("2026-11-15", 12), event);
    await insert(3, "draft", at("2026-11-15", 15), event, { chairTime: true });
    await insert(4, "approved", at("2026-11-15", 19, 30), event);
    expect(await levelDrafts(db, LEVEL_FROM_MS)).toBeGreaterThan(0);
    const after = new Map((await socialPosts(db, "1 = 1", [], "id", 10)).map(p => [p.id, p]));
    expect(after.get(3)!.publish_at_ms).toBe(at("2026-11-15", 15));
    expect(after.get(4)!.publish_at_ms).toBe(at("2026-11-15", 19, 30));
    expect([after.get(1)!, after.get(2)!].some(p => dateOf(p.publish_at_ms!) !== "2026-11-15")).toBe(true);
    // Run by the hourly job: not before the first morning, then once a day.
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", 0);
    const services = fakeServices({ ai: () => "{}" });
    const jobs = async (now: number) => { await topUpWeeks(env as never, deps(services.fetcher, now), db); return (await db.prepare("SELECT COUNT(*) AS n FROM job_claims WHERE job_key = 'social_level_days'").first<{ n: number }>())!.n; };
    expect(await jobs(LEVEL_FROM_MS - 3_600_000)).toBe(0);
    expect(await jobs(LEVEL_FROM_MS)).toBe(1);
    expect(await jobs(LEVEL_FROM_MS + 2 * 3_600_000)).toBe(1);
    expect(await jobs(LEVEL_FROM_MS + 86_400_000)).toBe(2);
  });
});
