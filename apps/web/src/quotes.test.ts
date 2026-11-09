import { describe, expect, it } from "vitest";
import { quoteChoices, wholeSentences } from "./quotes";

describe("the quotes offered", () => {
  it("are whole sentences, also where a sentence runs on to the next line", () => {
    const lines = ["En eftermiddag med englehealing, hvor du kan forbinde dig med din skytsengel", "og bede om healing til et tema, der fylder.",
      "", "Sarah Bjørk leder healingen, der varer ca. 45 minutter, tirsdag d. 10. november kl. 16.45.", "Pris: 150 kr.", "Læs mere på hjerterum.info"];
    expect(wholeSentences(lines)).toEqual([
      "En eftermiddag med englehealing, hvor du kan forbinde dig med din skytsengel og bede om healing til et tema, der fylder.",
      "Sarah Bjørk leder healingen, der varer ca. 45 minutter, tirsdag d. 10. november kl. 16.45."]);
  });
  it("never offers half a sentence", () => {
    for (const q of wholeSentences(["Du vil få mulighed for at møde og forbinde dig med", "din skytsengel samt at bede om healing.", "samt noget mere uden punktum"]))
      expect(q).toMatch(/^[A-ZÆØÅ].*[.!?…]$/);
  });
  it("puts the teacher's own words first, each quote once", () => {
    expect(quoteChoices(["Jeg holder et rum for ro og nærvær.", null], ["Jeg holder et rum for ro og nærvær.", "Kom og mærk roen i kroppen sammen med andre."]))
      .toEqual(["Jeg holder et rum for ro og nærvær.", "Kom og mærk roen i kroppen sammen med andre."]);
  });
});
