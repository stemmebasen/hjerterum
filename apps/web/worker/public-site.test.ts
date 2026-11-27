import { describe, expect, it } from "vitest";
import { setSiteLive, siteLive, toPublicSite } from "./public-site.js";
import { oldSiteInWaiting } from "./social/social.js";
import { testDatabase } from "./saga/test-support.js";

// Then (the chair, 27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes" - what goes out always links to hjerterum.info.
describe("the public website's address in what goes out", () => {
  it("is always hjerterum.info - never turned into holistisk.org, whatever was saved", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, link, content_hash, updated_at_ms) VALUES ('SF69c0139078ffd0f6f3047932', 'Source Breathwork', 1, 'https://holistisk.org/events/#!event/2026/11/4/source-breathwork', 'x', 1)`).run();
    const text = "Læs mere: https://www.hjerterum.info/events/69c0139078ffd0f6f3047932\nSe alle events og tilmeld dig: https://www.hjerterum.info/events\nLæs mere og tilmeld dig på hjerterum.info/events (link i bio).";
    await setSiteLive(db, false, "Jacob Hauge", 2);
    expect(await siteLive(db)).toBe(true);
    expect(await toPublicSite(db, text)).toBe(text);
  });

  it("leaves posts waiting as they are", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO social_posts (kind, source_key, channels, text, link, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('week', 'week:2026-W46', '["facebook"]', 'Se alle events og tilmeld dig: https://www.hjerterum.info/events', 'https://www.hjerterum.info/events', '{}', 1, 'draft', 1, 1)`).run();
    expect(await oldSiteInWaiting(db, 1_800_000_000_000)).toBe(0);
    expect((await db.prepare("SELECT link FROM social_posts").first<{ link: string }>())!.link).toBe("https://www.hjerterum.info/events");
  });
});
