import { describe, expect, it } from "vitest";
import { contactOf, isContactShare } from "./event-contact.js";

describe("event contact", () => {
  const row = { teacher_email: "booking@example.dk", member_email: "jacob@example.dk", phone: " 12 34 56 78 " };
  it("shows only what the organiser chose", () => {
    expect(contactOf({ ...row, contact_share: null })).toEqual({ share: null, email: null, phone: null });
    expect(contactOf({ ...row, contact_share: "email" })).toEqual({ share: "email", email: "jacob@example.dk", phone: null });
    expect(contactOf({ ...row, contact_share: "phone" })).toEqual({ share: "phone", email: null, phone: "12 34 56 78" });
    expect(contactOf({ ...row, contact_share: "both" })).toEqual({ share: "both", email: "jacob@example.dk", phone: "12 34 56 78" });
  });
  it("falls back to the booking e-mail and ignores unknown values", () => {
    expect(contactOf({ contact_share: "email", teacher_email: "booking@example.dk", member_email: null, phone: null }).email).toBe("booking@example.dk");
    expect(contactOf({ ...row, contact_share: "fax" }).share).toBeNull();
    expect(isContactShare("both")).toBe(true);
    expect(isContactShare("none")).toBe(false);
  });
});
