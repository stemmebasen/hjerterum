import { describe, expect, it } from "vitest";
import { attendRoomBooking } from "./room-bookings.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: "Man skal også kunne tilmelde sig et event som ikke-medlem".
async function booking(db: ReturnType<typeof testDatabase>, ticket: number, nonMember: number | null) {
  const start = Date.now() + 7 * 86_400_000;
  const r = await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, ticket_price_minor,
      non_member_price_minor, payout_clerk_user_id, created_at_ms, updated_at_ms, review_status)
    VALUES ('owner', 'Gitta', 'g@example.dk', 'Stopdans', ?, ?, 0, ?, ?, 'owner', 1, 1, 'approved')`).bind(start, start + 7_200_000, ticket, nonMember).run();
  return Number(r.meta?.last_row_id);
}

describe("signing up as a non-member", () => {
  it("lets a non-member into a free event", async () => {
    const db = testDatabase();
    const id = await booking(db, 0, null);
    await attendRoomBooking(db, "user_guest", id, { memberName: "Gæst", memberEmail: "gaest@example.dk" }, true);
    const row = await db.prepare("SELECT member_name, registration_status FROM room_booking_attendees WHERE room_booking_id = ?").bind(id).first<{ member_name: string; registration_status: string }>();
    expect(row).toEqual({ member_name: "Gæst", registration_status: "confirmed" });
  });

  it("does not let a non-member in for free when non-members pay - not even when members go free", async () => {
    const db = testDatabase();
    const free = await booking(db, 0, 5000);
    await expect(attendRoomBooking(db, "user_guest", free, { memberName: "Gæst", memberEmail: "gaest@example.dk" }, true)).rejects.toThrow("non_member_payment_unavailable");
    await attendRoomBooking(db, "user_member", free, { memberName: "Medlem", memberEmail: "m@example.dk" });
    const paid = await booking(db, 8000, null);
    await expect(attendRoomBooking(db, "user_guest", paid, { memberName: "Gæst", memberEmail: "gaest@example.dk" }, true)).rejects.toThrow("non_member_payment_unavailable");
  });
});
