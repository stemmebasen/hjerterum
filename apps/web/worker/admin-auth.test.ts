import { describe, expect, it } from "vitest";
import { verifiedPrimaryEmail } from "./admin-auth.js";

describe("verifiedPrimaryEmail", () => {
  it("returns the verified primary address normalized", () => {
    expect(verifiedPrimaryEmail({
      primary_email_address_id: "email_2",
      email_addresses: [
        { id: "email_1", email_address: "other@example.com", verification: { status: "verified" } },
        { id: "email_2", email_address: " Member@Example.com ", verification: { status: "verified" } }
      ]
    })).toBe("member@example.com");
  });

  it("rejects an unverified primary address even if another address is verified", () => {
    expect(() => verifiedPrimaryEmail({
      primary_email_address_id: "email_1",
      email_addresses: [
        { id: "email_1", email_address: "member@example.com", verification: { status: "unverified" } },
        { id: "email_2", email_address: "other@example.com", verification: { status: "verified" } }
      ]
    })).toThrow("identity_email_unverified");
  });

  it("uses a verified address when Clerk has no primary id", () => {
    expect(verifiedPrimaryEmail({
      email_addresses: [
        { id: "email_1", email_address: "member@example.com", verification: { status: "verified" } }
      ]
    })).toBe("member@example.com");
  });
});
