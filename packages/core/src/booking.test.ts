import { describe, expect, it } from "vitest";
import { intervalsOverlap } from "./booking.js";

describe("intervalsOverlap", () => {
  it("detects an overlapping room booking", () => {
    expect(
      intervalsOverlap(
        { startsAt: "2026-09-07T10:00:00+02:00", endsAt: "2026-09-07T12:00:00+02:00" },
        { startsAt: "2026-09-07T11:30:00+02:00", endsAt: "2026-09-07T13:00:00+02:00" }
      )
    ).toBe(true);
  });

  it("allows adjacent bookings without treating them as overlap", () => {
    expect(
      intervalsOverlap(
        { startsAt: "2026-09-07T10:00:00+02:00", endsAt: "2026-09-07T12:00:00+02:00" },
        { startsAt: "2026-09-07T12:00:00+02:00", endsAt: "2026-09-07T13:00:00+02:00" }
      )
    ).toBe(false);
  });

  it("rejects invalid intervals", () => {
    expect(() =>
      intervalsOverlap(
        { startsAt: "2026-09-07T12:00:00+02:00", endsAt: "2026-09-07T10:00:00+02:00" },
        { startsAt: "2026-09-07T13:00:00+02:00", endsAt: "2026-09-07T14:00:00+02:00" }
      )
    ).toThrow("Interval end must be after start");
  });
});
