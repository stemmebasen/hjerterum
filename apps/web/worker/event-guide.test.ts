import { describe, expect, it } from "vitest";
import { bookingTypeOf, draftFrom, guidedPrompt, isBrief, mergeFacts, nextStep, NO_FACTS, parseGuided, QUESTION, readFacts, replyFromBrokenJson } from "./event-guide.js";

// Reported: "Hun har allerede foreslået en titel, som jeg har sagt ja til, og så kommer hun alligevel med et nyt forslag senere" and
// "Det er alt for uorganiseret, og hun vender tilbage til spørgsmål, hun har stillet tidligere".

describe("the guided creation's order and memory", () => {
  it("asks one thing at a time, in a fixed order, and ends with the proposal", () => {
    expect(nextStep(NO_FACTS)).toBe("titel");
    const known = { ...NO_FACTS, title: "Rolig vejrtrækning", content: "Breathwork for begyndere" };
    expect(nextStep(known)).toBe("leder");
    expect(nextStep({ ...known, leader: "Jacob Hauge", contact: "email", bring: "Intet", date: "2026-11-08", start: "14:00", end: "16:00", member_price_kr: 0 })).toBe("pladser");
    expect(nextStep({ ...known, leader: "Jacob Hauge", contact: "email", bring: "Intet", date: "2026-11-08", start: "14:00", end: "16:00", member_price_kr: 0, max_attendees: 0, social: true, photo: "skipped" })).toBe("forslag");
    // Every question is one question.
    for (const q of Object.values(QUESTION)) expect(q.split("?").length - 1).toBeLessThanOrEqual(1);
  });

  it("lets only the brief fill in any step - after it, only the step being asked about, so she cannot invent a date", () => {
    expect(isBrief(NO_FACTS)).toBe(true);
    const fromBrief = mergeFacts(NO_FACTS, { title: "Breathwork", date: "2026-11-08", start: "14:00", end: "16:00" }, "titel", true);
    expect(fromBrief).toMatchObject({ title: "Breathwork", date: "2026-11-08" });
    const known = { ...NO_FACTS, title: "Rolig vejrtrækning en søndag eftermiddag" };
    const after = mergeFacts(known, { title: "Et åndedrag ad gangen", content: "For begyndere", date: "2026-12-20", start: "14:00", end: "15:00" }, "indhold");
    expect(after.title).toBe("Rolig vejrtrækning en søndag eftermiddag");
    expect(after.content).toBe("For begyndere");
    expect(after.date).toBeNull();
    expect(mergeFacts(known, { title: "Ny titel" }, "titel").title).toBe("Ny titel");
  });

  it("approves a photo only from the code, never from the model's word", () => {
    expect(mergeFacts(NO_FACTS, { photo: "ok" }, "billeder").photo).toBeNull();
    expect(mergeFacts(NO_FACTS, { photo: "skipped" }, "billeder").photo).toBe("skipped");
  });

  it("tells Saga what is known, not to ask, and the member's own name as the first leader", () => {
    const prompt = guidedPrompt({ ...NO_FACTS, title: "Rolig vejrtrækning" }, "indhold", "Jacob Hauge");
    expect(prompt).toContain('"title":"Rolig vejrtrækning"');
    expect(prompt).toContain("STIL INGEN SPØRGSMÅL");
    expect(prompt).toContain('"Jacob Hauge" først');
    expect(guidedPrompt(NO_FACTS, "forslag", "Jacob Hauge")).toBe("");
  });

  it("takes out a question she slipped into her reply - the code asks", () => {
    expect(parseGuided('{"reply":"Fint, så er titlen noteret. Hvornår skal det være?","next":"indhold","suggestions":["a","b","c","d"]}')).toMatchObject({ reply: "Fint, så er titlen noteret.", suggestionsFor: "indhold" });
  });
});

describe("reading what Saga and the page send", () => {
  it("keeps only well-formed facts", () => {
    expect(readFacts({ title: "  Yin  yoga ", date: "8. nov", start: "25:00", end: "16:00", member_price_kr: -5, non_member_price_kr: 120, max_attendees: 0, social: "ja", photo: "ok" }))
      .toEqual({ title: "Yin yoga", end: "16:00", non_member_price_kr: 120, max_attendees: 0, photo: "ok" });
  });

  it("reads her reply out of an answer cut off at its length limit, and never shows raw JSON", () => {
    const cut = '{"reply":"Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.","draft":null,"photo_ok":false,"progress":{"brief":true,"bill';
    expect(replyFromBrokenJson(cut)).toBe("Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.");
    expect(parseGuided(cut).reply).toBe("Tak for billedet, Jacob, men jeg kan ikke godkende det endnu.");
    expect(parseGuided('{"facts":{"ti').reply).not.toContain("{");
    const whole = parseGuided('{"reply":"Hvornår?","facts":{"content":"Breathwork","description":"x"},"suggestions":["Søndag 8/11 kl. 14-16","",3,"Lørdag 14/11 kl. 10-12"]}');
    expect(whole).toEqual({ reply: "Tak.", learned: { content: "Breathwork" }, suggestions: ["Søndag 8/11 kl. 14-16", "Lørdag 14/11 kl. 10-12"], suggestionsFor: null });
  });
});

describe("the proposal", () => {
  it("is put together from the facts, with the rent type from the prices", () => {
    expect(bookingTypeOf({ member_price_kr: 0, non_member_price_kr: 100 })).toBe("free");
    expect(bookingTypeOf({ member_price_kr: 80, non_member_price_kr: 120 })).toBe("reduced");
    expect(bookingTypeOf({ member_price_kr: 100, non_member_price_kr: null })).toBe("standard");
    const f = { ...NO_FACTS, title: "Rolig vejrtrækning", date: "2026-11-08", start: "14:00", end: "16:00", member_price_kr: 0, non_member_price_kr: 100, max_attendees: 20, description: "En rolig eftermiddag." };
    expect(draftFrom(f)).toEqual({ title: "Rolig vejrtrækning", description: "En rolig eftermiddag.", date: "2026-11-08", start: "14:00", end: "16:00", booking_type: "free", max_attendees: 20, member_price_kr: 0, non_member_price_kr: 100, contact_share: null });
    expect(draftFrom({ ...f, description: null })).toBeNull();
    expect(draftFrom({ ...f, max_attendees: 0 })?.max_attendees).toBeNull();
  });
});

describe("fixed answers", () => {
  it("takes Ja tak / Nej tak / Spring over without the model", async () => {
    const { fixedAnswer, choicesFor } = await import("./event-guide");
    expect(fixedAnswer("sociale", "Ja tak")).toEqual({ social: true });
    expect(fixedAnswer("sociale", "Nej tak.")).toEqual({ social: false });
    expect(fixedAnswer("sociale", "Kun Facebook")).toBeNull();
    expect(fixedAnswer("billeder", "Spring over")).toEqual({ photo: "skipped" });
    expect(fixedAnswer("titel", "Ja tak")).toBeNull();
    expect(choicesFor("sociale", { suggestions: ["Kun på Facebook"], suggestionsFor: "sociale" })).toEqual(["Ja tak", "Nej tak"]);
    expect(choicesFor("billeder", { suggestions: [], suggestionsFor: null })).toEqual(["Upload foto nu", "Spring over"]);
    expect(choicesFor("pris", { suggestions: ["Gratis"], suggestionsFor: "tid" })).toEqual([]);
  });
});

describe("contact step", () => {
  it("asks right after the leader and takes the four buttons without the model", async () => {
    const { fixedAnswer, choicesFor, nextStep, draftFrom } = await import("./event-guide");
    expect(nextStep({ ...NO_FACTS, title: "Breathwork", content: "Vejrtrækning", leader: "Jacob Hauge" })).toBe("kontakt");
    expect(fixedAnswer("kontakt", "E-mail")).toEqual({ contact: "email" });
    expect(fixedAnswer("kontakt", "Telefon")).toEqual({ contact: "phone" });
    expect(fixedAnswer("kontakt", "Begge dele")).toEqual({ contact: "both" });
    expect(fixedAnswer("kontakt", "Nej tak")).toEqual({ contact: "none" });
    expect(choicesFor("kontakt", { suggestions: [], suggestionsFor: null })).toEqual(["E-mail", "Telefon", "Begge dele", "Nej tak"]);
    const full = { ...NO_FACTS, title: "T", description: "D", date: "2026-12-20", start: "14:00", end: "16:00", member_price_kr: 0, contact: "none" as const };
    expect(draftFrom(full)?.contact_share).toBeNull();
    expect(draftFrom({ ...full, contact: "both" })?.contact_share).toBe("both");
  });
});
