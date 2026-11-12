import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, notifyVideos, tellWeekReady } from "./social.js";

// Reported (the chair, 12 Nov 2026): "Jeg bliver bedt om at godkende ugens events-film, men når jeg klikker ind på linket, så er filmen ikke lavet endnu."
const PLANNED = Date.parse("2026-11-12T09:00:00Z");
const MONDAY = Date.parse("2026-11-16T06:30:00Z");

describe("telling the chair about Ugens events", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('week', 'week:2026-W47', '2026-W47', '["facebook","instagram"]', 'Ugens events', '[]', '{}', ?, 'draft', ?, ?)`).bind(MONDAY, PLANNED, PLANNED).run();
    const reel = () => db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('week', 'reel:2026-W47', '2026-W47', '["facebook","instagram"]', 'Ugens events', '[]', '{"format":"reel","video":"https://www.hjerterum.info/api/social-reels/2026-w47-abc.mp4"}', ?, 'draft', ?, ?)`)
      .bind(MONDAY, PLANNED + 3_600_000, PLANNED + 3_600_000).run();
    const said = () => services.telegram("sendMessage").map(c => JSON.stringify(c.body)).filter(b => b.includes("uge 47"));
    return { db, env, services, reel, said };
  }

  it("waits for the film, then sends one message with a link straight to it", async () => {
    const { db, env, services, reel, said } = await setup();
    expect(await tellWeekReady(env, deps(services.fetcher, PLANNED + 60_000), db)).toBeNull();
    expect(said()).toEqual([]);
    await reel();
    // The message for a made video leaves the week's film to this one.
    expect(await notifyVideos(env, deps(services.fetcher, PLANNED + 3_700_000), db)).toBe(0);
    expect(await tellWeekReady(env, deps(services.fetcher, PLANNED + 3_700_000), db)).toBe("film");
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain("Filmen med");
    expect(said()[0]).toContain("7.30");
    expect(said()[0]).toMatch(/\/pr\/hurtig|https?:\/\//);
    expect(await tellWeekReady(env, deps(services.fetcher, PLANNED + 7_200_000), db)).toBeNull();
    expect(said()).toHaveLength(1);
  });

  it("tells about the picture post alone when no film has come the day after", async () => {
    const { db, env, services, said } = await setup();
    expect(await tellWeekReady(env, deps(services.fetcher, PLANNED + 20 * 3_600_000), db)).toBeNull();
    expect(await tellWeekReady(env, deps(services.fetcher, PLANNED + 27 * 3_600_000), db)).toBe("picture");
    expect(said()[0]).toContain("filmen er ikke lavet endnu");
  });
});
