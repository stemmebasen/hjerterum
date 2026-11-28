import { describe, expect, it } from "vitest";
import { englishNames } from "./translate-in-place";

// Douglas (8-9 Nov 2026): the names were kept out of what Google translates, so it translated the sentences in pieces ("CIRKLERSmall").
// Google now gets whole sentences; where it translates a name, the name is put back.
describe("the house's names in English", () => {
  it("puts Hjerterum and CIRKLER back where Google translated them", () => {
    expect(englishNames("Welcome to Heart Room")).toBe("Welcome to Hjerterum");
    expect(englishNames("Fixed price, no member discount for participating")).toBe("Fixed price, no member discount to participate");
    expect(englishNames("Join CIRCLES. Small, regular groups.")).toBe("Join CIRKLER. Small, regular groups.");
    expect(englishNames("the Heart Space calendar")).toBe("Hjerterum calendar");
    expect(englishNames("Small circles of friends")).toBe("Small circles of friends");
  });
  // Douglas (forslag #8, 27 Nov 2026): "Please leave out the word 'them' where it says 'keep them'".
  it("says keep, not keep them, when some of the places are cancelled", () => {
    expect(englishNames("Only some of the places - keep them")).toBe("Only some of the places - keep");
    expect(englishNames("Only some of the seats – Behold")).toBe("Only some of the seats – keep");
    expect(englishNames("Keep them warm")).toBe("Keep them warm");
  });
  // Douglas (forslag #9 and #10, 28 Nov 2026).
  it("says past events, never previous, and says registered once", () => {
    expect(englishNames("View previous events")).toBe("View past events");
    expect(englishNames("Show more earlier events")).toBe("Show more past events");
    expect(englishNames("Previous events could not be fetched")).toBe("Past events could not be fetched");
    expect(englishNames("← Previous")).toBe("← Previous");
    expect(englishNames("You are registered · You are registered")).toBe("You are registered");
    expect(englishNames("Free · 3 / 10 participants")).toBe("Free · 3 / 10 participants");
  });
});
