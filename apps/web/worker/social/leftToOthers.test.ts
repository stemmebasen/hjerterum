import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, leftToOthers, planWeek, socialPosts } from "./social.js";

// Lisbeth (20 Nov 2026): "Jeg tænker måske det er bedre at jeg selv laver pr opslag for Healings tilbuddet" - the chair: "Ja for 2026".
const THURSDAY = Date.parse("2026-12-10T09:00:00Z");

describe("an offer whose posts someone else makes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gets no posts of Saga's own in 2026, its old proposals are set aside, and it is still in Ugens events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: null, igUsername: null }, "Jacob Hauge", 0);
    const add = (id: string, title: string, iso: string) => db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Lisbeth', 'x', 0)`).bind(id, title, Date.parse(iso)).run();
    await add("SFh1", "Healing tilbud i Hjerterum - kl. 19.00", "2026-12-15T18:00:00Z");
    await add("SFh2", "Healing tilbud i Hjerterum - kl. 19.45", "2026-12-15T18:45:00Z");
    await add("SFl", "Lydbad", "2026-12-16T18:00:00Z");
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, status, publish_at_ms, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W51:mw:SFh1', '2026-W51', '["facebook"]', 'Kom forbi', NULL, '[]', ?, 'draft', ?, 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFh1", title: "Healing tilbud i Hjerterum - kl. 19.00", startsMs: Date.parse("2026-12-15T18:00:00Z"), host: "Lisbeth" }), Date.parse("2026-12-11T14:00:00Z")).run();
    await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-12-14");
    const events = await socialPosts(db, "week = '2026-W51' AND kind = 'event'");
    expect(events.filter(p => p.status !== "skipped").map(p => p.source.key)).toEqual(["mw:SFl"]);
    expect(events.find(p => p.source.key === "mw:SFh1")).toMatchObject({ status: "skipped" });
    const week = (await socialPosts(db, "kind = 'week'"))[0]!;
    expect(week.text).toContain("Healing tilbud i Hjerterum");
    expect(leftToOthers({ title: "Healing tilbud i Hjerterum - kl. 19.00", startsMs: Date.parse("2027-01-12T18:00:00Z") })).toBeNull();
  });
});
