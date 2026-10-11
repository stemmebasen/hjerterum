/** Prices as organisers write them in free text ("Pris: 100,- for medlemmer / 200,- for ikke-medlemmer", "kr. 350",
 * "Gratis"). Amounts are only taken from lines that talk about price, so dates and phone numbers are not mistaken
 * for prices. The result is marked as parsed from text. */
export type ParsedPrice = { minMinor: number | null; maxMinor: number | null; isFree: boolean | null; text: string | null };

const PRICE_LINE = /(pris|kr\.?|dkk|,-|gratis|free|entré|entre|donation|billet|beløb)/i;
const AMOUNT = /(?:(?:kr\.?|dkk)\s*(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,(\d{2}|-))?)|(?:(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,(\d{2}))?\s*(?:,-|kr\b|kr\.|kroner|dkk))/gi;

export function parsePrice(paragraphs: string[]): ParsedPrice {
  const lines: string[] = [];
  const amounts: number[] = [];
  let free = false;
  for (const line of paragraphs) {
    if (!PRICE_LINE.test(line) || line.length > 220) continue;
    // Phone and MobilePay numbers ("61 99 30 36") are never prices.
    const cleaned = line.replace(/(?:\+45\s*)?\b\d{2}\s?\d{2}\s?\d{2}\s?\d{2}\b/g, " ");
    let found = false;
    for (const m of cleaned.matchAll(AMOUNT)) {
      const value = Number((m[1] ?? m[3] ?? "").replace(/[.\s]/g, ""));
      if (Number.isFinite(value) && value > 0 && value <= 50_000) { amounts.push(value); found = true; }
    }
    if (/\bgratis\b|\bfree\b|fri entr[ée]|ingen entr[ée]/i.test(line)) { free = true; found = true; }
    if (found) lines.push(line);
  }
  if (!amounts.length && !free) return { minMinor: null, maxMinor: null, isFree: null, text: null };
  const text = [...new Set(lines)].slice(0, 3).join(" · ").slice(0, 200);
  if (!amounts.length) return { minMinor: 0, maxMinor: 0, isFree: true, text };
  return { minMinor: Math.min(...amounts) * 100, maxMinor: Math.max(...amounts) * 100, isFree: false, text };
}

/** "100–200 kr.", "Gratis", "Fra 150 kr." */
export function priceLabel(p: { price_min_minor: number | null; price_max_minor: number | null; is_free: number | null }): string | null {
  if (p.is_free === 1) return "Gratis";
  if (p.price_min_minor === null) return null;
  const kr = (minor: number) => new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(minor / 100);
  if (p.price_max_minor !== null && p.price_max_minor !== p.price_min_minor) return `${kr(p.price_min_minor)}–${kr(p.price_max_minor)} kr.`;
  return `${kr(p.price_min_minor)} kr.`;
}
