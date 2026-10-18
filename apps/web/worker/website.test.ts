import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { headings, renderMarkdown } from "../site/markdown.js";
import { HOME_SOURCES, SITE_PAGES } from "../site/pages.js";
import { carrierOf, REDIRECTS, redirectFor, RETIRED, sitePage } from "../site/redirects.js";
import legacy from "../../../docs/legacy/holistisk-org/pages.json";
import ledgerDocument from "../../../docs/CONTENT_LEDGER.md?raw";
import { buildLedger } from "../site/ledger.js";
import { sagaEnv, testDatabase } from "./saga/test-support.js";

// Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt".

const PUBLIC = new Set(Object.keys(import.meta.glob("../public/**/*")).map(file => file.slice("../public".length)));
const publicFile = (path: string) => PUBLIC.has(path);
const APP_ROUTES = /^\/(sign-in|sign-up|beregner|member-portal(\/[a-z-]+)?)$/;
const anchorsOf = (path: string) => new Set(headings(sitePage(path)?.body ?? "").map(h => h.id));

function resolves(href: string): boolean {
  const [path = "", anchor] = href.split("#");
  if (path === "" ) return true;
  if (path === "/") return !anchor;
  if (/^\/(media|dokumenter)\//.test(path)) return publicFile(path);
  if (APP_ROUTES.test(path)) return !anchor;
  if (!sitePage(path)) return false;
  return !anchor || anchorsOf(path).has(anchor) || ["events", "contact", "about"].includes(anchor) && anchorsOf(path).has(anchor);
}

describe("the website from holistisk.org", () => {
  it("accounts for every one of holistisk.org's 56 pages", () => {
    expect(legacy).toHaveLength(56);
    for (const { slug } of legacy) {
      const carrier = carrierOf(slug);
      if (RETIRED[slug]) { expect(carrier).toBeUndefined(); expect(redirectFor(`/${slug}`)).toBeTruthy(); continue; }
      expect(carrier, `${slug} is carried by no page`).toBeTruthy();
      // Its old address lands on that page - by redirect, or because the new page has the same address.
      const landing = (redirectFor(`/${slug}`) ?? `/${slug}`).split("#")[0];
      expect(landing, `/${slug} is carried by ${carrier}`).toBe(carrier);
    }
    expect(HOME_SOURCES).toEqual(["test"]);
  });

  it("sends every old address to a page and a place on it that exist", () => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      expect(sitePage(from), `${from} is both a page and a redirect`).toBeUndefined();
      expect(resolves(to), `${from} → ${to}`).toBe(true);
    }
  });

  it("links only to pages, places, pictures and documents that exist", () => {
    for (const page of SITE_PAGES) {
      const html = renderMarkdown(page.body.replace(/^\{\{[a-z-]+\}\}$/gm, ""));
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href!)) continue;
        expect(resolves(href!.replace(/&amp;/g, "&")), `${page.path} links to ${href}`).toBe(true);
      }
      for (const [, src] of html.matchAll(/src="([^"]+)"/g)) expect(publicFile(src!), `${page.path} shows ${src}`).toBe(true);
      for (const picture of [...(page.gallery?.pictures ?? []), ...(page.image ? [page.image] : [])]) {
        expect(publicFile(picture.src), picture.src).toBe(true);
        expect(picture.alt.length).toBeGreaterThan(3);
      }
      for (const child of page.children ?? []) expect(sitePage(child), `${page.path} → ${child}`).toBeTruthy();
    }
  });

  it("renders nothing executable and keeps the house's wifi code off the website", () => {
    expect(renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img onerror="x">')).not.toMatch(/<script|<img|javascript:/i);
    for (const page of SITE_PAGES) {
      const html = renderMarkdown(page.body);
      expect(html).not.toMatch(/<(script|iframe|style|form|object)\b|\son[a-z]+=/i);
      expect(page.body).not.toMatch(/Hjerterum 222/);
    }
  });

  it("gives every page a title, an introduction and a description, and one address each", () => {
    const paths = SITE_PAGES.map(page => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of SITE_PAGES) {
      expect(page.title && page.lead && page.description && page.card.title, page.path).toBeTruthy();
      expect(page.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("opens signing in and the member area on medlem.hjerterum.info, where the login can hold", async () => {
    const env = { ...sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "x" }), ASSETS: { fetch: async (request: Request) => new Response(`spa ${new URL(request.url).pathname}`) } } as never;
    const at = async (address: string) => { const r = await config.fetch(new Request(address), env); return r.status === 302 ? r.headers.get("location") : await r.text(); };
    expect(await at("https://www.hjerterum.info/sign-in")).toBe("https://medlem.hjerterum.info/sign-in");
    expect(await at("https://hjerterum.info/member-portal/events?tab=mine")).toBe("https://medlem.hjerterum.info/member-portal/events?tab=mine");
    expect(await at("https://www.hjerterum.info/admin/")).toBe("https://medlem.hjerterum.info/admin/");
    expect(await at("https://www.hjerterum.info/brug-hjerterum")).toBe("spa /brug-hjerterum");
    expect(await at("https://medlem.hjerterum.info/sign-in")).toBe("spa /sign-in");
    expect(await at("https://hjerterum-preview.example.workers.dev/sign-in")).toBe("spa /sign-in");
  });

  it("answers the old addresses with a permanent redirect on the platform's addresses", async () => {
    const env = { ...sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "x" }), ASSETS: { fetch: async (request: Request) => new Response(`spa ${new URL(request.url).pathname}`) } } as never;
    const old = await config.fetch(new Request("https://medlem.hjerterum.info/fordele-ved-medlemskab/"), env);
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/medlemskab#fordele");
    expect((await config.fetch(new Request("https://medlem.hjerterum.info/bliv-medlem"), env)).headers.get("location")).toBe("/medlemskab");
    expect(await (await config.fetch(new Request("https://medlem.hjerterum.info/medlemskab"), env)).text()).toBe("spa /medlemskab");
    expect(await (await config.fetch(new Request("https://medlem.hjerterum.info/events"), env)).text()).toBe("spa /events");
    // The board's cockpit keeps its own addresses.
    expect((await config.fetch(new Request("https://admin.hjerterum.info/vision"), env)).status).toBe(401);
  });

  it("keeps the content ledger in step with the site", () => {
    expect(ledgerDocument).toBe(buildLedger(legacy));
  });
});
