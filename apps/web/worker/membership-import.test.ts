import { describe, expect, it } from "vitest";
import { normalizeMembershipStatus, normalizeMembershipWorksRow } from "./membership-import.js";

describe("MembershipWorks import normalization", () => {
  it("normalizes common export headers and email casing", () => {
    expect(normalizeMembershipWorksRow({
      "Member ID": "mw-42",
      "First Name": "Anna",
      "Last Name": "Ananda",
      "Email Address": "ANNA@example.dk ",
      "Membership Level": "Hjerterum",
      "Membership Status": "Current"
    })).toMatchObject({
      externalId: "mw-42",
      email: "anna@example.dk",
      fullName: "Anna Ananda",
      membershipLevel: "Hjerterum",
      status: "active"
    });
  });

  it("stores only canonical membership fields from source rows", () => {
    const member = normalizeMembershipWorksRow({
      Email: "member@example.dk",
      Name: "Medlem",
      Status: "Active",
      "Private note": "must-not-be-copied"
    });
    expect(member.rawJson).not.toContain("must-not-be-copied");
    expect(JSON.parse(member.rawJson)).toMatchObject({
      email: "member@example.dk",
      fullName: "Medlem",
      status: "active"
    });
  });

  it("rejects records without a usable email", () => {
    expect(() => normalizeMembershipWorksRow({ Name: "Uden mail" })).toThrow("missing_or_invalid_email");
  });

  it("does not treat unknown states as active", () => {
    expect(normalizeMembershipStatus("Awaiting review")).toBe("awaiting review");
  });
});
