import { describe, expect, it } from "vitest";
import { pastEvents } from "./past-events.js";
import { testDatabase } from "./saga/test-support.js";
import { matchesPast } from "../src/past-events.js";

// Douglas (forslag #3, 26 Nov 2026): "Show past events in the website and Min side calendars" - "finding a teacher or event again to check on some detail".
const NOW = Date.parse("2026-11-26T12:00:00Z");
const H = 3_600_000;

describe("past events", () => {
  it("lists the house's own held events and the old calendar's, newest first - not coming, unapproved, cancelled or partners' events", async () => {
    const db = testDatabase();
    const own = (title: string, starts: number, review = "approved", status = "scheduled") => db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('u1', 'Mari-Anne', 'm@example.org', ?, ?, ?, ?, ?, 0, 0)`).bind(title, starts, starts + 2 * H, review, status).run();
    await own("Yin yoga", NOW - 48 * H);
    await own("Kommende yoga", NOW + 48 * H);
    await own("Ikke godkendt", NOW - 72 * H, "pending");
    await own("Aflyst", NOW - 72 * H, "approved", "cancelled");
    const old = (id: string, title: string, starts: number, location: string | null = null, removed: number | null = null) => db.prepare(`INSERT INTO house_events
      (id, title, starts_at_ms, ends_at_ms, location, host, category, content_hash, removed_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'Kasper Holm', 'Lyd', 'x', ?, 0)`)
      .bind(id, title, starts, starts + 2 * H, location, removed).run();
    await old("SF6ad5d1369e8a60ed5700d232", "Lydhealing", Date.parse("2021-03-04T18:00:00Z"));
    await old("SF6ad5d1369e8a60ed5700d233", "Dans i Hjerteland", NOW - 24 * H, "Hjerteland");
    await old("SF6ad5d1369e8a60ed5700d234", "Fjernet", NOW - 24 * H, null, NOW);
    await old("SF6ad5d1369e8a60ed5700d235", "Kommer", NOW + 24 * H);

    const list = await pastEvents(db as never, NOW);
    expect(list.map(e => e.title)).toEqual(["Yin yoga", "Lydhealing"]);
    expect(list[0]).toMatchObject({ host: "Mari-Anne", page: expect.stringMatching(/^\/events\/h\d+$/) });
    expect(list[1]).toMatchObject({ host: "Kasper Holm", page: "/events/6ad5d1369e8a60ed5700d232", startsAt: "2021-03-04T18:00:00.000Z" });
    // Never the teacher's e-mail.
    expect(JSON.stringify(list)).not.toContain("m@example.org");
  });

  it("finds an event again by title or teacher, without regard to case or accents", () => {
    const event = { title: "Yin Yoga med Yin Yogi", host: "Mari-Anne Christoffersen" };
    expect(matchesPast(event, "yin")).toBe(true);
    expect(matchesPast(event, "mari anne")).toBe(true);
    expect(matchesPast(event, "christoffersen yoga")).toBe(true);
    expect(matchesPast(event, "lydhealing")).toBe(false);
    expect(matchesPast({ title: "Café", host: null }, "cafe")).toBe(true);
  });
});
