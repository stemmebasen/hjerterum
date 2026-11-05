import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, decidePost, planWeek, proposeEventPost, socialPosts, topUpWeeks } from "./social.js";
import { dateOf, eventPostTimes, instagramPostTimes, placeFirsts, shoutWindows } from "./plan.js";
import type { NewsletterEvent } from "../newsletter.js";

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

  // Asked: "Hvorfor har du lagt så mange ind? Er det, fordi vi er i sidste øjeblik?" - never more than three a day.
  it("gives an event that came late one post a week before when the day's three are full, and never proposes one on the day", async () => {
    const late = Array.from({ length: 8 }, (_, i) => ({ key: `mw:${i}`, title: `E${i}`, startsMs: NOW + 11 * DAY + i * 3_600_000 }) as NewsletterEvent);
    const { times, single } = placeFirsts(late, late.map(e => shoutWindows(e.startsMs, NOW)), NOW + 30 * 60_000, []);
    const perDay = new Map<string, number>(); for (const t of times) perDay.set(dateOf(t), (perDay.get(dateOf(t)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
    expect(single.filter(Boolean).length).toBeGreaterThan(0);
    // "Det skal være et nødstilfælde, hvis et event skal promoveres, når det foregår på samme dag."
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", 0);
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES ('SFtoday', 'Medlemscafé', ?, 'Mira', 'x', 0)").bind(NOW + 6 * 3_600_000).run();
    expect((await planWeek(env as never, deps(services.fetcher, NOW), db, "2026-11-02", { eventsOnly: true })).fresh).toBe(0);
    expect(await proposeEventPost(env as never, deps(services.fetcher, NOW), db, "mw:SFtoday")).toBe("today");
    expect(await proposeEventPost(env as never, deps(services.fetcher, NOW), db, "mw:SFtoday", true)).toBe("ok");
    expect(await socialPosts(db, "kind = 'event'")).toHaveLength(1);
  });

  // Reported: "Der er tre forskellige events, der bliver publiceret på samme tidspunkt ... 0:30" and "Det er muligt at skabe meget mere luft imellem tidspunkterne".
  it("never gives a time in the night, keeps three hours between a medium's posts, and Instagram off Facebook's minutes", () => {
    const midnight = Date.parse("2026-11-05T23:20:00Z"); // 00.20 Danish time
    const today = [0, 1, 2].map(i => ({ key: `mw:t${i}`, title: `T${i}`, startsMs: Date.parse("2026-11-06T17:30:00Z") + i * 3_600_000 }) as NewsletterEvent);
    const times = eventPostTimes(today, midnight + 30 * 60_000);
    for (const t of times) expect(Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", hourCycle: "h23" }).format(t))).toBeGreaterThanOrEqual(9);
    const week = Array.from({ length: 6 }, (_, i) => ({ key: `mw:w${i}`, title: `W${i}`, startsMs: NOW + 20 * DAY + i * 3_600_000 }) as NewsletterEvent);
    const fb = eventPostTimes(week, NOW);
    const byDay = new Map<string, number[]>(); for (const t of fb) byDay.set(dateOf(t), [...(byDay.get(dateOf(t)) ?? []), t]);
    for (const day of byDay.values()) { day.sort((a, b) => a - b); for (let i = 1; i < day.length; i++) expect(day[i]! - day[i - 1]!).toBeGreaterThanOrEqual(3 * 3_600_000); }
    const ig = instagramPostTimes(week, fb, NOW);
    expect(ig.some(t => fb.includes(t) && fb.indexOf(t) !== ig.indexOf(t))).toBe(false);
  });
});
