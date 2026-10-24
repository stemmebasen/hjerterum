import { describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { parseVoxList, splitLocation, voxEvents, type VoxDetail } from "../src/sources/voxhall.js";
import { classify } from "../src/categories.js";
import { trainEvents, type TrainEvent } from "../src/sources/train.js";
import { musikhusetEvents, type MhEvent, type MhShowing } from "../src/sources/musikhuset.js";
import { aakbEvents, type AakbEvent } from "../src/sources/aakb.js";
import { resonansEvents, type ResonansEvent } from "../src/sources/resonans.js";
import { parseFolkestedet } from "../src/sources/folkestedet.js";
import { applyGodsPage, godsEvents, parseGodsDate, parseGodsList, parseGodsPage, parseGodsTime } from "../src/sources/godsbanen.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-24T10:00:00Z");
const source = (id: string) => SOURCES.find(s => s.id === id)!;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();

describe("VoxHall (concert list + WordPress REST)", () => {
  const list = parseVoxList(fixture("voxhall-koncerter.html"));
  const details = JSON.parse(fixture("voxhall-events.json")) as VoxDetail[];
  const { events, unreadable } = voxEvents(list, details, source("voxhall"));
  const by = (slug: string) => events.find(e => e.sourceEventId === slug)!;

  it("reads every concert on the list with its Danish start time", () => {
    expect(list).toHaveLength(41);
    expect(unreadable).toBe(0);
    expect(by("a-s-fanning")).toMatchObject({ title: "A.S. Fanning", venueName: "VoxHall", address: "Vester Allé 15", postalCode: "8000" });
    expect(iso(by("a-s-fanning").startsAt)).toBe("2026-10-24T18:00:00.000Z");
    // After the clocks go back.
    expect(iso(by("dylan-leblanc").startsAt)).toBe("2026-12-05T19:00:00.000Z");
  });

  it("takes price, ticket link, status and the place from the concert's page", () => {
    expect(by("a-s-fanning").price).toMatchObject({ minMinor: 11000, isFree: false });
    expect(by("ye-vagabonds-2")).toMatchObject({ venueName: "Radar", address: "Karen Wegeners Gade 6", postalCode: "8000", city: "Aarhus C" });
    expect(by("ye-vagabonds-2").signupUrl).toContain("yourticket.dk");
    expect(by("dylan-leblanc").venueName).toBe("Phono");
    expect(by("tyr").paragraphs[0]).toContain("Færøsk metal");
    const all = voxEvents([...list, { url: "https://voxhall.dk/koncerter/kliken/", slug: "kliken", start: "2026-10-10 20:00:00", title: "Kliken", image: null }, { url: "https://voxhall.dk/koncerter/cizzo/", slug: "cizzo", start: "2026-10-02 20:00:00", title: "Cizzo", image: null }], details, source("voxhall")).events;
    expect(all.find(e => e.sourceEventId === "kliken")!.qualityFlags).toContain("sold_out");
    expect(all.find(e => e.sourceEventId === "cizzo")!.cancelled).toBe(true);
  });

  it("splits a location line into place, street and town", () => {
    expect(splitLocation("Part – en del af VoxHall, Vester Allé 15, 8000 Aarhus C")).toEqual({ name: "Part", address: "Vester Allé 15", postalCode: "8000", city: "Aarhus C" });
  });

  it("is collected as concerts in Aarhus, in a few requests", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch({
      "https://voxhall.dk/robots.txt": { body: "User-agent: *\nDisallow: /wp-admin/\n" },
      "https://voxhall.dk/koncerter/": { body: fixture("voxhall-koncerter.html") },
      "https://voxhall.dk/wp-json/wp/v2/voxhall-event": { body: fixture("voxhall-events.json"), headers: { "content-type": "application/json" } }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("voxhall")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0 });
    expect(calls.filter(c => !c.endsWith("robots.txt"))).toHaveLength(3);
    const rows = db.raw.prepare("SELECT e.title, e.area, (SELECT group_concat(category) FROM event_categories c WHERE c.event_id = e.id) AS cats FROM events e").all() as Array<{ title: string; area: string; cats: string }>;
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.every(r => r.cats.split(",").includes("koncerter-musik"))).toBe(true);
    expect(rows.find(r => r.title === "A.S. Fanning")?.area).toBe("aarhus");
  });
});

describe("Godsbanen (calendar + event pages)", () => {
  it("reads the date text with the year from the data attributes", () => {
    expect(parseGodsDate("23.-24.okt.", "202610", "202610")).toEqual({ start: { y: 2026, m: 10, d: 23 }, end: { y: 2026, m: 10, d: 24 } });
    expect(parseGodsDate("5.- 6.dec.", "202612", "")).toEqual({ start: { y: 2026, m: 12, d: 5 }, end: { y: 2026, m: 12, d: 6 } });
    expect(parseGodsDate("3.okt.-12.dec.", "202610", "202612")).toEqual({ start: { y: 2026, m: 10, d: 3 }, end: { y: 2026, m: 12, d: 12 } });
    expect(parseGodsDate("24.okt.", "202610", "")).toEqual({ start: { y: 2026, m: 10, d: 24 }, end: null });
    expect(parseGodsDate("28.dec.-3.jan.", "202612", "202701")?.end).toEqual({ y: 2027, m: 1, d: 3 });
  });

  it("reads every listed event and leaves out exhibitions that run for weeks", () => {
    const { items, unreadable } = parseGodsList(fixture("godsbanen-kalender.html"));
    expect(items).toHaveLength(61);
    expect(unreadable).toBe(0);
    const events = godsEvents(items, source("godsbanen"));
    expect(events.length).toBeLessThan(61);
    expect(events.some(e => e.title.startsWith("Signe Boisen"))).toBe(false);
    expect(events.some(e => e.price?.isFree)).toBe(true);
  });

  it("takes time, room, price and ticket from the event page", () => {
    expect(parseGodsTime("Døre Kl. 19.00, Koncert Kl. 20.00")).toEqual({ start: [20, 0], end: null });
    expect(parseGodsTime("Kl. 9.15 - 12.55")).toEqual({ start: [9, 15], end: [12, 55] });
    expect(parseGodsTime("kl. 11-17")).toEqual({ start: [11, 0], end: [17, 0] });
    expect(parseGodsTime("TBC")).toBeNull();
    const page = parseGodsPage(fixture("godsbanen-ida-lilja.html"));
    expect(page).toMatchObject({ room: "Radar", entry: "150.-", ticket: "https://radarlive.dk/kalender/2026/october/ida-lilja/" });
    const items = parseGodsList(fixture("godsbanen-kalender.html")).items;
    const base = godsEvents(items, source("godsbanen")).find(e => e.sourceUrl?.includes("/ida-lilja/"))!;
    const rich = applyGodsPage(base, page, "Europe/Copenhagen");
    expect(iso(rich.startsAt)).toBe("2026-10-29T19:00:00.000Z");
    expect(rich).toMatchObject({ allDay: false, venueName: "Godsbanen, Radar", price: { minMinor: 15000 }, signupUrl: "https://radarlive.dk/kalender/2026/october/ida-lilja/" });
    const course = applyGodsPage(godsEvents(items, source("godsbanen")).find(e => e.sourceUrl?.includes("shaper-haandholdt"))!, parseGodsPage(fixture("godsbanen-shaper-haandholdt-cnc-fraeser-2.html")), "Europe/Copenhagen");
    expect(course.price).toMatchObject({ minMinor: 99500 });
    expect(course.address).toBe("Kjeld Tolstrups Gade 5");
  });

  it("is collected in Aarhus, filling in times from the event pages within the budget", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({
      "https://godsbanen.dk/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://godsbanen.dk/kalender/": { body: fixture("godsbanen-kalender.html") },
      "https://godsbanen.dk/kalender/ida-lilja/": { body: fixture("godsbanen-ida-lilja.html") }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("godsbanen")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0, enriched: 20 });
    const row = db.raw.prepare("SELECT starts_at, venue_name, area FROM events WHERE title = 'Ida Lilja'").all()[0] as { starts_at: number; venue_name: string; area: string } | undefined;
    if (row) expect(row).toMatchObject({ area: "aarhus" });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE area = 'aarhus'").all()[0] as { n: number }).n).toBeGreaterThan(30);
  });
});

describe("Train (public content API)", () => {
  const rows = (JSON.parse(fixture("train-sanity.json")) as { result: TrainEvent[] }).result;
  const { events, unreadable } = trainEvents(rows, source("train"));
  it("reads every concert with its room, address, price, ticket and status", () => {
    expect(events).toHaveLength(44);
    expect(unreadable).toBe(0);
    const august = events.find(e => e.title === "August Høyen")!;
    expect(iso(august.startsAt)).toBe("2026-10-24T18:00:00.000Z");
    expect(august).toMatchObject({ venueName: "TRAIN", address: "Kalkværksvej 13", postalCode: "8000", city: "Aarhus C", price: { minMinor: 32500 } });
    expect(august.qualityFlags).toContain("sold_out");
    expect(august.paragraphs).toContain("Support: Laura Hammer");
    expect(august.paragraphs[0]).not.toMatch(/^OBS/);
    expect(events.find(e => e.title === "lucca")).toMatchObject({ venueName: "HeadQuarters", address: "Valdemarsgade 1A" });
    expect(august.sourceUrl).toBe("https://train.dk/kalender/august-h%C3%B8yen-2026");
  });

  it("is collected as concerts in Aarhus in one request", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch({
      "https://zr3nrpl4.apicdn.sanity.io/robots.txt": { status: 404 },
      "https://zr3nrpl4.apicdn.sanity.io/v2021-10-21/data/query/production": { body: fixture("train-sanity.json"), headers: { "content-type": "application/json" } }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("train")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0, created: 44 });
    expect(calls.filter(c => c.includes("/data/query/"))).toHaveLength(1);
    expect(decodeURIComponent(calls.find(c => c.includes("/data/query/"))!)).toContain('$from="2026-10-24"');
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE area = 'aarhus'").all()[0] as { n: number }).n).toBe(44);
  });
});

describe("Musikhuset (the site's JSON API)", () => {
  const showings = (JSON.parse(fixture("musikhuset-showings.json")) as { data: MhShowing[] }).data;
  const productions = (JSON.parse(fixture("musikhuset-events.json")) as { data: MhEvent[] }).data;
  it("makes one event per performance with price, free flag and status", () => {
    const { events, unreadable } = musikhusetEvents(showings, productions, source("musikhuset"), NOW);
    expect(unreadable).toBe(0);
    expect(events.length).toBeGreaterThan(100);
    const cafe = events.find(e => e.title.startsWith("Cafékoncert med elever"))!;
    expect(cafe).toMatchObject({ venueName: "Musikhuset Aarhus", price: { isFree: true } });
    expect(iso(cafe.startsAt)).toBe("2026-10-24T09:00:00.000Z");
    expect(events.filter(e => e.price?.isFree).length).toBeGreaterThan(30);
    expect(events.some(e => e.qualityFlags.includes("sold_out"))).toBe(true);
    expect(events.every(e => e.startsAt <= NOW + 120 * 86_400_000)).toBe(true);
  });

  it("is collected with Musikhuset's genres as categories", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({
      "https://www.musikhuset.dk/robots.txt": { body: "User-agent: *\nAllow: /\n" },
      "https://www.musikhuset.dk/api/v2/events/showings": { body: fixture("musikhuset-showings.json"), headers: { "content-type": "application/json" } },
      "https://www.musikhuset.dk/api/v2/events": { body: fixture("musikhuset-events.json"), headers: { "content-type": "application/json" } }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("musikhuset")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0 });
    const cats = db.raw.prepare("SELECT c.category, COUNT(*) AS n FROM event_categories c GROUP BY c.category").all() as Array<{ category: string; n: number }>;
    const has = (c: string) => (cats.find(x => x.category === c)?.n ?? 0) > 0;
    expect(has("koncerter-musik") && has("scenekunst") && has("boern-familie") && has("foredrag-debat")).toBe(true);
  });
});

describe("Dokk1 (the libraries' events API)", () => {
  const rows = JSON.parse(fixture("aakb-events.json")) as AakbEvent[];
  it("keeps Dokk1's own events, physical, coming and short, with price and state", () => {
    const { events, unreadable } = aakbEvents(rows, source("dokk1"), NOW);
    expect(unreadable).toBe(0);
    expect(events.length).toBeGreaterThan(5);
    expect(events.every(e => e.venueName === "Dokk1")).toBe(true);
    expect(events.every(e => (e.endsAt ?? e.startsAt) >= NOW && e.startsAt <= NOW + 30 * 86_400_000)).toBe(true);
    expect(events.every(e => e.endsAt === null || e.endsAt - e.startsAt <= 14 * 86_400_000)).toBe(true);
    expect(events.some(e => e.price?.isFree)).toBe(true);
    const all = aakbEvents(rows, { ...source("dokk1"), options: { ...source("dokk1").options, branches: undefined } }, NOW).events;
    expect(all.length).toBeGreaterThan(events.length);
  });

  it("is collected in Aarhus with the library's categories", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({
      "https://www.aakb.dk/robots.txt": { body: "User-agent: *\nCrawl-delay: 10\n" },
      "https://www.aakb.dk/api/v1/events/happening": { body: fixture("aakb-events.json"), headers: { "content-type": "application/json" } }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("dokk1")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0 });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE area = 'aarhus'").all()[0] as { n: number }).n).toBe(out.sources[0]!.created);
  });
});

describe("Resonans Bistro & Bar", () => {
  it("reads the café's concerts", () => {
    const { events, unreadable } = resonansEvents(JSON.parse(fixture("resonans-events.json")) as ResonansEvent[], source("resonans"));
    expect(unreadable).toBe(0);
    expect(events).toHaveLength(17);
    const w = events.find(e => e.title === "Waterfahl")!;
    expect(iso(w.startsAt)).toBe("2026-10-29T18:30:00.000Z");
    expect(w).toMatchObject({ venueName: "Resonans Bistro & Bar", address: "Jægergårdsgade 150", signupUrl: "https://event-link.dk/arrangement/61441/" });
  });
});

describe("Folkestedet (calendar cards)", () => {
  it("reads single evenings with time and leaves out recurring courses and exhibitions", () => {
    const { events, unreadable } = parseFolkestedet(fixture("folkestedet-kalender.html"), source("folkestedet"), "https://folkestedet.aarhus.dk/kalender");
    expect(unreadable).toBe(0);
    expect(events.length).toBeGreaterThan(15);
    expect(events.some(e => e.title.startsWith("Kunstudstillinger"))).toBe(false);
    const harpin = events.find(e => e.title === "Harpin Wolf & the Black Sheep")!;
    expect(iso(harpin.startsAt)).toBe("2026-10-25T14:00:00.000Z");
    expect(iso(harpin.endsAt)).toBe("2026-10-25T16:00:00.000Z");
    expect(harpin).toMatchObject({ venueName: "Folkestedet", address: "Carl Blochs Gade 28", sourceUrl: "https://folkestedet.aarhus.dk/kalender/harpin-wolf-the-black-sheep" });
  });
});

describe("everyday categories", () => {
  it("know concerts, talks, art, stage, family and party nights", () => {
    expect(classify({ title: "Jazzkoncert på caféen" })).toContain("koncerter-musik");
    expect(classify({ title: "Forfatteraften med Kim Leine" })).toContain("foredrag-debat");
    expect(classify({ title: "Fernisering: Nye malerier" })).toContain("kunst-udstillinger");
    expect(classify({ title: "Stand-up comedy aften" })).toContain("scenekunst");
    expect(classify({ title: "Børneteater for hele familien" })).toContain("boern-familie");
    expect(classify({ title: "Pubquiz i baren" })).toContain("quiz-fest");
    expect(classify({ title: "Festival for nye stemmer" })).not.toContain("quiz-fest");
  });
});
