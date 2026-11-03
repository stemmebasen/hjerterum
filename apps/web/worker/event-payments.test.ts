import { describe, expect, it } from "vitest";
import { calculateEventFees, processEventPaymentWebhook } from "./event-payments.js";
import { testDatabase } from "./saga/test-support.js";

describe("event payment fees", () => {
  it("adds the handling fee to the buyer total and platform fee", () => {
    expect(calculateEventFees(20_000, 1_000)).toEqual({
      platformShareMinor: 1_000,
      applicationFeeMinor: 2_000,
      buyerTotalMinor: 21_000
    });
  });

  it("rounds the five percent platform share to whole øre", () => {
    expect(calculateEventFees(1_999, 250)).toEqual({
      platformShareMinor: 100,
      applicationFeeMinor: 350,
      buyerTotalMinor: 2_249
    });
  });

  it("supports a zero handling fee", () => {
    expect(calculateEventFees(10_000, 0)).toEqual({
      platformShareMinor: 500,
      applicationFeeMinor: 500,
      buyerTotalMinor: 10_000
    });
  });
});

// Security review (3 Nov 2026), point 7: a payment for a seat that is no longer there goes back at once.
describe("a ticket paid for a seat that is gone", () => {
  async function setup(bookingStatus: "scheduled" | "cancelled", registration: "pending" | "cancelled") {
    const db = testDatabase();
    await db.prepare(`INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, created_at_ms, updated_at_ms, status, payout_clerk_user_id)
      VALUES (7, 'user_org', 'Org', 'org@x.dk', 'Yoga', 2000000000000, 2000003600000, 1, 1, ?, 'user_org')`).bind(bookingStatus).run();
    await db.prepare("INSERT INTO member_payout_accounts (clerk_user_id, stripe_account_id, created_at_ms, updated_at_ms) VALUES ('user_org', 'acct_org', 1, 1)").run();
    await db.prepare(`INSERT INTO room_booking_attendees (id, room_booking_id, clerk_user_id, member_name, member_email, created_at_ms, registration_status, stripe_checkout_session_id)
      VALUES (11, 7, 'user_buyer', 'Buyer', 'b@x.dk', 1, ?, 'cs_1')`).bind(registration).run();
    const refunds: string[][] = [];
    const run = (id: string) => processEventPaymentWebhook(db, { id, type: "checkout.session.completed", account: "acct_org",
      data: { object: { id: "cs_1", payment_intent: "pi_1", payment_status: "paid", metadata: { registration_id: "11", booking_id: "7", clerk_user_id: "user_buyer" } } } } as never,
      async (pi, account) => { refunds.push([pi, account]); });
    const status = async () => (await db.prepare("SELECT registration_status AS s FROM room_booking_attendees WHERE id = 11").first<{ s: string }>())?.s;
    return { run, refunds, status };
  }

  it("gives the money back when the person had signed off", async () => {
    const { run, refunds, status } = await setup("scheduled", "cancelled");
    await run("evt_1");
    expect(refunds).toEqual([["pi_1", "acct_org"]]);
    expect(await status()).toBe("cancelled");
  });

  it("gives the money back when the event was cancelled, and confirms no seat", async () => {
    const { run, refunds, status } = await setup("cancelled", "pending");
    await run("evt_2");
    expect(refunds).toEqual([["pi_1", "acct_org"]]);
    expect(await status()).toBe("cancelled");
  });

  it("confirms the seat as before when all is well", async () => {
    const { run, refunds, status } = await setup("scheduled", "pending");
    await run("evt_3");
    expect(refunds).toEqual([]);
    expect(await status()).toBe("confirmed");
  });
});
