import { describe, expect, it } from "vitest";
import { deps, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, countFollowers } from "../social/social.js";
import { insightData, insightSection } from "./prInsight.js";

// Requested (the chair, 3 Nov 2026): "Ja til det hele" - the plan's "månedlig indsigt": followers and what went out, month by month.
describe("the month's insight", () => {
  it("counts the followers once a day and shows the month's growth next to what went out", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
    let fb = 6012, ig = 1400;
    const calls: string[] = [];
    const fetcher: typeof fetch = async input => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://graph.facebook.com/v25.0/755?")) return new Response(JSON.stringify({ followers_count: fb }));
      if (url.startsWith("https://graph.facebook.com/v25.0/17841?")) return new Response(JSON.stringify({ followers_count: ig, media_count: 310 }));
      return new Response("{}", { status: 404 });
    };
    expect(await countFollowers(env as never, deps(fetcher, Date.parse("2026-11-02T10:00:00Z")), db)).toBe(true);
    // Once a day.
    expect(await countFollowers(env as never, deps(fetcher, Date.parse("2026-11-02T15:00:00Z")), db)).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("access_token=page-token");
    fb = 6040; ig = 1395;
    await countFollowers(env as never, deps(fetcher, Date.parse("2026-11-20T10:00:00Z")), db);
    await db.prepare(`INSERT INTO social_posts (kind, source_key, channels, text, published, status, published_at_ms, created_at_ms, updated_at_ms) VALUES
      ('week', 'week:a', '["facebook","instagram"]', 'x', '{"facebook":"1","instagram":"2"}', 'published', ?, 0, 0),
      ('event', 'event:a', '["facebook"]', 'x', '{"facebook":"3"}', 'published', ?, 0, 0),
      ('event', 'event:b', '["facebook"]', 'x', '{}', 'skipped', ?, 0, 0)`).bind(Date.parse("2026-11-09T14:30:00Z"), Date.parse("2026-11-10T14:00:00Z"), Date.parse("2026-11-10T14:00:00Z")).run();
    const [november, october] = await insightData(db, Date.parse("2026-11-21T10:00:00Z"));
    expect(november).toEqual({ month: "2026-11", fb: { start: 6012, end: 6040 }, ig: { start: 1400, end: 1395 }, sent: { week: 1, event: 1, share: 0, instagram: 1 } });
    expect(october).toMatchObject({ month: "2026-10", fb: { start: null, end: null } });
    const html = insightSection([november!, october!]);
    expect(html).toContain("6.040 <small class=\"good\">+28</small>");
    expect(html).toContain("1.395 <small class=\"warn\">-5</small>");
  });

  it("says so when there is nothing yet", async () => {
    expect(insightSection(await insightData(testDatabase(), Date.now()))).toContain("Endnu ingen tal");
  });
});
