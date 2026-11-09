import { describe, expect, it } from "vitest";
import { englishNames } from "./translate-in-place";

// Douglas (8-9 Nov 2026): the names were kept out of what Google translates, so it translated the sentences in pieces ("CIRKLERSmall").
// Google now gets whole sentences; where it translates a name, the name is put back.
describe("the house's names in English", () => {
  it("puts Hjerterum and CIRKLER back where Google translated them", () => {
    expect(englishNames("Welcome to Heart Room")).toBe("Welcome to Hjerterum");
    expect(englishNames("Join CIRCLES. Small, regular groups.")).toBe("Join CIRKLER. Small, regular groups.");
    expect(englishNames("the Heart Space calendar")).toBe("Hjerterum calendar");
    expect(englishNames("Small circles of friends")).toBe("Small circles of friends");
  });
});
