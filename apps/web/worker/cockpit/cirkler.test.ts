import { describe, expect, it } from "vitest";
import { cirklerKnowledge } from "./cirkler.js";

// Asked: "Ved hun virkelig ikke mere om cirkler? Er det en anden saga end hende vi har i admin?"
describe("CIRKLER on the website and in the member area", () => {
  it("gives Saga the same facts as in admin when the conversation is about CIRKLER, and nothing otherwise", () => {
    expect(cirklerKnowledge([{ text: "Hej" }, { text: "Kan du fortælle mere om cirkler" }])).toContain("395 kr. om måneden");
    expect(cirklerKnowledge([{ text: "What are Tribes?" }])).toContain("CIRKLER");
    expect(cirklerKnowledge([{ text: "Hvad koster et medlemskab?" }])).toBe("");
  });
});
