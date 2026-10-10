import { describe, expect, it } from "vitest";
import { subscriptionSummary } from "./member-profile.js";

// Requested: price, when it is charged, and a small Afmeld - from the member's Stripe subscription.
describe("subscriptionSummary", () => {
  it("reads the price and the next charge, from the item on newer Stripe versions", () => {
    expect(subscriptionSummary({ status: "active", items: { data: [{ current_period_end: 1_800_000_000, price: { unit_amount: 15000, recurring: { interval: "month" } } }] } }))
      .toEqual({ amountMinor: 15000, interval: "month", nextChargeAt: new Date(1_800_000_000_000).toISOString(), cancelAtPeriodEnd: false, endsAt: null });
  });
  it("says when a cancelled membership ends, and no next charge", () => {
    const s = subscriptionSummary({ status: "active", cancel_at_period_end: true, current_period_end: 1_800_000_000, items: { data: [{ price: { unit_amount: 1500000, recurring: { interval: "year" } } }] } });
    expect(s).toMatchObject({ cancelAtPeriodEnd: true, nextChargeAt: null, endsAt: new Date(1_800_000_000_000).toISOString(), interval: "year" });
  });
});
