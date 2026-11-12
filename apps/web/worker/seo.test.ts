import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import config from "./config-entry.js";
import { withSeo, type Seo } from "./seo.js";
import { sagaEnv, testDatabase } from "./saga/test-support.js";

// Asked (the chair, 12 Nov 2026): "Er siden SEO optimeret efter nyeste og bedste standarder" - "Ja, og det hele bare så snart du kan".
const INDEX = `<!doctype html><html lang="da"><head><meta name="description" content="Hjerterum i Aarhus" /><title>Hjerterum</title>
<!-- og:start -->\n<meta property="og:title" content="Hjerterum" />\n<!-- og:end --></head><body><div id="root"></div></body></html>`;
const STARTS = Date.parse("2026-11-20T18:00:00Z");

async function setUp() {
  const db = testDatabase();
  const id = Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, ticket_price_minor, non_member_price_minor, max_attendees, review_status, status, created_at_ms, updated_at_ms)
    VALUES ('t', 'Anna Ananda', 'a@x.dk', 'Lydbad </script>', 'En rolig aften.', ?, ?, 0, 15000, 20, 'approved', 'scheduled', 1, 1)`).bind(STARTS, STARTS + 7_200_000).run()).meta!.last_row_id);
  const env = { ...sagaEnv(db), ASSETS: { fetch: async (request: Request) => new URL(request.url).pathname === "/kvittering"
    ? new Response("<!doctype html><p>Tak</p>", { headers: { "content-type": "text/html; charset=utf-8" } })
    : new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8", etag: '"x"' } }) } } as never;
  const get = (path: string, host = "www.hjerterum.info") => config.fetch(new Request(`https://${host}${path}`), env);
  return { id, get };
}
const ld = (html: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!) as { "@graph": Array<Record<string, unknown>> };

describe("the website for search engines", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-12T12:00:00Z")); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); })); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("gives the front page its title, canonical address, schema.org and words - with the coming events as links", async () => {
    const { id, get } = await setUp();
    const page = await get("/");
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("<title>Hjerterum – nærvær, oplevelser og fællesskab i Aarhus</title>");
    expect(html).toContain('<link rel="canonical" href="https://www.hjerterum.info/" />');
    expect(html).toContain("<h1>Hjerterum – nærvær, oplevelser og fællesskab i Aarhus</h1>");
    expect(html).toContain(`<a href="/events/h${id}">Lydbad &lt;/script&gt;</a>`);
    const types = ld(html)["@graph"].map(n => n["@type"]);
    expect(types).toEqual(expect.arrayContaining(["WebSite", "Organization", "Place"]));
    expect(page.headers.get("etag")).toBeNull();
  });

  it("gives every page of the website its own head and words, and the same address from the member area's host", async () => {
    const { get } = await setUp();
    const html = await (await get("/medlemskab/", "medlem.hjerterum.info")).text();
    expect(html).toContain("· Hjerterum</title>");
    expect(html).toContain('<link rel="canonical" href="https://www.hjerterum.info/medlemskab" />');
    expect(html).toContain("Standard medlemskab</strong>: 222 kr. pr. måned");
    const graph = ld(html)["@graph"];
    expect(graph.find(n => n["@type"] === "BreadcrumbList")).toBeTruthy();
    expect(html).not.toContain("{{");
  });

  it("describes an event as schema.org Event, with its prices, and keeps a script tag in a title harmless", async () => {
    const { id, get } = await setUp();
    const html = await (await get(`/events/h${id}`)).text();
    const event = ld(html)["@graph"].find(n => n["@type"] === "Event")!;
    expect(event).toMatchObject({ name: "Lydbad </script>", startDate: "2026-11-20T18:00:00.000Z", endDate: "2026-11-20T20:00:00.000Z", performer: { name: "Anna Ananda" },
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", location: { address: { streetAddress: "Guldsmedgade 26B" } } });
    expect(event.offers).toEqual([expect.objectContaining({ name: "Medlemmer", price: 0, priceCurrency: "DKK" }), expect.objectContaining({ name: "Ikke-medlemmer", price: 150 })]);
    expect(html).not.toMatch(/Lydbad <\/script>/);
  });

  it("answers 404 for a page that does not exist, and keeps the login and member pages out of search", async () => {
    const { get } = await setUp();
    const missing = await get("/findes-ikke");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    const member = await get("/member-portal/profil", "medlem.hjerterum.info");
    expect(member.status).toBe(200);
    expect(member.headers.get("x-robots-tag")).toBe("noindex");
    // A page the worker writes itself is left alone.
    expect(await (await get("/kvittering")).text()).toBe("<!doctype html><p>Tak</p>");
  });

  it("has a robots.txt and a sitemap with the pages and the coming events", async () => {
    const { id, get } = await setUp();
    const robots = await (await get("/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://www.hjerterum.info/sitemap.xml");
    expect(robots).not.toContain("<html");
    const sitemap = await get("/sitemap.xml");
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    const xml = await sitemap.text();
    for (const loc of ["https://www.hjerterum.info/", "https://www.hjerterum.info/medlemskab", "https://www.hjerterum.info/brug-hjerterum/lejepriser", `https://www.hjerterum.info/events/h${id}`])
      expect(xml).toContain(`<loc>${loc}</loc>`);
  });

  it("shows the words only to readers without scripts, as the app draws the page over them", () => {
    const seo: Seo = { status: 200, title: "T · Hjerterum", description: "D", canonical: "https://www.hjerterum.info/t", jsonLd: [], body: "<h1>T</h1>" };
    const html = withSeo(INDEX, seo);
    expect(html).toContain('<div id="root"><div data-prerender><h1>T</h1></div></div>');
    expect(html).toContain("@media (scripting:none)");
    expect(html.match(/og:title/g)).toHaveLength(1);
  });
});
