import { describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { applyRadarPage, parseRadarList, parseRadarPage, radarTimes } from "../src/sources/radar.js";
import { parseLoeves } from "../src/sources/loeves.js";
import { parseNemTilmeld, parseNemTilmeldTime } from "../src/sources/nemtilmeld.js";
import { applyFofPage, fofDate, fofEvents, parseFofList, parseFofPage } from "../src/sources/fof.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-11-09T21:00:00Z");
const ZONE = "Europe/Copenhagen";
const source = (id: string) => SOURCES.find(s => s.id === id)!;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();

describe("Radar (calendar page + event pages)", () => {
  const { events, unreadable } = parseRadarList(fixture("radar-kalender.html"), source("radar"), "https://radarlive.dk/kalender/");
  const by = (slug: string) => events.find(e => e.sourceEventId.endsWith(slug))!;

  it("reads every event on the calendar with the year from its link", () => {
    expect(events).toHaveLength(22);
    expect(unreadable).toBe(0);
    expect(by("/mercedess")).toMatchObject({ title: "Mercedess [SUPPORT: Solow]", venueName: "Radar", postalCode: "8000", allDay: true });
    expect(iso(by("/mercedess").startsAt)).toBe("2026-11-11T23:00:00.000Z");
    expect(iso(by("/ye-vagabonds-ie").startsAt)).toBe("2027-04-08T22:00:00.000Z");
    // "[GRATIS]" in the title is the price, not part of the name.
    expect(by("/nye-veje-vidensseminar-2026-gratis")).toMatchObject({ title: "Nye Veje vidensseminar 2026", price: { isFree: true } });
  });

  it("takes the concert time, price, genre and ticket link from the event's page", () => {
    const m = applyRadarPage(by("/mercedess"), parseRadarPage(fixture("radar-mercedess.html")), ZONE);
    // Doors 19:00, concert 20:00.
    expect(iso(m.startsAt)).toBe("2026-11-12T19:00:00.000Z");
    expect(m).toMatchObject({ allDay: false, price: { minMinor: 16500, isFree: false }, signupUrl: "https://www.yourticket.dk/?ytroute=/arrangementer/59056/mercedess/" });
    expect(m.qualityFlags).not.toContain("time_from_event_page");
    const seminar = applyRadarPage(by("/nye-veje-vidensseminar-2026-gratis"), parseRadarPage(fixture("radar-nye-veje.html")), ZONE);
    expect(iso(seminar.startsAt)).toBe("2026-11-18T10:00:00.000Z");
    expect(seminar.price).toMatchObject({ isFree: true });
    expect(radarTimes("Tid", "10:00-16:00")).toEqual({ start: [10, 0], end: [16, 0] });
  });
});

describe("Løve's Bog- og VinCafé (calendar page)", () => {
  it("reads each date and its event, linked to the café's own event", () => {
    const { events, unreadable } = parseLoeves(fixture("loeves-kalender.html"), source("loeves"));
    expect(unreadable).toBe(0);
    expect(events).toHaveLength(10);
    expect(events[0]).toMatchObject({ title: "Bog-klub møde #169", allDay: true, venueName: "Løve's Bog- og VinCafé", address: "Nørregade 32", sourceEventId: "1816558059659848" });
    expect(iso(events[0]!.startsAt)).toBe("2026-11-09T23:00:00.000Z");
    expect(events.at(-1)).toMatchObject({ title: "Åben Poetisk Scene", signupUrl: "https://www.facebook.com/events/801733572883016/801733582883015/" });
    expect(iso(events.at(-1)!.startsAt)).toBe("2026-12-22T23:00:00.000Z");
  });
});

describe("NemTilmeld (an association's event list)", () => {
  it("reads the Danish time spans", () => {
    expect(parseNemTilmeldTime("Søndag d. 29. november 2026 kl. 14:30 til 17:30")).toEqual({ start: { y: 2026, m: 11, d: 29, h: 14, mi: 30 }, end: { y: 2026, m: 11, d: 29, h: 17, mi: 30 } });
    expect(parseNemTilmeldTime("Fredag d. 11. december 2026 kl. 17:00 til lørdag d. 12. december 2026 kl. 02:00")?.end).toEqual({ y: 2026, m: 12, d: 12, h: 2, mi: 0 });
  });

  it("keeps workshops and parties, not weekly courses or the membership", () => {
    const { events, unreadable } = parseNemTilmeld(fixture("nemtilmeld-aarhuslindyhoppers.html"), source("aarhus-lindy-hoppers"));
    expect(unreadable).toBe(0);
    expect(events.map(e => e.title)).toEqual(["Workshops in rhythm & musicality for swing dancers", "Blues Fundamentals Workshop", "Christmas Party - Aarhus Lindy Hoppers 2026"]);
    const blues = events[1]!;
    expect(blues).toMatchObject({ venueName: "Frederiksbjerg Skole", city: "Aarhus", price: { minMinor: 7500 }, signupUrl: "https://aarhuslindyhoppers.nemtilmeld.dk/197/" });
    expect(iso(blues.startsAt)).toBe("2026-11-29T13:30:00.000Z");
    expect(iso(blues.endsAt)).toBe("2026-11-29T16:30:00.000Z");
  });
});

describe("FOF Aarhus' talks (list pages + talk pages)", () => {
  const { cards, lastPage } = parseFofList(fixture("fof-foredrag.html"));

  it("reads the cards from the page's payload and finds the last page", () => {
    expect(cards).toHaveLength(12);
    expect(lastPage).toBe(8);
    expect(fofDate("Tirsdag 10/11", NOW, ZONE)).toEqual({ y: 2026, m: 11, d: 10 });
    // A January date after New Year falls on the right weekday only in the next year.
    expect(fofDate("Torsdag 14/1", NOW, ZONE)).toEqual({ y: 2027, m: 1, d: 14 });
  });

  it("takes time, place, price and the booking link from the talk's page", () => {
    const base = fofEvents(cards, source("fof-aarhus"), NOW).events.find(e => e.sourceEventId.endsWith("trump-i-terapi-med-surrugue-og-2-x-lasse"))!;
    expect(base).toMatchObject({ allDay: true, city: "Aarhus C" });
    const e = applyFofPage(base, parseFofPage(fixture("fof-trump-i-terapi.html")), ZONE);
    expect(iso(e.startsAt)).toBe("2026-11-10T18:00:00.000Z");
    expect(iso(e.endsAt)).toBe("2026-11-10T20:00:00.000Z");
    expect(e).toMatchObject({ allDay: false, venueName: "VIA Campus, Bygn. A, Aarhus C", city: "Aarhus C", price: { minMinor: 23500 } });
    expect(e.signupUrl).toContain("holdnr=427112");
  });

  it("is collected in Aarhus, stopping when a page brings nothing new", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch({
      "https://www.fof.dk/robots.txt": { body: "User-Agent: *\nAllow: /\nDisallow: /soeg\n" },
      "https://www.fof.dk/aarhus/foredrag-i-aarhus": { body: fixture("fof-foredrag.html") },
      "https://www.fof.dk/aftenskolen/fof-aarhus/trump-i-terapi-med-surrugue-og-2-x-lasse": { body: fixture("fof-trump-i-terapi.html") }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("fof-aarhus")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0, created: 12 });
    expect(calls.filter(c => c.includes("?page="))).toHaveLength(1);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE area = 'aarhus'").all()[0] as { n: number }).n).toBe(12);
  });
});

describe("switching a source off", () => {
  it("takes its coming events off the site and brings them back when it is switched on again", async () => {
    const db = testDb();
    const routes = {
      "https://radarlive.dk/robots.txt": { status: 404 },
      "https://radarlive.dk/kalender/": { body: fixture("radar-kalender.html") }
    };
    const on = { ...source("radar"), enabled: () => true };
    const off = { ...source("radar"), enabled: () => false };
    const run = (s: typeof on, at: number) => runIngest({ DB: db }, { trigger: "test", now: at, fetcher: fakeFetch(routes).fetcher, sleep: noSleep, sources: [s], enrichBudget: 0 });
    await run(on, NOW);
    const scheduled = () => (db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled'").all()[0] as { n: number }).n;
    expect(scheduled()).toBe(22);
    expect((await run(off, NOW + 60_000)).sources[0]).toMatchObject({ status: "skipped", error: "disabled" });
    expect(scheduled()).toBe(0);
    await run(on, NOW + 120_000);
    expect(scheduled()).toBe(22);
  });
});
