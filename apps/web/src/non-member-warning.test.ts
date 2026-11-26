import { describe, expect, it } from "vitest";
import { nonMemberWarning } from "./event-planner-logic";

// Douglas (forslag #4, decision 0013): warn about a non-member price under the minimum, with the amount - do not block saving.
describe("the warning under the non-member price", () => {
  const plan = (type: "standard" | "reduced" | "free", date: string, start: string) => ({ date, start, end: "23:00", type, setup: 30, cleanup: 30 });
  it("names the minimum when the price is under it, and is quiet otherwise", () => {
    expect(nonMemberWarning(plan("free", "2027-11-20", "10:00"), "0", "75")).toContain("mindst 100 kr.");
    expect(nonMemberWarning(plan("free", "2027-11-20", "10:00"), "0", "75")).toContain("bliver eventet nok ikke godkendt");
    expect(nonMemberWarning(plan("free", "2027-11-20", "10:00"), "0", "100")).toBeNull();
    expect(nonMemberWarning(plan("free", "2027-11-17", "10:00"), "0", "")).toContain("mindst 75 kr.");
    expect(nonMemberWarning(plan("reduced", "2027-11-17", "10:00"), "100", "150")).toContain("mindst 175 kr.");
    expect(nonMemberWarning(plan("reduced", "2027-11-17", "19:00"), "100", "200")).toBeNull();
    expect(nonMemberWarning(plan("standard", "2027-11-17", "10:00"), "100", "0")).toBeNull();
    expect(nonMemberWarning(plan("free", "", "10:00"), "0", "0")).toBeNull();
  });
});
