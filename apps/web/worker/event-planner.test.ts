import { describe, expect, it } from "vitest";
import { atLocal, busyDuring, endOptions, firstFreeStart, monthGrid, planFromBooking, planInstants, planProblem, quoteFor, quoteForPlan, startOptions, windowOf, type DayEntry, type Plan } from "../src/event-planner-logic";

// Requested: one date from a date picker, the day's overview, the times as choices, and the price for each kind of rent.

const NOW = new Date(2026, 9, 5, 9, 0); // Monday 5 October 2026, 09.00 local
const entry = (date: string, from: number, to: number, label = "Optaget"): DayEntry =>
  ({ startsAt: atLocal(date, from).toISOString(), endsAt: atLocal(date, to).toISOString(), label, own: false, external: false, waiting: false });
const plan = (over: Partial<Plan> = {}): Plan => ({ date: "2026-10-19", start: "14:00", end: "16:00", type: "standard", setup: 0, cleanup: 0, ...over });

describe("the date picker's month", () => {
  it("is weeks of seven, Monday first, with neighbours filling the edges", () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0]![0]!.date).toBe("2026-09-28");
    expect(grid[0]![3]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(grid.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    expect(grid.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
  });
});

describe("the times", () => {
  it("start every half hour from 08.00 to 22.00, and end 2 to 10 hours later but never past midnight", () => {
    const starts = startOptions();
    expect(starts[0]).toBe("08:00");
    expect(starts.at(-1)).toBe("22:00");
    expect(endOptions("10:00")).toHaveLength(17);
    expect(endOptions("10:00")[0]).toBe("12:00");
    expect(endOptions("10:00").at(-1)).toBe("20:00");
    expect(endOptions("20:00")).toEqual(["22:00", "22:30", "23:00", "23:30", "24:00"]);
    expect(endOptions("22:00")).toEqual(["24:00"]);
  });

  it("suggest the first free two hours from 10.00", () => {
    const d = "2026-10-19";
    expect(firstFreeStart([], d)).toBe("10:00");
    expect(firstFreeStart([entry(d, 9 * 60, 13 * 60)], d)).toBe("13:00");
    expect(firstFreeStart([entry(d, 8 * 60, 24 * 60)], d)).toBeNull();
    expect(busyDuring([entry(d, 12 * 60, 14 * 60)], d, 14 * 60, 16 * 60)).toHaveLength(0);
    expect(busyDuring([entry(d, 12 * 60, 14 * 60 + 30)], d, 14 * 60, 16 * 60)).toHaveLength(1);
  });
});

describe("what is wrong with a plan", () => {
  it("names the first problem in the order a person fixes it", () => {
    expect(planProblem(plan({ date: "" }), [], NOW)).toBe("no_date");
    expect(planProblem(plan({ date: "2026-10-05", start: "08:00", end: "10:00" }), [], NOW)).toBe("past");
    expect(planProblem(plan(), [], NOW)).toBeNull();
    expect(planProblem(plan(), [entry("2026-10-19", 15 * 60, 17 * 60)], NOW)).toBe("busy");
  });

  it("refuses a weekday reduced or free rent across 18.30 but allows the weekend and standard price", () => {
    const across = { start: "17:00", end: "20:00" };
    expect(planProblem(plan({ ...across, type: "reduced" }), [], NOW)).toBe("crosses_evening");
    expect(planProblem(plan({ ...across, type: "free" }), [], NOW)).toBe("crosses_evening");
    expect(planProblem(plan({ ...across, type: "standard" }), [], NOW)).toBeNull();
    expect(planProblem(plan({ ...across, type: "reduced", date: "2026-10-24" }), [], NOW)).toBeNull(); // Saturday
  });

  it("holds the room to 2-10 hours", () => {
    expect(planProblem(plan({ end: "15:30" }), [], NOW)).toBe("too_short");
    expect(planProblem(plan({ start: "08:00", end: "19:00" }), [], NOW)).toBe("too_long");
  });
});

describe("the room's price per kind of rent", () => {
  it("matches the calculator: package price, reduced with campaign discount, and free", () => {
    expect(quoteFor("2026-10-19", "14:00", "17:00", "standard")?.totalKr).toBe(1080);
    const reduced = quoteFor("2026-10-19", "14:00", "17:00", "reduced")!; // Monday, B-time: 150 + 75 = 225 kr.
    expect(reduced.totalKr).toBe(225);
    expect(reduced.lines.join(" ")).toContain("Dagtakst");
    expect(quoteFor("2026-10-19", "14:00", "17:00", "free")?.totalKr).toBe(0);
    // A weekend is A-time: 400 + 150 = 550 kr., less the 25 % campaign discount (138 kr.) = 412 kr.
    const weekend = quoteFor("2026-10-24", "14:00", "17:00", "reduced")!;
    expect(weekend.totalKr).toBe(412);
    expect(weekend.lines).toEqual(["400 kr. for de første 2 timer + 1 × 150 kr. = 550 kr.", "Kampagnerabat 25 %: −138 kr.", "Aftentakst (hverdage fra 18.30 og weekender)."]);
  });

  it("cannot price a time that crosses 18.30 for reduced or free, or one outside 2-10 hours", () => {
    expect(quoteFor("2026-10-19", "17:00", "20:00", "reduced")).toBeNull();
    expect(quoteFor("2026-10-19", "17:00", "20:00", "standard")?.totalKr).toBe(1080);
    expect(quoteFor("2026-10-19", "14:00", "15:00", "standard")).toBeNull();
  });
});

describe("a plan and the instants the server gets", () => {
  it("round-trips through a booking, with midnight as the end of the day", () => {
    const p = plan({ start: "20:00", end: "24:00" });
    const { startsAt, endsAt } = planInstants(p);
    expect(planFromBooking(startsAt, endsAt, "reduced")).toEqual({ ...p, type: "reduced" });
    expect(new Date(endsAt).getTime() - new Date(startsAt).getTime()).toBe(4 * 3_600_000);
  });
});

// Requested: the room must be ready before the guests come and tidy after they leave - 30 minutes each way by default.
describe("setup and cleanup around the event", () => {
  const buffered = (over: Partial<Plan> = {}) => plan({ setup: 30, cleanup: 30, ...over });

  it("take the room from half an hour before to half an hour after", () => {
    expect(windowOf(buffered())).toEqual({ from: 13 * 60 + 30, to: 16 * 60 + 30 });
    expect(planProblem(buffered(), [entry("2026-10-19", 12 * 60, 13 * 60 + 30)], NOW)).toBeNull();
    expect(planProblem(buffered(), [entry("2026-10-19", 12 * 60, 13 * 60 + 45)], NOW)).toBe("busy");
    expect(planProblem(buffered(), [entry("2026-10-19", 16 * 60 + 15, 18 * 60)], NOW)).toBe("busy");
    expect(firstFreeStart([entry("2026-10-19", 9 * 60, 13 * 60)], "2026-10-19", 120, 30, 30)).toBe("13:30");
  });

  it("let a one-hour event fill the two hours of rent, and end so the cleanup is done by midnight", () => {
    expect(endOptions("10:00", 30, 30)[0]).toBe("11:00");
    expect(endOptions("10:00", 30, 30).at(-1)).toBe("19:00");
    expect(endOptions("22:00", 30, 30)).toEqual(["23:00", "23:30"]);
    expect(planProblem(buffered({ end: "15:00" }), [], NOW)).toBeNull();
    expect(planProblem(buffered({ end: "14:30" }), [], NOW)).toBe("too_short");
    expect(planProblem(buffered({ start: "08:00", end: "18:00" }), [], NOW)).toBe("too_long");
    expect(planProblem(buffered({ start: "22:00", end: "24:00" }), [], NOW)).toBe("too_late");
  });

  it("are priced and checked against 18.30 with the event", () => {
    expect(quoteForPlan(buffered(), "standard")?.totalKr).toBe(quoteFor("2026-10-19", "13:30", "16:30", "standard")?.totalKr);
    expect(planProblem(buffered({ start: "16:30", end: "18:30", type: "reduced" }), [], NOW)).toBe("crosses_evening");
    expect(planProblem(buffered({ start: "16:00", end: "18:00", type: "reduced" }), [], NOW)).toBeNull();
  });

  it("come back when a booking is edited", () => {
    const p = buffered({ start: "18:00", end: "21:00" });
    const { startsAt, endsAt } = planInstants(p);
    expect(planFromBooking(startsAt, endsAt, "standard", 30, 30)).toEqual(p);
  });

  it("can be a quarter of an hour, with the rent in half hours", () => {
    // 10.00-11.30 with 15 minutes each way: the room is taken 09.45-11.45, rented 09.30-12.00.
    const p = buffered({ start: "10:00", end: "11:30", setup: 15, cleanup: 15 });
    expect(windowOf(p)).toEqual({ from: 9 * 60 + 45, to: 11 * 60 + 45 });
    expect(quoteForPlan(p, "standard")?.totalKr).toBe(quoteFor("2026-10-19", "09:30", "12:00", "standard")?.totalKr);
    expect(planProblem(p, [entry("2026-10-19", 8 * 60, 9 * 60 + 45)], NOW)).toBeNull();
    expect(planProblem(p, [entry("2026-10-19", 11 * 60 + 40, 13 * 60)], NOW)).toBe("busy");
    expect(endOptions("10:00", 15, 15)[0]).toBe("11:00");
    expect(endOptions("22:00", 45, 45)).toEqual(["23:00"]);
  });
});
