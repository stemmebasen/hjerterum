import { describe, expect, it } from "vitest";
import { isoWeek, parseProgramme, resolveDate } from "../src/sources/lysetshus.js";
import { SOURCES } from "../src/sources/registry.js";
import { runIngest } from "../src/ingest/run.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const config = SOURCES.find(s => s.id === "lysetshus")!;
const iso = (ms: number) => new Date(ms).toISOString();

describe("Lysets Hus' programme", () => {
  it("finds the year from the weekday, and refuses a date whose weekday fits no year near now", () => {
    expect(resolveDate("Onsdag", 14, 10, NOW)).toBe("2026-10-14");
    expect(resolveDate("Onsdag", 6, 1, NOW)).toBe("2027-01-06");
    expect(resolveDate("Fredag", 14, 10, NOW)).toBeNull();
    expect(isoWeek("2026-10-07")).toBe(41);
    expect(isoWeek("2027-01-01")).toBe(53);
  });

  it("reads the dated evenings and the free evenings from the real page", () => {
    const { events, unreadable } = parseProgramme(fixture("lysetshus.html"), config, NOW);
    expect(unreadable).toBe(0);
    const lectures = events.filter(e => e.price && !e.price.isFree);
    const free = events.filter(e => e.price?.isFree);
    expect(lectures).toHaveLength(9);
    expect(free).toHaveLength(9);

    const palm = lectures.find(e => e.title.includes("Håndlæsning"))!;
    expect(palm).toMatchObject({
      sourceEventId: "billetto-1933517", hostName: "Karlinna J. V. Frederiksen", venueName: "Lysets Hus", address: "Posthussmøgen 11C", postalCode: "8000",
      signupUrl: "https://billetto.dk/e/foredrag-handlaesning-kiromantien-som-redskab-til-selvindsigt-og-kommunikation-karlinna-j-v-frederiksen-billetter-1933517",
      price: { minMinor: 15000, isFree: false }
    });
    expect(iso(palm.startsAt)).toBe("2026-10-14T17:00:00.000Z");
    expect(palm.paragraphs.join(" ")).toContain("kiromantien");
    expect(palm.paragraphs.join(" ")).not.toContain("billetto.dk/e/");

    // "Klarsyn" alone gets the speaker in its title; "18.11.kl. 19" is read too.
    expect(lectures.find(e => e.sourceEventId === "billetto-1933511")?.title).toBe("Klarsyn med Bettina Thomsen");
    expect(iso(lectures.find(e => e.title.startsWith("Foredrag: Healing"))!.startsAt)).toBe("2026-11-18T18:00:00.000Z");

    const meditation = free.find(e => e.startsAt === Date.parse("2026-10-14T15:30:00Z"))!;
    expect(meditation).toMatchObject({ title: "Gratis healings meditation", hostName: "Mads Jensen" });
    expect(iso(meditation.endsAt!)).toBe("2026-10-14T16:30:00.000Z");
    const treatment = free.find(e => e.startsAt === Date.parse("2026-10-07T15:30:00Z"))!;
    expect(treatment.title).toBe("Gratis alternativ prøvebehandling");
    expect(iso(treatment.endsAt!)).toBe("2026-10-07T16:45:00.000Z");
  });

  it("is collected into the portal, in Aarhus, with spiritual categories", async () => {
    const db = testDb();
    const { fetcher } = fakeFetch({ "https://lysetshus.dk/robots.txt": { body: "User-agent: *\nDisallow: /wp-admin/\n" }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") } });
    const out = await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: [config] });
    // The 7 October evening is over; 8 lectures and 8 free evenings remain.
    expect(out.sources[0]).toMatchObject({ status: "ok", created: 16, rejected: 0 });
    const rows = db.raw.prepare("SELECT e.title, e.area, e.description, e.image_url, group_concat(c.category) AS cats FROM events e LEFT JOIN event_categories c ON c.event_id = e.id GROUP BY e.id").all() as Array<Record<string, string | null>>;
    expect(rows.every(r => r.area === "aarhus" && r.image_url === null)).toBe(true);
    expect(rows.find(r => r.title === "Klarsyn med Karina Graabæk")?.cats).toContain("spiritualitet-bevidsthed");
    // Until Lysets Hus has agreed, only an excerpt of its text is stored.
    expect(Math.max(...rows.map(r => (r.description ?? "").length))).toBeLessThan(400);
  });
});
