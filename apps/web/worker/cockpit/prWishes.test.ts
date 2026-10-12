import { describe, expect, it } from "vitest";
import { markPrDone, prPicker, prWishes, prWishList, setPrWishes } from "./prWishes.js";
import { testDatabase } from "../saga/test-support.js";

// Requested (Gitta): "en lille dropdown menu om hvad man godt kunne tænke sig der blev lavet: story, reel, karrusel, andet?"
describe("PR wishes on the coming events", () => {
  it("keeps each member's ticks, shows who wished what, and lets Gitta mark it made", async () => {
    const db = testDatabase();
    const NOW = Date.parse("2026-10-12T10:00:00Z");
    await setPrWishes(db, "SF1", "Jacob Hauge", ["reel", "story"], "", NOW);
    await setPrWishes(db, "SF1", "Lisbeth Holm", ["reel", "andet", "nonsense"], "Interview med underviseren", NOW);
    let wishes = (await prWishes(db, ["SF1"])).get("SF1")!;
    expect(wishes.map(w => [w.kind, w.wished_by, w.note])).toEqual([["story", ["Jacob Hauge"], null], ["reel", ["Jacob Hauge", "Lisbeth Holm"], null], ["andet", ["Lisbeth Holm"], "Interview med underviseren"]]);
    // Jacob unticks story: nobody wishes it any more, so it is gone.
    await setPrWishes(db, "SF1", "Jacob Hauge", ["reel"], "", NOW);
    await markPrDone(db, "SF1", "reel", "Gitta", true, NOW);
    wishes = (await prWishes(db, ["SF1"])).get("SF1")!;
    expect(wishes.map(w => w.kind)).toEqual(["reel", "andet"]);
    expect(wishes[0]).toMatchObject({ done_by: "Gitta", done_at_ms: NOW });
    const list = prWishList("/c", [{ id: "SF1", title: "Dhyana Yoga", starts_at_ms: NOW + 86_400_000 }, { id: "SF2", title: "Uden ønsker", starts_at_ms: NOW }], await prWishes(db, ["SF1", "SF2"]), "Gitta");
    expect(list).toContain("Dhyana Yoga");
    expect(list).not.toContain("Uden ønsker");
    expect(list).toContain("Lavet af Gitta");
    expect(list).toContain("Andet: Interview med underviseren");
    const picker = prPicker("/c", "SF1", wishes, "Jacob Hauge");
    expect(picker).toContain('value="reel" checked');
    expect(picker).not.toContain('value="story" checked');
    expect(prPicker("/c", "SF1", wishes, null)).toBe("");
  });
});
