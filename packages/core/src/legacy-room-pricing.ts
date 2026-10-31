/** Gratis leje: what a non-member pays at least, per person - the same at all times. */
export const FREE_RENT_MIN_NON_MEMBER_KR = 75;

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

/** Hjerterum's price calculator - the truth for every room price and rule. Requested: "Det er denne
 * prisberegners data alt skal baseres på https://holistisk.org/lejepriser/" (the page embeds the calculator). */
export const ROOM_PRICE_CALCULATOR_URL = "https://prisberegner.replit.app/beregner";
export const ROOM_PRICES_PAGE_URL = "https://holistisk.org/lejepriser/";

export type RoomBookingProblem = "duration_too_short" | "duration_too_long" | "duration_not_half_hours" | "crosses_a_time_boundary";

/** The calculator's rules for a booking: 2 to 10 hours in half hours, and with member discount or free
 * rent a weekday booking lies wholly before or wholly from 18:30 (B-time or A-time, never both). */
export function roomBookingProblems(input: LegacyRoomPricingInput & { bookingType: RoomBookingType }): RoomBookingProblem[] {
  const problems: RoomBookingProblem[] = [];
  if (input.durationMinutes < 120) problems.push("duration_too_short");
  if (input.durationMinutes > 600) problems.push("duration_too_long");
  if (input.durationMinutes % 30 !== 0) problems.push("duration_not_half_hours");
  const weekend = input.dayOfWeek === 0 || input.dayOfWeek === 6;
  if (input.bookingType !== "standard" && !weekend && input.startMinutes < A_TIME_START_MINUTES && input.startMinutes + input.durationMinutes > A_TIME_START_MINUTES) {
    problems.push("crosses_a_time_boundary");
  }
  return problems;
}

/** The calculator's prices and rules in words, for Saga and for the board. */
export const ROOM_RENTAL_RULES = [
  `Kilde: Hjerterums prisberegner (${ROOM_PRICE_CALCULATOR_URL}) på ${ROOM_PRICES_PAGE_URL}. Alle priser er inkl. moms.`,
  "Varighed: mindst 2 og højst 10 timer pr. booking, i halve timer. Opsætning og oprydning (typisk 30 min. før og efter) skal ligge inden for den bookede tid.",
  "A) Standard (uden medlemsrabat): fast pakkepris efter længde, samme pris hele døgnet: 2 t 720 kr., 2,5 t 900, 3 t 1.080, 3,5 t 1.230, 4 t 1.380, 4,5 t 1.530, 5 t 1.680, 5,5 t 1.800, 6 t 1.920, 6,5 t 2.040, 7 t 2.160, 7,5 t 2.250, 8 t 2.340, 8,5 t 2.430, 9 t 2.520, 9,5 t 2.610, 10 t 2.700 kr.",
  "B) Reduceret pris (medlemmer får lavere deltagerpris end ikke-medlemmer): B-tid (hverdage før kl. 18:30) 150 kr. for de første 2 timer + 75 kr. pr. ekstra time. A-tid (hverdage fra kl. 18:30 samt weekender) 400 kr. for de første 2 timer + 150 kr. pr. ekstra time, lige nu med 25 % kampagnerabat.",
  "Ikke-medlemmer betaler mindst så meget mere end medlemmer (medlemspris → tillæg A-tid / B-tid): under 400 kr. → +100 / +50 kr.; 400-799 kr. → 25 % (min. 100) / 12,5 % (min. 50); 800-1.999 kr. → 20 % (min. 200) / 10 % (min. 100); 2.000-3.999 kr. → 15 % (min. 400) / 7,5 % (min. 200); 4.000 kr. og derover → 10 % (min. 600) / 5 % (min. 300).",
  "C) Gratis leje: Hjerterum tager ikke betaling for lokalet, medlemmer deltager gratis, ikke-medlemmer betaler mindst 75 kr. pr. person, som underviseren selv opkræver. Kun for betalende medlemmer.",
  "Med reduceret pris eller gratis leje kan en booking på en hverdag ikke gå hen over kl. 18:30: den ligger enten helt i B-tid eller helt i A-tid (en hel dag er to bookinger).",
  "Bookingforespørgslen skal have eventnavn, mindst én dato, beskrivelse, arrangørens navn og mail; gerne max. antal deltagere, betalingsmetode, tilmelding (online eller direkte til underviser), coverbillede (royalty-free, helst ikke AI, 1920 × 1005 px) og links."
].join("\n");

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
      // Formanden 31.10.2026: "Gratis leje – underviseren opkræver selv: Min. 75 kr./person til ikke-medlemmer. Gratis for medlemmer" (før 150 kr. i A-tid).
      minimumNonMemberPriceKr: FREE_RENT_MIN_NON_MEMBER_KR, memberSurchargeKr: null, discountPercent: 0 };
  }

  const basePriceKr = aTime ? 400 : 150;
  const extraRateKr = aTime ? 150 : 75;
  const reducedPrice = basePriceKr + Math.max(0, roundedHours - 2) * extraRateKr;
  const discountPercent = aTime ? 25 : 0;
  // As the calculator: the discount is rounded and taken off (550 kr. - 138 = 412 kr.).
  const totalPriceKr = reducedPrice - Math.round(reducedPrice * discountPercent / 100);
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
