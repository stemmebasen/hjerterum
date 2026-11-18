import { describe, expect, it } from "vitest";
import { arrearsFor, pastDueRule, savePastDueRule } from "./past-due.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (13-17 Nov 2026), for the board: "a way of calculating the past dues when a membership payment has not gone through for a while and then
// gets started again" - as MembershipWorks' "Include past due period up to a maximum amount then restart membership" (max 666).
describe("the past-due rule", () => {
  const DAY = 86_400_000, NOW = Date.parse("2026-11-18T12:00:00Z");
  async function member(db: ReturnType<typeof testDatabase>, status: string, paidDaysAgo: number | null, failedDaysAgo: number | null, interval = "month") {
    await db.prepare(`INSERT INTO members (id, clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
      VALUES (1, 'u1', 'cus_1', 'standard', ?, ?, 'Eva', 'eva@x.dk', 1, 1)`).bind(interval, status).run();
    if (paidDaysAgo !== null) await db.prepare("INSERT INTO member_timeline (member_id, at_ms, kind, title) VALUES (1, ?, 'payment', 'Betaling')").bind(NOW - paidDaysAgo * DAY).run();
    if (failedDaysAgo !== null) await db.prepare("INSERT INTO member_timeline (member_id, at_ms, kind, title) VALUES (1, ?, 'payment_failed', 'Betaling mislykkedes')").bind(NOW - failedDaysAgo * DAY).run();
    return { id: 1, status, tier: "standard", interval };
  }

  it("counts the months the last payment did not cover, up to the maximum (666 kr. unless changed)", async () => {
    const db = testDatabase();
    expect(await pastDueRule(db)).toEqual({ mode: "include", maxMinor: 66_600 });
    const m = await member(db, "canceled", 100, 70); // paid 100 days ago: 3 periods since, 2 not covered
    expect(await arrearsFor(db, m, NOW)).toBe(2 * 22_200);
    await savePastDueRule(db, { mode: "include", maxMinor: 30_000 }, "Douglas", NOW);
    expect(await arrearsFor(db, m, NOW)).toBe(30_000);
    await savePastDueRule(db, { mode: "restart", maxMinor: 30_000 }, "Douglas", NOW);
    expect(await arrearsFor(db, m, NOW)).toBe(0);
  });

  it("asks nothing of one who did not fall behind", async () => {
    const db = testDatabase();
    expect(await arrearsFor(db, await member(db, "canceled", 100, null), NOW)).toBe(0);
    const db2 = testDatabase();
    expect(await arrearsFor(db2, await member(db2, "active", 100, 70), NOW)).toBe(0);
  });
});
