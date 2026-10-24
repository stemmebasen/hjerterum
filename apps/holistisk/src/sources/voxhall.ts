import { collapse, decodeEntities } from "../text.js";
import { zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** VoxHall (voxhall.dk), the concert venue on Vester Allé. Two requests a night:
 *
 * 1. The concert list (/koncerter/) has every upcoming concert as schema.org microdata: link, start
 *    ("2026-10-24 20:00:00", Danish time), title and picture.
 * 2. The WordPress REST API (/wp-json/wp/v2/voxhall-event?slug=a,b,…) gives each concert's page: the price
 *    ("Price DKK 150,-"), the ticket button ("Køb billet", "Sold out", "Cancelled", "Fri entré"), a lead paragraph and,
 *    for concerts elsewhere (Radar, Phono, Part), a "Location" line.
 *
 * Options: url (the list), api (the REST endpoint). */

const DEFAULT_LIST = "https://voxhall.dk/koncerter/";
const DEFAULT_API = "https://voxhall.dk/wp-json/wp/v2/voxhall-event";
const text = (s: string) => collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));

export type VoxListItem = { url: string; slug: string; start: string; title: string; image: string | null };
export type VoxDetail = { slug: string; link: string; title: { rendered: string }; content: { rendered: string } };

export function parseVoxList(html: string): VoxListItem[] {
  const out: VoxListItem[] = [];
  for (const m of html.matchAll(/<article\b[^>]*js-event-element[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = m[1]!;
    const url = /<a\s[^>]*href="([^"]+)"[^>]*itemprop="url/.exec(block)?.[1] ?? /<a\s[^>]*href="([^"]+)"/.exec(block)?.[1];
    const start = /itemprop="startDate"[^>]*datetime="([^"]+)"/.exec(block)?.[1] ?? /itemprop="startDate"[^>]*content="([^"]+)"/.exec(block)?.[1];
    const title = /<h2[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1];
    if (!url || !start || !title) continue;
    const slug = url.replace(/\/+$/, "").split("/").pop()!;
    out.push({ url, slug, start, title: text(title), image: /<img[^>]*\ssrc="([^"]+)"[^>]*itemprop="image"/.exec(block)?.[1] ?? /<img[^>]*\ssrc="([^"]+)"/.exec(block)?.[1] ?? null });
  }
  return out;
}

/** "2026-10-24 20:00:00" in Danish time. */
function localTime(value: string, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, zone);
}

export type VoxFacts = { status: "open" | "sold_out" | "cancelled" | "free" | "past" | null; ticketUrl: string | null; priceText: string | null; lead: string | null; location: string | null };

export function voxFacts(content: string): VoxFacts {
  const bar = content.indexOf("event-hero-ticket-bar");
  const seg = bar >= 0 ? content.slice(bar, bar + 2500) : "";
  const button = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/.exec(seg);
  const label = button ? text(button[3]!).toLowerCase() : "";
  const status = !button ? null
    : /cancel|aflyst/.test(label) ? "cancelled"
    : /sold out|udsolgt/.test(label) ? "sold_out"
    : /fri entr|free/.test(label) ? "free"
    : /past event/.test(label) ? "past" : "open";
  const href = button?.[1] === "a" ? /href="([^"]+)"/.exec(button[2]!)?.[1] ?? null : null;
  const block = (marker: string) => {
    const i = content.indexOf(marker);
    if (i < 0) return null;
    const rest = content.slice(i + marker.length);
    const end = rest.search(/<!--/);
    const t = text(end >= 0 ? rest.slice(0, end) : rest.slice(0, 600));
    return t || null;
  };
  const priceText = block("<!-- Event price -->");
  const loc = block("<!-- Event location -->");
  const lead = /block-lead-paragraph[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/.exec(content)?.[1];
  return {
    status,
    ticketUrl: href ? decodeEntities(href) : null,
    priceText: priceText && /dkk|kr|gratis|free/i.test(priceText) ? priceText.replace(/^Price\s*/i, "Pris: ") : null,
    lead: lead ? text(lead) || null : null,
    location: loc && /^Location\s/i.test(loc) ? loc.replace(/^Location\s+/i, "") : null
  };
}

/** "Radar, Karen Wegeners Gade 6, DK 8000 Aarhus C" -> name, address, postcode, town. */
export function splitLocation(value: string): { name: string; address: string | null; postalCode: string | null; city: string | null } {
  const parts = value.split(",").map(p => p.trim()).filter(Boolean);
  const name = parts[0] ?? value;
  const postal = parts.map(p => /(?:DK[-\s]?)?(\d{4})\s+(.+)$/.exec(p)).find(Boolean);
  const address = parts.slice(1).find(p => !/\d{4}\s/.test(p) && /\d/.test(p)) ?? null;
  return { name: name.replace(/\s+[–-]\s+en del af VoxHall$/i, ""), address, postalCode: postal?.[1] ?? null, city: postal?.[2] ?? null };
}

export function voxEvents(list: VoxListItem[], details: VoxDetail[], config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const bySlug = new Map(details.map(d => [d.slug, d]));
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const item of list) {
    const startsAt = localTime(item.start, zone);
    if (startsAt === null) { unreadable++; continue; }
    const detail = bySlug.get(item.slug);
    const facts = detail ? voxFacts(detail.content.rendered) : null;
    const place = facts?.location ? splitLocation(facts.location) : null;
    const price = facts?.status === "free" ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Fri entré" } : facts?.priceText ? parsePrice([facts.priceText]) : null;
    events.push({
      sourceEventId: item.slug,
      title: detail ? text(detail.title.rendered) || item.title : item.title,
      paragraphs: facts?.lead ? [facts.lead] : [],
      startsAt,
      endsAt: null,
      allDay: false,
      timezone: zone,
      organizerName: config.defaults.organizerName,
      organizerUrl: config.defaults.organizerUrl,
      hostName: null,
      venueName: place?.name ?? venue?.name ?? null,
      address: place ? place.address : venue?.address ?? null,
      postalCode: place ? place.postalCode : venue?.postalCode ?? null,
      city: place ? place.city : venue?.city ?? null,
      lat: place ? null : venue?.lat ?? null,
      lon: place ? null : venue?.lon ?? null,
      locationText: place ? facts!.location : venue?.name ?? null,
      categoryHints: ["koncert"],
      price: price && (price.minMinor !== null || price.isFree !== null) ? { ...price, currency: "DKK" } : null,
      signupUrl: facts?.ticketUrl ?? item.url,
      sourceUrl: item.url,
      imageUrl: item.image,
      cancelled: facts?.status === "cancelled",
      qualityFlags: [...(facts?.status === "sold_out" ? ["sold_out"] : []), ...(detail ? [] : ["no_detail"])]
    });
  }
  return { events, unreadable };
}

export const voxhall: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const listUrl = String(config.options.url ?? DEFAULT_LIST);
    const api = String(config.options.api ?? DEFAULT_API);
    const res = await ctx.http.get(listUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const list = parseVoxList(decodeBody(res.body, res.headers.get("content-type")));
    if (!list.length) throw new Error("voxhall_no_concerts_found");
    const details: VoxDetail[] = [];
    // The REST API takes several slugs at once; 40 per request keeps the address short.
    for (let i = 0; i < list.length; i += 40) {
      const slugs = list.slice(i, i + 40).map(l => l.slug).join(",");
      const r = await ctx.http.get(`${api}?slug=${encodeURIComponent(slugs)}&per_page=100&_fields=slug,link,title,content`, { headers: { accept: "application/json" }, respectRobots: config.respectRobots });
      const parsed = JSON.parse(decodeBody(r.body, r.headers.get("content-type"))) as VoxDetail[];
      if (Array.isArray(parsed)) details.push(...parsed);
    }
    const { events, unreadable } = voxEvents(list, details, config);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
