import { describe, expect, it } from "vitest";
import { sameTaggedPost } from "./social.js";
import type { TaggedPost } from "./meta.js";

// Reported (the chair, 10 Nov 2026): "Jeg bliver ved med at se gamle opslag, som vi er tagget i, som jeg allerede har skjult. De skal ikke vises igen."
const post = (p: Partial<TaggedPost>): TaggedPost => ({ network: "instagram", id: "1", author: null, permalink: null, text: "", createdMs: 0, images: [], media: "none", ...p });

describe("a tagged post already seen", () => {
  it("is the same reel sent in Messenger and later tagged on Instagram", () => {
    const seen = { key: "instagram:ig-DfZahAFRi3Z", link: "https://www.instagram.com/reel/DfZahAFRi3Z/", author: "Mari-Anne Christoffersen", text: "Hej Hjerterum", permalink: "https://www.instagram.com/reel/DfZahAFRi3Z/" };
    expect(sameTaggedPost(post({ id: "18089878229288253", author: "yinyogi.dk", permalink: "https://www.instagram.com/reel/DfZahAFRi3Z/?igsh=abc" }), seen)).toBe(true);
  });
  it("is the same Facebook post under another id, or the same words by the same maker", () => {
    expect(sameTaggedPost(post({ network: "facebook", id: "1632439132231187_1629437819197985" }), { key: "facebook:101821901895631_1629437819197985", link: null })).toBe(true);
    const words = "Vi glæder os virkelig til at komme tilbage i Hjerterum med en ny rejse";
    expect(sameTaggedPost(post({ network: "facebook", id: "9_1", author: "BreathWork Sound Journey", text: words }), { key: "facebook:8_2", link: null, author: "BreathWork Sound Journey", text: words })).toBe(true);
  });
  it("is not a different post by the same maker", () => {
    expect(sameTaggedPost(post({ network: "facebook", id: "9_1", author: "BreathWork Sound Journey", text: "Det er alt for længe siden sidst og vi glæder os virkelig" }),
      { key: "facebook:8_2", link: "https://www.facebook.com/8/posts/2", author: "BreathWork Sound Journey", text: "Vi glæder os virkelig til at komme tilbage i Hjerterum" })).toBe(false);
  });
});
