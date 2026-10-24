import { describe, expect, it } from "vitest";
import { runIngest, scheduledRun, DAILY_CRON, ingestStatus } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import type { SourceConfig } from "../src/sources/types.js";
import { TIMEZONE } from "../src/time.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hjerterum = SOURCES.filter(s => s.id === "hjerterum");
const DETAIL = JSON.stringify({ ttl: "Deep Shamanic Healing Journey", adn: "Hjerterum", adr: { ad1: "Guldsmedgade 26", con: "DK", zip: "8000", cit: "Aarhus", loc: ["10.2078481", "56.1593182"] } });

function routes(feed: string) {
  return {
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS },
    [FEED_URL]: { body: feed, headers: { "content-type": "application/rss+xml" } },
    "https://api.membershipworks.com/v2/event?eid=6a572ab06960ef7bf40e3978": { body: DETAIL, headers: { "content-type": "application/json" } },
    "https://lysetshus.dk/robots.txt": { status: 404 },
    "https://lysetshus.dk/": { body: fixture("lysetshus.html") },
    "https://brahmakumaris.dk/robots.txt": { status: 404 },
    "https://brahmakumaris.dk/events/feed/": { body: fixture("brahmakumaris-events.xml") },
    "https://buddha.dk/robots.txt": { status: 404 },
    "https://buddha.dk/": { body: fixture("buddha-dk.html") },
    "https://mindfulness.au.dk/robots.txt": { status: 404 },
    "https://mindfulness.au.dk/aktuelt/arrangementer/element/123480/rss.xml": { body: fixture("dcm-arrangementer.xml") },
    "https://vaekstcenteret.dk/robots.txt": { status: 404 },
    "https://vaekstcenteret.dk/kurser/": { body: fixture("vaekstcenteret-kurser.html") },
    "https://vaekstcenteret.dk/kursus/": { body: fixture("vaekstcenteret-meditationsdage.html") },
    "https://favnaarhus.dk/robots.txt": { status: 404 },
    "https://favnaarhus.dk/workshop-kalender-aarhus/": { body: fixture("favn-workshops.html") },
    "https://zr3nrpl4.apicdn.sanity.io/robots.txt": { status: 404 },
    "https://zr3nrpl4.apicdn.sanity.io/v2021-10-21/data/query/production": { body: fixture("train-sanity.json"), headers: { "content-type": "application/json" } },
    "https://www.musikhuset.dk/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://www.musikhuset.dk/api/v2/events/showings": { body: fixture("musikhuset-showings.json"), headers: { "content-type": "application/json" } },
    "https://www.musikhuset.dk/api/v2/events": { body: fixture("musikhuset-events.json"), headers: { "content-type": "application/json" } },
    "https://www.aakb.dk/robots.txt": { body: "User-agent: *\nCrawl-delay: 10\n" },
    "https://www.aakb.dk/api/v1/events/happening": { body: fixture("aakb-events.json"), headers: { "content-type": "application/json" } },
    "https://resonansbistro.dk/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://resonansbistro.dk/public/events/upcoming": { body: fixture("resonans-events.json"), headers: { "content-type": "application/json" } },
    "https://folkestedet.aarhus.dk/robots.txt": { status: 404 },
    "https://folkestedet.aarhus.dk/kalender": { body: fixture("folkestedet-kalender.html") },
    "https://godsbanen.dk/robots.txt": { body: "User-agent: *\nDisallow:\n" },
    "https://godsbanen.dk/kalender/": { body: fixture("godsbanen-kalender.html") },
    "https://voxhall.dk/robots.txt": { body: "User-agent: *\nDisallow: /wp-admin/\n" },
    "https://voxhall.dk/koncerter/": { body: fixture("voxhall-koncerter.html") },
    "https://voxhall.dk/wp-json/wp/v2/voxhall-event": { body: fixture("voxhall-events.json"), headers: { "content-type": "application/json" } }
  };
}

type Row = Record<string, unknown>;
const rows = (db: ReturnType<typeof testDb>, sql: string, ...params: unknown[]) => db.raw.prepare(sql).all(...params) as Row[];

describe("collecting Hjerterum's calendar", () => {
  it("creates the events with place, area, categories, price and links", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch(routes(fixture("hjerterum-rss.xml")));
    const outcome = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: hjerterum });
    expect(outcome.status).toBe("ok");
    expect(outcome.sources[0]).toMatchObject({ id: "hjerterum", status: "ok", fetched: 7, created: 7, duplicates: 0, rejected: 0 });

    const deep = rows(db, "SELECT * FROM events WHERE title = 'Deep Shamanic Healing Journey'")[0]!;
    expect(deep).toMatchObject({
      venue_name: "Hjerterum", address: "Guldsmedgade 26B", postal_code: "8000", city: "Aarhus C", area: "aarhus", region: "ostjylland",
      host_name: "Lisa Mai Toft", price_min_minor: 10000, price_max_minor: 20000, status: "scheduled", timezone: TIMEZONE,
      signup_url: "https://hjerterum.info/events/6a572ab06960ef7bf40e3978", organizer_id: "hjerterum"
    });
    expect(new Date(deep.starts_at as number).toISOString()).toBe("2026-10-11T13:30:00.000Z");
    expect(new Date(deep.ends_at as number).toISOString()).toBe("2026-10-11T16:00:00.000Z");
    expect(String(deep.image_url)).toMatch(/^https:\/\/d1tif55lvfk8gc\.cloudfront\.net\//);
    expect(String(deep.description)).toContain("trommerejsens unikke univers");
    expect(String(deep.description)).not.toMatch(/<p>|&aring;/);
    expect(rows(db, "SELECT category FROM event_categories WHERE event_id = ? ORDER BY rank", deep.id).map(r => r.category)).toContain("spiritualitet-bevidsthed");

    const breath = rows(db, "SELECT e.id, e.title FROM events e WHERE title LIKE '%Breathwork Journey%'")[0]!;
    expect(String(breath.title)).toContain("Jørgen Arvid");
    expect(rows(db, "SELECT category FROM event_categories WHERE event_id = ?", breath.id).map(r => r.category)).toContain("aandedraet-breathwork");

    const partner = rows(db, "SELECT * FROM events WHERE venue_name = 'Hjerteland'")[0]!;
    expect(partner).toMatchObject({ postal_code: "8200", area: "aarhus", organizer_id: "hjerteland" });
    expect(rows(db, "SELECT kind FROM event_changes").every(r => r.kind === "created")).toBe(true);
  });

  it("changes nothing but the check time when the same data is collected again", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch(routes(fixture("hjerterum-rss.xml")));
    await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: hjerterum });
    const second = await runIngest({ DB: db }, { trigger: "test", now: NOW + 86400_000, fetcher, sleep: noSleep, sources: hjerterum });
    expect(second.sources[0]).toMatchObject({ created: 0, updated: 0, unchanged: 7, duplicates: 0 });
    expect(rows(db, "SELECT COUNT(*) AS n FROM events")[0]!.n).toBe(7);
    expect(rows(db, "SELECT COUNT(*) AS n FROM event_changes")[0]!.n).toBe(7);
    expect(rows(db, "SELECT COUNT(*) AS n FROM events WHERE last_checked_at = ?", NOW + 86400_000)[0]!.n).toBe(7);
  });

  it("updates a moved event and records a cancellation", async () => {
    const db = testDb();
    const feed = fixture("hjerterum-rss.xml");
    await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher: fakeFetch(routes(feed)).fetcher, sleep: noSleep, sources: hjerterum });
    const changed = feed
      .replace("<ev:startdate>2026-10-11T15:30:00+02:00", "<ev:startdate>2026-10-18T15:30:00+02:00")
      .replace("<ev:enddate>2026-10-11T18:00:00+02:00", "<ev:enddate>2026-10-18T18:00:00+02:00")
      .replace("<title>Dhyana Yoga</title>", "<title>AFLYST: Dhyana Yoga</title>");
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW + 3600_000, fetcher: fakeFetch(routes(changed)).fetcher, sleep: noSleep, sources: hjerterum });
    expect(out.sources[0]).toMatchObject({ created: 0, updated: 2, unchanged: 5 });
    const deep = rows(db, "SELECT * FROM events WHERE title = 'Deep Shamanic Healing Journey'")[0]!;
    expect(new Date(deep.starts_at as number).toISOString()).toBe("2026-10-18T13:30:00.000Z");
    const yoga = rows(db, "SELECT * FROM events WHERE title = 'Dhyana Yoga'")[0]!;
    expect(yoga.status).toBe("cancelled");
    const kinds = rows(db, "SELECT kind FROM event_changes WHERE kind != 'created' ORDER BY kind").map(r => r.kind);
    expect(kinds).toEqual(["cancelled", "rescheduled"]);
  });

  it("withdraws an event that disappears from the listing for two runs, and brings it back if it returns", async () => {
    const db = testDb();
    const feed = fixture("hjerterum-rss.xml");
    const run = (xml: string, at: number) => runIngest({ DB: db }, { trigger: "test", now: at, fetcher: fakeFetch(routes(xml)).fetcher, sleep: noSleep, sources: hjerterum });
    await run(feed, NOW);
    const without = feed.replace(/<item>(?:(?!<\/item>)[\s\S])*Dhyana Yoga[\s\S]*?<\/item>/, "");
    expect(without).not.toContain("Dhyana Yoga");
    await run(without, NOW + 3600_000);
    expect(rows(db, "SELECT status FROM events WHERE title = 'Dhyana Yoga'")[0]!.status).toBe("scheduled");
    const second = await run(without, NOW + 7200_000);
    expect(second.sources[0]!.withdrawn).toBe(1);
    expect(rows(db, "SELECT status FROM events WHERE title = 'Dhyana Yoga'")[0]!.status).toBe("withdrawn");
    await run(feed, NOW + 3 * 3600_000);
    expect(rows(db, "SELECT status FROM events WHERE title = 'Dhyana Yoga'")[0]!.status).toBe("scheduled");
    expect(rows(db, "SELECT kind FROM event_changes WHERE kind IN ('withdrawn', 'reappeared') ORDER BY id").map(r => r.kind)).toEqual(["withdrawn", "reappeared"]);
  });

  it("retires ended events", async () => {
    const db = testDb();
    const first = await runIngest({ DB: db }, { trigger: "test", now: Date.parse("2026-10-11T10:00:00Z"), fetcher: fakeFetch(routes(fixture("hjerterum-rss.xml"))).fetcher, sleep: noSleep, requestBudget: 1000 });
    expect(first.deferred).toEqual([]);
    // Every source was collected 14 hours ago: the hourly cron only retires ended events.
    const later = Date.parse("2026-10-12T00:00:00Z");
    const out = await scheduledRun({ DB: db }, "47 * * * *", { now: later, fetcher: fakeFetch({}).fetcher, sleep: noSleep });
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("nothing_due");
    expect(rows(db, "SELECT status FROM events WHERE title = 'Deep Shamanic Healing Journey'")[0]!.status).toBe("past");
    expect(rows(db, "SELECT status FROM events WHERE title = 'Dhyana Yoga'")[0]!.status).toBe("scheduled");
  });

  it("looks up details for at most a budget of events per run and catches up on the rest in later runs", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch(routes(fixture("hjerterum-rss.xml")));
    const run = (at: number) => runIngest({ DB: db }, { trigger: "test", now: at, fetcher, sleep: noSleep, sources: hjerterum, enrichBudget: 3 });
    expect((await run(NOW)).sources[0]).toMatchObject({ created: 7, enriched: 3 });
    expect((await run(NOW + 60_000)).sources[0]).toMatchObject({ created: 0, updated: 0, unchanged: 7, enriched: 3 });
    expect((await run(NOW + 120_000)).sources[0]).toMatchObject({ unchanged: 7, enriched: 1 });
    expect((await run(NOW + 180_000)).sources[0]).toMatchObject({ unchanged: 7, enriched: 0 });
    expect(calls.filter(c => c.includes("/v2/event?eid="))).toHaveLength(7);
    // Looking up details is not a change in the event's history.
    expect(rows(db, "SELECT kind, COUNT(*) AS n FROM event_changes GROUP BY kind")).toEqual([{ kind: "created", n: 7 }]);
  });

  it("logs a failing source after retrying, without stopping the run, and reports it in the status", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { status: 503, body: "down" } });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: hjerterum });
    expect(out.status).toBe("failed");
    expect(out.sources[0]).toMatchObject({ status: "failed", error: "http_503 after 3 attempt(s)" });
    expect(calls.filter(c => c === FEED_URL)).toHaveLength(3);
    const status = await ingestStatus(db, NOW);
    expect(status.healthy).toBe(false);
    expect(status.lastRun?.status).toBe("failed");
    expect(status.sources[0]).toMatchObject({ id: "hjerterum", status: "failed" });
    // The hourly cron collects it again (a failed source is retried after three hours).
    const retry = await scheduledRun({ DB: db }, "47 * * * *", { now: NOW + 6 * 3600_000, fetcher: fakeFetch(routes(fixture("hjerterum-rss.xml"))).fetcher, sleep: noSleep });
    expect(retry.status).toBe("ok");
    expect((await ingestStatus(db, NOW + 6 * 3600_000)).healthy).toBe(true);
  });

  it("does not read a source whose robots.txt forbids it", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") } });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: hjerterum });
    expect(out.sources[0]).toMatchObject({ status: "failed", error: "robots_disallowed" });
    expect(calls).not.toContain(FEED_URL);
  });

  it("skips a run while another one is going", async () => {
    const db = testDb();
    db.raw.prepare("INSERT INTO ingest_runs (id, trigger, started_at, status) VALUES ('r1', 'test', ?, 'running')").run(NOW - 60_000);
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher: fakeFetch({}).fetcher, sleep: noSleep, sources: hjerterum });
    expect(out).toMatchObject({ status: "skipped", reason: "already_running" });
  });

  it("a run stays within its request budget: sources take turns, stalest first, and wait instead of failing", async () => {
    const db = testDb();
    const { fetcher, calls } = fakeFetch(routes(fixture("hjerterum-rss.xml")));
    const run = (at: number, requestBudget: number) => scheduledRun({ DB: db, INGEST_REQUEST_BUDGET: String(requestBudget) }, "47 * * * *", { now: at, fetcher, sleep: noSleep });
    const first = await run(NOW, 20);
    expect(calls.length).toBeLessThanOrEqual(20);
    expect(first.status).toBe("ok");
    expect(first.sources.filter(s => s.status === "failed")).toEqual([]);
    const done = first.sources.filter(s => s.status === "ok").map(s => s.id);
    expect(done.length).toBeGreaterThan(1);
    expect(first.deferred.length).toBeGreaterThan(1);
    expect(first.deferred).not.toContain("billetto");
    // The next runs take the deferred sources, not the ones just collected, until every source has had its turn.
    let seen = new Set(done);
    for (let i = 1; i <= 10 && seen.size < SOURCES.filter(s => s.id !== "billetto").length; i++) {
      const before = calls.length;
      const next = await run(NOW + i * 3600_000, 20);
      expect(calls.length - before).toBeLessThanOrEqual(20);
      expect(next.sources.filter(s => s.status === "ok").some(s => seen.has(s.id))).toBe(false);
      for (const s of next.sources) if (s.status === "ok") seen.add(s.id);
    }
    expect(seen.size).toBe(SOURCES.filter(s => s.id !== "billetto").length);
    const status = await ingestStatus(db, NOW + 11 * 3600_000);
    expect(status.sources.filter(s => s.id !== "billetto").every(s => s.status === "ok")).toBe(true);
    expect((await run(NOW + 12 * 3600_000, 20)).reason).toBe("nothing_due");
    // A day later the first batch is due again.
    expect((await run(NOW + 21 * 3600_000, 20)).sources.filter(s => s.status === "ok").map(s => s.id)).toEqual(done);
  });

  it("detail lookups stop at the budget and are stored as not yet checked; a source that needs more than the whole budget fails", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch(routes(fixture("hjerterum-rss.xml")));
    const godsbanen = SOURCES.filter(s => s.id === "godsbanen");
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: godsbanen, requestBudget: 7 });
    expect(out.sources[0]).toMatchObject({ status: "ok", enriched: 3 });
    expect(rows(db, "SELECT COUNT(*) AS n FROM event_sources WHERE source_id = 'godsbanen' AND content_hash LIKE 'pending:%'")[0]!.n).toBeGreaterThan(0);
    const tight = await runIngest({ DB: testDb() }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === "voxhall"), requestBudget: 2 });
    expect(tight.sources[0]).toMatchObject({ status: "failed", error: "request_budget_exceeded (2)" });
  });

  it("the daily cron collects what is due; a disabled source is logged as skipped", async () => {
    const db = testDb();
    const out = await scheduledRun({ DB: db, INGEST_REQUEST_BUDGET: "1000" }, DAILY_CRON, { now: NOW, fetcher: fakeFetch(routes(fixture("hjerterum-rss.xml"))).fetcher, sleep: noSleep });
    expect(out.status).toBe("ok");
    expect(out.sources.find(s => s.id === "billetto")).toMatchObject({ status: "skipped", error: "disabled" });
    expect(out.sources.find(s => s.id === "hjerterum")).toMatchObject({ status: "ok", created: 7 });
  });
});

describe("the same event from two sources", () => {
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:abc-1@example.org", "DTSTART;TZID=Europe/Copenhagen:20261011T153000", "DTEND;TZID=Europe/Copenhagen:20261011T180000",
    "SUMMARY:Deep Shamanic Healing Journey", "LOCATION:Hjerterum\\, Guldsmedgade 26B\\, 8000 Aarhus C", "URL:https://example.org/deep", "END:VEVENT",
    "BEGIN:VEVENT", "UID:abc-2@example.org", "DTSTART;TZID=Europe/Copenhagen:20261014T190000", "DTEND;TZID=Europe/Copenhagen:20261014T210000",
    "SUMMARY:Kakaoceremoni og lydbad", "LOCATION:Studio Ro\\, Vestergade 3\\, 8600 Silkeborg", "DESCRIPTION:Pris: 250 kr.", "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  const calendar: SourceConfig = {
    id: "test-ical", name: "Testkalender", adapter: "ical", homepageUrl: "https://example.org", permissionBasis: "test", attribution: "Testkalender",
    imagePolicy: "none", descriptionPolicy: "full", priority: 30, requireRelevance: false, completeListing: true, canonicalToSource: false, respectRobots: true,
    enabled: () => true, defaults: { timezone: TIMEZONE, organizerName: "Testarrangør", organizerUrl: null, venues: [] }, options: { url: "https://example.org/cal.ics" }
  };

  it("merges it into the event that is already there and keeps the leading source's details", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({ ...routes(fixture("hjerterum-rss.xml")), "https://example.org/robots.txt": { status: 404 }, "https://example.org/cal.ics": { body: ics } });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [...hjerterum, calendar] });
    expect(out.sources.find(s => s.id === "test-ical")).toMatchObject({ status: "ok", created: 1, duplicates: 1 });
    const deep = rows(db, "SELECT * FROM events WHERE title = 'Deep Shamanic Healing Journey'");
    expect(deep).toHaveLength(1);
    expect(deep[0]!.primary_source_id).toBe("hjerterum");
    expect(rows(db, "SELECT source_id FROM event_sources WHERE event_id = ? ORDER BY source_id", deep[0]!.id).map(r => r.source_id)).toEqual(["hjerterum", "test-ical"]);
    const kakao = rows(db, "SELECT * FROM events WHERE title = 'Kakaoceremoni og lydbad'")[0]!;
    expect(kakao).toMatchObject({ area: "silkeborg", city: "Silkeborg", postal_code: "8600", address: "Vestergade 3", venue_name: "Studio Ro", price_min_minor: 25000 });
    expect(new Date(kakao.starts_at as number).toISOString()).toBe("2026-10-14T17:00:00.000Z");

    // Running both again creates nothing new.
    const again = await runIngest({ DB: db }, { trigger: "test", now: NOW + 3600_000, fetcher, sleep: noSleep, sources: [...hjerterum, calendar] });
    expect(again.sources.map(s => s.created)).toEqual([0, 0]);
    expect(rows(db, "SELECT COUNT(*) AS n FROM events")[0]!.n).toBe(8);
  });
});
