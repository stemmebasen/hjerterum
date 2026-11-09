import { describe, expect, it } from "vitest";
import { SOURCES } from "../src/sources/registry.js";
import { boraProduction, katapultProduction, parseBoraList, parseFiluren, parseKatapultList } from "../src/sources/theatres.js";
import { parseCurtain, parseDanishRange, productionEvents, type Production } from "../src/sources/stage.js";
import { fixture } from "./helpers.js";

const source = (id: string) => SOURCES.find(s => s.id === id)!;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();

describe("reading a theatre's dates and curtain times", () => {
  it("reads runs, single days and runs over New Year", () => {
    expect(parseDanishRange("17. – 19. november 2026")).toEqual({ start: { y: 2026, m: 11, d: 17 }, end: { y: 2026, m: 11, d: 19 } });
    expect(parseDanishRange("26. februar – 3. marts 2027")).toEqual({ start: { y: 2027, m: 2, d: 26 }, end: { y: 2027, m: 3, d: 3 } });
    expect(parseDanishRange("28. dec. - 3. jan. 2027")).toEqual({ start: { y: 2026, m: 12, d: 28 }, end: { y: 2027, m: 1, d: 3 } });
    expect(parseDanishRange("7. marts 2027")).toEqual({ start: { y: 2027, m: 3, d: 7 }, end: { y: 2027, m: 3, d: 7 } });
    expect(parseDanishRange("18. - 19. NOVEMBER", 2026)).toEqual({ start: { y: 2026, m: 11, d: 18 }, end: { y: 2026, m: 11, d: 19 } });
    expect(parseDanishRange("Hele året – GRATIS")).toBeNull();
  });

  it("takes the first clock time", () => {
    expect(parseCurtain("19:30")).toEqual([19, 30]);
    expect(parseCurtain("KL. 19.30, LØR. KL. 16")).toEqual([19, 30]);
    expect(parseCurtain("kl. 16")).toEqual([16, 0]);
    expect(parseCurtain("Se datoer")).toBeNull();
  });

  const run = (start: [number, number, number], end: [number, number, number], time: [number, number] | null): Production => ({
    id: "p", title: "P", url: "https://x.dk/p/", teaser: null, image: null, price: null, time,
    start: { y: start[0], m: start[1], d: start[2] }, end: { y: end[0], m: end[1], d: end[2] }
  });

  it("shows a short run with a known time as one event per evening, and leaves out everything else", () => {
    const config = source("bora-bora");
    const evenings = productionEvents(run([2026, 11, 17], [2026, 11, 19], [19, 30]), config);
    expect(evenings.map(e => [e.sourceEventId, iso(e.startsAt), e.allDay])).toEqual([
      ["p@2026-11-17", "2026-11-17T18:30:00.000Z", false],
      ["p@2026-11-18", "2026-11-18T18:30:00.000Z", false],
      ["p@2026-11-19", "2026-11-19T18:30:00.000Z", false]
    ]);
    // A long run ("29. november – 17. december") and a run without a time have no evening to go to together.
    expect(productionEvents(run([2026, 11, 29], [2026, 12, 17], [19, 30]), config)).toEqual([]);
    expect(productionEvents(run([2026, 11, 17], [2026, 11, 17], null), config)).toEqual([]);
    // Unless a source asks for runs to be shown.
    const shown = productionEvents(run([2026, 11, 29], [2026, 12, 17], [19, 30]), { ...config, options: { ...config.options, showRuns: true } });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ allDay: true, qualityFlags: ["run"] });
  });
});

describe("Teaterhuset Filuren", () => {
  const { events, unreadable } = parseFiluren(fixture("filuren-kalender.html"), source("filuren"));

  it("reads every performance with its date and time", () => {
    expect(events).toHaveLength(39);
    expect(unreadable).toBe(0);
    expect(events[0]).toMatchObject({
      sourceEventId: "fredagsdans@2026-11-13T1600", title: "Fredagsdans", allDay: false, venueName: "Teaterhuset Filuren",
      signupUrl: "https://filuren.dk/forestillinger/fredagsdans/"
    });
    expect(iso(events[0]!.startsAt)).toBe("2026-11-13T15:00:00.000Z");
  });

  it("marks sold-out performances", () => {
    expect(events.filter(e => e.qualityFlags.includes("sold_out")).map(e => e.sourceEventId)).toEqual([
      "jeg-bor-i-et-paphus@2026-11-29T1100", "jeg-bor-i-et-paphus@2026-12-05T1030", "digital-dopamin@2027-02-21T1700"
    ]);
  });
});

describe("Teater Katapult", () => {
  const items = parseKatapultList(fixture("katapult-saeson.html"), "https://katapult.dk/saeson-2026/");

  it("reads the season's list", () => {
    expect(items.map(i => [i.date, i.title])).toEqual([
      ["11. november 2026", "StorySlam"],
      ["18. – 19. november 2026", "Don Quixote (FIN)"],
      ["1. december 2026", "Dinosaur World"],
      ["8. december 2026", "Grand Slami Musikhuset"],
      ["Hele året – GRATIS", "BLANKE HANS"],
      ["Hele året – GRATIS", "Havet imellem os"]
    ]);
  });

  it("takes the time, stage and price from the event's page and makes one event per evening", () => {
    const item = items.find(i => i.title.startsWith("Don Quixote"))!;
    const events = productionEvents(katapultProduction(item, fixture("katapult-don-quixote.html"), 2026)!, source("katapult"));
    expect(events.map(e => [e.sourceEventId, iso(e.startsAt)])).toEqual([
      ["don-quixote@2026-11-18", "2026-11-18T18:30:00.000Z"],
      ["don-quixote@2026-11-19", "2026-11-19T18:30:00.000Z"]
    ]);
    expect(events[0]).toMatchObject({ venueName: "Teater Katapult, Black Box", price: { minMinor: 23000, isFree: false } });
    const slam = katapultProduction(items[0]!, fixture("katapult-storyslam.html"), 2026)!;
    expect(slam).toMatchObject({ time: [19, 30], price: { minMinor: 10000 }, venueName: "Teater Katapult" });
  });
});

describe("Bora Bora", () => {
  const items = parseBoraList(fixture("borabora-forside.html"));

  it("reads the season from the front page", () => {
    expect(items).toHaveLength(17);
    expect(items.find(i => i.url.endsWith("/wired/"))).toMatchObject({
      title: "Wired", artist: "Marie Kaae (DK/CM)", date: "17. – 19. november 2026", price: "From DKK 95 – 210", label: "Move Your Mind Festival"
    });
  });

  it("takes the curtain time from the production's page and makes one event per evening", () => {
    const p = boraProduction(items.find(i => i.url.endsWith("/wired/"))!, fixture("borabora-wired.html"))!;
    expect(p).toMatchObject({ title: "Wired – Marie Kaae (DK/CM)", time: [19, 30], price: { minMinor: 9500, maxMinor: 21000 } });
    expect(productionEvents(p, source("bora-bora")).map(e => [e.sourceEventId, iso(e.startsAt)])).toEqual([
      ["wired@2026-11-17", "2026-11-17T18:30:00.000Z"],
      ["wired@2026-11-18", "2026-11-18T18:30:00.000Z"],
      ["wired@2026-11-19", "2026-11-19T18:30:00.000Z"]
    ]);
  });

  it("leaves out a production whose page gives no time", () => {
    const p = boraProduction(items.find(i => i.url.endsWith("/labour/"))!, null)!;
    expect(p.time).toBeNull();
    expect(productionEvents(p, source("bora-bora"))).toEqual([]);
  });
});
