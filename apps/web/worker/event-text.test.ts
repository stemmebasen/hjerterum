import { describe, expect, it } from "vitest";
import { MIN_EVENT_WORDS, textLongEnough, wordCount } from "../site/event-text.js";
import { parseTextReview } from "./event-text.js";
import { readVerdict } from "./cockpit/eventDesk.js";

// Requested: "en flot eventtekst med et minimumsantal på 75 ord".
describe("the event text", () => {
  it("counts words, not dashes or emojis", () => {
    expect(MIN_EVENT_WORDS).toBe(75);
    expect(wordCount("Rolig breathwork - for alle 🌿")).toBe(4);
    expect(textLongEnough(Array(74).fill("ord").join(" "))).toBe(false);
    expect(textLongEnough(Array(75).fill("ord").join(" "))).toBe(true);
  });
  it("reads Saga's review and her verdict needs the language criterion", () => {
    expect(parseTextReview('{"notes":["Skriv hvem det er for."],"improved":"En tekst."}')).toEqual({ notes: ["Skriv hvem det er for."], improved: "En tekst." });
    expect(parseTextReview("ingen json")).toBeNull();
    const all = '{"criteria":{"formaal":true,"vaerdier":true,"aabent":true,"redeligt":true,"sprog":true,"tekst":true},"verdict":"approve","note":""}';
    expect(readVerdict(all).approve).toBe(true);
    expect(readVerdict(all.replace('"sprog":true', '"sprog":false')).approve).toBe(false);
  });
});
