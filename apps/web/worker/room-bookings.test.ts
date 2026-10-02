import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomBooking, normalizeCreateRoomBookingInput } from "./room-bookings.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: "Det er denne prisberegners data alt skal baseres på https://holistisk.org/lejepriser/".
// Copenhagen is UTC+1 in November: 10:00 local is 09:00Z.
const booking = (startsAt: string, endsAt: string, bookingType?: string) => normalizeCreateRoomBookingInput({
  teacherName: "Maria", teacherEmail: "maria@example.com", title: "Yoga", startsAt, endsAt, ...(bookingType ? { bookingType } : {})
});

describe("room bookings priced by Hjerterum's price calculator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("charges the calculator's prices and keeps the booking type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    // Tuesday 10:00-13:00, standard: the 3-hour package.
    expect(await createRoomBooking(db, "u1", booking("2027-11-16T09:00:00Z", "2027-11-16T12:00:00Z"))).toMatchObject({ feeKr: 1080 });
    // Tuesday 19:00-22:00, member discount: A-time 400 + 150, less 25 %.
    expect(await createRoomBooking(db, "u1", booking("2027-11-16T18:00:00Z", "2027-11-16T21:00:00Z", "reduced"))).toMatchObject({ feeKr: 412 });
    // Saturday, free rent.
    expect(await createRoomBooking(db, "u1", booking("2027-11-20T09:00:00Z", "2027-11-20T11:00:00Z", "free"))).toMatchObject({ feeKr: 0 });
    const rows = (await db.prepare("SELECT booking_type, fee_minor FROM room_bookings ORDER BY id").all()).results;
    expect(rows).toEqual([{ booking_type: "standard", fee_minor: 108000 }, { booking_type: "reduced", fee_minor: 41200 }, { booking_type: "free", fee_minor: 0 }]);
  });

  it("holds the calculator's rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    // Weekday 17:00-19:00 with member discount crosses 18:30.
    await expect(createRoomBooking(db, "u1", booking("2027-11-16T16:00:00Z", "2027-11-16T18:00:00Z", "reduced"))).rejects.toThrow("invalid_crosses_a_time_boundary");
    await expect(createRoomBooking(db, "u1", booking("2027-11-16T09:00:00Z", "2027-11-16T10:00:00Z"))).rejects.toThrow("invalid_duration_too_short");
    await expect(createRoomBooking(db, "u1", booking("2027-11-16T07:00:00Z", "2027-11-16T18:00:00Z"))).rejects.toThrow("invalid_duration_too_long");
    expect(() => booking("2027-11-16T09:00:00Z", "2027-11-16T12:00:00Z", "gratis")).toThrow("invalid_booking_type");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM room_bookings").first())).toEqual({ n: 0 });
  });
});
