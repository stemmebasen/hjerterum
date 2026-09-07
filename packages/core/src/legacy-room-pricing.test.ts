import { describe, expect, it } from "vitest";
import { calculateLegacyRoomFee } from "./legacy-room-pricing.js";

describe("calculateLegacyRoomFee", () => {
  it("charges A-time on weekends", () => {
    expect(calculateLegacyRoomFee({ dayOfWeek: 6, startMinutes: 10 * 60, durationMinutes: 60 })).toEqual({
      band: "A",
      roundedHours: 1,
      feeKr: 200
    });
  });

  it("switches weekday bookings to A-time at 18:30", () => {
    expect(calculateLegacyRoomFee({ dayOfWeek: 1, startMinutes: 18 * 60 + 30, durationMinutes: 180 })).toEqual({
      band: "A",
      roundedHours: 3,
      feeKr: 275
    });
  });

  it("uses B-time before 18:30 on weekdays", () => {
    expect(calculateLegacyRoomFee({ dayOfWeek: 2, startMinutes: 18 * 60 + 29, durationMinutes: 60 })).toEqual({
      band: "B",
      roundedHours: 1,
      feeKr: 75
    });
  });

  it("rounds partial hours upward before pricing", () => {
    expect(calculateLegacyRoomFee({ dayOfWeek: 3, startMinutes: 12 * 60, durationMinutes: 121 })).toEqual({
      band: "B",
      roundedHours: 3,
      feeKr: 113
    });
  });

  it("applies the legacy extra-hour rates after two hours", () => {
    expect(calculateLegacyRoomFee({ dayOfWeek: 0, startMinutes: 9 * 60, durationMinutes: 240 }).feeKr).toBe(350);
    expect(calculateLegacyRoomFee({ dayOfWeek: 4, startMinutes: 9 * 60, durationMinutes: 240 }).feeKr).toBe(150);
  });
});
