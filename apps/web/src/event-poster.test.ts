import { describe, expect, it } from "vitest";
import { VARIANTS, chooseVariant, kickerOf, photoFits, splitTitle, teacherOf, wholeIn, whenOf } from "./event-poster";

// An event's poster for social media in five designs; the system picks one.

describe("the poster's words", () => {
  it("splits a title at the bar, and finds the teacher", () => {
    expect(splitTitle("Mediterende Yoga  |  Onsdage 16-17.20")).toEqual({ title: "Mediterende Yoga", rest: "Onsdage 16-17.20", teacher: null });
    expect(splitTitle("Dhyana Yoga")).toEqual({ title: "Dhyana Yoga", rest: null, teacher: null });
    expect(splitTitle("Source Breathwork (Rebirthing) with Douglas Crawford")).toEqual({ title: "Source Breathwork", rest: "Rebirthing", teacher: "Douglas Crawford" });
    // The calendar ran a title in capitals and its subtitle together.
    expect(splitTitle("LÆR AT LYTTE TIL DIN INTUITIONKursus i Sjælstegning")).toEqual({ title: "Lær at lytte til din intuition", rest: "Kursus i Sjælstegning", teacher: null });
    expect(splitTitle("KIRTAN med Mia")).toEqual({ title: "KIRTAN", rest: null, teacher: "Mia" });
    expect(teacherOf("None", ["Underviser: Søren Malmstrøm", "18-måneders uddannelse"])).toBe("Søren Malmstrøm");
    expect(teacherOf(null, ["FACILITATOR : Douglas Crawford"])).toBe("Douglas Crawford");
    expect(teacherOf(null, ["Underviser:", "Meditating Yoga | Mediterende Yoga"])).toBeNull();
    expect(teacherOf("Lisa Lawrie", [])).toBe("Lisa Lawrie");
  });

  it("says the day and time in Danish, in Copenhagen's time", () => {
    expect(whenOf({ startsAt: "2026-11-04T18:00:00.000Z", endsAt: "2026-11-04T20:15:00.000Z" })).toEqual({ day: "Onsdag 4. november", time: "19.00–21.15", number: "4", month: "november" });
  });

  it("puts the category over the title, or the kind of evening", () => {
    expect(kickerOf({ title: "Dhyana Yoga", category: "Yoga & Meditation" })).toBe("Yoga & Meditation");
    expect(kickerOf({ title: "Source Breathwork (Rebirthing)", category: null })).toBe("Breathwork");
    expect(kickerOf({ title: "Noget helt andet", category: null })).toBe("I Hjerterum");
    expect(kickerOf({ title: "Source Breathwork", category: "Events & Workshops" })).toBe("Breathwork");
  });
});

describe("the system's choice of design, and the photo's size", () => {
  const event = (title: string, imageUrl: string | null = "/api/event-files/1", id = "6abba949e1a89220c3050d27") => ({ id, title, category: null, imageUrl });
  const big = { width: 1920, height: 2400 }, cover = { width: 1920, height: 1005 }, small = { width: 240, height: 150 };
  it("draws an event without a photo, or with a photo too small for every design, in type only", () => {
    // Type only: Typografi or Plakat, by the event.
    expect(["typografi", "plakat"]).toContain(chooseVariant(event("Dhyana Yoga", null), big));
    expect(["typografi", "plakat"]).toContain(chooseVariant(event("Dhyana Yoga"), small));
    expect(photoFits("plakat", "cover", null)).toEqual({ ok: true });
    // Every design has a photo box or none in every format, and the cover is Facebook's size.
    for (const v of VARIANTS) for (const f of ["opslag", "story", "cover"] as const) expect(() => photoFits(v.key, f, big)).not.toThrow();
  });
  it("refuses a design the photo is too small for, and says why", () => {
    expect(photoFits("foto", "opslag", big)).toEqual({ ok: true });
    // A wide cover is put in whole on the tall page - big enough for that; a smaller one is not.
    expect(photoFits("foto", "opslag", cover)).toEqual({ ok: true });
    const refused = photoFits("foto", "opslag", { width: 700, height: 366 });
    expect(refused.ok).toBe(false);
    expect((refused as { reason: string }).reason).toContain("700 × 366 px");
    expect(photoFits("rolig", "opslag", cover)).toEqual({ ok: true });
    expect(photoFits("typografi", "opslag", null)).toEqual({ ok: true });
    expect(photoFits("eget", "opslag", small).ok).toBe(false);
    expect(photoFits("eget", "opslag", { width: 800, height: 1000 }).ok).toBe(true);
  });
  it("lets the chair's own crop into a design a little softer, and puts a shaped crop in whole", () => {
    // A square cut from a Facebook event cover (1200 × 628): too small as a plain photo, fine (a little soft) as the chair's square crop.
    const square = { width: 628, height: 628 };
    expect(photoFits("foto", "opslag", square).ok).toBe(false);
    expect(photoFits("foto", "opslag", { ...square, cropped: true, shaped: true })).toEqual({ ok: true, soft: true });
    // A crop far too small is still refused, and says what to do.
    const tiny = photoFits("foto", "opslag", { width: 300, height: 300, cropped: true, shaped: true });
    expect(tiny.ok).toBe(false);
    expect((tiny as { reason: string }).reason).toContain("Zoom lidt mindre ind");
    // A big crop is simply fine.
    expect(photoFits("foto", "opslag", { width: 1600, height: 1600, cropped: true, shaped: true })).toEqual({ ok: true });
  });
  it("gives a concert the full photo only when it is big enough and fills it", () => {
    expect(chooseVariant(event("Kirtan koncert"), big)).toBe("foto");
    expect(chooseVariant(event("Kirtan koncert"), cover)).not.toBe("foto");
  });
  it("gives talks the calm design and the café the organic one, and spreads the rest by the event", () => {
    expect(chooseVariant(event("Foredrag om søvn"), big)).toBe("rolig");
    expect(chooseVariant(event("Hjerterum Medlemscafé"), big)).toBe("organisk");
    const picks = new Set(["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"].map(id => chooseVariant(event("Dhyana Yoga", "/x", id), big)));
    expect(picks.size).toBeGreaterThan(1);
    expect(chooseVariant(event("Dhyana Yoga", "/x", "same"), big)).toBe(chooseVariant(event("Dhyana Yoga", "/x", "same"), big));
  });
});

describe("a picture with words on it is never cut", () => {
  it("is put in whole where filling its place would cut more than a tenth of it", () => {
    // Sjælstegning's picture (1024 × 536, words to the edges) in a 4:3 place: whole.
    expect(wholeIn(1080, 810, 1024, 536)).toBe(true);
    expect(wholeIn(1080, 1080, 1024, 536)).toBe(true);
    // About the place's shape: it fills.
    expect(wholeIn(1080, 566, 1024, 536)).toBe(false);
    expect(wholeIn(1000, 1000, 960, 1000)).toBe(false);
    // The chair's own crop as before: whole as soon as the shapes differ.
    expect(wholeIn(1080, 1000, 1000, 1000, true)).toBe(false);
    expect(wholeIn(1080, 810, 1000, 1000, true)).toBe(true);
  });
});
