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

export type RoomBookingType = "standard" | "reduced" | "free";

export type RoomPriceQuote = {
  bookingType: RoomBookingType;
  band: "A" | "B";
  roundedHours: number;
  totalPriceKr: number;
  memberPriceKr: number | null;
  nonMemberPriceKr: number | null;
  minimumNonMemberPriceKr: number | null;
  memberSurchargeKr: number | null;
  discountPercent: number;
};

const STANDARD_PACKAGE_PRICES: Record<number, number> = {
  2: 720, 2.5: 900, 3: 1080, 3.5: 1230, 4: 1380, 4.5: 1530,
  5: 1680, 5.5: 1800, 6: 1920, 6.5: 2040, 7: 2160, 7.5: 2250,
  8: 2340, 8.5: 2430, 9: 2520, 9.5: 2610, 10: 2700
};

const A_TIME_START_MINUTES = 18 * 60 + 30;

/** Legacy server-side SoMe invoice item. The legacy UI displays a different value. */
export const LEGACY_SOME_PACKAGE_FEE_KR = 390;

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

export function calculateRoomPriceQuote(input: LegacyRoomPricingInput & {
  bookingType: RoomBookingType;
  memberPriceKr?: number;
}): RoomPriceQuote {
  const roundedHours = Math.ceil(input.durationMinutes / 30) / 2;
  if (!Number.isFinite(roundedHours) || roundedHours <= 0) {
    throw new Error("durationMinutes must be positive");
  }
  const weekend = input.dayOfWeek === 0 || input.dayOfWeek === 6;
  const aTime = weekend || input.startMinutes >= A_TIME_START_MINUTES;
  const band: "A" | "B" = aTime ? "A" : "B";

  if (input.bookingType === "standard") {
    const totalPriceKr = roundedHours <= 10
      ? STANDARD_PACKAGE_PRICES[roundedHours] ?? 2700
      : 2700 + (roundedHours - 10) * 180;
    return { bookingType: input.bookingType, band, roundedHours, totalPriceKr,
      memberPriceKr: null, nonMemberPriceKr: null, minimumNonMemberPriceKr: null,
      memberSurchargeKr: null, discountPercent: 0 };
  }

  if (input.bookingType === "free") {
    return { bookingType: input.bookingType, band, roundedHours, totalPriceKr: 0,
      memberPriceKr: 0, nonMemberPriceKr: null,
      minimumNonMemberPriceKr: aTime ? 150 : 75, memberSurchargeKr: null, discountPercent: 0 };
  }

  const basePriceKr = aTime ? 400 : 150;
  const extraRateKr = aTime ? 150 : 75;
  const reducedPrice = basePriceKr + Math.max(0, roundedHours - 2) * extraRateKr;
  const discountPercent = aTime ? 25 : 0;
  const totalPriceKr = Math.round(reducedPrice * (1 - discountPercent / 100));
  const memberPriceKr = input.memberPriceKr;
  if (memberPriceKr === undefined || !Number.isFinite(memberPriceKr) || memberPriceKr < 0) {
    throw new Error("memberPriceKr must be a non-negative number for reduced bookings");
  }
  const surcharge = memberPriceKr < 400 ? (aTime ? 100 : 50)
    : memberPriceKr < 800 ? Math.max(aTime ? 100 : 50, Math.round(memberPriceKr * (aTime ? .25 : .125)))
    : memberPriceKr < 2000 ? Math.max(aTime ? 200 : 100, Math.round(memberPriceKr * (aTime ? .2 : .1)))
    : memberPriceKr < 4000 ? Math.max(aTime ? 400 : 200, Math.round(memberPriceKr * (aTime ? .15 : .075)))
    : Math.max(aTime ? 600 : 300, Math.round(memberPriceKr * (aTime ? .1 : .05)));
  return { bookingType: input.bookingType, band, roundedHours, totalPriceKr,
    memberPriceKr, nonMemberPriceKr: memberPriceKr + surcharge,
    minimumNonMemberPriceKr: null, memberSurchargeKr: surcharge, discountPercent };
}
