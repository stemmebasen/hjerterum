import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { isAlternativeEvent } from "../src/mainstream.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Saturday 24 October 2026: the coming week has Dokk1's library events next to Hjerterum's and Lysets Hus' evenings.
const NOW = Date.parse("2026-10-24T10:00:00Z");
const env = (): Env => ({ DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" });
const text = async (path: string) => (await handle(new Request(`https://portal.example${path}`), env(), NOW)).text();
const titlesOf = (source: string) => (db.raw.prepare("SELECT title FROM events WHERE primary_source_id = ? AND status = 'scheduled'").all(source) as Array<{ title: string }>).map(r => r.title);
let db: ReturnType<typeof testDb>;

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") },
    "https://www.aakb.dk/robots.txt": { body: "User-agent: *\nCrawl-delay: 10\n" },
    "https://www.aakb.dk/api/v1/events/happening": { body: fixture("aakb-events.json"), headers: { "content-type": "application/json" } }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus", "dokk1"].includes(s.id)) });
});

describe("a broad, mainstream selection (Jake 2026-11-10)", () => {
  it("tells spiritual and alternative events from the broad offer", () => {
    expect(isAlternativeEvent({ primary_source_id: "lysetshus", organizer_id: "lysets-hus", categories: "foredrag-debat" })).toBe(true);
    expect(isAlternativeEvent({ primary_source_id: "dokk1", organizer_id: "dokk1", categories: "foredrag-debat,boern-familie" })).toBe(false);
    expect(isAlternativeEvent({ primary_source_id: "dokk1", organizer_id: "dokk1", categories: "foredrag-debat,spiritualitet-bevidsthed" })).toBe(true);
    expect(isAlternativeEvent({ primary_source_id: "faste-tilbud", organizer_id: "brahma-kumaris-aarhus", categories: null })).toBe(true);
    expect(isAlternativeEvent({ primary_source_id: "folkestedet", organizer_id: "folkestedet", categories: "yoga" })).toBe(false);
  });

  it("the front page's suggestions, free events and week list show the broad offer, the calendar everything", async () => {
    const alternative = [...titlesOf("hjerterum"), ...titlesOf("lysetshus")];
    expect(alternative.length).toBeGreaterThan(0);
    const front = await text("/");
    const stack = /class="ticket-stack"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(front)?.[0] ?? front;
    for (const t of alternative) expect(front).not.toContain(`<span class="row-title">${t.replace(/&/g, "&amp;")}</span>`);
    expect(alternative.filter(t => stack.includes(t))).toEqual([]);
    expect(titlesOf("dokk1").some(t => front.includes(t.replace(/&/g, "&amp;")))).toBe(true);
    // Everything is still in the calendar.
    const calendar = await text("/kalender?periode=maaned");
    expect(alternative.some(t => calendar.includes(t.replace(/&/g, "&amp;")))).toBe(true);
  });

  it("the interest list puts the broad offer first", async () => {
    const body = await text("/kom-godt-i-gang");
    const listed = [...body.matchAll(/name="event" value="([^"]+)"/g)].map(m => m[1]!);
    const kinds = listed.map(slug => (db.raw.prepare("SELECT primary_source_id s FROM events WHERE slug = ?").all(slug)[0] as { s: string }).s);
    expect(kinds.length).toBeGreaterThan(0);
    const firstAlternative = kinds.findIndex(k => k !== "dokk1");
    const lastBroad = kinds.lastIndexOf("dokk1");
    expect(lastBroad).toBeGreaterThanOrEqual(0);
    if (firstAlternative >= 0) expect(firstAlternative).toBeGreaterThan(lastBroad);
  });

  it("menus and /kategorier lead with concerts, theatre and talks; spiritual topics are one click further", async () => {
    const page = await text("/kategorier");
    expect(page).toContain("Koncerter, teater og comedy, foredrag, quiz, udstillinger, dans og meget mere.");
    expect(page.indexOf('href="/koncerter"')).toBeLessThan(page.indexOf('href="/spiritualitet"'));
    expect(page).toContain("Ro og fordybelse");
    expect(page).not.toMatch(/klarsyn, soundbath, kakaoceremonier/);
    const today = await text("/i-dag");
    expect(today).toContain("Koncerter, teater, foredrag, udstillinger og fællesskaber i dag");
  });
});
