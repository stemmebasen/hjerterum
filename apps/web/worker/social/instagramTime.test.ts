import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, planWeek, publishDue, socialPosts, topUpWeeks } from "./social.js";
import { instagramPostTimes, POST_GAP_MS } from "./plan.js";
import { prCalendarSection } from "../cockpit/prCalendar.js";
import type { NewsletterEvent } from "../newsletter.js";

// Requested (the chair, 4 Nov 2026): "Og så kan man jo argumentere for, at et event publiceres på forskellige tidspunkter på de to medier." - asked
// whether Saga should propose different times as a rule: "Ja".
const THURSDAY = Date.parse("2026-11-05T09:00:00Z");
const GRAPH = "https://graph.facebook.com/v25.0";

describe("Facebook and Instagram at their own times", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("proposes Instagram's time later than Facebook's, and the same where there is no room before the event", () => {
    const e = (iso: string) => ({ key: iso, title: iso, startsMs: Date.parse(iso) }) as NewsletterEvent;
    const [far, near] = [e("2026-11-12T18:00:00Z"), e("2026-11-05T15:30:00Z")];
    const fb = [Date.parse("2026-11-06T14:00:00Z"), Date.parse("2026-11-05T11:00:00Z")];
    const ig = instagramPostTimes([far, near], fb, THURSDAY);
    expect(ig[0]! - fb[0]!).toBeGreaterThanOrEqual(POST_GAP_MS);
    expect(ig[0]!).toBeLessThan(far.startsMs - 2 * 3_600_000);
    expect(ig[1]).toBe(fb[1]);
  });

  it("plans each event's Instagram at its own time, sends each medium at its time, and shows both in the calendar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES ('SFa', 'Dans', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0)`).bind(Date.parse("2026-11-12T18:00:00Z")).run();
    await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-11-09", { eventsOnly: true });
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post!.channels).toEqual(["facebook", "instagram"]);
    const igAt = post!.source.instagramAtMs!;
    expect(igAt - post!.publish_at_ms!).toBeGreaterThanOrEqual(POST_GAP_MS);
    await db.prepare("UPDATE social_posts SET status = 'approved'").run();
    const graph: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const [path] = url.slice(GRAPH.length).split("?"); graph.push(path!);
      return new Response(JSON.stringify(/^\/c/.test(path!) ? { status_code: "FINISHED" } : { id: path === "/17841/media" ? "c1" : path === "/755/feed" ? "755_1" : "ig1" }));
    };
    // Facebook's time: Facebook only; the post waits for Instagram's.
    await publishDue(env as never, deps(fetcher, post!.publish_at_ms! + 60_000), db);
    expect(graph).toContain("/755/feed");
    expect(graph).not.toContain("/17841/media");
    let now = (await socialPosts(db, "kind = 'event'"))[0]!;
    expect(now).toMatchObject({ status: "approved", published: { facebook: "755_1" } });
    const calendar = prCalendarSection("", { mondays: ["2026-11-02", "2026-11-09"], posts: [now], nowMs: THURSDAY });
    expect(calendar.match(/cal-item is-sent/g)?.length).toBeGreaterThanOrEqual(2); // the legend's and Facebook's
    expect(calendar).toContain("Publiceret · FB");
    expect(calendar).toContain("Godkendt · IG");
    // Instagram's time: out there too, once.
    await publishDue(env as never, deps(fetcher, igAt + 60_000), db);
    await publishDue(env as never, deps(fetcher, igAt + 120_000), db);
    now = (await socialPosts(db, "kind = 'event'"))[0]!;
    expect(now).toMatchObject({ status: "published", published: { facebook: "755_1", instagram: "ig1" } });
    expect(graph.filter(p => p === "/755/feed")).toHaveLength(1);
    expect(graph.filter(p => p === "/17841/media_publish")).toHaveLength(1);
  });

  // Asked: "Er det rigtigt forstået, at opslaget bliver sendt ud på begge medier på samme tid?"
  it("gives a proposal whose time passed without a yes the next free times again - Facebook's and Instagram's own, never in the night", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES ('SFq', 'Qi Gong', ?, 'Benji', 'https://d1tif55lvfk8gc.cloudfront.net/q.jpg', 'x', 0)`).bind(Date.parse("2026-11-13T09:30:00Z")).run();
    await planWeek(env as never, deps(services.fetcher, THURSDAY), db, "2026-11-09", { eventsOnly: true });
    // Its time passes in the night, nobody says yes.
    await db.prepare("UPDATE social_posts SET publish_at_ms = ?, source = json_remove(source, '$.instagramAtMs')").bind(Date.parse("2026-11-04T00:30:00Z")).run();
    const later = Date.parse("2026-11-06T07:00:00Z");
    await topUpWeeks(env as never, deps(services.fetcher, later), db);
    const [post] = await socialPosts(db, "kind = 'event'");
    expect(post!.publish_at_ms!).toBeGreaterThan(later);
    expect(post!.source.instagramAtMs! - post!.publish_at_ms!).toBeGreaterThanOrEqual(POST_GAP_MS);
    for (const t of [post!.publish_at_ms!, post!.source.instagramAtMs!]) expect(new Date(t).getUTCHours()).toBeGreaterThanOrEqual(7);
  });
});
