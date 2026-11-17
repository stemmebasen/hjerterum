import { MEMBERSHIP_TIERS, membershipPlans } from "../membership.js";

/** Asked (the chair, 17 Nov 2026), of the FAQ's prices: they follow what the chair and Douglas save in admin (Medlemsoverblik → Medlemskaber).
 * In the pages' text the list is the line [[medlemspriser]]; it is written from the plans in use, wherever the page is read. */
export const PRICES_TOKEN = "[[medlemspriser]]";
const kr = (minor: number) => `${(minor / 100).toLocaleString("da-DK", { maximumFractionDigits: 2 })} kr.`;
const EXTRA: Record<string, string> = {
  generoest: " Du støtter lidt ekstra og hjælper andre til et medlemskab til reduceret pris.",
  support: " Du støtter huset uden medlemsfordele."
};

export function priceLines(): string {
  return MEMBERSHIP_TIERS.map(tier => {
    const p = membershipPlans[tier];
    return `- **${p.name.replace(/ medlemskab$/i, "")}:** ${kr(p.month)} pr. måned eller ${kr(p.year)} pr. år.${EXTRA[tier] ?? ""}`;
  }).join("\n");
}

export const withPrices = (text: string) => text.includes(PRICES_TOKEN) ? text.split(PRICES_TOKEN).join(priceLines()) : text;
