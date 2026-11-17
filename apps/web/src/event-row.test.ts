import { describe, expect, it } from "vitest";
import { rowWhen, spansDays } from "./event-row";

// Douglas (17 Nov 2026): "Not picking up weekend course in new system, only the Saturday".
describe("a weekend course in the calendar", () => {
  it("shows both its days", () => {
    expect(spansDays("2026-11-28T09:00:00Z", "2026-11-29T17:00:00Z")).toBe(true);
    expect(rowWhen("2026-11-28T09:00:00Z", "2026-11-29T17:00:00Z")).toBe("Lørdag 10.00 – søndag 18.00");
    expect(rowWhen("2026-11-28T09:00:00Z", "2026-11-28T17:00:00Z")).toBe("Lørdag 10.00–18.00");
  });
});
