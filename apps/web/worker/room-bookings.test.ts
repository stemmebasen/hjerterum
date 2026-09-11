import { describe, expect, it } from "vitest";
import { normalizeCreateRoomBookingInput } from "./room-bookings.js";

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
