import { describe, expect, it } from "vitest";
import { attendRoomBooking, listMemberCalendarBookings, reduceAttendance, unattendRoomBooking } from "./room-bookings.js";
import { testDatabase } from "./saga/test-support.js";
import { cancelMessage } from "../src/cancel-registration-text.js";

// Douglas (forslag #6, 27 Nov 2026): "Cancel a registration, or some of its people, from My registrations on Min side".
async function eventWithGroup(seats: number, max = 10, startsIn = 10 * 86_400_000) {
  const db = testDatabase();
  const start = Date.now() + startsIn;
  const id = Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, max_attendees, review_status, status, created_at_ms, updated_at_ms)
    VALUES ('maria', 'Maria', 'm@x.dk', 'Test 3', ?, ?, ?, 'approved', 'scheduled', 1, 1)`).bind(start, start + 3_600_000, max).run()).meta!.last_row_id);
  await attendRoomBooking(db, "douglas", id, { memberName: "Douglas", memberEmail: "d@x.dk" }, false, seats);
  return { db, id };
}
const mine = async (db: ReturnType<typeof testDatabase>, id: number) => (await listMemberCalendarBookings(db, "douglas", Date.now())).find(b => b.id === id)!;

describe("cancelling a registration from Min side", () => {
  it("keeps some of the places of a group registration, frees the others at once, and shows the right number", async () => {
    const { db, id } = await eventWithGroup(4);
    expect(await mine(db, id)).toMatchObject({ my_seats: 4, attendee_count: 4, is_attending: 1 });
    expect(await reduceAttendance(db, "douglas", id, 2)).toBe(2);
    expect(await mine(db, id)).toMatchObject({ my_seats: 2, attendee_count: 2, is_attending: 1 });
    // Not more than there are, not none, not someone else's.
    await expect(reduceAttendance(db, "douglas", id, 2)).rejects.toThrow("attendance_not_found");
    await expect(reduceAttendance(db, "douglas", id, 0)).rejects.toThrow("invalid_seats");
    await expect(reduceAttendance(db, "someone-else", id, 1)).rejects.toThrow("attendance_not_found");
    // The whole registration goes as in Kalender.
    await unattendRoomBooking(db, "douglas", id);
    expect(await mine(db, id)).toMatchObject({ my_seats: null, attendee_count: 0, is_attending: 0 });
  });

  it("does not change a registration once the event has begun", async () => {
    const { db, id } = await eventWithGroup(3, 10, 60_000);
    await db.prepare("UPDATE room_bookings SET starts_at_ms = ? WHERE id = ?").bind(Date.now() - 60_000, id).run();
    await expect(reduceAttendance(db, "douglas", id, 1)).rejects.toThrow("booking_started");
  });

  it("says the same as Kalender", () => {
    expect(cancelMessage(null)).toBe("Din tilmelding er annulleret.");
    expect(cancelMessage(1)).toBe("Din tilmelding er nu for 1 person.");
    expect(cancelMessage(3)).toBe("Din tilmelding er nu for 3 personer.");
  });
});
