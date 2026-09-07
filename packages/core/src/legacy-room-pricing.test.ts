import { describe, expect, it } from "vitest";
import {
  calculateLegacyRoomFee,
  LEGACY_SOME_PACKAGE_FEE_KR
} from "./legacy-room-pricing.js";

describe("calculateLegacyRoomFee", () => {
  it("uses A-time on weekends", () => {
    expect(
      calculateLegacyRoomFee({ dayOfWeek: 6, startMinutes: 10 * 60, durationMinutes: 120 })
    ).toEqual({ band: "A", roundedHours: 2, feeKr: 200 });
  });

  it("switches weekday bookings to A-time exactly at 18:30", () => {
    expect(
      calculateLegacyRoomFee({ dayOfWeek: 1, startMinutes: 18 * 60 + 29, durationMinutes: 120 })
    ).toEqual({ band: "B", roundedHours: 2, feeKr: 75 });

    expect(
      calculateLegacyRoomFee({ dayOfWeek: 1, startMinutes: 18 * 60 + 30, durationMinutes: 120 })
    ).toEqual({ band: "A", roundedHours: 2, feeKr: 200 });
  });

  it("rounds partial booking hours upward before applying A-time supplements", () => {
    expect(
      calculateLegacyRoomFee({ dayOfWeek: 0, startMinutes: 12 * 60, durationMinutes: 121 })
    ).toEqual({ band: "A", roundedHours: 3, feeKr: 275 });
  });

  it("rounds B-time half-kroner to whole DKK exactly like the legacy server", () => {
    expect(
      calculateLegacyRoomFee({ dayOfWeek: 2, startMinutes: 12 * 60, durationMinutes: 180 })
    ).toEqual({ band: "B", roundedHours: 3, feeKr: 113 });

    expect(
      calculateLegacyRoomFee({ dayOfWeek: 2, startMinutes: 12 * 60, durationMinutes: 300 })
    ).toEqual({ band: "B", roundedHours: 5, feeKr: 188 });
  });

  it("keeps the first two hours at the flat base fee", () => {
    expect(
      calculateLegacyRoomFee({ dayOfWeek: 3, startMinutes: 9 * 60, durationMinutes: 1 })
    ).toEqual({ band: "B", roundedHours: 1, feeKr: 75 });

    expect(
      calculateLegacyRoomFee({ dayOfWeek: 3, startMinutes: 9 * 60, durationMinutes: 120 })
    ).toEqual({ band: "B", roundedHours: 2, feeKr: 75 });
  });

  it("pins the legacy backend SoMe invoice item to 390 DKK", () => {
    expect(LEGACY_SOME_PACKAGE_FEE_KR).toBe(390);
  });

  it("rejects invalid legacy pricing inputs", () => {
    expect(() =>
      calculateLegacyRoomFee({ dayOfWeek: 7, startMinutes: 0, durationMinutes: 60 })
    ).toThrow();
    expect(() =>
      calculateLegacyRoomFee({ dayOfWeek: 1, startMinutes: 1440, durationMinutes: 60 })
    ).toThrow();
    expect(() =>
      calculateLegacyRoomFee({ dayOfWeek: 1, startMinutes: 0, durationMinutes: 0 })
    ).toThrow();
  });
});
