import { describe, expect, it } from "vitest";
import { memberSavings, nonMemberMinor } from "./member-savings.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: "Medlemsbesparelse xxx kr. Siden <dato>" - the non-member price minus what the member paid, for events taken part in since joining.
const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("the member's saving", () => {
  it("adds up what a non-member would have paid more, for events taken part in since joining", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms, joined_on)
      VALUES ('u1', 'cus_1', 'standard', 'month', 'active', 'Anna', 'anna@example.dk', ?, ?, '2026-09-01')`).bind(NOW, NOW).run();
    const booking = async (id: number, startsAt: string, nonMember: number | null, type = "standard") => {
      const start = Date.parse(startsAt);
      await db.prepare(`INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, created_at_ms, updated_at_ms, non_member_price_minor, booking_type, review_status)
        VALUES (?, 'teacher', 'Lærer', 'l@example.dk', 'Event', ?, ?, 0, 0, ?, ?, 'approved')`).bind(id, start, start + 2 * 3_600_000, nonMember, type).run();
      await db.prepare(`INSERT INTO room_booking_attendees (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms, ticket_amount_minor) VALUES (?, 'u1', 'Anna', 'anna@example.dk', 0, 5000)`).bind(id).run();
    };
    await booking(1, "2026-09-10T16:00:00Z", 25000);          // 250 - 50 = 200 kr.
    await booking(2, "2026-08-10T16:00:00Z", 25000);          // before joining
    await booking(3, "2026-11-10T16:00:00Z", 25000);          // not yet held
    await booking(4, "2026-09-20T16:00:00Z", null);           // no non-member price
    expect(await memberSavings(db, "u1", NOW)).toEqual({ savedKr: 200, since: "2026-09-01", events: 2 });
  });
  it("counts the calculator's minimum for non-members on free rent", () => {
    const start = Date.parse("2026-10-07T08:00:00Z"); // a Wednesday morning
    expect(nonMemberMinor({ non_member_price_minor: null, booking_type: "free", starts_at_ms: start, ends_at_ms: start + 2 * 3_600_000 })).toBeGreaterThan(0);
    expect(nonMemberMinor({ non_member_price_minor: null, booking_type: "standard", starts_at_ms: start, ends_at_ms: start + 7_200_000 })).toBe(0);
  });
});
