import { calculateRoomPriceQuote, type RoomBookingType } from "../../../../packages/core/src/legacy-room-pricing.js";

/** The price calculator's sums - the same rules as everywhere in Hjerterum (packages/core legacy-room-pricing.ts). */
export type CalcInput = { day: number; start: string; hours: number; type: RoomBookingType; memberPrice: number | null };
export type CalcResult = {
  day: number; start: string; end: string; hours: number; type: RoomBookingType; band: "A" | "B"; weekend: boolean;
  /** The rent before any campaign discount, and what it is made of. */
  baseKr: number; firstTwoKr: number | null; extraHours: number; extraRateKr: number | null;
  discountPercent: number; discountKr: number; totalKr: number;
  memberPriceKr: number | null; nonMemberPriceKr: number | null; memberAdvantageKr: number | null; minimumNonMemberKr: number | null;
};

export const DAYS_DA = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
export const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const A_TIME = 18 * 60 + 30;
const minutes = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const clock = (total: number) => `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

export function parseCalcInput(raw: Record<string, unknown>): CalcInput | null {
  const day = Number(raw.day), hours = Number(raw.hours), start = String(raw.start ?? "");
  const type = String(raw.type ?? "") as RoomBookingType;
  const member = raw.memberPrice === undefined || raw.memberPrice === null || String(raw.memberPrice).trim() === "" ? null : Number(raw.memberPrice);
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(start)) return null;
  if (!Number.isFinite(hours) || hours < 2 || hours > 10 || Math.round(hours * 2) !== hours * 2) return null;
  if (!["standard", "reduced", "free"].includes(type)) return null;
  if (member !== null && (!Number.isFinite(member) || member < 0 || member > 100_000)) return null;
  return { day, start, hours, type, memberPrice: member === null ? null : Math.round(member) };
}

/** Reduced price and free rent may not cross 18:30 on a weekday; a standard booking may (it is one package price). */
export function crossesBand(input: Pick<CalcInput, "day" | "start" | "hours" | "type">): boolean {
  if (input.type === "standard" || input.day === 0 || input.day === 6) return false;
  const from = minutes(input.start), to = from + input.hours * 60;
  return from < A_TIME && to > A_TIME;
}

export function calculate(input: CalcInput): CalcResult {
  const from = minutes(input.start);
  const quote = calculateRoomPriceQuote({ bookingType: input.type, dayOfWeek: input.day, startMinutes: from, durationMinutes: input.hours * 60,
    ...(input.type === "reduced" ? { memberPriceKr: input.memberPrice ?? 0 } : {}) });
  const aTime = quote.band === "A";
  const extraHours = Math.max(0, quote.roundedHours - 2);
  const firstTwoKr = input.type === "reduced" ? (aTime ? 400 : 150) : null, extraRateKr = input.type === "reduced" ? (aTime ? 150 : 75) : null;
  const baseKr = input.type === "reduced" ? firstTwoKr! + extraHours * extraRateKr! : quote.totalPriceKr;
  return {
    day: input.day, start: input.start, end: clock(from + input.hours * 60), hours: input.hours, type: input.type, band: quote.band,
    weekend: input.day === 0 || input.day === 6, baseKr, firstTwoKr, extraHours, extraRateKr,
    discountPercent: quote.discountPercent, discountKr: baseKr - quote.totalPriceKr, totalKr: quote.totalPriceKr,
    memberPriceKr: input.type === "reduced" ? input.memberPrice : input.type === "free" ? 0 : null,
    nonMemberPriceKr: input.type === "reduced" && input.memberPrice !== null ? quote.nonMemberPriceKr : null,
    memberAdvantageKr: input.type === "reduced" && input.memberPrice !== null ? quote.memberSurchargeKr : null,
    minimumNonMemberKr: input.type === "free" ? quote.minimumNonMemberPriceKr : null,
  };
}
