import { describe, expect, it } from "vitest";
import { currentSiteForSaga } from "./site-knowledge.js";
import { membershipFacts } from "./cockpit/membership.js";

// Asked: "tjek også om der er andre områder hun skal have opdateret sin viden" - the board's Saga reads hjerterum.info, not the old holistisk.org.
describe("what the board's Saga knows of the site", () => {
  it("lists every page of hjerterum.info and gives the ones the question is about in full", () => {
    const text = currentSiteForSaga("Hvad koster det at leje salen? lejepriser");
    expect(text).toContain("https://www.hjerterum.info/brug-hjerterum/lejepriser");
    expect(text).toContain("C) Gratis leje");
    expect(text).toContain("https://www.hjerterum.info/om-os/foreningen [kun titel]");
    expect(text).not.toContain("holistisk.org/lejepriser");
  });

  it("takes membership from the site as it is now, not from a snapshot", () => {
    const facts = membershipFacts();
    expect(facts).toContain("Kilde: hjemmesiden https://www.hjerterum.info");
    expect(facts).toContain("Bindingsperioden er løbende måned + 1 måned");
    expect(facts).toContain("ikke Support");
    expect(facts).not.toContain("læst 2. oktober 2026");
  });
});
