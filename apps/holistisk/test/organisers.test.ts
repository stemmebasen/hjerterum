import { describe, expect, it } from "vitest";
import { classifyTopics } from "../src/activities.js";
import { runIngest } from "../src/ingest/run.js";
import { parseCrawlDelay } from "../src/sources/http.js";
import { eventsFromDiamondWay } from "../src/sources/diamondway.js";
import { parseEventsManagerFeed, parseWhen } from "../src/sources/eventsmanager.js";
import { SOURCES } from "../src/sources/registry.js";
import { parseTypo3Events } from "../src/sources/typo3events.js";
import { parseCourseList, parseCoursePage } from "../src/sources/vaekstcenteret.js";
import { parseFavnCalendar } from "../src/sources/favn.js";
import { ORGANIZERS } from "../src/organizers.js";
import { slugify } from "../src/text.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const source = (id: string) => SOURCES.find(s => s.id === id)!;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();

describe("Brahma Kumaris (Events Manager feed)", () => {
  it("reads Danish date lines with times and with several days", () => {
    expect(parseWhen("mandag d. 12. oktober 2026 - 18:30 - 19:20")).toEqual({ date: { y: 2026, m: 10, d: 12 }, endDate: null, start: [18, 30], end: [19, 20] });
    expect(parseWhen("fredag d. 30. oktober 2026 - 19:00 - søndag d. 1. november 2026 - 15:00")).toMatchObject({ date: { d: 30, m: 10 }, endDate: { d: 1, m: 11 }, start: [19, 0], end: [15, 0] });
  });

  it("keeps the Aarhus centre's events, leaves out Copenhagen and the daily evening meditation", () => {
    const { events, skipped } = parseEventsManagerFeed(fixture("brahmakumaris-events.xml"), source("brahma-kumaris-aarhus"));
    expect(skipped).toBeGreaterThan(20);
    expect(events.length).toBeGreaterThan(3);
    expect(events.every(e => e.title !== "Aftenmeditation")).toBe(true);
    expect(events.every(e => /århus|aarhus/i.test(e.locationText ?? ""))).toBe(true);
    const course = events.find(e => e.title === "Videregående kursus i Raja Yoga Meditation")!;
    expect(course).toMatchObject({ venueName: "Brahma Kumaris Aarhus", address: "Ålborggade 22, 3. tv.", postalCode: "8000" });
    expect(iso(course.startsAt)).toBe("2026-10-12T17:30:00.000Z");
    expect(iso(course.endsAt)).toBe("2026-10-12T19:00:00.000Z");
  });
});

describe("Buddhistisk Center Aarhus (buddha.dk)", () => {
  it("makes one event per evening named in the text, at its real time", () => {
    const { events } = eventsFromDiamondWay(fixture("buddha-dk.html"), source("buddhistisk-center-aarhus"));
    expect(events.map(e => [e.title, iso(e.startsAt), iso(e.endsAt)])).toEqual([
      ["Meditation – Julianne Ferenczy", "2026-10-21T17:00:00.000Z", "2026-10-21T19:00:00.000Z"],
      ["Compassion and wisdom – Julianne Ferenczy", "2026-10-22T17:00:00.000Z", "2026-10-22T19:00:00.000Z"]
    ]);
    expect(events[0]).toMatchObject({ postalCode: "8200", address: "Peder Skrams Gade 52B, kld.", price: { minMinor: 7500 } });
  });
});

describe("Dansk Center for Mindfulness (AU's event RSS)", () => {
  it("takes the structured start, end and place", () => {
    const { events } = parseTypo3Events(fixture("dcm-arrangementer.xml"), source("dansk-center-for-mindfulness"));
    const tools = events.find(e => e.title === "Mindfulness Tools efterår")!;
    expect(iso(tools.startsAt)).toBe("2026-11-05T15:00:00.000Z");
    expect(iso(tools.endsAt)).toBe("2026-11-08T11:00:00.000Z");
    expect(tools.locationText).toBe("Østjylland");
  });
});

describe("Vækstcenteret (course list and pages)", () => {
  it("reads the course list and a course page", () => {
    const list = parseCourseList(fixture("vaekstcenteret-kurser.html"));
    expect(list.length).toBeGreaterThan(20);
    const days = list.find(b => b.title.startsWith("Meditationsdage"))!;
    expect(days).toMatchObject({ startDate: "2026-10-14", teachers: ["Jes Bertelsen"] });
    const page = parseCoursePage(fixture("vaekstcenteret-meditationsdage.html"));
    expect(page).toMatchObject({ start: { date: "2026-10-14", h: 9, m: 0 }, end: { date: "2026-10-17", h: 13, m: 0 }, place: "Store sal, Vækstcenteret" });
  });

  it("is collected with times from the course pages, waiting the 10 seconds the site asks for", async () => {
    const db = testDb();
    const waits: number[] = [];
    const robots = "Crawl-delay: 10\n\nUser-agent: *\nDisallow: /wp-admin/\n";
    const { fetcher } = fakeFetch({
      "https://vaekstcenteret.dk/robots.txt": { body: robots },
      "https://vaekstcenteret.dk/kurser/": { body: fixture("vaekstcenteret-kurser.html") },
      "https://vaekstcenteret.dk/kursus/meditationsdage": { body: fixture("vaekstcenteret-meditationsdage.html") },
      "https://vaekstcenteret.dk/kursus/": { body: "<html></html>" }
    });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: async ms => { waits.push(ms); }, sources: [source("vaekstcenteret")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", enriched: 8 });
    expect(waits.length).toBeGreaterThanOrEqual(7);
    expect(waits.every(ms => ms > 9000 && ms <= 10000)).toBe(true);
    const row = db.raw.prepare("SELECT starts_at, ends_at, all_day, area FROM events WHERE title LIKE 'Meditationsdage%'").all()[0] as Record<string, number | string>;
    expect(row).toMatchObject({ all_day: 0, area: "horsens" });
    expect(iso(row.starts_at as number)).toBe("2026-10-14T07:00:00.000Z");
  });

  it("parses Crawl-delay", () => {
    expect(parseCrawlDelay("Crawl-delay: 10\n\nUser-agent: *\nDisallow: /wp-admin/")).toBe(10);
    expect(parseCrawlDelay("User-agent: GPTBot\nCrawl-delay: 30\n\nUser-agent: *\nDisallow:")).toBeNull();
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: 60")).toBe(15);
  });
});

describe("Favn Aarhus (workshop calendar)", () => {
  it("reads each dated workshop, finds the year from the weekday and keeps repeated workshops apart", () => {
    const { events, unreadable } = parseFavnCalendar(fixture("favn-workshops.html"), source("favn-aarhus"), NOW);
    expect(unreadable).toBe(0);
    const chakra = events.filter(e => e.title === "Intuitiv chakradans med Anne");
    expect(chakra.map(e => iso(e.startsAt))).toEqual(["2026-09-25T14:30:00.000Z", "2026-10-09T14:30:00.000Z", "2026-11-06T15:30:00.000Z", "2026-12-04T15:30:00.000Z"]);
    expect(new Set(chakra.map(e => e.sourceEventId)).size).toBe(4);
    expect(events.some(e => iso(e.startsAt)!.startsWith("2026-08-05"))).toBe(false);
    expect(chakra[1]).toMatchObject({ hostName: "Anne", venueName: "Favn Aarhus", address: "Jægergårdsgade 14, 2.", price: { minMinor: 20000 } });
    expect(iso(chakra[1]!.endsAt)).toBe("2026-10-09T16:00:00.000Z");
    const kakao = events.find(e => e.title.startsWith("Stemme- og hjerteåbnende kakaoceremoni"))!;
    expect([iso(kakao.startsAt), iso(kakao.endsAt)]).toEqual(["2026-09-05T12:00:00.000Z", "2026-09-05T15:00:00.000Z"]);
    expect(kakao.hostName).toBe("Lucas, Ksenia og Johanne");
    const network = events.find(e => e.title === "Yoga og netværk med LuminaLux")!;
    expect(network.endsAt).toBeNull();
    expect(events.find(e => e.title === "Kvinde - kend din kraft")?.price).toMatchObject({ minMinor: 65000, maxMinor: 85000 });
  });

  it("is collected into Aarhus with the right activities and topics", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({ "https://favnaarhus.dk/robots.txt": { body: "User-agent: *\nDisallow:\n" }, "https://favnaarhus.dk/workshop-kalender-aarhus/": { body: fixture("favn-workshops.html") } });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [source("favn-aarhus")] });
    expect(out.sources[0]).toMatchObject({ status: "ok", rejected: 0 });
    expect(out.sources[0]!.created).toBeGreaterThan(5);
    const topics = db.raw.prepare("SELECT e.title, group_concat(t.topic) AS topics FROM events e LEFT JOIN event_topics t ON t.event_id = e.id GROUP BY e.id").all() as Array<{ title: string; topics: string | null }>;
    expect(topics.every(r => r.title)).toBe(true);
    const cats = (title: string) => (db.raw.prepare("SELECT group_concat(c.category) AS c FROM events e JOIN event_categories c ON c.event_id = e.id WHERE e.title = ? GROUP BY e.id").all(title)[0] as { c: string } | undefined)?.c ?? "";
    expect(cats("Slow Down Sunday med Anne")).toContain("yoga");
    expect(topics.find(r => r.title === "Slow Down Sunday med Anne")?.topics ?? "").not.toContain("yin-yoga");
  });
});

describe("organiser directory", () => {
  it("each profile's slug is the organiser id its events get, and every profile has a source for its offerings", () => {
    for (const o of ORGANIZERS) {
      expect(slugify(o.name, 60) === o.slug || ["yoga-og-meditation-horsens"].includes(o.slug)).toBe(true);
      expect(o.offerings.every(x => /^https:\/\//.test(x.source))).toBe(true);
    }
    for (const id of ["brahma-kumaris-aarhus", "buddhistisk-center-aarhus", "dansk-center-for-mindfulness", "vaekstcenteret"]) {
      expect(ORGANIZERS.some(o => o.slug === slugify(source(id).defaults.organizerName!, 60))).toBe(true);
    }
  });

  it("topics need more than a passing mention", () => {
    expect(classifyTopics({ title: "Klarsyn med Karina Graabæk" })).toContain("klarsyn");
    expect(classifyTopics({ title: "Yin yoga og lydbad", description: "Vi slutter med syngeskåle og gong." })).toEqual(expect.arrayContaining(["yin-yoga", "soundbath"]));
    expect(classifyTopics({ title: "Hatha yoga", description: "Godt mod stress." })).not.toContain("stress");
    expect(classifyTopics({ title: "Stilhedsretreat på Mols" })).toContain("stilhedsretreat");
    expect(classifyTopics({ title: "Stille morgen", description: "En dag med stilhed." })).not.toContain("stilhedsretreat");
  });
});
