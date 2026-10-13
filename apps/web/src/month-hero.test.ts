import { describe, expect, it } from "vitest";
import { dayLine, featureLine, isoWeek, monthOf, monthSections, type MonthEvent } from "./month-hero";

// Requested: the front page's calendar like the monthly newsletter - "Oktober i Hjerterum", three highlighted events, the general assembly
// in its own box, the rest of the month week by week, and the Mornings.
const NOW = Date.parse("2026-10-13T08:00:00Z");
const ev = (key: string, title: string, local: string, imageUrl: string | null = `https://img/${key}.jpg`, extra: Partial<MonthEvent> = {}): MonthEvent =>
  ({ key, title, startsAt: new Date(Date.parse(`${local}:00+02:00`)).toISOString(), imageUrl, page: `/events/${key}`, link: null, ...extra });
const EVENTS = [
  ev("y1", "Mediterende Yoga", "2026-10-14T16:00"), ev("gf", "Generalforsamling i Hjerterum", "2026-10-14T19:30", null, { location: "Hjerterum" }),
  ev("y2", "Mediterende Yoga", "2026-10-21T16:00"), ev("k", "Koncert med Victoria Akua", "2026-10-24T19:30"),
  ev("r", "Relax Your Eyes", "2026-10-25T10:00"), ev("s", "Source Breathwork", "2026-10-13T19:00"),
  ev("m1", "Dhyana Yoga", "2026-10-20T10:30", "https://img/m.jpg", { category: "Mornings" }), ev("m2", "Qi Gong · Mornings", "2026-10-23T10:30"),
  ev("nov", "Talk", "2026-11-02T19:00"), ev("old", "Før", "2026-10-12T10:00")
];

describe("the month on the front page", () => {
  it("highlights one-off events with a picture, gives the general assembly its own box, and finds the Mornings", () => {
    const m = monthSections(EVENTS, NOW);
    expect(m.name).toBe("Oktober");
    expect(m.featured.map(e => e.key)).toEqual(["s", "k", "r"]);
    expect(m.announce?.key).toBe("gf");
    expect(m.mornings?.key).toBe("m1");
    // The rest of the month, week by week, without what is shown above.
    expect(m.weeks.map(w => [w.week, w.events.map(e => e.key)])).toEqual([[42, ["y1"]], [43, ["m1", "y2", "m2"]]]);
  });

  it("writes the dates as the newsletter does, and moves on to next month near its end", () => {
    expect(featureLine(EVENTS[3]!.startsAt)).toBe("LØRDAG 24. OKTOBER · KL. 19.30");
    expect(dayLine(EVENTS[3]!.startsAt)).toBe("LØR. 24/10 · 19.30");
    expect(isoWeek(EVENTS[0]!.startsAt)).toBe(42);
    expect(monthOf(EVENTS, Date.parse("2026-10-25T20:00:00Z")).name).toBe("November");
  });

  it("shows at most six a week, and says how many more", () => {
    const many = Array.from({ length: 9 }, (_, i) => ev(`w${i}`, `Hold ${i}`, `2026-10-2${Math.min(i, 5)}T1${i}:00`, null));
    const week = monthSections(many, NOW).weeks.find(w => w.week === 43)!;
    expect(week.events.length).toBe(6);
    expect(week.events.length + week.more).toBe(9);
  });
});
