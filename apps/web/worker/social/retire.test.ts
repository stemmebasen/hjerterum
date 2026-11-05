import { describe, expect, it } from "vitest";
import { testDatabase } from "../saga/test-support.js";
import { retireCancelled, socialPost } from "./social.js";

// Reported (the chair, 5 Nov 2026): "Jeg får stadig vist et event som dette, selvom det er aflyst. Det er en fejl." - "Mediterende Yoga | Onsdage 16-17.20 - Aflyst -".
const NOW = Date.parse("2026-11-05T12:00:00Z");

describe("posts for events that are off", () => {
  it("are set aside when the calendar marks the event cancelled, or when the event has taken place without its post", async () => {
    const db = testDatabase();
    const add = async (id: string, title: string, startsMs: number) => {
      await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Mira', 'x', 0)").bind(id, title, startsMs).run();
      await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
        VALUES ('event', ?, '2026-W46', '["facebook"]', 'Kom', '[]', ?, ?, 'draft', 0, 0)`).bind(`event:${id}`, JSON.stringify({ key: `mw:${id}`, title, startsMs }), startsMs - 86_400_000).run();
      return Number((await db.prepare("SELECT max(id) AS id FROM social_posts").first<{ id: number }>())!.id);
    };
    const cancelled = await add("SF6abba95f7f218a92a203a7da", "Mediterende Yoga  |  Onsdage 16-17.20 - Aflyst -", NOW + 6 * 86_400_000);
    const past = await add("SF6abba949e1a89220c3050d27", "Mediterende Yoga  |  Onsdage 16-17.20", NOW - 3_600_000);
    const on = await add("SF6abba9770891c915390afe77", "Mediterende Yoga  |  Onsdage 16-17.20", NOW + 13 * 86_400_000);
    expect(await retireCancelled(db, NOW)).toBe(2);
    expect(await socialPost(db, cancelled)).toMatchObject({ status: "skipped", error: "Eventet er aflyst eller fjernet fra kalenderen" });
    expect(await socialPost(db, past)).toMatchObject({ status: "skipped", error: "Eventet er afholdt, før opslaget blev godkendt" });
    expect((await socialPost(db, on))!.status).toBe("draft");
  });
});
