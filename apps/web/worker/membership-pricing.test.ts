import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMembershipCheckout, parseCheckoutInput } from "./members.js";
import { stripeRequest } from "./stripe.js";
import type { D1Database, D1PreparedStatement } from "./db.js";
import { includesMemberBenefits, membershipName } from "../membership.js";

vi.mock("./stripe.js", () => ({ stripeRequest: vi.fn() }));

class EmptyStatement implements D1PreparedStatement {
  bind(..._values: unknown[]): D1PreparedStatement { return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return null; }
  async all<T = Record<string, unknown>>() { return { results: [] as T[] }; }
  async run<T = unknown>() { return { success: true, results: [] as T[] }; }
}
const db: D1Database = { prepare: () => new EmptyStatement() };

describe("published Hjerterum membership prices", () => {
  beforeEach(() => {
    vi.mocked(stripeRequest).mockReset();
    vi.mocked(stripeRequest).mockResolvedValue({ url: "https://checkout.stripe.com/test" });
  });

  it.each([
    ["standard", "month", 22200], ["standard", "year", 231000],
    ["generoest", "month", 33300], ["generoest", "year", 346500],
    ["reduceret", "month", 11100], ["reduceret", "year", 115500],
    ["support", "month", 5000], ["support", "year", 54000]
  ])("charges the published price for %s / %s", async (tier, interval, amount) => {
    const input = parseCheckoutInput({ tier, interval, email: "test@example.invalid", fullName: "Test" });
    await createMembershipCheckout(db, "test-secret", "https://staging.example.invalid", "user_test", input);
    expect(stripeRequest).toHaveBeenCalledWith("test-secret", "POST", "/checkout/sessions",
      expect.objectContaining({ "line_items[0][price_data][unit_amount]": amount }));
  });

  it("rejects invalid and inherited plan names", () => {
    for (const tier of ["invalid", "constructor", "__proto__"]) {
      expect(() => parseCheckoutInput({ tier, interval: "month", email: "test@example.invalid", fullName: "Test" })).toThrow("invalid_tier");
    }
  });

  it("recognizes the imported Support label without changing other imported memberships", () => {
    expect(includesMemberBenefits("Support medlemskab")).toBe(false);
    expect(includesMemberBenefits("Standard medlemskab")).toBe(true);
    expect(membershipName("generoest")).toBe("Generøst medlemskab");
  });
});
