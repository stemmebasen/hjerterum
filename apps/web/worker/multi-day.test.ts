import { describe, expect, it, vi } from "vitest";
import { createRoomBooking, dayWindows, laterDay, normalizeCreateRoomBookingInput } from "./room-bookings.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (18 Nov 2026), for the board: "I cannot see any way to book a whole weekend."
describe("an event on several days in a row", () => {
  it("keeps the clock time from day to day, also over the change from summer time", () => {
    const sat = Date.parse("2027-10-30T08:00:00Z"); // Saturday 10.00 summer time; winter time from Sunday 31 Oct
    expect(new Date(laterDay(sat, 1)).toISOString()).toBe("2027-10-31T09:00:00.000Z");
    expect(dayWindows(sat, sat + 8 * 3_600_000, 2).map(d => new Date(d.endMs).toISOString())).toEqual(["2027-10-30T16:00:00.000Z", "2027-10-31T17:00:00.000Z"]);
  });

  it("rents the room for each day, and finds it busy if any day is taken", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const input = (days: number, day = "2027-03-06") => normalizeCreateRoomBookingInput({ teacherName: "D", teacherEmail: "d@x.dk", title: "Weekend", description: "x",
      startsAt: `${day}T09:00:00Z`, endsAt: `${day}T15:00:00Z`, days });
    const one = await createRoomBooking(db, "a", input(1, "2027-03-13"));
    const two = await createRoomBooking(db, "b", input(2));
    expect(two.feeKr).toBe(one.feeKr * 2);
    const row = await db.prepare("SELECT starts_at_ms, ends_at_ms, days FROM room_bookings WHERE id = ?").bind(two.id).first<{ starts_at_ms: number; ends_at_ms: number; days: number }>();
    expect(row).toEqual({ starts_at_ms: Date.parse("2027-03-06T09:00:00Z"), ends_at_ms: Date.parse("2027-03-07T15:00:00Z"), days: 2 });
    // Sunday 7 March is taken by the weekend: another booking that day is refused.
    await expect(createRoomBooking(db, "c", input(1, "2027-03-07"))).rejects.toThrow("booking_conflict");
    // A two-day booking whose second day meets the one on 13 March is refused.
    await expect(createRoomBooking(db, "c", input(2, "2027-03-12"))).rejects.toThrow("booking_conflict");
    expect(() => normalizeCreateRoomBookingInput({ teacherName: "D", teacherEmail: "d@x.dk", title: "x", startsAt: "2027-03-06T09:00:00Z", endsAt: "2027-03-06T15:00:00Z", days: 9 })).toThrow("invalid_days");
    vi.unstubAllGlobals();
  });
});
