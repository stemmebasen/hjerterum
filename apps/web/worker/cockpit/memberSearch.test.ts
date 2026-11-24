import { describe, expect, it } from "vitest";
import { applyFilter, type CockpitMember } from "./membershipCockpit.js";

// Douglas (19 Nov 2026): "I added a new label for myself for testing purposes, and I used the label, 'Judge'. I am not able to search for that label".
describe("searching the members", () => {
  it("finds a member by a label the board gave", () => {
    const m = (name: string, labels: string[]) => ({ name, email: `${name.toLowerCase()}@x.dk`, phone: null, labels, status: "aktiv", tier: "standard", billing: "kort", teacher: false } as unknown as CockpitMember);
    const list = [m("Douglas", ["Judge"]), m("Anna", ["Frivillig"])];
    const f = { q: "judge", status: "", tier: "", billing: "", teacher: false, sort: "navn" as const };
    expect(applyFilter(list, f).map(x => x.name)).toEqual(["Douglas"]);
  });
});
