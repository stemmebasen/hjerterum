import { describe, expect, it } from "vitest";
import { calendarLines, houseKnowledge, memberSagaChat, parseAnswer, photoFacts } from "./member-saga.js";
import type { ExternalEvent } from "./external-events.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: Saga on the member site helps set up an event, and can fill the form.
describe("Saga on the member site", () => {
  it("returns a draft only with a title, a real day and times", () => {
    const ok = parseAnswer('{"reply":"Her er et udkast","draft":{"title":"Breathwork","description":"Rolig","date":"2026-10-20","start":"11:30","end":"13:30","booking_type":"free","max_attendees":12,"member_price_kr":null,"non_member_price_kr":150}}');
    expect(ok.draft).toMatchObject({ title: "Breathwork", date: "2026-10-20", booking_type: "free", non_member_price_kr: 150 });
    expect(parseAnswer('{"reply":"Hvornår?","draft":{"title":"Breathwork","date":"","start":"","end":""}}').draft).toBeNull();
    expect(parseAnswer("bare tekst").reply).toBe("bare tekst");
  });
  it("answers only signed-in members", async () => {
    const response = await memberSagaChat(new Request("https://x/api/members/saga/chat", { method: "POST", body: "{}" }), { DB: testDatabase(), AI_API_KEY: "k", AI_MODEL: "m" } as never, { fetcher: fetch, now: () => 0 });
    expect(response.status).toBe(401);
  });
});

// Requested: "Spørg Saga" - limited, no internal secrets, very good at events and texts, help with getting in and social media, and photos.
describe("what Spørg Saga knows", () => {
  it("reads weekdays and the room's taken times from a calendar - never whose", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, ticket_price_minor, payout_clerk_user_id, created_at_ms, updated_at_ms, review_status, status, setup_minutes, cleanup_minutes)
      VALUES ('u', 'T', 't@example.com', 'Hemmelig workshop', ?, ?, 0, 0, 'u', 1, 1, 'pending', 'scheduled', 30, 30)`).bind(Date.parse("2026-11-04T17:00:00Z"), Date.parse("2026-11-04T19:00:00Z")).run();
    const external: ExternalEvent[] = [
      { id: "1", source: "membershipworks", title: "Yoga", startsAt: "2026-11-04T19:30:00Z", endsAt: "2026-11-04T21:00:00Z", location: null, imageUrl: null, link: null, host: null, description: null, category: null },
      { id: "2", source: "membershipworks", title: "Hjerteland", startsAt: "2026-11-05T09:00:00Z", endsAt: "2026-11-05T11:00:00Z", location: "Hjerteland", imageUrl: null, link: null, host: null, description: null, category: null }
    ];
    const lines = (await calendarLines(db, external, Date.parse("2026-10-10T10:00:00Z"))).split("\n");
    expect(lines).toHaveLength(120);
    expect(lines[0]).toBe("2026-10-10 lørdag: ledig hele dagen");
    expect(lines.find((l) => l.startsWith("2026-11-01"))).toContain("søndag");
    // 18.00-20.00 with half an hour each way, and the calendar's 20.30-22.00 right after: one taken stretch.
    expect(lines.find((l) => l.startsWith("2026-11-04"))).toBe("2026-11-04 onsdag: optaget 17.30-22.00");
    // A partner house's event is not in the room.
    expect(lines.find((l) => l.startsWith("2026-11-05"))).toBe("2026-11-05 torsdag: ledig hele dagen");
    expect(lines.join(" ")).not.toContain("Hemmelig");
  });

  it("has the website's pages about getting in, cleaning and marketing - without the key box code", () => {
    const text = houseKnowledge();
    expect(text).toContain("nøgleboks");
    expect(text).toContain("dørtelefon");
    expect(text).toContain("Facebook");
    expect(text).not.toContain("{{");
    expect(text).not.toMatch(/kode(n)? (er|til nøgleboksen er) \d/i);
  });

  it("measures a photo against the cover's rules, and never approves one that breaks them", () => {
    expect(photoFacts({ name: "a.jpg", type: "image/jpeg", bytes: 2_000_000, width: 4000, height: 3000 }).ok).toBe(true);
    const small = photoFacts({ name: "b.jpg", type: "image/jpeg", bytes: 200_000, width: 1600, height: 1200 });
    expect(small.ok).toBe(false);
    expect(small.text).toContain("1600 × 1200");
    expect(photoFacts({ name: "c.webp", type: "image/webp", bytes: 1_000_000, width: 4000, height: 3000 }).ok).toBe(false);
    expect(photoFacts({ name: "d.png", type: "image/png", bytes: 9 * 1024 * 1024, width: 4000, height: 3000 }).ok).toBe(false);
    // Tall: 3000 × 4000 cut to 1.91:1 is 3000 × 1571 - big enough.
    expect(photoFacts({ name: "e.jpg", type: "image/jpeg", bytes: 1_000_000, width: 3000, height: 4000 }).ok).toBe(true);
    expect(parseAnswer('{"reply":"Flot foto","draft":null,"photo_ok":true}').photoOk).toBe(true);
    expect(parseAnswer('{"reply":"Hm","draft":null}').photoOk).toBeNull();
  });
});
