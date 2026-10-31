import { describe, expect, it } from "vitest";
import { testDatabase } from "./saga/test-support.js";
import { copenhagenDayRange, copenhagenMidnightMs, listDayItems } from "./room-day.js";

// Requested: choosing a date for an event shows what happens that day, so a free time is easy to pick.

describe("a Copenhagen day", () => {
  it("starts at local midnight, summer and winter, and clock-change days are 23 or 25 hours", () => {
    expect(new Date(copenhagenMidnightMs("2026-10-19")!).toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(new Date(copenhagenMidnightMs("2026-12-01")!).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    const spring = copenhagenDayRange("2026-03-29")!, autumn = copenhagenDayRange("2026-10-25")!;
    expect((spring.toMs - spring.fromMs) / 3_600_000).toBe(23);
    expect((autumn.toMs - autumn.fromMs) / 3_600_000).toBe(25);
  });

  it("refuses what is not a date", () => {
    for (const bad of ["", "2026-13-01", "2026-02-30", "19/10/2026", "2026-10-1"]) expect(copenhagenDayRange(bad)).toBeNull();
  });
});

async function insert(db: ReturnType<typeof testDatabase>, owner: string, title: string, start: string, end: string, review: string, status = "scheduled") {
  await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, ticket_price_minor, payout_clerk_user_id, created_at_ms, updated_at_ms, review_status, status)
    VALUES (?, 'T', 't@example.com', ?, ?, ?, 0, 0, ?, 1, 1, ?, ?)`).bind(owner, title, Date.parse(start), Date.parse(end), owner, review, status).run();
}

describe("the day's overview", () => {
  it("names approved and own events, hides other members' waiting ones behind 'Optaget', and skips other days and cancelled events", async () => {
    const db = testDatabase();
    await insert(db, "user_a", "Meditation", "2026-10-19T08:00:00Z", "2026-10-19T10:00:00Z", "approved");
    await insert(db, "user_b", "Hemmeligt udkast", "2026-10-19T12:00:00Z", "2026-10-19T14:00:00Z", "pending");
    await insert(db, "user_me", "Mit eget udkast", "2026-10-19T15:00:00Z", "2026-10-19T17:00:00Z", "pending");
    await insert(db, "user_a", "Næste dag", "2026-10-20T08:00:00Z", "2026-10-20T10:00:00Z", "approved");
    await insert(db, "user_a", "Aflyst", "2026-10-19T18:00:00Z", "2026-10-19T19:00:00Z", "approved", "cancelled");
    const items = (await listDayItems(db, "user_me", "2026-10-19", []))!;
    expect(items.map((item) => [item.label, item.own, item.waiting])).toEqual([
      ["Meditation", false, false], ["Optaget", false, true], ["Mit eget udkast", true, true]
    ]);
    expect(JSON.stringify(items)).not.toContain("Hemmeligt");
  });

  it("adds the membership calendar's events that fall on the day", async () => {
    const db = testDatabase();
    const items = (await listDayItems(db, "user_me", "2026-10-19", [
      { title: "Filmaften", startsAt: "2026-10-19T17:00:00Z", endsAt: "2026-10-19T19:00:00Z" },
      { title: "En anden dag", startsAt: "2026-10-21T17:00:00Z", endsAt: null },
      { title: "Uden slut", startsAt: "2026-10-19T06:00:00Z" },
      // Partnerhusenes events holdes et andet sted og optager ikke salen (Jake 2026-11-01).
      { title: "Breathwork på Hjerteland", startsAt: "2026-10-19T13:00:00Z", endsAt: "2026-10-19T17:00:00Z" },
      { title: "Aura Balancering", startsAt: "2026-10-19T11:00:00Z", endsAt: "2026-10-19T15:00:00Z", location: "Hjerteland" }
    ]))!;
    expect(items.map((item) => [item.label, item.external])).toEqual([["Uden slut", true], ["Filmaften", true]]);
  });

  it("answers null for a bad date", async () => {
    expect(await listDayItems(testDatabase(), "user_me", "i dag", [])).toBeNull();
  });
});

describe("the day's overview with setup and cleanup", () => {
  it("shows the whole time the room is taken, and the member's own booking id", async () => {
    const db = testDatabase();
    await insert(db, "user_me", "Mit event", "2026-10-19T10:00:00Z", "2026-10-19T12:00:00Z", "approved");
    await db.prepare("UPDATE room_bookings SET setup_minutes = 30, cleanup_minutes = 60").run();
    const [item] = (await listDayItems(db, "user_me", "2026-10-19", []))!;
    expect(item).toMatchObject({ startsAt: "2026-10-19T09:30:00.000Z", endsAt: "2026-10-19T13:00:00.000Z", own: true });
    expect(typeof item!.id).toBe("number");
    const [other] = (await listDayItems(db, "user_other", "2026-10-19", []))!;
    expect(other!.id).toBeUndefined();
  });
});
