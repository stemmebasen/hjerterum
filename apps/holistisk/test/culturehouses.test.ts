import { describe, expect, it } from "vitest";
import { SOURCES } from "../src/sources/registry.js";
import { aarhusTeaterEvents, moesgaardEvents, parseFriheden, parseParadis, type AtShow, type MoesResponse } from "../src/sources/venues.js";
import { fixture } from "./helpers.js";

const source = (id: string) => SOURCES.find(s => s.id === id)!;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("Tivoli Friheden", () => {
  it("takes the talks and concerts from the front page, once each, and not the park's own activities", () => {
    const { events, unreadable } = parseFriheden(fixture("friheden-forside.html"), source("tivoli-friheden"));
    expect(unreadable).toBe(0);
    expect(events.map(e => [e.title, iso(e.startsAt), e.venueName, e.categoryHints[0]])).toEqual([
      ["OUTSIDER", "2026-11-13T18:00:00.000Z", "Hermans, Tivoli Friheden", "hermans"],
      ["Det, Vi Taler Om", "2026-11-14T19:00:00.000Z", "Hermans, Tivoli Friheden", "hermans"]
    ]);
    expect(events[0]!.sourceUrl).toBe("https://friheden.dk/arrangementer/hermans/bo-henriksen");
    expect(events[0]!.sourceEventId).toBe("hermans/bo-henriksen@2026-11-13T1900");
  });
});

describe("Aarhus Teater", () => {
  it("makes one event per performance, with the stage and the ticket link", () => {
    const shows = JSON.parse(fixture("aarhusteater-shows.json")) as AtShow[];
    const { events, unreadable } = aarhusTeaterEvents(shows, source("aarhus-teater"));
    expect(unreadable).toBe(0);
    const mann = events.filter(e => e.title === "Mann");
    expect(mann.length).toBe(3);
    expect(iso(mann[0]!.startsAt)).toBe("2026-11-13T16:00:00.000Z");
    expect(mann[0]!.venueName).toBe("Aarhus Teater, Stiklingen");
    expect(mann[0]!.signupUrl).toMatch(/^https:\/\/billet\.aarhusteater\.dk\/da\//);
    expect(mann[1]!.qualityFlags).toContain("sold_out");
    expect(events.find(e => e.title === "Absalons Hemmelighed")!.categoryHints).toEqual(["for børn"]);
    expect(events.some(e => e.title === "Eksistens")).toBe(true);
  });
});

describe("Moesgaard Museum", () => {
  it("leaves out the daily guided tours and reads talks with price and end time", () => {
    const page = JSON.parse(fixture("moesgaard-events.json")) as MoesResponse;
    const { events, unreadable } = moesgaardEvents([page], source("moesgaard"));
    expect(unreadable).toBe(0);
    expect(events.some(e => e.title === "Maya")).toBe(false);
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) {
      expect(e.endsAt === null || e.endsAt > e.startsAt).toBe(true);
      expect(e.sourceUrl).toMatch(/^https:\/\/moesgaardmuseum\.dk\//);
    }
  });
});

describe("Øst for Paradis", () => {
  it("reads every event on the events page with its day, time and ticket link", () => {
    const { events, unreadable } = parseParadis(fixture("paradis-events.html"), source("oest-for-paradis"), NOW);
    expect(unreadable).toBe(0);
    const first = events[0]!;
    expect([first.title, iso(first.startsAt), first.signupUrl]).toEqual(
      ["Blodig Weekend 2026 - Pet Sematary", "2026-11-13T18:00:00.000Z", "https://www.paradisbio.dk/order_movie_ticket/227003"]);
    expect(first.paragraphs[0]).toMatch(/Med intro/);
    expect(events.find(e => e.title === "Tony")!.paragraphs[0]).toMatch(/gin og tonic/);
    expect(new Set(events.map(e => e.sourceEventId)).size).toBe(events.length);
  });

  it("reads a date early in the year as next year", () => {
    const html = '<div class="CategoryDate col-12"><h3>Fredag den 8. januar </h3></div><div class="col-md-6 col-lg-6 film-wrap-item">'
      + '<h5>Nytårsfilm</h5><a href="/movie_details/1" class="filmLink"></a><a href="/order_movie_ticket/9"><button title="Event">Event 19:00</button></a></div>';
    const { events } = parseParadis(html, source("oest-for-paradis"), NOW);
    expect(iso(events[0]!.startsAt)).toBe("2027-01-08T18:00:00.000Z");
  });
});
