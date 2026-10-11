import { describe, expect, it } from "vitest";
import { dateBadge, dayLabel, isoWithOffset, localDate, startOfLocalDay, timeRangeLabel, zonedToUtc } from "../src/time.js";

describe("Danish time", () => {
  it("converts wall-clock time with summer and winter offsets", () => {
    expect(new Date(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 19, minute: 0 })).toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(new Date(zonedToUtc({ year: 2026, month: 12, day: 1, hour: 19, minute: 0 })).toISOString()).toBe("2026-12-01T18:00:00.000Z");
  });

  it("takes the earlier instant in the repeated autumn hour and moves a skipped spring time forward", () => {
    // 25 October 2026: 03:00 summer time becomes 02:00 winter time, so 02:30 happens twice.
    expect(new Date(zonedToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 })).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    // 29 March 2026: 02:00 becomes 03:00, so 02:30 does not exist; it is read as 03:30 summer time.
    expect(new Date(zonedToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 })).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("finds local midnight and the local calendar day around the change", () => {
    expect(new Date(startOfLocalDay("2026-10-25")!).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(new Date(startOfLocalDay("2026-10-26")!).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(startOfLocalDay("2026-02-30")).toBeNull();
    expect(localDate(Date.parse("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
  });

  it("writes ISO dates with the offset and Danish labels", () => {
    expect(isoWithOffset(Date.parse("2026-10-11T13:30:00Z"))).toBe("2026-10-11T15:30:00+02:00");
    expect(isoWithOffset(Date.parse("2026-11-11T13:30:00Z"))).toBe("2026-11-11T14:30:00+01:00");
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(dayLabel(Date.parse("2026-10-11T13:30:00Z"), now)).toBe("søndag 11. oktober");
    expect(dayLabel(Date.parse("2027-01-02T13:30:00Z"), now)).toBe("lørdag 2. januar 2027");
    expect(dateBadge(Date.parse("2026-10-11T13:30:00Z"))).toEqual({ weekday: "søn", day: "11", month: "okt" });
    expect(timeRangeLabel(Date.parse("2026-10-11T13:30:00Z"), Date.parse("2026-10-11T16:00:00Z"), false, now)).toBe("kl. 15.30–18.00");
  });
});
