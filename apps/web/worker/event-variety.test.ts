import { describe, expect, it } from "vitest";
import { copenhagenMs } from "./cockpit/data.js";
import { eventType, isMornings } from "../site/event-types.js";
import { varietyProblems, type HallEvent } from "./event-variety.js";

// Requested: "ikke kommer for mange af samme type events i kalenderen" - at most 3 a week, 1 a day, not two days in a row.
describe("variety in the calendar", () => {
  it("knows an event's type from its own words", () => {
    expect(eventType("Din Indre Natur - Breathwork med Jørgen Arvid")).toBe("breathwork");
    expect(eventType("Source Breathwork (Rebirthing) with Douglas Crawford")).toBe("breathwork");
    expect(eventType("Dhyana Yoga")).toBe("yoga");
    expect(eventType("Kys i Aarhus vol. 1", "En workshop om forbundethed")).toBe("foredrag");
    expect(eventType("Hjerterum Medlemscafé ☕️")).toBe("socialt");
    expect(eventType("Introduktion til Guidekontakt")).toBe("healing");
    expect(eventType("Bliv speaker")).toBe("andet");
    expect(isMornings("Dhyana Yoga", "Hjerterum Mornings Presents: Dhyana Yoga")).toBe(true);
  });
  it("finds too much of one type", () => {
    const at = (date: string, title: string, type: HallEvent["type"]): HallEvent => ({ startMs: copenhagenMs(date, "19:00"), title, type });
    const week = [at("2026-11-23", "Breathwork A", "breathwork"), at("2026-11-25", "Breathwork B", "breathwork"), at("2026-11-27", "Breathwork C", "breathwork")];
    const thursday = copenhagenMs("2026-11-26", "19:00");
    expect(varietyProblems("breathwork", thursday, week).join(" ")).toMatch(/allerede 3 events med breathwork/);
    expect(varietyProblems("breathwork", thursday, week).join(" ")).toMatch(/dagen før eller efter/);
    expect(varietyProblems("breathwork", copenhagenMs("2026-11-25", "10:00"), week).join(" ")).toMatch(/samme dag/);
    expect(varietyProblems("yoga", thursday, week)).toEqual([]);
    expect(varietyProblems("andet", thursday, week)).toEqual([]);
    expect(varietyProblems("breathwork", copenhagenMs("2026-12-02", "19:00"), week)).toEqual([]);
  });
});
