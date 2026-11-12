// Membership names, prices and descriptions adopted from holistisk.org/bliv-medlem/ (2026-09-24).
export type MembershipPlan = { name: string; description: string; month: number; year: number; benefits: boolean };

/** As written here; what the chair and Douglas have since saved in admin (Medlemsoverblik → Medlemskaber) is laid over them
 * with applyMembershipLevels - the worker from the database, the pages from /api/membership-levels. */
export const DEFAULT_MEMBERSHIP_PLANS = {
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
    description: "Hvis din nettoløn (efter skat) er under 13.500 kr./måned (f.eks. SU), kan du få nedsat kontingent. Hvis din nettoindkomst senere overstiger 13.500 kr., bedes du opgradere til det almindelige medlemskab.",
    month: 11_100, year: 115_500, benefits: true
  },
  support: {
    name: "Support medlemskab",
    description: "Ønsker du at støtte Hjerterum med et lille beløb uden at få adgang til medlemsfordelene, så er dette medlemskab for dig.",
    month: 5_000, year: 54_000, benefits: false
  }
} as const satisfies Record<string, MembershipPlan>;

export type MembershipTier = keyof typeof DEFAULT_MEMBERSHIP_PLANS;
export const MEMBERSHIP_TIERS = Object.keys(DEFAULT_MEMBERSHIP_PLANS) as MembershipTier[];

/** The plans in use: the defaults, with what admin has saved laid over them. Read at the time of use (never copied at load), so a change reaches every page. */
export const membershipPlans: Record<MembershipTier, MembershipPlan> = Object.fromEntries(MEMBERSHIP_TIERS.map(t => [t, { ...DEFAULT_MEMBERSHIP_PLANS[t] }])) as Record<MembershipTier, MembershipPlan>;

export type MembershipLevel = { tier: string; name: string; description: string; month: number; year: number };

/** Lays saved levels over the defaults (whether a level gives the member benefits is not edited - it decides access). True when something changed. */
export function applyMembershipLevels(levels: readonly MembershipLevel[]): boolean {
  let changed = false;
  for (const tier of MEMBERSHIP_TIERS) {
    const saved = levels.find(l => l.tier === tier);
    const next: MembershipPlan = saved && saved.name.trim() && Number.isInteger(saved.month) && Number.isInteger(saved.year) && saved.month >= 0 && saved.year >= 0
      ? { name: saved.name.trim(), description: saved.description.trim(), month: saved.month, year: saved.year, benefits: DEFAULT_MEMBERSHIP_PLANS[tier].benefits }
      : { ...DEFAULT_MEMBERSHIP_PLANS[tier] };
    const now = membershipPlans[tier];
    if (now.name !== next.name || now.description !== next.description || now.month !== next.month || now.year !== next.year) { membershipPlans[tier] = next; changed = true; }
  }
  return changed;
}

export function membershipPlan(tier: string): MembershipPlan | undefined {
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
