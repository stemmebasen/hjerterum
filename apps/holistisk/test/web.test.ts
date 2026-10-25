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
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") },
    "https://buddha.dk/robots.txt": { status: 404 }, "https://buddha.dk/": { body: fixture("buddha-dk.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus", "buddhistisk-center-aarhus"].includes(s.id)) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland" };
});

const get = (path: string, e: Env = env) => handle(new Request(`https://portal.example${path}`), e, NOW);
const text = async (path: string, e?: Env) => { const r = await get(path, e); return { status: r.status, body: await r.text(), headers: r.headers }; };
/** Titles in the calendar's rows. */
const rows = (body: string) => [...body.matchAll(/<span class="row-title">([^<]+)<\/span>/g)].map(m => m[1]);
const count = (body: string) => Number(/class="results-count"[^>]*>(\d+) events?</.exec(body)?.[1] ?? NaN);

describe("front page", () => {
  it("shows a few events with pictures, the whole coming week, cities, activities, topics and standing offerings", async () => {
    const { status, body } = await text("/");
    expect(status).toBe(200);
    expect(body).toContain('<h1>Find et event – og en <span class="marker">flok at følges med.</span></h1>');
    expect(body).toContain('class="ticket-stack"');
    // The hero's tickets: coming events on different days, weekday and part of the day on the stub.
    const stubs = [...body.matchAll(/<span class="mini-weekday">(\w+)<\/span><span class="mini-part">(\w+)<\/span>/g)].map(m => m[1]);
    expect(stubs.length).toBeGreaterThan(0);
    expect(new Set(stubs).size).toBe(stubs.length);
    expect(body).toContain("Spar på billetten");
    expect(body).toContain("<title>Flokken – find events i Aarhus og nogen at følges med</title>");
    expect(body).toContain("Sådan virker Flokken");
    expect(body).toContain('href="/samarbejde"');
    expect(body).toContain('class="card ticket');
    expect(body).toContain('action="/kalender"');
    expect(body).toContain('href="/aarhus"');
    expect(body).toContain('href="/klarsyn"');
    expect(body).toContain('href="/breathwork"');
    expect(body).toContain("Faste ugentlige tilbud");
    expect(body).toContain("16. Karmapa-meditation hver mandag kl. 17.00");
    expect(body).toContain("De næste 7 dage");
  });

  it("lists every event of the coming 7 days, not a selection", async () => {
    const week = rows((await text("/kalender?periode=uge")).body);
    expect(week.length).toBeGreaterThan(5);
    expect(rows((await text("/")).body)).toEqual(week);
  });
});

describe("spar på billetten", () => {
  it("lists free and cheap events from their own prices and promises no benefit that is not confirmed", async () => {
    const { status, body } = await text("/spar-paa-billetten");
    expect(status).toBe(200);
    expect(body).toContain("Medlemsfordele");
    expect(body).toContain("Vi er ved at aftale billetfordele");
    expect(body).not.toContain("Medlemsfordel</span>");
    expect(rows(body).length).toBeGreaterThan(3);
    expect(count((await text("/kalender?pris=under-100")).body)).toBeGreaterThanOrEqual(count((await text("/kalender?pris=gratis")).body));
    expect((await text("/kalender?pris=gratis")).body).toContain('<span class="price-chip">Gratis</span>');
  });
});

describe("the calendar", () => {
  it("lists every upcoming event, grouped by day", async () => {
    const { body } = await text("/kalender");
    expect(count(body)).toBe(7 + 16 + 2);
    expect(body).toContain('<h3 class="day-head"><time datetime="2026-10-11">');
    expect(rows(body)[0]).toBe("Deep Shamanic Healing Journey");
  });

  it("filters by words, activity, date, city, town and price", async () => {
    expect(rows((await text("/kalender?q=breathwork")).body)).toEqual(["Din Indre Natur - Breathwork Journey med Jørgen Arvid", "Dhyana Yoga", "Source Breathwork (Rebirthing) with Douglas Crawford"]);
    expect(count((await text("/kalender?q=lisa+toft")).body)).toBe(1);
    expect(rows((await text("/kalender?kategori=yoga")).body)).toEqual(["Dhyana Yoga"]);
    expect(count((await text("/kalender?fra=2026-10-13&til=2026-10-13")).body)).toBe(3);
    expect(count((await text("/kalender?periode=idag")).body)).toBe(0);
    expect(rows((await text("/kalender?periode=weekend")).body)).toEqual(["Deep Shamanic Healing Journey"]);
    expect(count((await text("/kalender?omraade=randers")).body)).toBe(0);
    expect(rows((await text("/kalender?by=Lisbjerg")).body)).toEqual(["You Can Sing! / Aarhus"]);
    expect(count((await text("/kalender?pris=gratis")).body)).toBeGreaterThan(5);
    expect(rows((await text("/kalender?emne=klarsyn")).body)).toContain("Klarsyn med Karina Graabæk");
  });

  it("ignores unknown or hostile values instead of echoing them", async () => {
    const { status, body } = await text("/kalender?kategori=%3Cscript%3E&omraade=mars&fra=2026-13-45&pris=dyrt&emne=x&q=%3Cimg%20src%3Dx%3E");
    expect(status).toBe(200);
    expect(body).not.toContain("<img src=x>");
    expect(body).toContain("&lt;img src=x&gt;");
    expect(body).not.toContain("<script>");
    expect(count((await text("/kalender?q=%25%25")).body)).toBe(0);
  });

  it("today and the weekend have their own pages", async () => {
    const weekend = await text("/weekend");
    expect(weekend.body).toContain("<h1>Det sker i weekenden i Østjylland</h1>");
    expect(rows(weekend.body)).toEqual(["Deep Shamanic Healing Journey"]);
    expect((await text("/i-dag")).body).toContain("<title>Hvad sker der i dag? Events i Østjylland – Flokken</title>");
  });
});

describe("landing pages: activity, then city", () => {
  it("an activity across the region and in one city", async () => {
    const meditation = await text("/meditation");
    expect(meditation.body).toContain("<h1>Meditation i Østjylland</h1>");
    const aarhus = await text("/meditation/aarhus");
    expect(aarhus.status).toBe(200);
    expect(aarhus.body).toContain("<h1>Meditation i Aarhus</h1>");
    expect(aarhus.body).toContain("<title>Meditation i Aarhus – Flokken</title>");
    expect(aarhus.body).toMatch(/<meta name="description" content="Oplev guidede meditationer, mindfulness og stilhed i Aarhus\. Find ro og nærvær – og find en flok at følges med\.">/);
    expect(aarhus.body).toContain("Faste tilbud i Aarhus");
    expect(aarhus.body).toContain('href="/arrangoerer/buddhistisk-center-aarhus"');
    expect(aarhus.body).toContain('href="/meditation/randers"');
    expect(aarhus.body).toContain('"@type":"BreadcrumbList"');
    expect(aarhus.body).toContain('"@type":"ItemList"');
  });

  it("narrow topics people search for: klarsyn, buddhistisk meditation", async () => {
    const klarsyn = await text("/klarsyn/aarhus");
    expect(klarsyn.body).toContain("<h1>Klarsynsaftener i Aarhus</h1>");
    expect(rows(klarsyn.body)).toContain("Klarsyn med Karina Graabæk");
    expect(rows(klarsyn.body)).not.toContain("Dhyana Yoga");
    const buddhist = await text("/buddhistisk-meditation/aarhus");
    expect(rows(buddhist.body)).toEqual(["Meditation – Julianne Ferenczy", "Compassion and wisdom – Julianne Ferenczy"]);
    expect(buddhist.body).toContain("16. Karmapa-meditation hver torsdag kl. 19.30");
  });

  it("an empty page with an organiser still has something to offer; one without is kept from search engines", async () => {
    const prod: Env = { ...env, ENVIRONMENT: "production" };
    const horsensYoga = await text("/yin-yoga/horsens", prod);
    expect(horsensYoga.status).toBe(200);
    expect(horsensYoga.body).toContain("Yoga &amp; Meditation Horsens");
    expect(horsensYoga.body).toContain('<meta name="robots" content="index, follow');
    expect((await text("/kakaoceremoni/randers", prod)).body).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("a city's page", async () => {
    const { body } = await text("/aarhus");
    expect(body).toContain("<h1>Events i Aarhus</h1>");
    expect(body).toContain("<title>Hvad sker der i Aarhus? Events og flokke – Flokken</title>");
    expect(body).toContain("I weekenden i Aarhus");
    expect(body).toContain('href="/klarsyn/aarhus"');
    expect(body).toContain("Arrangører i Aarhus");
  });

  it("old and long addresses move permanently; unknown ones are 404", async () => {
    const moved = async (path: string) => { const r = await get(path); return [r.status, r.headers.get("location")]; };
    expect(await moved("/aarhus/meditation")).toEqual([301, "/meditation/aarhus"]);
    expect(await moved("/kategori/yoga")).toEqual([301, "/yoga"]);
    expect(await moved("/kategori/aandedraet-breathwork")).toEqual([301, "/breathwork"]);
    expect(await moved("/omraade/aarhus")).toEqual([301, "/aarhus"]);
    expect(await moved("/events?q=yoga")).toEqual([301, "/kalender?q=yoga"]);
    expect((await text("/ukendt")).status).toBe(404);
    expect((await text("/meditation/ukendt")).status).toBe(404);
    expect((await text("/fyn")).status).toBe(404);
  });
});

describe("organisers", () => {
  it("a directory and a profile with standing offerings and coming events", async () => {
    const list = await text("/arrangoerer");
    expect(list.body).toContain('href="/arrangoerer/lysets-hus"');
    expect(list.body).toContain("Peder Skrams Gade 52B");
    const profile = await text("/arrangoerer/lysets-hus");
    expect(profile.body).toContain("<h1>Lysets Hus</h1>");
    expect(profile.body).toContain("Gratis healingsmeditation onsdage i lige uger kl. 17.30–18.30");
    expect(rows(profile.body)).toContain("Klarsyn med Karina Graabæk");
    expect(profile.body).toContain('"@type":"Organization"');
    expect((await text("/arrangoerer/ukendt")).status).toBe(404);
  });

  it("studios whose calendars cannot be collected still have a profile, listed under their activities", async () => {
    const yogaskolen = await text("/arrangoerer/skandinavisk-yoga-og-meditationsskole-aarhus");
    expect(yogaskolen.status).toBe(200);
    expect(yogaskolen.body).toContain("Gratis prøvetime i yoga, afspænding og meditation de fleste torsdage kl. 20–21");
    expect((await text("/arrangoerer/yo-studios")).body).toContain("Margrethepladsen 4, 1. sal");
    const yoga = (await text("/yoga/aarhus")).body;
    expect(yoga).toContain('href="/arrangoerer/yo-studios"');
    expect(yoga).toContain('href="/arrangoerer/skandinavisk-yoga-og-meditationsskole-aarhus"');
  });
});

describe("the map", () => {
  it("is its own page with the coming two weeks' events as data, days, activities and the map's scripts", async () => {
    const { status, body } = await text("/kort");
    expect(status).toBe(200);
    expect(body).toContain('class="map" data-map');
    expect(body).toContain('src="/assets/vendor/leaflet/leaflet.js?v=1.9.4"');
    expect(body).toContain('src="/assets/map.js?v=1"');
    expect(body).not.toContain('class="site-footer"');
    const data = JSON.parse(/<script type="application\/json" id="kort-data">([\s\S]*?)<\/script>/.exec(body)![1]!);
    expect(data.days).toHaveLength(14);
    expect(data.days[0]).toMatchObject({ label: "I dag" });
    expect(data.events.length).toBeGreaterThan(0);
    for (const e of data.events) {
      expect(e.p).toMatch(/^\/events\/[a-z0-9-]+$/);
      expect(typeof e.y).toBe("number");
      expect(data.days.some((d: { d: string }) => d.d === e.d)).toBe(true);
    }
    expect(data.categories.length).toBeGreaterThan(0);
  });

  it("is reached from the menu, the front page, the calendar and an event's page", async () => {
    expect((await text("/")).body).toContain('href="/kort"');
    expect((await text("/kalender")).body).toContain('class="map-link" href="/kort"');
    const { body } = await text("/kort");
    const path = JSON.parse(/id="kort-data">([\s\S]*?)<\/script>/.exec(body)![1]!).events[0].p as string;
    expect((await text(path)).body).toContain(`href="/kort?event=${path.slice(8)}"`);
  });
});

describe("an event's page", () => {
  it("details, sign-up link, source, breadcrumb into the activity and city, schema.org data", async () => {
    const list = (await text("/kalender?q=shamanic")).body;
    const path = /href="(\/events\/deep-shamanic-healing-journey-[a-z0-9]+)"/.exec(list)?.[1];
    expect(path).toBeTruthy();
    const { status, body } = await text(path!);
    expect(status).toBe(200);
    expect(body).toContain("<h1>Deep Shamanic Healing Journey</h1>");
    expect(body).toContain("Søndag 11. oktober · kl. 15.30–18.00");
    expect(body).toContain("Guldsmedgade 26B");
    expect(body).toContain('href="https://hjerterum.info/events/6a572ab06960ef7bf40e3978"');
    expect(body).toContain('href="/arrangoerer/hjerterum"');
    expect(body).toContain('<a href="https://kropsterapi-healing.dk/trommerejser/" rel="nofollow ugc noopener">');
    expect(body).toContain("https://hjerterum.info/bliv-medlem");
    const ld = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(body)![1]!);
    expect(ld).toMatchObject({ "@type": "Event", startDate: "2026-10-11T15:30:00+02:00", endDate: "2026-10-11T18:00:00+02:00" });
    const ics = await text(path! + ".ics");
    expect(ics.body).toContain("DTSTART:20261011T133000Z");
    expect((await text("/events/findes-ikke-123456")).status).toBe(404);
  });
});

describe("search engines and safety", () => {
  it("staging is never indexed; production lists the landing pages that have content", async () => {
    expect((await text("/robots.txt")).body).toBe("User-agent: *\nDisallow: /\n");
    expect((await get("/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const prod: Env = { ...env, ENVIRONMENT: "production", PUBLIC_BASE_URL: "https://holistisk.org" };
    expect((await text("/robots.txt", prod)).body).toContain("Sitemap: https://holistisk.org/sitemap.xml");
    const sitemap = (await text("/sitemap.xml", prod)).body;
    for (const p of ["/kalender", "/weekend", "/aarhus", "/meditation", "/meditation/aarhus", "/klarsyn/aarhus", "/buddhistisk-meditation/aarhus", "/arrangoerer/lysets-hus", "/yin-yoga/horsens", "/retreat/djursland"]) {
      expect(sitemap).toContain(`<loc>https://holistisk.org${p}</loc>`);
    }
    expect(sitemap).not.toContain("<loc>https://holistisk.org/kakaoceremoni/randers</loc>");
    expect((await text("/", prod)).body).toContain('<link rel="canonical" href="https://holistisk.org/">');
  });

  it("share cards, language and security headers", async () => {
    const r = await get("/meditation/aarhus");
    const body = await r.text();
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(body).toContain('<meta property="og:image" content="https://portal.example/assets/og.jpg">');
    expect(body).toContain('<link rel="alternate" hreflang="da-DK" href="https://portal.example/meditation/aarhus">');
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("health reports the collector; a manual run needs the token", async () => {
    expect(JSON.parse((await text("/api/health")).body)).toMatchObject({ status: "ok", ingest: { healthy: true } });
    const post = (auth?: string, e: Env = env) => handle(new Request("https://portal.example/api/ingest/run", { method: "POST", headers: auth ? { authorization: auth } : {} }), e, NOW);
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong", { ...env, INGEST_TOKEN: "x".repeat(32) })).status).toBe(401);
  });
});
