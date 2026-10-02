/** Partnerplanen, fase 1 (docs/PARTNERPLAN.md): a partner gives Hjerterum's members a discount on
 * the partner's own events. The partner chooses the level - a percentage or a fixed amount off - and
 * keeps their own prices, tickets and payment. Hjerterum only shows the event and the member price. */

export type PartnerDiscount = { kind: "percent" | "amount"; /** Percent (1-90), or DKK minor units off. */ value: number };

export const MAX_PARTNER_PERCENT = 90;
export const MAX_PARTNER_AMOUNT_MINOR = 1_000_000;

export function validPartnerDiscount(discount: PartnerDiscount): boolean {
  if (!Number.isSafeInteger(discount.value) || discount.value <= 0) return false;
  return discount.kind === "percent" ? discount.value <= MAX_PARTNER_PERCENT : discount.kind === "amount" && discount.value <= MAX_PARTNER_AMOUNT_MINOR;
}

/** The member price for an event whose normal price is known. Null when the price is unknown: then
 * only the discount is shown, never a guessed price. */
export function partnerMemberPriceMinor(priceMinor: number | null, discount: PartnerDiscount): number | null {
  if (priceMinor === null || !Number.isSafeInteger(priceMinor) || priceMinor < 0 || !validPartnerDiscount(discount)) return null;
  const off = discount.kind === "percent" ? Math.round(priceMinor * discount.value / 100) : discount.value;
  return Math.max(0, priceMinor - off);
}

/** "250 kr.", "1.250 kr.", "299,70 kr." */
export function formatKrMinor(minor: number): string {
  const whole = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const ore = minor % 100;
  return ore ? `${whole},${String(ore).padStart(2, "0")} kr.` : `${whole} kr.`;
}

/** "10 % rabat" or "50 kr. rabat". */
export function partnerDiscountLabel(discount: PartnerDiscount): string {
  return discount.kind === "percent" ? `${discount.value} % rabat` : `${formatKrMinor(discount.value)} rabat`;
}

const LABEL = /(?:^|[^\p{L}])(?:normalpris|billetpris|deltagerpris|kursuspris|deltagergebyr|pris|prisen|billetter|billet|entré|entre|price|tickets?)(?![\p{L}])/giu;
const AFTER_LABEL = /^\s*(?:(?:er|is|pr\.?\s*(?:person|deltager)|per\s+person)\s*)?[:\-–]?\s*/i;

function amount(digits: string, decimals: string | undefined): number | null {
  // "1.250" is thousands; "250.00" is decimals.
  const kr = /^\d{1,3}(?:\.\d{3})+$/.test(digits) ? Number(digits.replace(/\./g, "")) : /^\d+$/.test(digits) ? Number(digits) : null;
  if (kr === null) {
    const decimal = /^(\d+)\.(\d{2})$/.exec(digits);
    return decimal ? Number(decimal[1]) * 100 + Number(decimal[2]) : null;
  }
  const minor = kr * 100 + (decimals ? Number(decimals) : 0);
  return minor <= 10_000_000 ? minor : null;
}

/** The normal price from an event's text, when it is plainly stated next to a price label and a
 * currency ("Pris: 250 kr.", "Billet: kr. 1.250", "Entré: 150,-", "Pris: gratis"). Anything less
 * clear - "Pris for medlemmer: 200 kr.", a bare "250 kr." - gives null, so no price is ever guessed. */
export function extractPriceMinor(text: string | null): number | null {
  if (!text) return null;
  if (/(?:^|[^\p{L}])(?:gratis|fri)\s+entr[ée](?![\p{L}])/iu.test(text)) return 0;
  for (const match of text.matchAll(LABEL)) {
    const rest = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 60).replace(AFTER_LABEL, "");
    if (/^(?:gratis|free)(?![\p{L}])/iu.test(rest)) return 0;
    const before = /^(?:kr\.?|dkk)\s*(\d[\d.]*)(?:,(\d{2})|,-)?/i.exec(rest);
    const after = /^(\d[\d.]*?)(?:,(\d{2}))?\s*(?:kr\.?(?![\p{L}])|kroner(?![\p{L}])|dkk(?![\p{L}])|,-)/iu.exec(rest);
    const found = before ?? after;
    if (found) {
      const value = amount(found[1]!.replace(/\.$/, ""), found[2]);
      if (value !== null) return value;
    }
  }
  return null;
}
