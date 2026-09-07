import { describe, expect, it } from "vitest";
import {
  calculateAdminFeeMinor,
  canCreateEvent,
  eventRefundsEnabled,
  requiresEventApproval
} from "./event-policy.js";

describe("event policies", () => {
  it("allows event creation only for paying members", () => {
    expect(canCreateEvent(true)).toBe(true);
    expect(canCreateEvent(false)).toBe(false);
  });

  it("skips approval for fixed teachers only", () => {
    expect(requiresEventApproval(true)).toBe(false);
    expect(requiresEventApproval(false)).toBe(true);
  });

  it("calculates the five percent admin fee in minor units", () => {
    expect(calculateAdminFeeMinor(10_000)).toBe(500);
    expect(calculateAdminFeeMinor(1_999)).toBe(100);
  });

  it("rejects invalid monetary inputs", () => {
    expect(() => calculateAdminFeeMinor(-1)).toThrow();
    expect(() => calculateAdminFeeMinor(10.5)).toThrow();
  });

  it("keeps event refunds disabled", () => {
    expect(eventRefundsEnabled).toBe(false);
  });
});
