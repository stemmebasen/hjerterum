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

  async function setup(o: { reminder?: boolean; fbLink?: boolean } = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    const starts = Date.parse("2026-11-09T18:00:00Z");
    // The event's only post, a draft whose time came an hour ago, unapproved.
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W46:mw:SFa', '2026-W46', '["facebook","instagram"]', 'Kom til lydbad.', 'https://www.hjerterum.info/events/a', '["https://x.example/design.jpg"]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFa", title: "Lydbad", startsMs: starts, shout: 1, shouts: o.reminder ? 2 : 1, host: "Sarah Bjørk", design: true, instagramAtMs: NOW - 3_600_000 }), NOW - 3_600_000).run();
    // The reminder a week before, still to come.
    if (o.reminder) await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', 'event:2026-W46:mw:SFa:2', '2026-W46', '["facebook","instagram"]', 'Om en uge: lydbad.', 'https://www.hjerterum.info/events/a', '[]', ?, ?, 'draft', 0, 0)`)
      .bind(JSON.stringify({ key: "mw:SFa", title: "Lydbad", startsMs: starts, shout: 2, shouts: 2 }), starts - 3 * 86_400_000).run();
    if (o.fbLink !== false) await db.prepare("INSERT INTO facebook_events (event_key, title, starts_at_ms, done_by, done_at_ms, link) VALUES ('mw:SFa', 'Lydbad', ?, 'Jacob Hauge', 0, ?)").bind(starts, FB_EVENT).run();
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

  // Requested (the chair, 8 Nov 2026): "repost the event itself when nothing else has been planned still working out 7 and 14 days rule" - "Ved både 14 og 7
  // dage"; then "Det er ikke et link vi skal dele med repost af opslaget" - "Kort fast tekst + billede".
  it("puts out the event itself - its picture with short fixed words, on both media - and tells the chair", async () => {
    const { db, env, services, fetcher, calls } = await setup();
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post).toMatchObject({ status: "approved", channels: ["facebook", "instagram"], link: "https://www.hjerterum.info/events/a", publish_at_ms: NOW, source: { eventItself: true, design: true } });
    expect(post!.text).toBe("✨ Lydbad ✨\n\n🗓 Mandag d. 9. november kl. 19.00\n🌿 Med Sarah Bjørk\n📍 Hjerterum\n\n💛 Læs mere og tilmeld dig her 👇");
    expect(post!.source.instagramText).toContain("💛 Læs mere og tilmeld dig via linket i bio");
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("udgiver eventet selv"))).toBe(true);
    await publishDue(env as never, deps(fetcher, NOW + 60_000), db);
    // The picture as a photo with the words and the link in them - never a link card.
    expect(calls.find(c => c.path === "/755/photos")!.params).toMatchObject({ url: "https://x.example/design.jpg" });
    expect(calls.find(c => c.path === "/755/photos")!.params.caption).toContain("Med Sarah Bjørk");
    expect(calls.some(c => c.path === "/755/feed")).toBe(false);
    expect(calls.find(c => c.path === "/17841/media")!.params.caption).toContain("linket i bio");
  });

  it("does so at the first post's time too, with the reminder still to come", async () => {
    const { db, env, fetcher } = await setup({ reminder: true });
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    expect((await socialPosts(db, "source_key = 'event:2026-W46:mw:SFa'"))[0]).toMatchObject({ status: "approved", publish_at_ms: NOW, source: { eventItself: true } });
    // The reminder is untouched - a post of its own, waiting for the chair.
    expect((await socialPosts(db, "source_key = 'event:2026-W46:mw:SFa:2'"))[0]).toMatchObject({ status: "draft", channels: ["facebook", "instagram"] });
  });
});
