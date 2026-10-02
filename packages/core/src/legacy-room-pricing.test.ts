import { describe, expect, it } from "vitest";
import {
  calculateLegacyRoomFee,
  calculateRoomPriceQuote,
  LEGACY_SOME_PACKAGE_FEE_KR,
  ROOM_RENTAL_RULES,
  roomBookingProblems
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

  it("calculates the three public booking types", () => {
    expect(calculateRoomPriceQuote({
      bookingType: "standard", dayOfWeek: 1, startMinutes: 600, durationMinutes: 180
    }).totalPriceKr).toBe(1080);
    expect(calculateRoomPriceQuote({
      bookingType: "reduced", dayOfWeek: 6, startMinutes: 600, durationMinutes: 120, memberPriceKr: 300
    })).toMatchObject({ totalPriceKr: 300, nonMemberPriceKr: 400, discountPercent: 25 });
    expect(calculateRoomPriceQuote({
      bookingType: "free", dayOfWeek: 1, startMinutes: 600, durationMinutes: 120
    })).toMatchObject({ totalPriceKr: 0, minimumNonMemberPriceKr: 75 });
  });

  // Requested: "Det er denne prisberegners data alt skal baseres på https://holistisk.org/lejepriser/".
  it("matches Hjerterum's price calculator, also on A-time weekdays and in the member surcharge", () => {
    expect(calculateRoomPriceQuote({ bookingType: "standard", dayOfWeek: 6, startMinutes: 600, durationMinutes: 270 }).totalPriceKr).toBe(1530);
    expect(calculateRoomPriceQuote({ bookingType: "reduced", dayOfWeek: 2, startMinutes: 19 * 60, durationMinutes: 180, memberPriceKr: 500 }))
      .toMatchObject({ band: "A", totalPriceKr: 412, nonMemberPriceKr: 625 });
    expect(calculateRoomPriceQuote({ bookingType: "reduced", dayOfWeek: 2, startMinutes: 600, durationMinutes: 240, memberPriceKr: 1000 }))
      .toMatchObject({ band: "B", totalPriceKr: 300, nonMemberPriceKr: 1100, discountPercent: 0 });
    expect(calculateRoomPriceQuote({ bookingType: "free", dayOfWeek: 5, startMinutes: 1110, durationMinutes: 120 })).toMatchObject({ minimumNonMemberPriceKr: 150 });
  });

  it("holds the calculator's booking rules", () => {
    expect(roomBookingProblems({ bookingType: "standard", dayOfWeek: 1, startMinutes: 900, durationMinutes: 300 })).toEqual([]);
    expect(roomBookingProblems({ bookingType: "reduced", dayOfWeek: 1, startMinutes: 900, durationMinutes: 300 })).toEqual(["crosses_a_time_boundary"]);
    expect(roomBookingProblems({ bookingType: "free", dayOfWeek: 6, startMinutes: 900, durationMinutes: 300 })).toEqual([]);
    expect(roomBookingProblems({ bookingType: "reduced", dayOfWeek: 1, startMinutes: 16 * 60 + 30, durationMinutes: 120 })).toEqual([]);
    expect(roomBookingProblems({ bookingType: "standard", dayOfWeek: 1, startMinutes: 600, durationMinutes: 90 })).toEqual(["duration_too_short"]);
    expect(roomBookingProblems({ bookingType: "standard", dayOfWeek: 1, startMinutes: 600, durationMinutes: 615 })).toEqual(["duration_too_long", "duration_not_half_hours"]);
    expect(ROOM_RENTAL_RULES).toContain("https://prisberegner.replit.app/beregner");
    expect(ROOM_RENTAL_RULES).toContain("10 t 2.700 kr.");
  });
});
