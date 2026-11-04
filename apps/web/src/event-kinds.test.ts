import { describe, expect, it } from "vitest";
import { isKind, kindOf } from "./event-kinds";

describe("the front page's kinds of events", () => {
  it("finds the kind in the title or the category", () => {
    expect(isKind({ title: "Songs to Soften the Heart - Koncert med Victoria Akua" }, "koncerter")).toBe(true);
    // Douglas (3 Nov): "how about a fællesspisning button in this list?" - its own kind now, not Café.
    expect(isKind({ title: "Fællesspisning med ÅBEN SCENE" }, "spisning")).toBe(true);
    expect(isKind({ title: "Fællesspisning med ÅBEN SCENE" }, "cafe")).toBe(false);
    expect(isKind({ title: "Yoga om eftermiddagen" }, "spisning")).toBe(false);
    expect(isKind({ title: "Hjerterum Medlemscafé ☕️" }, "cafe")).toBe(true);
    expect(isKind({ title: "Movie-night in Hjerterum" }, "film")).toBe(true);
    expect(isKind({ title: "Living without a Mobile - Talk and question evening" }, "foredrag")).toBe(true);
    expect(isKind({ title: "Morning Sound Journey", category: "Lyd, Sang & Musik" }, "koncerter")).toBe(true);
    expect(isKind({ title: "Dhyana Yoga", category: "Yoga & Meditation" }, "koncerter")).toBe(false);
    expect(kindOf("ukendt")).toBeNull();
  });
});
