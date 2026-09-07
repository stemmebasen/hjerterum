export type LegacyRoomPricingInput = {
  /** 0 = Sunday, 1 = Monday, ... 6 = Saturday in the legacy local calendar. */
  dayOfWeek: number;
  /** Minutes since local midnight for the booking start. */
  startMinutes: number;
  /** Positive booking duration in minutes. Legacy rounds partial hours upward. */
  durationMinutes: number;
};

export type LegacyRoomPricingResult = {
  band: "A" | "B";
  roundedHours: number;
  feeKr: number;
};

const A_TIME_START_MINUTES = 18 * 60 + 30;

/**
 * Exact reference implementation of the validated legacy server-side room fee.
 * This is a migration fixture, not a declaration of future Hjerterum pricing.
 */
export function calculateLegacyRoomFee(input: LegacyRoomPricingInput): LegacyRoomPricingResult {
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
    throw new Error("dayOfWeek must be an integer from 0 to 6");
  }
  if (!Number.isFinite(input.startMinutes) || input.startMinutes < 0 || input.startMinutes >= 24 * 60) {
    throw new Error("startMinutes must be within the local day");
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("durationMinutes must be positive");
  }

  const roundedHours = Math.ceil(input.durationMinutes / 60);
  const weekend = input.dayOfWeek === 0 || input.dayOfWeek === 6;
  const band: "A" | "B" = weekend || input.startMinutes >= A_TIME_START_MINUTES ? "A" : "B";
  const extraHours = Math.max(0, roundedHours - 2);

  const feeKr =
    band === "A"
      ? Math.round(200 + extraHours * 75)
      : Math.round(75 + extraHours * 37.5);

  return { band, roundedHours, feeKr };
}
