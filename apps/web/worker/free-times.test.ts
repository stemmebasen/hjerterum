import { describe, expect, it } from "vitest";
import { copenhagenMs } from "./cockpit/data.js";
import { freeTimes, isFree, readTimeChoice, timeLabel } from "./free-times.js";

// Reported: "Hun skal ikke forslå et tidspunkt der ikke er ledigt".
describe("the hall's free times", () => {
  const now = copenhagenMs("2026-11-23", "12:00"); // a Monday
  const taken = [[copenhagenMs("2026-11-26", "18:30"), copenhagenMs("2026-11-26", "21:00")]] as const;

  it("counts setup and cleanup, as the booking does", () => {
    expect(isFree(taken, "2026-11-26", "19:00", "21:00")).toBe(false);
    expect(isFree(taken, "2026-11-26", "17:00", "19:00")).toBe(false);
    expect(isFree(taken, "2026-11-26", "16:00", "18:00")).toBe(true); // cleanup ends 18:30, just as the other one's setup begins
    expect(isFree(taken, "2026-11-26", "15:00", "17:30")).toBe(true);
  });

  it("offers only free times, one a day, from tomorrow", () => {
    const times = freeTimes(taken, now);
    expect(times).toHaveLength(5);
    for (const t of times) expect(isFree(taken, t.date, t.start, t.end)).toBe(true);
    expect(times[0]!.label).toBe("Tirsdag 24/11 kl. 19-21");
    // Thursday evening is taken, so Thursday offers the afternoon instead.
    expect(times.find(t => t.date === "2026-11-26")?.label).toBe("Torsdag 26/11 kl. 16-18");
    expect(new Set(times.map(t => t.date)).size).toBe(times.length);
  });

  it("reads a time the way the buttons write it", () => {
    expect(readTimeChoice("Tirsdag 24/11 kl. 19-21", now)).toEqual({ date: "2026-11-24", start: "19:00", end: "21:00" });
    expect(readTimeChoice("lørdag 3/1 kl. 10.30-12", now)).toEqual({ date: "2027-01-03", start: "10:30", end: "12:00" });
    expect(readTimeChoice("en aften i næste uge", now)).toBeNull();
    expect(timeLabel("2026-11-28", "10:30", "12:00")).toBe("Lørdag 28/11 kl. 10.30-12");
  });
});
