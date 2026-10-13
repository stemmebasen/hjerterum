import { describe, expect, it } from "vitest";
import { dayLine, isoWeek, monthHeader, monthOf, restOfMonth, type MonthEvent } from "./month-hero";

// Requested: the front page like the monthly newsletter - "Oktober i Hjerterum", three photos, what not to miss, and "Resten af oktober".
const NOW = Date.parse("2026-10-13T08:00:00Z");
const ev = (key: string, title: string, local: string, imageUrl: string | null = `https://img/${key}.jpg`): MonthEvent =>
  ({ key, title, startsAt: new Date(Date.parse(`${local}:00+02:00`)).toISOString(), imageUrl, page: `/events/${key}`, link: null });
const EVENTS = [
  ev("a", "Mediterende Yoga", "2026-10-14T16:00"), ev("b", "Generalforsamling i Hjerterum", "2026-10-14T19:30", null),
  ev("c", "Mediterende Yoga", "2026-10-21T16:00"), ev("d", "Koncert med Victoria Akua", "2026-10-24T19:30"),
  ev("e", "Relax Your Eyes", "2026-10-25T10:00"), ev("f", "Talk med Douglas", "2026-11-02T19:00"), ev("old", "Før", "2026-10-12T10:00"),
  ev("g", "Source Breathwork", "2026-10-13T19:00")
];

describe("the month on the front page", () => {
  it("is about this month, with photos from one-off events first and the general assembly as the line not to miss", () => {
    const header = monthHeader(EVENTS, NOW);
    expect(header.name).toBe("Oktober");
    // The weekly yoga comes after the one-off events; the three are shown in date order.
    expect(header.photos.map(e => e.key)).toEqual(["g", "d", "e"]);
    // A word inside another ("Honestbodytalk") is not a talk.
    expect(monthHeader([ev("h", "Honestbodytalk Uddannelsen", "2026-10-17T09:00"), ev("i", "Talk med Douglas", "2026-10-26T19:00")], NOW).highlight?.key).toBe("i");
    expect(header.note).toMatch(/^Generalforsamling i Hjerterum · Onsdag (den )?14\.10\.? kl\. 19\.30$/);
  });

  it("moves on to next month when fewer than three events are left in this one", () => {
    expect(monthOf(EVENTS, Date.parse("2026-10-24T20:00:00Z")).name).toBe("November");
  });

  it("lists the rest of the month week by week, without the events already shown", () => {
    const rest = restOfMonth(EVENTS, NOW, new Set(["a", "b", "c"]));
    expect(rest.name).toBe("oktober");
    expect(rest.weeks.map(w => [w.week, w.events.map(e => e.key)])).toEqual([[42, ["g"]], [43, ["d", "e"]]]);
    expect(dayLine(EVENTS[3]!.startsAt)).toBe("LØR. 24/10 · 19.30");
    expect(isoWeek(EVENTS[0]!.startsAt)).toBe(42);
  });
});
