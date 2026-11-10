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
let db: ReturnType<typeof testDb>;

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") },
    "https://buddha.dk/robots.txt": { status: 404 }, "https://buddha.dk/": { body: fixture("buddha-dk.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus", "buddhistisk-center-aarhus"].includes(s.id)).map(s => ({ ...s, enabled: () => true })) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
});

const get = (path: string, e: Env = env) => handle(new Request(`https://portal.example${path}`), e, NOW);
const text = async (path: string, e?: Env) => { const r = await get(path, e); return { status: r.status, body: await r.text(), headers: r.headers }; };
/** Titles in the calendar's rows. */
const rows = (body: string) => [...body.matchAll(/<span class="row-title">([^<]+)<\/span>/g)].map(m => m[1]);
const count = (body: string) => Number(/class="results-count"[^>]*>(\d+) events?</.exec(body)?.[1] ?? NaN);

describe("about page", () => {
  it("presents Flokken as a social association: two aims, who it is for, values, an English summary", async () => {
    const { status, body } = await text("/om");
    expect(status).toBe(200);
    expect(body).toContain('<h2 id="formaal">Vores formål</h2>');
    expect(body).toContain("<strong>Fællesskab.</strong>");
    expect(body).toContain("<strong>Byens arrangører.</strong>");
    expect(body).toContain("internationale studerende");
    for (const v of ["Fællesskab", "Inddragelse", "Inklusion"]) expect(body).toContain(`<dt>${v}</dt>`);
    expect(body).toContain('<p class="aims-en" lang="en">');
    expect(body).not.toMatch(/registreret socialøkonomisk|RSV/i);
  });
});

describe("cancelled events", () => {
  it("drop out of the front page, the calendar and its count, but their own page still opens and says so", async () => {
    const before = await text("/kalender");
    const row = db.raw.prepare("SELECT slug, title FROM events WHERE status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW)[0] as { slug: string; title: string };
    expect(rows(before.body)).toContain(row.title);
    db.raw.prepare("UPDATE events SET status = 'cancelled' WHERE slug = ?").run(row.slug);
    try {
      const after = await text("/kalender");
      expect(rows(after.body)).not.toContain(row.title);
      expect(count(after.body)).toBe(count(before.body) - 1);
      expect((await text("/")).body).not.toContain(`/${row.slug}"`);
      const own = await text(`/events/${row.slug}`);
      expect(own.status).toBe(200);
      expect(own.body).toContain("Arrangøren har meldt dette event aflyst.");
    } finally {
      db.raw.prepare("UPDATE events SET status = 'scheduled' WHERE slug = ?").run(row.slug);
    }
  });
});

describe("front page", () => {
  it("shows a few events with pictures, the whole coming week, cities, activities and the city's stages and houses", async () => {
    const { status, body } = await text("/");
    expect(status).toBe(200);
    expect(body).toContain('<h1 class="hero-title">Byen er fuld af gode oplevelser <span class="hero-line">–&nbsp;<span class="marker">del dem med gode&nbsp;mennesker!</span></span></h1>');
    expect(body).toMatch(/<a class="calendar-cta" href="\/kalender">[\s\S]*?<strong>Se kalenderen<\/strong><span>\d+ events? – dag for dag<\/span>/);
    expect(body).toContain('<h2 id="h-mission">Derfor findes Flokken</h2>');
    expect(body).toContain("så er du IKKE alene");
    // The intro carries both aims and promises no savings.
    expect(body).toMatch(/<p class="standfirst">\d+ events? i Aarhus lige nu – fra de store scener til de små spillesteder, teatre og foreninger, som flere fortjener at opdage\. Sæt kryds ved det, du har lyst til, så samler vi en lille flok, der skal det samme som dig – og I oplever det sammen\.<\/p>/);
    // The association's two aims and a line for newcomers who read English.
    expect(body).toContain("Flokken er en social forening med to formål");
    expect(body).toContain('<p class="mission-en" lang="en">New in Aarhus?');
    // Not yet registered: never claim the protected RSV status.
    expect(body).not.toMatch(/registreret socialøkonomisk/i);
    // Step 2: find a flock or start one; what a flock of five gets is not decided, so it stays a teaser.
    expect(body).toContain("<strong>Vis interesse – så samler vi flokken</strong>");
    expect(body).toContain("Alting er sjovere i samlet flok. Når I er 5 samlet, giver vi en <span class=\"secret\" aria-hidden=\"true\">*****</span>");
    expect(body).toContain('class="ticket-stack"');
    // The hero's tickets: coming events on different days, weekday and part of the day on the stub.
    const stubs = [...body.matchAll(/<span class="mini-weekday">(\w+)<\/span><span class="mini-part">(\w+)<\/span>/g)].map(m => m[1]);
    expect(stubs.length).toBeGreaterThan(0);
    expect(new Set(stubs).size).toBe(stubs.length);
    // Each ticket ends in the event's photo, or a patterned panel naming the activity when it has none.
    expect((body.match(/class="mini-photo( mini-photo-plain)?"/g) ?? []).length).toBe((body.match(/class="mini-ticket mini-ticket-/g) ?? []).length);
    // No row of shortcut buttons under the calendar button; the pages themselves stay.
    expect(body).not.toContain('aria-label="Genveje"');
    // No "Spar på billetten" (Jake 2026-11-10): it promised a saving we don't give.
    expect(body).not.toMatch(/spar på billetten/i);
    expect(body).toContain('href="/gratis-og-billigt"');
    expect(body).toContain("<title>Flokken – find events i Aarhus og nogen at følges med</title>");
    expect(body).toContain("Sådan virker Flokken");
    expect(body).toContain('href="/samarbejde"');
    expect(body).toContain('class="card ticket');
    expect(body).toContain('action="/kalender"');
    expect(body).toContain('href="/aarhus"');
    // Broad and mainstream (Jake 2026-11-10): no spiritual topics, alternative activities or meditation offerings on
    // the front page or in its menu; the city's stages, houses and associations instead.
    expect(body).not.toContain('href="/klarsyn"');
    expect(body).not.toContain('href="/breathwork"');
    expect(body).not.toContain("Karmapa");
    expect(body).toContain('<h2 id="h-venues">Byens scener, huse og foreninger</h2>');
    expect(body).toContain('href="/arrangoerer/voxhall"');
    expect(body).toContain('href="/arrangoerer/dokk1"');
    expect(body).not.toContain('href="/arrangoerer/lysets-hus"');
    expect(body).toContain('href="/koncerter"');
    expect(body).toContain('<a href="/kategorier">Alle aktiviteter og emner</a>');
    expect(body).toContain("De næste 7 dage");
  });

  it("lists every event of the coming 7 days, not a selection", async () => {
    const week = rows((await text("/kalender?periode=uge")).body);
    expect(week.length).toBeGreaterThan(5);
    expect(rows((await text("/")).body)).toEqual(week);
  });
});

describe("spar på billetten", () => {
  it("lists free and cheap events from their own prices and promises no ticket discount", async () => {
    expect((await get("/spar-paa-billetten")).headers.get("location")).toBe("/gratis-og-billigt");
    const { status, body } = await text("/gratis-og-billigt");
    expect(status).toBe(200);
    expect(body).not.toMatch(/spar på billetten/i);
    expect(body).not.toMatch(/medlemsfordel|billetfordel|rabat/i);
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

  it("invites organisers in the top banner instead of calling the site a test version", async () => {
    const { body } = await text("/");
    expect(body).toContain('Mangler dit event på siden? Skynd dig og tag fat i os – <a href="mailto:jh@jacobhauge.com?subject=Mit%20event%20p%C3%A5%20Socialklubben">klik her</a>');
    expect(body).not.toContain("Testversion");
  });

  it("has toggleable chips for Område, Pris and Hvornår, with the search field at the bottom", async () => {
    const all = count((await text("/kalender")).body);
    const nord = await text("/kalender?omraade=nord");
    expect(rows(nord.body)).toContain("You Can Sing! / Aarhus");
    const midt = count((await text("/kalender?omraade=midtbyen")).body);
    expect(midt).toBeGreaterThan(0);
    expect(midt + count(nord.body)).toBeLessThanOrEqual(all);
    // The old areas still work in links.
    expect(count((await text("/kalender?omraade=aarhus")).body)).toBeGreaterThan(0);
    // A chosen chip links to the same list without it; the others add to it.
    expect(nord.body).toMatch(/<a class="filter-chip is-on" href="\/kalender#soeg"[^>]*>Nord for Aarhus/);
    expect(nord.body).toContain('href="/kalender?omraade=syd#soeg"');
    expect(nord.body).toContain('href="/kalender?omraade=nord&amp;pris=gratis#soeg"');
    expect(nord.body).toContain('href="/kalender?periode=14-dage&amp;omraade=nord#soeg"');
    for (const label of ["Aarhus midtby", "Nord for Aarhus", "Vest for Aarhus", "Syd for Aarhus", "Gratis", "Under 100 kr.", "Under 200 kr.", "Under 500 kr.", "I dag", "I morgen", "I weekenden", "Næste 14 dage"])
      expect(nord.body).toContain(`>${label}`);
    // Område, Pris and Hvornår come first, the search field last, and it keeps the chosen chips.
    const panel = nord.body.slice(nord.body.indexOf('<div class="filters">'));
    expect(panel.indexOf("Område")).toBeLessThan(panel.indexOf("Pris"));
    expect(panel.indexOf("Pris")).toBeLessThan(panel.indexOf("Hvornår"));
    expect(panel.indexOf("Hvornår")).toBeLessThan(panel.indexOf('id="f-q"'));
    expect(panel).toContain('<input type="hidden" name="omraade" value="nord">');
    expect(count((await text("/kalender?periode=14-dage")).body)).toBeGreaterThanOrEqual(count((await text("/kalender?periode=uge")).body));
  });

  it("places events in Midtbyen, Nord, Syd or Vest by postcode, town or position", async () => {
    const { zoneSql } = await import("../src/zones.js");
    const db = testDb();
    const zone = (postal_code: string | null, city: string | null, lat: number | null = null, lon: number | null = null) =>
      (db.raw.prepare(`SELECT ${zoneSql("e")} AS z FROM (SELECT ? AS postal_code, ? AS city, ? AS lat, ? AS lon) e`).all(postal_code, city, lat, lon)[0] as { z: string | null }).z;
    expect(zone("8000", "Aarhus C")).toBe("midtbyen");
    expect(zone("8200", "Aarhus N")).toBe("nord");
    expect(zone("8240", "Risskov")).toBe("nord");
    expect(zone("8900", "Randers C")).toBe("nord");
    expect(zone("8260", "Viby J")).toBe("syd");
    expect(zone("8270", "Højbjerg")).toBe("syd");
    expect(zone("8700", "Horsens")).toBe("syd");
    expect(zone("8766", "Nørre Snede")).toBe("syd");
    expect(zone("8210", "Aarhus V")).toBe("vest");
    expect(zone("8220", "Brabrand")).toBe("vest");
    expect(zone("8600", "Silkeborg")).toBe("vest");
    expect(zone(null, "Brabrand")).toBe("vest");
    expect(zone(null, "Aarhus C")).toBe("midtbyen");
    expect(zone(null, null, 56.153436, 10.213776)).toBe("midtbyen"); // Dokk1
    expect(zone(null, null, 56.1890, 10.2050)).toBe("nord");
    expect(zone(null, null, 56.1200, 10.1900)).toBe("syd");
    expect(zone(null, null, 56.1550, 10.1200)).toBe("vest");
    expect(zone("5000", "Odense C")).toBeNull();
    expect(zone(null, null)).toBeNull();
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
    expect(aarhus.body).toContain('href="/arrangoerer/skandinavisk-yoga-og-meditationsskole-aarhus"');
    // Switched off with the turn to a broad selection (2026-11-10).
    expect(aarhus.body).not.toContain('href="/arrangoerer/buddhistisk-center-aarhus"');
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
    expect(buddhist.body).not.toContain("16. Karmapa-meditation hver torsdag kl. 19.30");
  });

  it("an empty page with an organiser still has something to offer; one without is kept from search engines", async () => {
    const prod: Env = { ...env, ENVIRONMENT: "production" };
    const yinYoga = await text("/yin-yoga/aarhus", prod);
    expect(yinYoga.status).toBe(200);
    expect(yinYoga.body).toContain("YO Studios");
    expect(yinYoga.body).toContain('<meta name="robots" content="index, follow');
    // Hidden with the turn to a broad selection (2026-11-10), so Horsens' yin yoga page has nothing left.
    expect((await text("/yin-yoga/horsens", prod)).body).toContain('<meta name="robots" content="noindex, nofollow">');
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
    expect(list.body).not.toContain("Peder Skrams Gade 52B");
    // Stages, libraries and houses first, then yoga, meditation and the like.
    expect(list.body).toContain("Spillesteder, teatre, biblioteker, kulturhuse og foreninger");
    expect(list.body.indexOf('href="/arrangoerer/voxhall"')).toBeGreaterThan(0);
    expect(list.body.indexOf('href="/arrangoerer/voxhall"')).toBeLessThan(list.body.indexOf('href="/arrangoerer/lysets-hus"'));
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
    expect(body).toContain('src="/assets/map.js?v=2"');
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
    for (const p of ["/kalender", "/weekend", "/aarhus", "/meditation", "/meditation/aarhus", "/klarsyn/aarhus", "/buddhistisk-meditation/aarhus", "/arrangoerer/lysets-hus", "/arrangoerer/voxhall", "/yin-yoga/aarhus"]) {
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
    // The profile photo is made small in the browser from a blob: picture.
    expect(r.headers.get("content-security-policy")).toMatch(/img-src [^;]*blob:/);
  });

  it("health reports the collector; a manual run needs the token", async () => {
    expect(JSON.parse((await text("/api/health")).body)).toMatchObject({ status: "ok", ingest: { healthy: true } });
    const post = (auth?: string, e: Env = env) => handle(new Request("https://portal.example/api/ingest/run", { method: "POST", headers: auth ? { authorization: auth } : {} }), e, NOW);
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong", { ...env, INGEST_TOKEN: "x".repeat(32) })).status).toBe(401);
  });
});
