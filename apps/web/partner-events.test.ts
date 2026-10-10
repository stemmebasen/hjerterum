import { expect, it } from "vitest";
import { isPartnerEvent } from "./partner-events";

// Requested: Hjerteland's events at the bottom under "Fra samarbejdspartnere".
it("knows a partner house's event by its place, category or title", () => {
  expect(isPartnerEvent({ title: "You Can Sing! / Aarhus", location: "Hjerteland (8200 Lisbjerg)", category: "Hjerteland" })).toBe(true);
  expect(isPartnerEvent({ title: "Breathwork", location: "Hjerterum", category: "Events & Workshops" })).toBe(false);
  expect(isPartnerEvent({ title: "Sang på Hjerteland" })).toBe(true);
});
