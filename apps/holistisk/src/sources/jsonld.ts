import { collapse, findHost, htmlToParagraphs, decodeEntities } from "../text.js";
import { parsePrice } from "../price.js";
import { zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import { venueFor } from "./membershipworks.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** schema.org Event objects published in an organiser's own pages (<script type="application/ld+json">).
 * Only for organisers who have agreed. Options: urls (pages to read). */

type Json = Record<string, unknown>;
const EVENT_TYPES = /^(Event|BusinessEvent|ChildrensEvent|ComedyEvent|CourseInstance|DanceEvent|EducationEvent|ExhibitionEvent|Festival|LiteraryEvent|MusicEvent|SocialEvent|SportsEvent|TheaterEvent|VisualArtsEvent)$/;

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1]!.trim())); } catch { /* a broken block is skipped */ }
  }
  return out;
}

export function findEvents(node: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(node)) { for (const n of node) findEvents(n, found); return found; }
  if (!node || typeof node !== "object") return found;
  const obj = node as Json;
  const types = ([] as unknown[]).concat(obj["@type"] ?? []).map(String);
  if (types.some(t => EVENT_TYPES.test(t))) found.push(obj);
  for (const key of ["@graph", "itemListElement", "item", "event", "events", "subEvent"]) if (obj[key]) findEvents(obj[key], found);
  return found;
}

const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? collapse(decodeEntities(v)) : null;
const first = (v: unknown): unknown => Array.isArray(v) ? v[0] : v;

/** schema.org dates: with an offset or Z they are instants; without, they are wall-clock time in the feed's zone. */
export function parseSchemaDate(value: unknown, zone: string): { ms: number; allDay: boolean } | null {
  const v = str(value);
  if (!v) return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return { ms: zonedToUtc({ year: +d[1]!, month: +d[2]!, day: +d[3]!, hour: 0, minute: 0 }, zone), allDay: true };
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(v);
  if (local) return { ms: zonedToUtc({ year: +local[1]!, month: +local[2]!, day: +local[3]!, hour: +local[4]!, minute: +local[5]!, second: +(local[6] ?? 0) }, zone), allDay: false };
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? { ms, allDay: false } : null;
}

export function eventFromSchema(obj: Json, config: SourceConfig, pageUrl: string): SourceEvent | null {
  const zone = config.defaults.timezone;
  const title = str(obj.name);
  const start = parseSchemaDate(obj.startDate, zone);
  if (!title || !start) return null;
  const end = parseSchemaDate(obj.endDate, zone);
  const location = first(obj.location) as Json | string | undefined;
  const place = typeof location === "object" && location ? location : null;
  const address = place && typeof place.address === "object" ? place.address as Json : null;
  const geo = place && typeof place.geo === "object" ? place.geo as Json : null;
  const locationText = typeof location === "string" ? collapse(location) : str(place?.name) ?? (typeof place?.address === "string" ? collapse(place.address) : null);
  const venue = venueFor(locationText, config.defaults.venues);
  const paragraphs = config.descriptionPolicy === "none" ? [] : htmlToParagraphs(str(obj.description) ?? "");
  const offers = first(obj.offers) as Json | undefined;
  const low = Number(offers?.lowPrice ?? offers?.price), high = Number(offers?.highPrice ?? offers?.price);
  const textPrice = parsePrice(paragraphs);
  const price = Number.isFinite(low)
    ? { minMinor: Math.round(low * 100), maxMinor: Math.round((Number.isFinite(high) ? high : low) * 100), isFree: low === 0 && (!Number.isFinite(high) || high === 0), text: null, currency: str(offers?.priceCurrency) ?? "DKK" }
    : textPrice.minMinor === null && textPrice.isFree === null ? null : { ...textPrice, currency: "DKK" };
  const organizer = first(obj.organizer) as Json | undefined;
  const image = first(obj.image);
  const imageUrl = typeof image === "string" ? image : str((image as Json | undefined)?.url);
  const url = str(obj.url) ?? str(offers?.url);
  const lat = Number(geo?.latitude), lon = Number(geo?.longitude);
  return {
    sourceEventId: url && url !== pageUrl ? url : `${title}|${new Date(start.ms).toISOString()}`,
    title,
    paragraphs,
    startsAt: start.ms,
    endsAt: end && end.ms >= start.ms ? end.ms : null,
    allDay: start.allDay,
    timezone: zone,
    organizerName: venue?.organizerName ?? str(organizer?.name) ?? config.defaults.organizerName,
    organizerUrl: venue?.organizerUrl ?? str(organizer?.url) ?? config.defaults.organizerUrl,
    hostName: findHost(paragraphs),
    venueName: venue?.name ?? str(place?.name),
    address: venue?.address ?? str(address?.streetAddress),
    postalCode: venue?.postalCode ?? str(address?.postalCode),
    city: venue?.city ?? str(address?.addressLocality),
    lat: venue?.lat ?? (Number.isFinite(lat) ? lat : null),
    lon: venue?.lon ?? (Number.isFinite(lon) ? lon : null),
    locationText,
    categoryHints: ([] as unknown[]).concat(obj.keywords ?? [], obj["@type"] ?? []).map(String),
    price,
    signupUrl: str(offers?.url) ?? url ?? pageUrl,
    sourceUrl: url ?? pageUrl,
    imageUrl: config.imagePolicy === "allowed" ? imageUrl : null,
    cancelled: /EventCancelled/i.test(String(obj.eventStatus ?? "")) || /\baflyst\b/i.test(title),
    qualityFlags: price && price.text ? ["price_from_text"] : []
  };
}

export const jsonLd: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const urls = Array.isArray(config.options.urls) ? config.options.urls.map(String).filter(u => /^https:\/\//.test(u)) : [];
    if (!urls.length) throw new Error("jsonld_urls_missing");
    const events: SourceEvent[] = [];
    let unreadable = 0;
    for (const url of urls) {
      const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
      for (const obj of findEvents(extractJsonLd(decodeBody(res.body, res.headers.get("content-type"))))) {
        const ev = eventFromSchema(obj, config, url);
        if (ev) events.push(ev); else unreadable++;
      }
    }
    // A page shows a selection, not necessarily every upcoming event: nothing is withdrawn for being absent.
    return { events: events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000), windowEnd: null, unreadable };
  }
};
