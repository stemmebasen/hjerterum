import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Saturday 10 October 2026, 14:00 in Aarhus.
const NOW = Date.parse("2026-10-10T12:00:00Z");
let env: Env;

beforeAll(async () => {
  const db = testDb();
  const { fetcher } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") } });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === "hjerterum") });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland" };
});

const get = (path: string, e: Env = env) => handle(new Request(`https://portal.example${path}`), e, NOW);
const text = async (path: string, e?: Env) => { const r = await get(path, e); return { status: r.status, body: await r.text(), headers: r.headers }; };
const titles = (body: string) => [...body.matchAll(/<h3 class="card-title">([^<]+)<\/h3>/g)].map(m => m[1]);
const count = (body: string) => Number(/<h2 id="h-results"[^>]*>(\d+) events?<\/h2>/.exec(body)?.[1] ?? NaN);

describe("the portal's pages", () => {
  it("front page: introduction, search, upcoming events, areas and categories", async () => {
    const { status, body } = await text("/");
    expect(status).toBe(200);
    expect(body).toContain("<h1>Find ro, nærvær og fællesskab – tæt på dig</h1>");
    expect(body).toContain('action="/events"');
    expect(titles(body).length).toBeGreaterThan(3);
    expect(body).toContain('href="/omraade/aarhus"');
    expect(body).toContain('href="/kategori/aandedraet-breathwork"');
    expect(body).toContain("Se alle 7 kommende events");
  });

  it("lists every upcoming event, soonest first", async () => {
    const { body } = await text("/events");
    expect(count(body)).toBe(7);
    expect(titles(body)[0]).toBe("Deep Shamanic Healing Journey");
  });

  it("filters by words, category, date, area, town and price - and combinations", async () => {
    // Words in the text and in the category names both count ("Åndedræt og breathwork").
    expect(titles((await text("/events?q=breathwork")).body)).toEqual(["Din Indre Natur - Breathwork Journey med Jørgen Arvid", "Dhyana Yoga", "Source Breathwork (Rebirthing) with Douglas Crawford"]);
    expect(count((await text("/events?q=lisa+toft")).body)).toBe(1);
    expect(titles((await text("/events?kategori=yoga")).body)).toEqual(["Dhyana Yoga"]);
    expect(count((await text("/events?kategori=yoga&kategori=aandedraet-breathwork")).body)).toBe(3);
    expect(count((await text("/events?fra=2026-10-13&til=2026-10-13")).body)).toBe(3);
    expect(count((await text("/events?periode=idag")).body)).toBe(0);
    // The weekend from Saturday 10 October is the 10th and the 11th.
    expect(titles((await text("/events?periode=weekend")).body)).toEqual(["Deep Shamanic Healing Journey"]);
    expect(count((await text("/events?omraade=aarhus")).body)).toBe(7);
    expect(count((await text("/events?omraade=randers")).body)).toBe(0);
    expect(titles((await text("/events?by=Lisbjerg")).body)).toEqual(["You Can Sing! / Aarhus"]);
    expect(count((await text("/events?pris=under-200")).body)).toBeGreaterThan(0);
    expect(titles((await text("/events?q=breathwork&fra=2026-10-13")).body)).toEqual(["Dhyana Yoga", "Source Breathwork (Rebirthing) with Douglas Crawford"]);
  });

  it("ignores unknown or hostile filter values instead of echoing them", async () => {
    const { status, body } = await text("/events?kategori=%3Cscript%3E&omraade=mars&fra=2026-13-45&pris=dyrt&q=%3Cimg%20src%3Dx%3E");
    expect(status).toBe(200);
    expect(body).not.toContain("<img src=x>");
    expect(body).toContain("&lt;img src=x&gt;");
    expect(body).not.toContain("<script>");
  });

  it("a search with a LIKE wildcard is taken literally", async () => {
    expect(count((await text("/events?q=%25%25")).body)).toBe(0);
  });

  it("category and area landing pages", async () => {
    const yoga = await text("/kategori/yoga");
    expect(yoga.status).toBe(200);
    expect(yoga.body).toContain("<h1>Yoga</h1>");
    expect(titles(yoga.body)).toEqual(["Dhyana Yoga"]);
    const aarhus = await text("/omraade/aarhus");
    expect(aarhus.body).toContain("Holistiske events i Aarhus og omegn");
    expect((await text("/kategori/ukendt")).status).toBe(404);
    // An area outside the active regions is not a page yet.
    expect((await text("/omraade/fyn")).status).toBe(404);
  });

  it("event page: details, sign-up link, source, schema.org data", async () => {
    const list = (await text("/events?q=shamanic")).body;
    const path = /href="(\/events\/deep-shamanic-healing-journey-[a-z0-9]+)"/.exec(list)?.[1];
    expect(path).toBeTruthy();
    const { status, body } = await text(path!);
    expect(status).toBe(200);
    expect(body).toContain("<h1>Deep Shamanic Healing Journey</h1>");
    expect(body).toContain("Søndag 11. oktober · kl. 15.30–18.00");
    expect(body).toContain("Guldsmedgade 26B");
    expect(body).toContain('href="https://hjerterum.info/events/6a572ab06960ef7bf40e3978"');
    expect(body).toContain("Tilmeld hos arrangøren");
    expect(body).toContain("100–200 kr.");
    expect(body).toContain("Lisa Mai Toft");
    expect(body).toContain("Kilde:");
    // Links in the text are links; Hjerterum's old address points to its new one.
    expect(body).toContain('<a href="https://kropsterapi-healing.dk/trommerejser/" rel="nofollow ugc noopener">');
    expect(body).not.toContain("https://holistisk.org/bliv-medlem");
    expect(body).toContain("https://hjerterum.info/bliv-medlem");
    const ld = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(body)![1]!);
    expect(ld).toMatchObject({ "@type": "Event", name: "Deep Shamanic Healing Journey", startDate: "2026-10-11T15:30:00+02:00", endDate: "2026-10-11T18:00:00+02:00", eventStatus: "https://schema.org/EventScheduled" });
    expect(ld.location.address).toMatchObject({ streetAddress: "Guldsmedgade 26B", postalCode: "8000", addressLocality: "Aarhus C" });
    const ics = await text(path! + ".ics");
    expect(ics.headers.get("content-type")).toContain("text/calendar");
    expect(ics.body).toContain("DTSTART:20261011T133000Z");
    expect(ics.body).toContain("SUMMARY:Deep Shamanic Healing Journey");
  });

  it("unknown event pages are 404", async () => {
    expect((await text("/events/findes-ikke-123456")).status).toBe(404);
  });

  it("staging is never indexed; production publishes a sitemap", async () => {
    const staging = await text("/robots.txt");
    expect(staging.body).toBe("User-agent: *\nDisallow: /\n");
    expect((await get("/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await text("/")).body).toContain('<meta name="robots" content="noindex, nofollow">');
    const prod: Env = { ...env, ENVIRONMENT: "production", PUBLIC_BASE_URL: "https://holistisk.org" };
    expect((await text("/robots.txt", prod)).body).toContain("Sitemap: https://holistisk.org/sitemap.xml");
    expect((await get("/", prod)).headers.get("x-robots-tag")).toBeNull();
    const sitemap = (await text("/sitemap.xml", prod)).body;
    expect(sitemap).toContain("<loc>https://holistisk.org/kategori/yoga</loc>");
    expect(sitemap.match(/\/events\/[a-z0-9-]+</g)?.length).toBe(7);
    expect((await text("/", prod)).body).toContain('<link rel="canonical" href="https://holistisk.org/">');
  });

  it("health and status report the collector", async () => {
    const health = JSON.parse((await text("/api/health")).body);
    expect(health).toMatchObject({ status: "ok", environment: "staging", ingest: { healthy: true }, events: { upcoming: 7 } });
  });

  it("a manual collection needs the secret token", async () => {
    const post = (auth?: string, e: Env = env) => handle(new Request("https://portal.example/api/ingest/run", { method: "POST", headers: auth ? { authorization: auth } : {} }), e, NOW);
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong", { ...env, INGEST_TOKEN: "x".repeat(32) })).status).toBe(401);
    // Without a configured token the endpoint is closed.
    expect((await post("Bearer ")).status).toBe(401);
  });

  it("sends security headers", async () => {
    const r = await get("/events");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
