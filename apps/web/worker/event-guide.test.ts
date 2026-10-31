import { describe, expect, it } from "vitest";
import { bookingTypeOf, draftFrom, guidedPrompt, mergeFacts, nextStep, NO_FACTS, parseGuided, readFacts, replyFromBrokenJson } from "./event-guide.js";

// Reported: "Hun har allerede foreslået en titel, som jeg har sagt ja til, og så kommer hun alligevel med et nyt forslag senere" and
// "Det er alt for uorganiseret, og hun vender tilbage til spørgsmål, hun har stillet tidligere".

describe("the guided creation's order and memory", () => {
  it("asks one step at a time, in a fixed order, and ends with the proposal", () => {
    expect(nextStep(NO_FACTS)).toBe("titel");
    const known = { ...NO_FACTS, title: "Rolig vejrtrækning", content: "Breathwork for begyndere" };
    expect(nextStep(known)).toBe("tid");
    expect(nextStep({ ...known, date: "2026-11-08", start: "14:00", end: "16:00", member_price_kr: 0, social: true, photo: "skipped" })).toBe("forslag");
  });

  it("locks what is known: a title said yes to is never replaced by a later answer", () => {
    const known = { ...NO_FACTS, title: "Rolig vejrtrækning en søndag eftermiddag" };
    const after = mergeFacts(known, { title: "Et åndedrag ad gangen", content: "For begyndere", leader: "Jacob" }, "indhold");
    expect(after.title).toBe("Rolig vejrtrækning en søndag eftermiddag");
    expect(after.content).toBe("For begyndere");
    expect(after.leader).toBe("Jacob");
    // The step being asked about may change its own answer, and what was not known yet may come from anywhere.
    expect(mergeFacts(known, { title: "Ny titel" }, "titel").title).toBe("Ny titel");
    expect(mergeFacts(known, { date: "2026-11-08" }, "indhold").date).toBe("2026-11-08");
  });

  it("approves a photo only from the code, never from the model's word", () => {
    expect(mergeFacts(NO_FACTS, { photo: "ok" }, "billeder").photo).toBeNull();
    expect(mergeFacts(NO_FACTS, { photo: "skipped" }, "billeder").photo).toBe("skipped");
  });

  it("tells Saga what is known and the one thing to ask about", () => {
    const prompt = guidedPrompt({ ...NO_FACTS, title: "Rolig vejrtrækning" }, "indhold");
    expect(prompt).toContain('"title":"Rolig vejrtrækning"');
    expect(prompt).toContain("SPØRG NU KUN OM: INDHOLDET");
    expect(prompt).toContain("spørg ALDRIG om dem igen");
    expect(guidedPrompt(NO_FACTS, "forslag")).toBe("");
  });
});

describe("reading what Saga and the page send", () => {
  it("keeps only well-formed facts", () => {
    expect(readFacts({ title: "  Yin  yoga ", date: "8. nov", start: "25:00", end: "16:00", member_price_kr: -5, non_member_price_kr: 120, max_attendees: 0, social: "ja", photo: "ok" }))
      .toEqual({ title: "Yin yoga", end: "16:00", non_member_price_kr: 120, photo: "ok" });
  });

  it("reads her reply out of an answer cut off at its length limit, and never shows raw JSON", () => {
    const cut = '{"reply":"Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.","draft":null,"photo_ok":false,"progress":{"brief":true,"bill';
    expect(replyFromBrokenJson(cut)).toBe("Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.");
    expect(parseGuided(cut).reply).toBe("Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.");
    expect(parseGuided('{"facts":{"ti').reply).not.toContain("{");
    const whole = parseGuided('{"reply":"Hvornår?","facts":{"content":"Breathwork","description":"x"},"suggestions":["Søndag 8/11 kl. 14-16","",3,"Lørdag 14/11 kl. 10-12"]}');
    expect(whole).toEqual({ reply: "Hvornår?", learned: { content: "Breathwork" }, suggestions: ["Søndag 8/11 kl. 14-16", "Lørdag 14/11 kl. 10-12"] });
  });
});

describe("the proposal", () => {
  it("is put together from the facts, with the rent type from the prices", () => {
    expect(bookingTypeOf({ member_price_kr: 0, non_member_price_kr: 100 })).toBe("free");
    expect(bookingTypeOf({ member_price_kr: 80, non_member_price_kr: 120 })).toBe("reduced");
    expect(bookingTypeOf({ member_price_kr: 100, non_member_price_kr: null })).toBe("standard");
    const f = { ...NO_FACTS, title: "Rolig vejrtrækning", date: "2026-11-08", start: "14:00", end: "16:00", member_price_kr: 0, non_member_price_kr: 100, max_attendees: 20, description: "En rolig eftermiddag." };
    expect(draftFrom(f)).toEqual({ title: "Rolig vejrtrækning", description: "En rolig eftermiddag.", date: "2026-11-08", start: "14:00", end: "16:00", booking_type: "free", max_attendees: 20, member_price_kr: 0, non_member_price_kr: 100 });
    expect(draftFrom({ ...f, description: null })).toBeNull();
  });
});
