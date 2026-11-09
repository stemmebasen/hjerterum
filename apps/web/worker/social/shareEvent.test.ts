import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { asEventItself, connectSocial, findFacebookEvents, publishDue, redoEventItself, setShareFacebookEvent, socialPosts, topUpWeeks } from "./social.js";

// Asked (the chair, 6 Nov 2026): "Er det muligt at dele selve eventet (altså videresende kan man sige) som et post via systemet?" -
// "Når der ikke er godkendt et opslag, så deles selve eventet bare".
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-06T09:00:00Z");
const FB_EVENT = "https://www.facebook.com/events/123456789";

describe("the Facebook event shared when no post was approved", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(o: { reminder?: boolean; fbLink?: boolean; ai?: string; pageEvents?: unknown[]; refuse?: boolean } = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => o.ai ?? "{}" });
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
    const calls: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0]!, method = init?.method ?? "GET";
      calls.push({ method, path, params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
      if (path === "/755/events") return new Response(JSON.stringify({ data: o.pageEvents ?? [] }));
      if (method === "DELETE") return path === "/1810" && o.refuse ? new Response(JSON.stringify({ error: { message: "(#10) Application does not have permission for this action", code: 10 } }), { status: 403 }) : new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify({ id: "755_9" }));
    };
    return { db, env, services, fetcher, calls };
  }

  it("is not done unless the chair has turned it on", async () => {
    const { db, env, fetcher } = await setup();
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "draft" });
  });

  // Corrected (the chair, 8 Nov 2026): "Nu er movie Night kommet ud med en reel. Jeg havde ikke godkendt den så den bør have været en deling af begivenheden".
  it("shares the event's Facebook event with the short words - on Facebook only, never the picture or video - and tells the chair", async () => {
    const { db, env, services, fetcher, calls } = await setup({ ai: "Giv dig selv en pause i lydens bølger 🌊🤍" });
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post).toMatchObject({ status: "approved", channels: ["facebook"], link: FB_EVENT, images: [], publish_at_ms: NOW, source: { fbEventShare: true, noVideo: true } });
    expect(post!.source.design).toBeUndefined();
    expect(post!.text).toBe("✨ Lydbad ✨\n\nGiv dig selv en pause i lydens bølger 🌊🤍\n\n🗓 Mandag d. 9. november kl. 19.00\n🌿 Med Sarah Bjørk\n📍 Hjerterum\n\n💛 Læs mere og tilmeld dig her 👇");
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("deler Facebook-begivenheden"))).toBe(true);
    await publishDue(env as never, deps(fetcher, NOW + 60_000), db);
    expect(calls.find(c => c.path === "/755/feed")!.params).toMatchObject({ link: FB_EVENT });
    expect(calls.some(c => c.path === "/755/photos" || c.path === "/755/videos" || c.path.startsWith("/17841"))).toBe(false);
  });

  it("shares at the first post's time too (14 days before), with the reminder still to come", async () => {
    const { db, env, fetcher } = await setup({ reminder: true });
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    expect((await socialPosts(db, "source_key = 'event:2026-W46:mw:SFa'"))[0]).toMatchObject({ status: "approved", link: FB_EVENT, source: { fbEventShare: true } });
    expect((await socialPosts(db, "source_key = 'event:2026-W46:mw:SFa:2'"))[0]).toMatchObject({ status: "draft", channels: ["facebook", "instagram"] });
  });

  it("puts nothing out in its place when the Facebook event is not known - and tells the chair once", async () => {
    const { db, env, services, fetcher } = await setup({ fbLink: false });
    await setShareFacebookEvent(db, true, "Jacob Hauge", NOW);
    await topUpWeeks(env as never, deps(fetcher, NOW), db);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post!.status).not.toBe("approved");
    expect(post!.source.fbEventShare).toBeUndefined();
    expect(services.telegram("sendMessage").filter(c => JSON.stringify(c.body).includes("kender ikke eventets Facebook-begivenhed")).length).toBe(1);
    // Told once, also when its next time comes (the told mark survives the post's new time).
    expect((await socialPosts(db, "kind = 'event'"))[0]!.source.noFbEventTold).toBe(1);
  });

  it("finds the event's Facebook event on the page by its time and title", async () => {
    const { db, env, fetcher } = await setup({ fbLink: false, pageEvents: [{ id: "999", name: "Lydbad med gongs", start_time: "2026-11-09T19:00:00+0100" }, { id: "111", name: "Noget andet", start_time: "2026-11-09T19:00:00+0100" }] });
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, content_hash, updated_at_ms) VALUES ('SFa', 'Lydbad', ?, 'h', 0)").bind(Date.parse("2026-11-09T18:00:00Z")).run();
    expect(await findFacebookEvents(env as never, deps(fetcher, NOW), db)).toBe(1);
    expect(await db.prepare("SELECT link FROM facebook_events WHERE event_key = 'mw:SFa'").first()).toEqual({ link: "https://www.facebook.com/events/999" });
  });

  // Reported (the chair, 8 Nov 2026): "men det er jo lige her" - an event only in the membership system's list, and a recurring event on Facebook.
  it("finds a recurring Facebook event's own date for an event that only has posts", async () => {
    const { db, env, fetcher } = await setup({ fbLink: false, pageEvents: [{ id: "500", name: "Lydbad hver mandag", start_time: "2026-11-02T19:00:00+0100",
      event_times: [{ id: "501", start_time: "2026-11-09T19:00:00+0100" }, { id: "502", start_time: "2026-11-16T19:00:00+0100" }] }] });
    expect(await findFacebookEvents(env as never, deps(fetcher, NOW), db)).toBe(1);
    expect(await db.prepare("SELECT link FROM facebook_events WHERE event_key = 'mw:SFa'").first()).toEqual({ link: "https://www.facebook.com/events/501" });
  });

  // "Jeg vil også gerne kunne omgøre et design så Saga bare viderdeler eventet med en kort tekst som vi lige har skrevet om".
  it("makes a post a share of the Facebook event on the chair's button - a proposal to approve", async () => {
    const { db, env, fetcher } = await setup();
    const [before] = await socialPosts(db, "kind = 'event'");
    expect(await asEventItself(env as never, deps(fetcher, NOW), db, before!.id, NOW)).toBe("ok");
    expect((await socialPosts(db, "kind = 'event'"))[0]).toMatchObject({ status: "draft", channels: ["facebook"], link: FB_EVENT, images: [], source: { fbEventShare: true } });
    const other = await setup({ fbLink: false });
    const [post] = await socialPosts(other.db, "kind = 'event'");
    expect(await asEventItself(other.env as never, deps(other.fetcher, NOW), other.db, post!.id, NOW)).toBe("no_event");
  });

  // "Slet og del begivenheden": the post that went out as the event's video is taken down, and the Facebook event shared instead.
  it("takes down a post that went out as the event itself, and shares the Facebook event instead", async () => {
    const { db, env, fetcher, calls } = await setup();
    await db.prepare(`UPDATE social_posts SET status = 'published', published = '{"facebook":"1097","instagram":"1810"}', source = json_set(source, '$.eventItself', 1, '$.video', 'https://x.example/v.mp4')`).run();
    expect(await redoEventItself(env as never, deps(fetcher, NOW), db)).toBe(1);
    expect(calls.filter(c => c.method === "DELETE").map(c => c.path).sort()).toEqual(["/1097", "/1810"]);
    const posts = await socialPosts(db, "kind = 'event'", [], "id");
    expect(posts[0]!.source.removed).toBeTruthy();
    expect(posts[1]).toMatchObject({ source_key: "event:2026-W46:mw:SFa:begivenhed", status: "approved", channels: ["facebook"], link: FB_EVENT, source: { fbEventShare: true } });
    // Once.
    expect(await redoEventItself(env as never, deps(fetcher, NOW), db)).toBe(0);
  });

  it("shares the Facebook event all the same when Meta will not take the old post down - and tells the chair what to delete", async () => {
    const { db, env, services, fetcher } = await setup({ refuse: true });
    await db.prepare(`UPDATE social_posts SET status = 'published', published = '{"facebook":"1097","instagram":"1810","instagram_link":"https://www.instagram.com/reel/X/"}', source = json_set(source, '$.eventItself', 1)`).run();
    expect(await redoEventItself(env as never, deps(fetcher, NOW), db)).toBe(1);
    const posts = await socialPosts(db, "kind = 'event'", [], "id");
    expect(posts[0]!.error).toContain("Instagram: meta_403");
    expect(posts[1]).toMatchObject({ status: "approved", link: FB_EVENT });
    expect(services.telegram("sendMessage").some(c => JSON.stringify(c.body).includes("https://www.instagram.com/reel/X/"))).toBe(true);
    expect(await redoEventItself(env as never, deps(fetcher, NOW), db)).toBe(0);
  });
});
