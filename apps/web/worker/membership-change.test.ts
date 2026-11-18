import { describe, expect, it } from "vitest";
import { changeOptions } from "./membership-change.js";
import { processMemberStripeEvent } from "./members.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (13 Nov 2026), for the board: only certain levels when changing - never the free one for a paying member - and the change at the next renewal.
describe("changing membership level", () => {
  it("offers the paid levels but one's own, and none to one with the free membership", () => {
    expect(changeOptions("standard")).toEqual(["generoest", "reduceret", "support"]);
    expect(changeOptions("support")).toEqual(["standard", "generoest", "reduceret"]);
    expect(changeOptions("gratis")).toEqual([]);
    expect(changeOptions(null)).toEqual([]);
  });

  it("takes the new level over when Stripe renews, not before", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO members (id, clerk_user_id, stripe_customer_id, stripe_subscription_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms, pending_tier)
      VALUES (1, 'u1', 'cus_1', 'sub_1', 'support', 'month', 'active', 'Eva', 'eva@x.dk', 1, 1, 'standard')`).run();
    await processMemberStripeEvent(db, { id: "evt_create", type: "invoice.paid", created: 100, data: { object: { customer: "cus_1", amount_paid: 5000, billing_reason: "subscription_update" } } } as never);
    expect((await db.prepare("SELECT tier, pending_tier FROM members WHERE id = 1").first())).toEqual({ tier: "support", pending_tier: "standard" });
    await processMemberStripeEvent(db, { id: "evt_cycle", type: "invoice.paid", created: 200, data: { object: { customer: "cus_1", amount_paid: 22200, billing_reason: "subscription_cycle" } } } as never);
    expect((await db.prepare("SELECT tier, pending_tier FROM members WHERE id = 1").first())).toEqual({ tier: "standard", pending_tier: null });
  });
});
