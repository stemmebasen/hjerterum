// Membership names, prices and descriptions adopted from holistisk.org/bliv-medlem/ (2026-09-24).
export const membershipPlans = {
  standard: {
    name: "Standard medlemskab",
    description: "Bliv medlem af Hjerterum og få adgang til en lang række fordele.",
    month: 22_200, year: 231_000, benefits: true
  },
  generoest: {
    name: "Generøst medlemskab",
    description: "Ønsker du at støtte Hjerterum lidt ekstra, så vælg dette medlemskab. Samtidig er du med til at hjælpe mennesker med kun få midler til at få et medlemskab til reduceret pris.",
    month: 33_300, year: 346_500, benefits: true
  },
  reduceret: {
    name: "Reduceret pris medlemskab",
    description: "Hvis din nettoløn (efter skat) er under 11.000 kr./måned (f.eks. SU), kan du få nedsat kontingent. Hvis din nettoindkomst senere overstiger 11.000 kr., bedes du opgradere til det almindelige medlemskab.",
    month: 11_100, year: 115_500, benefits: true
  },
  support: {
    name: "Support medlemskab",
    description: "Ønsker du at støtte Hjerterum med et lille beløb uden at få adgang til medlemsfordelene, så er dette medlemskab for dig.",
    month: 5_000, year: 54_000, benefits: false
  }
} as const;

export type MembershipTier = keyof typeof membershipPlans;

export function membershipPlan(tier: string) {
  return Object.prototype.hasOwnProperty.call(membershipPlans, tier)
    ? membershipPlans[tier as MembershipTier]
    : Object.values(membershipPlans).find(plan => plan.name.toLocaleLowerCase("da-DK") === tier.trim().toLocaleLowerCase("da-DK"));
}

export function membershipName(tier: string) {
  return membershipPlan(tier)?.name ?? tier;
}

export function includesMemberBenefits(tier: string | null) {
  return tier === null || membershipPlan(tier)?.benefits !== false;
}

export function membershipPrice(amountMinor: number) {
  return (amountMinor / 100).toLocaleString("da-DK") + " kr.";
}
