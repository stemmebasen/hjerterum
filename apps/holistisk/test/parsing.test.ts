import { describe, expect, it } from "vitest";
import { classify, isHolisticRelevant } from "../src/categories.js";
import { activeRegions, activeAreas, areaForPostcode, placeEvent } from "../src/geo.js";
import { parsePrice } from "../src/price.js";
import { isAllowed, parseRobots, createHttpClient, decodeBody } from "../src/sources/http.js";
import { eventsFromCalendar, expandRule, parseDate, splitLocation } from "../src/sources/ical.js";
import { eventFromSchema, extractJsonLd, findEvents } from "../src/sources/jsonld.js";
import { eventFromBilletto } from "../src/sources/billetto.js";
import { SOURCES } from "../src/sources/registry.js";
import type { SourceConfig } from "../src/sources/types.js";
import { TIMEZONE } from "../src/time.js";
import { normalizeTitle, titleSimilarity, htmlToParagraphs } from "../src/text.js";
import { isSameEvent } from "../src/ingest/store.js";
import { fakeFetch, noSleep } from "./helpers.js";

const config = (over: Partial<SourceConfig> = {}): SourceConfig => ({
  id: "t", name: "T", adapter: "ical", homepageUrl: "https://example.org", permissionBasis: "test", attribution: "T", imagePolicy: "allowed",
  descriptionPolicy: "full", priority: 10, requireRelevance: false, completeListing: true, canonicalToSource: false, respectRobots: true,
  enabled: () => true, defaults: { timezone: TIMEZONE, organizerName: null, organizerUrl: null, venues: [] }, options: {}, ...over
});

describe("geography", () => {
  it("places events by postcode, then by town", () => {
    expect(areaForPostcode("8000")?.slug).toBe("aarhus");
    expect(areaForPostcode("8900")?.slug).toBe("randers");
    expect(areaForPostcode("8400")?.slug).toBe("djursland");
    expect(areaForPostcode("8600")?.slug).toBe("silkeborg");
    expect(areaForPostcode("8660")?.slug).toBe("skanderborg");
    expect(areaForPostcode("8464")?.slug).toBe("skanderborg");
    expect(areaForPostcode("8700")?.slug).toBe("horsens");
    expect(areaForPostcode("5000")?.slug).toBe("fyn");
    expect(areaForPostcode("2200")?.region).toBe("hovedstaden");
    expect(placeEvent({ city: "Ebeltoft" })?.slug).toBe("djursland");
    expect(placeEvent({ freeText: "Yogahuset, Randers C" })?.slug).toBe("randers");
    expect(placeEvent({ city: "Ukendtby" })).toBeNull();
  });

  it("which regions are shown is configuration", () => {
    expect(activeRegions(undefined)).toEqual(["ostjylland"]);
    expect(activeRegions("ostjylland, fyn, atlantis")).toEqual(["ostjylland", "fyn"]);
    expect(activeAreas(["ostjylland"]).map(a => a.slug)).toEqual(["aarhus", "randers", "djursland", "silkeborg", "skanderborg", "horsens"]);
  });
});

describe("categories", () => {
  it("reads the title first and does not let a passing word decide", () => {
    expect(classify({ title: "Din Indre Natur - Breathwork Journey" })).toEqual(["aandedraet-breathwork"]);
    expect(classify({ title: "Morning Sound Journey", hints: ["Lyd, Sang & Musik"] })).toContain("lydhealing");
    expect(classify({ title: "Kvindecirkel ved nymåne" })).toEqual(expect.arrayContaining(["kvinde-mandegrupper", "spiritualitet-bevidsthed"]));
    expect(classify({ title: "Stilhedsretræte på Mols", description: "Tre dages retræte med meditation i naturen." })).toEqual(expect.arrayContaining(["retraeter", "meditation-mindfulness"]));
    expect(classify({ title: "Hjerterum Medlemscafé" })).toEqual(["sociale-faellesskaber"]);
    expect(classify({ title: "Generalforsamling", description: "Vi mødes i naturen." })).toEqual([]);
    expect(classify({ title: "Slow Down Sunday med Anne", summary: "2 timers restorativ yoga for dyb afspænding" })).toEqual(["yoga"]);
  });

  it("knows a holistic event from another one", () => {
    expect(isHolisticRelevant("Yin yoga og lydbad")).toBe(true);
    expect(isHolisticRelevant("Stand-up comedy med kendte navne")).toBe(false);
  });
});

describe("prices from text", () => {
  it("reads kroner and ranges, and ignores phone numbers", () => {
    expect(parsePrice(["Pris:", "100,- for medlemmer", "200,- for ikke-medlemmer", "Betaling v. MobilePay på 61 99 30 36"])).toMatchObject({ minMinor: 10000, maxMinor: 20000, isFree: false });
    expect(parsePrice(["Pris: kr. 1.250 inkl. frokost"])).toMatchObject({ minMinor: 125000, maxMinor: 125000 });
    expect(parsePrice(["Gratis entré – alle er velkomne"])).toMatchObject({ isFree: true, minMinor: 0 });
    expect(parsePrice(["Vi mødes kl. 19 den 12. oktober"])).toMatchObject({ minMinor: null, isFree: null });
  });
});

describe("text and duplicates", () => {
  it("turns HTML into clean paragraphs", () => {
    expect(htmlToParagraphs("<p>Hej&nbsp;med&aring; dig</p><script>alert(1)</script><p>_____</p><ul><li>En</li></ul>")).toEqual(["Hej medå dig", "• En"]);
  });

  it("recognises the same event despite small title differences", () => {
    expect(titleSimilarity(normalizeTitle("AFLYST: Dhyana Yoga"), normalizeTitle("Dhyana yoga"))).toBe(1);
    const at = Date.parse("2026-10-13T08:30:00Z");
    expect(isSameEvent({ title: "Kakaoceremoni med lydbad", starts_at: at, area: "aarhus" }, { title: "Kakaoceremoni & lydbad", starts_at: at + 15 * 60_000, area: null })).toBe(true);
    expect(isSameEvent({ title: "Dhyana Yoga", starts_at: at, area: "aarhus" }, { title: "Dhyana Yoga", starts_at: at + 7 * 86400_000, area: "aarhus" })).toBe(false);
    expect(isSameEvent({ title: "Dhyana Yoga", starts_at: at, area: "aarhus" }, { title: "Dhyana Yoga", starts_at: at, area: "randers" })).toBe(false);
    expect(isSameEvent({ title: "Yin yoga", starts_at: at, area: "aarhus" }, { title: "Lydbad", starts_at: at, area: "aarhus" })).toBe(false);
  });
});

describe("robots.txt and HTTP", () => {
  it("follows the longest matching rule", () => {
    const rules = parseRobots("User-agent: *\nAllow: /$\nAllow: /v2/*\nDisallow: /\n\nUser-agent: Googlebot\nDisallow:\n");
    expect(isAllowed(rules, "/v2/events?_op=rss")).toBe(true);
    expect(isAllowed(rules, "/")).toBe(true);
    expect(isAllowed(rules, "/admin")).toBe(false);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /api/*\n"), "/events")).toBe(true);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /api/*\n"), "/api/x")).toBe(false);
  });

  it("retries temporary failures, but not a 404", async () => {
    let n = 0;
    const flaky = fakeFetch({ "https://x.example/robots.txt": { status: 404 }, "https://x.example/feed": () => (++n < 3 ? { status: 502 } : { body: "ok" }) });
    const http = createHttpClient({ fetcher: flaky.fetcher, sleep: noSleep });
    const res = await http.get("https://x.example/feed");
    expect(res.attempts).toBe(3);
    const missing = fakeFetch({ "https://x.example/robots.txt": { status: 404 }, "https://x.example/gone": { status: 404 } });
    await expect(createHttpClient({ fetcher: missing.fetcher, sleep: noSleep }).get("https://x.example/gone")).rejects.toMatchObject({ status: 404, attempts: 1 });
    expect(missing.calls.filter(c => c.endsWith("/gone"))).toHaveLength(1);
  });

  it("reads UTF-8 even when a feed claims Latin-1", () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><t>Jørgen</t>');
    expect(decodeBody(bytes.buffer as ArrayBuffer, null)).toContain("Jørgen");
    const latin1 = new Uint8Array([0x4a, 0xf8, 0x72, 0x67, 0x65, 0x6e]);
    expect(decodeBody(latin1.buffer, "text/xml; charset=ISO-8859-1")).toBe("Jørgen");
  });
});

describe("iCalendar", () => {
  it("keeps a weekly class at 19:00 local time across the change to winter time", () => {
    const start = parseDate({ name: "DTSTART", params: { TZID: "Europe/Copenhagen" }, value: "20261014T190000" }, TIMEZONE)!;
    const { starts } = expandRule("FREQ=WEEKLY;COUNT=4", start, 0, Date.parse("2027-01-01"));
    expect(starts.map(ms => new Date(ms).toISOString())).toEqual(["2026-10-14T17:00:00.000Z", "2026-10-21T17:00:00.000Z", "2026-10-28T18:00:00.000Z", "2026-11-04T18:00:00.000Z"]);
  });

  it("expands BYDAY, monthly rules and exceptions", () => {
    const start = parseDate({ name: "DTSTART", params: {}, value: "20261005T080000Z" }, TIMEZONE)!;
    const twice = expandRule("FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261016T235959Z", start, 0, Date.parse("2027-01-01")).starts;
    expect(twice.map(ms => new Date(ms).toISOString().slice(0, 10))).toEqual(["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
    const firstSaturday = parseDate({ name: "DTSTART", params: { TZID: "Europe/Copenhagen" }, value: "20261003T100000" }, TIMEZONE)!;
    const monthly = expandRule("FREQ=MONTHLY;BYDAY=1SA;COUNT=3", firstSaturday, 0, Date.parse("2027-06-01")).starts;
    expect(monthly.map(ms => new Date(ms).toISOString().slice(0, 10))).toEqual(["2026-10-03", "2026-11-07", "2026-12-05"]);
  });

  it("reads a feed: zones, all-day events, cancellations, moved occurrences, folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "UID:w1", "DTSTART;TZID=Europe/Copenhagen:20261014T190000", "DURATION:PT1H30M", "RRULE:FREQ=WEEKLY;COUNT=3",
      "EXDATE;TZID=Europe/Copenhagen:20261021T190000", "SUMMARY:Ecstatic dance", "LOCATION:Dansens Hus\\, Vestergade 1\\, 8000 Aarhus C", "END:VEVENT",
      "BEGIN:VEVENT", "UID:w1", "RECURRENCE-ID;TZID=Europe/Copenhagen:20261028T190000", "DTSTART;TZID=Europe/Copenhagen:20261028T200000",
      "DTEND;TZID=Europe/Copenhagen:20261028T213000", "SUMMARY:Ecstatic dance (senere)", "END:VEVENT",
      "BEGIN:VEVENT", "UID:r1", "DTSTART;VALUE=DATE:20261106", "DTEND;VALUE=DATE:20261109", "SUMMARY:Stilhedsretræte", "STATUS:CANCELLED",
      "DESCRIPTION:Tre dage i stilhed.\\nPris: 2.400 kr.", "LOCATION:Mols", "BEGIN:VALARM", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT",
      "BEGIN:VEVENT", "UID:f1", "DTSTART:20261020T170000Z", "SUMMARY:En meget lang titel der er foldet over", " flere linjer", "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const { events } = eventsFromCalendar(ics, config(), Date.parse("2026-10-10T00:00:00Z"));
    const dance = events.filter(e => e.title.startsWith("Ecstatic"));
    expect(dance.map(e => [new Date(e.startsAt).toISOString(), e.title])).toEqual([
      ["2026-10-14T17:00:00.000Z", "Ecstatic dance"],
      ["2026-10-28T19:00:00.000Z", "Ecstatic dance (senere)"]
    ]);
    expect(dance[0]).toMatchObject({ endsAt: Date.parse("2026-10-14T18:30:00Z"), postalCode: "8000", city: "Aarhus C", address: "Vestergade 1", venueName: "Dansens Hus" });
    const retreat = events.find(e => e.title === "Stilhedsretræte")!;
    expect(retreat).toMatchObject({ allDay: true, cancelled: true, startsAt: Date.parse("2026-11-05T23:00:00Z") });
    expect(retreat.price?.minMinor).toBe(240000);
    expect(events.find(e => e.sourceEventId === "f1")?.title).toBe("En meget lang titel der er foldet overflere linjer");
  });

  it("splits a Danish address line", () => {
    expect(splitLocation("Studio Ro, Vestergade 3, 8600 Silkeborg")).toEqual({ name: "Studio Ro", address: "Vestergade 3", postalCode: "8600", city: "Silkeborg" });
  });
});

describe("schema.org and Billetto", () => {
  it("reads Event objects from a page", () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"Event","name":"Lecture/Meditation event","startDate":"2026-10-21T19:30","location":{"@type":"Place","name":"Buddhistisk Center","address":{"@type":"PostalAddress","streetAddress":"P. Skramsgade 52B","postalCode":"8200","addressLocality":"Aarhus N"}},"offers":{"price":"0","priceCurrency":"DKK"}}]}</script>`;
    const found = findEvents(extractJsonLd(page));
    expect(found).toHaveLength(1);
    const e = eventFromSchema(found[0]!, config({ adapter: "jsonld" }), "https://example.org/")!;
    expect(new Date(e.startsAt).toISOString()).toBe("2026-10-21T17:30:00.000Z");
    expect(e).toMatchObject({ postalCode: "8200", city: "Aarhus N", price: { isFree: true } });
  });

  it("keeps Billetto's own link and only an excerpt", () => {
    const billetto = SOURCES.find(s => s.id === "billetto")!;
    const e = eventFromBilletto({
      id: "123", title: "Yin yoga & lydbad", description: "<p>" + "Lang tekst. ".repeat(60) + "</p>",
      url: "https://billetto.dk/e/yin-123?utm_source=Billetto+Advertising", image_link: "https://billetto.imgix.net/1",
      minimum_price: { amount: "150.0", currency: "DKK" }, location: { location_name: "Studio, 8000 Aarhus", postal_code: "8000", city: "Aarhus" },
      startdate: "2026-10-20T17:00:00Z", enddate: "2026-10-20T19:00:00Z"
    }, billetto)!;
    expect(e.sourceUrl).toBe("https://billetto.dk/e/yin-123?utm_source=Billetto+Advertising");
    expect(e.paragraphs.join(" ").length).toBeLessThan(320);
    expect(e.imageUrl).toBeNull();
    expect(e.price).toMatchObject({ minMinor: 15000 });
    expect(billetto.enabled({})).toBe(false);
    expect(billetto.enabled({ BILLETTO_API_KEYPAIR: "id:secret" })).toBe(true);
  });
});
