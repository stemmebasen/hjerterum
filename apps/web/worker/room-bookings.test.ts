import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomBooking, normalizeCreateRoomBookingInput } from "./room-bookings.js";
import { testDatabase } from "./saga/test-support.js";

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

describe("member event input rules", () => {
  it("accepts a valid upcoming event", () => {
    expect(normalizeCreateRoomBookingInput({
      teacherName: "Ignored client name",
      teacherEmail: "ignored@example.dk",
      title: "Meditation",
      startsAt: futureIso(60),
      endsAt: futureIso(120),
      maxAttendees: 12,
      ticketPriceKr: 125.5
    })).toMatchObject({ title: "Meditation", maxAttendees: 12, ticketPriceMinor: 12_550 });
  });

  it("defaults free events to zero", () => {
    expect(normalizeCreateRoomBookingInput({
      teacherName: "Anna",
      teacherEmail: "anna@example.dk",
      title: "Gratis",
      startsAt: futureIso(60),
      endsAt: futureIso(120)
    }).ticketPriceMinor).toBe(0);
  });

  it("rejects negative ticket prices", () => {
    expect(() => normalizeCreateRoomBookingInput({
      teacherName: "Anna",
      teacherEmail: "anna@example.dk",
      title: "Forkert pris",
      startsAt: futureIso(60),
      endsAt: futureIso(120),
      ticketPriceKr: -1
    })).toThrow("invalid_ticket_price");
  });

  it("rejects events in the past", () => {
    expect(() => normalizeCreateRoomBookingInput({
      teacherName: "Anna",
      teacherEmail: "anna@example.dk",
      title: "Fortid",
      startsAt: new Date(Date.now() - 120_000).toISOString(),
      endsAt: new Date(Date.now() - 60_000).toISOString()
    })).toThrow("invalid_booking_start");
  });

  it("rejects an invalid interval and capacity", () => {
    expect(() => normalizeCreateRoomBookingInput({
      teacherName: "Anna",
      teacherEmail: "anna@example.dk",
      title: "Forkert tid",
      startsAt: futureIso(120),
      endsAt: futureIso(60)
    })).toThrow("invalid_booking_interval");

    expect(() => normalizeCreateRoomBookingInput({
      teacherName: "Anna",
      teacherEmail: "anna@example.dk",
      title: "Forkert kapacitet",
      startsAt: futureIso(60),
      endsAt: futureIso(120),
      maxAttendees: 0
    })).toThrow("invalid_max_attendees");
  });
});

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

// Requested: setup before and cleanup after the event - the room is taken, and rented, for the whole window.
describe("setup and cleanup around a booking", () => {
  afterEach(() => vi.unstubAllGlobals());
  const withBuffers = (startsAt: string, endsAt: string, setupMinutes: number, cleanupMinutes: number) =>
    normalizeCreateRoomBookingInput({ teacherName: "Maria", teacherEmail: "maria@example.com", title: "Yoga", startsAt, endsAt, setupMinutes, cleanupMinutes });

  it("rents and holds the room for the event plus its setup and cleanup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    // Tuesday 10:30-12:30 with 30 minutes each way: the room is rented 10:00-13:00, the 3-hour package.
    expect(await createRoomBooking(db, "u1", withBuffers("2027-11-16T09:30:00Z", "2027-11-16T11:30:00Z", 30, 30))).toMatchObject({ feeKr: 1080 });
    expect(await db.prepare("SELECT setup_minutes, cleanup_minutes FROM room_bookings").first()).toEqual({ setup_minutes: 30, cleanup_minutes: 30 });
    // An event that starts right when the first one ends still collides with its cleanup ...
    await expect(createRoomBooking(db, "u2", withBuffers("2027-11-16T11:30:00Z", "2027-11-16T13:30:00Z", 0, 0))).rejects.toThrow("booking_conflict");
    // ... and one whose setup reaches back into it too.
    await expect(createRoomBooking(db, "u2", withBuffers("2027-11-16T12:30:00Z", "2027-11-16T14:30:00Z", 60, 0))).rejects.toThrow("booking_conflict");
    // With half an hour of setup it fits: the room is rented 13:00-15:30, the 2½-hour package.
    expect(await createRoomBooking(db, "u2", withBuffers("2027-11-16T12:30:00Z", "2027-11-16T14:30:00Z", 30, 0))).toMatchObject({ feeKr: 900 });
  });

  it("allows only none, half an hour or an hour", () => {
    expect(() => withBuffers("2027-11-16T09:30:00Z", "2027-11-16T11:30:00Z", 45, 0)).toThrow("invalid_setup_minutes");
    expect(() => withBuffers("2027-11-16T09:30:00Z", "2027-11-16T11:30:00Z", 0, 90)).toThrow("invalid_cleanup_minutes");
  });
});
