import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, publishDue, setShareFacebookEvent, socialPosts, topUpWeeks } from "./social.js";

// Asked (the chair, 6 Nov 2026): "Er det muligt at dele selve eventet (altså videresende kan man sige) som et post via systemet?" -
// "Når der ikke er godkendt et opslag, så deles selve eventet bare".
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-06T09:00:00Z");
const FB_EVENT = "https://www.facebook.com/events/123456789";

describe("the Facebook event shared when no post was approved", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    const starts = Date.parse("2026-11-09T18:00:00Z");
    // The event's only post, a draft whose time came an hour ago, unapproved.
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W46:mw:SFa', '2026-W46', '["facebook","instagram"]', 'Kom til lydbad.', 'https://www.hjerterum.info/events/a', '["https://x.example/design.jpg"]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFa", title: "Lydbad", startsMs: starts, shout: 1, shouts: 1, design: true, instagramAtMs: NOW - 3_600_000 }), NOW - 3_600_000).run();
    await db.prepare("INSERT INTO facebook_events (event_key, title, starts_at_ms, done_by, done_at_ms, link) VALUES ('mw:SFa', 'Lydbad', ?, 'Jacob Hauge', 0, ?)").bind(starts, FB_EVENT).run();
    // The once-only replans were done long ago (as in production).
    for (const key of ["social_balance_retime", "social_instagram_times", "social_shouts_v1", "social_shouts_v2", "social_shouts_v3"])
      await db.prepare("INSERT INTO job_claims (job_key, scheduled_for_ms, claimed_at_ms) VALUES (?, 0, 0)").bind(key).run();
    const calls: Array<{ path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      calls.push({ path: url.slice(GRAPH.length).split("?")[0]!, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      return new Response(JSON.stringify({ id: "755_9" }));
    };
    return { db, env, services, fetcher, calls };
  }

  it("is not done unless the chair has turned it on", async () => {
    const { db, env, fetcher } = await setup();
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "draft" });
  });

  it("shares the event's own Facebook event instead, on Facebook only, and tells the chair", async () => {
    const { db, env, services, fetcher, calls } = await setup();
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    // Its time has come, unapproved: the Facebook event goes out now instead.
    const later = NOW;
    await topUpWeeks(env as never, deps(fetcher, later), db);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post).toMatchObject({ status: "approved", channels: ["facebook"], link: FB_EVENT, source: { fbEventShare: true } });
    expect(post!.text).toContain("Lydbad - mandag d. 9. november kl. 19.00");
    expect(post!.publish_at_ms).toBe(later);
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("deler Facebook-begivenheden"))).toBe(true);
    await publishDue(env as never, deps(fetcher, post!.publish_at_ms! + 60_000), db);
    // The event's card, not the design as a photo, and nothing on Instagram.
    expect(calls.find(c => c.path === "/755/feed")!.params).toMatchObject({ link: FB_EVENT });
    expect(calls.some(c => c.path === "/755/photos" || c.path.startsWith("/17841"))).toBe(false);
  });
});
