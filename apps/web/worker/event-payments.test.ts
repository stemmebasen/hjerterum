import { describe, expect, it } from "vitest";
import { calculateEventFees } from "./event-payments.js";

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
