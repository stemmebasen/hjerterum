import { describe, expect, it } from "vitest";
import { etaText, liveEta } from "./wish-eta.js";

// The chair (27 Nov 2026): "Det er vigtigt at Jewel briefer Douglas og giver en eta på hvornår hans ændringer cirka er live".
const at = (iso: string) => Date.parse(iso);
describe("when a request is expected live", () => {
  it("is the work's time after the next check, never at night", () => {
    // Friday 27 Nov 2026, 10.30 in Copenhagen (UTC+1): next check 12 - small at 13, medium at 15.
    const morning = at("2026-11-27T09:30:00Z");
    expect(new Date(liveEta("lille", morning)).toISOString()).toBe("2026-11-27T12:00:00.000Z");
    expect(new Date(liveEta("mellem", morning)).toISOString()).toBe("2026-11-27T14:00:00.000Z");
    expect(etaText(liveEta("lille", morning), morning, "en")).toBe("today around 13:00");
    expect(etaText(liveEta("mellem", morning), morning, "da")).toBe("i dag ca. kl. 15");
    // Large: the day after.
    expect(etaText(liveEta("stor", morning), morning, "en")).toBe("tomorrow around 12:00");
    // 20.00: the check at 21 plus three hours would be past midnight - the next day around noon.
    const evening = at("2026-11-27T19:00:00Z");
    expect(etaText(liveEta("mellem", evening), evening, "en")).toBe("tomorrow around 12:00");
    // After the last check: the first one the next morning.
    const late = at("2026-11-27T21:30:00Z");
    expect(etaText(liveEta("lille", late), late, "da")).toBe("i morgen ca. kl. 10");
  });
});
