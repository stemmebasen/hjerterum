import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { danishPath, englishCanonicalOf, englishPath } from "../src/i18n/paths.js";
import { translateHtml, translateText } from "../src/i18n/translate.js";
import { englishDates } from "../src/i18n/en-rules.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Socialklubben in English (Jake 2026-11-18): every page also under /en/, findable by search engines.
const NOW = Date.parse("2026-10-10T12:00:00Z");
const SITE = "https://socialklubben.dk";
let env: Env;
let slug = "";

beforeAll(async () => {
  const db = testDb();
  const { fetcher } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") } });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === "hjerterum") });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
  slug = (db.raw.prepare("SELECT slug FROM events WHERE starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW)[0] as { slug: string }).slug;
});

async function call(path: string, init: { form?: Record<string, string>; cookie?: string; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.form) { headers.origin = init.host ?? SITE; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request((init.host ?? SITE) + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env, NOW);
  return { status: r.status, body: await r.text(), headers: r.headers };
}

describe("English addresses", () => {
  it("maps the main pages to English words and back", () => {
    expect(englishPath("/")).toBe("/en");
    expect(englishPath("/kalender?periode=idag#soeg")).toBe("/en/calendar?periode=idag#soeg");
    expect(englishPath("/moed-nye-mennesker")).toBe("/en/meet-new-people");
    expect(englishPath("/events/koncert-1a2b3c")).toBe("/en/events/koncert-1a2b3c");
    expect(englishPath("/meditation/aarhus")).toBe("/en/meditation/aarhus");
    expect(englishPath("/assets/site.css?v=1")).toBe("/assets/site.css?v=1");
    expect(englishPath("/api/kontakt")).toBe("/api/kontakt");
    expect(englishPath("/en/calendar")).toBe("/en/calendar");
    expect(danishPath("/en/things-to-do-in-aarhus")).toBe("/ting-at-lave-i-aarhus");
    expect(danishPath("/en")).toBe("/");
    expect(danishPath("/kalender")).toBeNull();
    expect(englishCanonicalOf("/en/kalender")).toBe("/en/calendar");
    expect(englishCanonicalOf("/en/calendar")).toBeNull();
  });

  it("puts dates, times and counts into English", () => {
    expect(englishDates("Søndag 11. oktober · kl. 15.30–18.00")).toBe("Sunday 11 October · 15:30–18:00");
    expect(translateText("Tid: Onsdag 14. oktober · kl. 17.30–18.30.")).toBe("Time: Wednesday 14 October · 17:30–18:30.");
    expect(translateText("Lysets Hus, Aarhus C · Gratis · til 18.30")).toBe("Lysets Hus, Aarhus C · Free · until 18:30");
    expect(translateText("23 arrangementer")).toBe("23 events");
    expect(translateText("1 arrangement")).toBe("1 event");
    expect(translateText("Meditation i Aarhus")).toBe("Meditation in Aarhus");
    expect(translateText("Også ons 28/10, ons 11/11")).toBe("Also Wed 28/10, Wed 11/11");
  });

  it("leaves organisers' own text alone and never touches scripts or what people typed", () => {
    const page = '<p>Healing med Lisa</p><textarea>Kalender</textarea><script>var a = "Kalender";</script><a href="/kalender">Kalender</a>';
    expect(translateHtml(page, SITE)).toBe('<p>Healing med Lisa</p><textarea>Kalender</textarea><script>var a = "Kalender";</script><a href="/en/calendar">Calendar</a>');
  });
});

describe("the English site", () => {
  it("serves the front page in English, with hreflang both ways and a way back to Danish", async () => {
    const r = await call("/en");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-language")).toBe("en");
    expect(r.body).toContain('<html lang="en"');
    expect(r.body).toContain("<title>Socialklubben – events and things to do in Aarhus, with people to go with</title>");
    expect(r.body).toContain('<meta name="robots" content="index, follow, max-image-preview:large">');
    expect(r.body).toContain(`<link rel="canonical" href="${SITE}/en">`);
    expect(r.body).toContain(`<link rel="alternate" hreflang="da" href="${SITE}/">`);
    expect(r.body).toContain(`<link rel="alternate" hreflang="en" href="${SITE}/en">`);
    expect(r.body).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE}/">`);
    expect(r.body).toContain('<meta property="og:locale" content="en_GB">');
    expect(r.body).toContain(`<a class="lang-switch" href="${SITE}/" hreflang="da"`);
    expect(r.body).toContain('href="/en/calendar"');
    expect(r.body).toContain("I&#39;d like to come along!");
    expect(r.body).toContain('href="/assets/site.css?v=51"');
    expect(r.body).not.toContain('href="/kalender"');
  });

  it("links the Danish pages to their English twins", async () => {
    const r = await call("/kalender");
    expect(r.body).toContain('<html lang="da"');
    expect(r.body).toContain(`<link rel="alternate" hreflang="en" href="${SITE}/en/calendar">`);
    expect(r.body).toContain(`<a class="lang-switch" href="${SITE}/en/calendar" hreflang="en"`);
  });

  it("translates the guide pages people search for", async () => {
    const meet = await call("/en/meet-new-people");
    expect(meet.status).toBe(200);
    expect(meet.body).toContain("<h1>Meet new people in Aarhus</h1>");
    const todo = await call("/en/things-to-do-in-aarhus");
    expect(todo.body).toContain("Things to do in Aarhus");
    const about = await call("/en/about");
    expect(about.body).toContain("Socialklubben was created by Jacob Hauge");
  });

  it("shows an event page in English with the organiser's own description as it is", async () => {
    const r = await call(`/en/events/${slug}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("Add to calendar");
    expect(r.body).toContain(`<link rel="canonical" href="${SITE}/en/events/${slug}">`);
    expect(r.body).toContain(`"url":"${SITE}/en/events/${slug}"`);
  });

  it("moves Danish words under /en/ to the English address, and sends pages without an English version back", async () => {
    const old = await call("/en/kalender?periode=idag");
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/en/calendar?periode=idag");
    const admin = await call("/en/admin");
    expect(admin.status).toBe(302);
    expect(admin.headers.get("location")).toBe("/admin");
    expect((await call("/en/findes-ikke")).status).toBe(404);
  });

  it("keeps a new member in English through sign-up, with the welcome cookie on the English address", async () => {
    const r = await call("/en/membership", { form: { fornavn: "Maria", naeste: "/flokke" } });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/en\//);
    const cookies = r.headers.getSetCookie();
    const note = cookies.find(c => c.startsWith("flok_ny_kode="));
    expect(note).toContain("Path=/en/membership/velkommen");
    expect(r.headers.get("location")).toBe("/en/membership/velkommen?naeste=%2Fflokke");
  });

  it("lists both languages in the sitemap and keeps private English pages out of the crawl", async () => {
    const map = await call("/sitemap.xml");
    expect(map.body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(map.body).toContain(`<loc>${SITE}/en/calendar</loc>`);
    expect(map.body).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/things-to-do-in-aarhus"/>`);
    const robots = await call("/robots.txt");
    expect(robots.body).toContain("Disallow: /en/log-in");
    expect(robots.body).toContain("Disallow: /en/calendar?");
    expect(robots.body).toContain("Allow: /en/calendar?side=");
  });

  it("is only for Socialklubben, never Samfolk", async () => {
    const samfolk = { ...env, EDITION: "forening" };
    const r = await handle(new Request("https://samfolk.example/en"), samfolk, NOW);
    expect(r.headers.get("content-language")).toBeNull();
  });
});
