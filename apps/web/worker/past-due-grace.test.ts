import { describe, expect, it } from "vitest";
import { hasAccess, PAST_DUE_GRACE_DAYS } from "./membership-access.js";

// Douglas (24 Nov 2026), for the board: members in the new system keep access for 14 days while Stripe retries a failed card payment - "I think we must,
// also because they may need to go into their profile and update their membership."
describe("access while a payment is due", () => {
  it("lasts 14 days from the failed payment, as for a member in MembershipWorks", () => {
    const failed = Date.parse("2026-12-01T10:00:00Z"), day = 86_400_000;
    expect(PAST_DUE_GRACE_DAYS).toBe(14);
    expect(hasAccess("active", null)).toBe(true);
    expect(hasAccess("past_due", failed, failed + 13 * day)).toBe(true);
    expect(hasAccess("past_due", failed, failed + 15 * day)).toBe(false);
    expect(hasAccess("past_due", null, failed)).toBe(false);
    expect(hasAccess("canceled", failed, failed + day)).toBe(false);
  });
});
