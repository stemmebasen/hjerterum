import { describe, expect, it } from "vitest";
import { chooseVariant, kickerOf, photoFits, splitTitle, teacherOf, whenOf } from "./event-poster";

// An event's poster for social media in five designs; the system picks one.

describe("the poster's words", () => {
  it("splits a title at the bar, and finds the teacher", () => {
    expect(splitTitle("Mediterende Yoga  |  Onsdage 16-17.20")).toEqual({ title: "Mediterende Yoga", rest: "Onsdage 16-17.20", teacher: null });
    expect(splitTitle("Dhyana Yoga")).toEqual({ title: "Dhyana Yoga", rest: null, teacher: null });
    expect(splitTitle("Source Breathwork (Rebirthing) with Douglas Crawford")).toEqual({ title: "Source Breathwork", rest: "Rebirthing", teacher: "Douglas Crawford" });
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
  const big = { width: 1920, height: 2400 }, cover = { width: 1920, height: 1005 }, small = { width: 480, height: 300 };
  it("draws an event without a photo, or with a photo too small for every design, in type only", () => {
    expect(chooseVariant(event("Dhyana Yoga", null), big)).toBe("typografi");
    expect(chooseVariant(event("Dhyana Yoga"), small)).toBe("typografi");
  });
  it("refuses a design the photo is too small for, and says why", () => {
    expect(photoFits("foto", "opslag", big)).toEqual({ ok: true });
    const refused = photoFits("foto", "opslag", cover);
    expect(refused.ok).toBe(false);
    expect((refused as { reason: string }).reason).toContain("1920 × 1005 px");
    expect(photoFits("rolig", "opslag", cover)).toEqual({ ok: true });
    expect(photoFits("typografi", "opslag", null)).toEqual({ ok: true });
    expect(photoFits("eget", "opslag", small).ok).toBe(false);
    expect(photoFits("eget", "opslag", { width: 800, height: 1000 }).ok).toBe(true);
  });
  it("gives a concert the full photo only when it is big enough", () => {
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
