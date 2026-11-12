import { describe, expect, it } from "vitest";
import { isMemberAttendee } from "./membership-access.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (12 Nov 2026): "Is it possible for a teacher to be able to see the email addresses of the people who have signed up for their workshop
// and whether they are members or non-members."
describe("whether a sign-up is a member's", () => {
  async function member(db: ReturnType<typeof testDatabase>, n: number, email: string, tier = "standard", status = "active") {
    await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, 'month', ?, 'X', ?, 1, 1)`).bind(`user_${n}`, `cus_${n}`, tier, status, email).run();
  }

  it("knows a member by their login or, signed up as a guest, by their e-mail; a support membership or an ended one is not a member's", async () => {
    const db = testDatabase();
    await member(db, 1, "anna@x.dk");
    await member(db, 2, "bo@x.dk", "support");
    await member(db, 3, "eva@x.dk", "standard", "canceled");
    expect(await isMemberAttendee(db, "user_1", "anna@x.dk")).toBe(true);
    expect(await isMemberAttendee(db, "guest:anna@x.dk", "Anna@X.dk ")).toBe(true);
    expect(await isMemberAttendee(db, "user_2", "bo@x.dk")).toBe(false);
    expect(await isMemberAttendee(db, "user_3", "eva@x.dk")).toBe(false);
    expect(await isMemberAttendee(db, "guest:ole@x.dk", "ole@x.dk")).toBe(false);
  });
});
