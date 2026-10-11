import { findHost, htmlToParagraphs, collapse, decodeEntities } from "../text.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent, VenueRule } from "./types.js";

/** MembershipWorks: an organisation's public event calendar as RSS (?_op=rss&org=<id>), and each event's public
 * JSON (/v2/event?eid=&org=) for the address and coordinates. Options: org, signupUrlTemplate ("...{eid}"). */

type Options = { org: string; signupUrlTemplate?: string; sourceUrlTemplate?: string };

const options = (config: SourceConfig): Options => {
  const org = String(config.options.org ?? "");
  if (!/^\d+$/.test(org)) throw new Error("membershipworks_org_missing");
  return {
    org,
    ...(typeof config.options.signupUrlTemplate === "string" ? { signupUrlTemplate: config.options.signupUrlTemplate } : {}),
    ...(typeof config.options.sourceUrlTemplate === "string" ? { sourceUrlTemplate: config.options.sourceUrlTemplate } : {})
  };
};

function tag(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(block);
  if (!m?.[1]) return null;
  const inner = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return inner.trim() || null;
}

function attr(block: string, tagName: string, name: string): string | null {
  const t = new RegExp(`<${tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^>]*>`, "i").exec(block)?.[0];
  const m = t ? new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(t) : null;
  return m?.[1] ? decodeEntities(m[1]) : null;
}

const fill = (template: string | undefined, eid: string): string | null => template ? template.replace("{eid}", encodeURIComponent(eid)) : null;

export function venueFor(locationText: string | null, venues: VenueRule[]): VenueRule | null {
  if (!locationText) return null;
  return venues.find(v => v.match.test(locationText)) ?? null;
}

export function parseFeed(xml: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const opts = options(config);
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const item of items) {
    const rawTitle = tag(item, "title");
    const start = Date.parse(tag(item, "ev:startdate") ?? "");
    const guid = tag(item, "guid");
    const eid = /([0-9a-f]{24})$/i.exec((guid ?? "").trim())?.[1]?.toLowerCase() ?? null;
    if (!rawTitle || !Number.isFinite(start) || !eid) { unreadable++; continue; }
    const endParsed = Date.parse(tag(item, "ev:enddate") ?? "");
    const end = Number.isFinite(endParsed) && endParsed >= start ? endParsed : null;
    const title = collapse(decodeEntities(rawTitle));
    const cancelled = /\baflys[t]?\b|\bcancel+ed\b/i.test(title);
    const html = tag(item, "content:encoded") ?? tag(item, "description") ?? "";
    const paragraphs = htmlToParagraphs(html);
    const locationText = collapse(decodeEntities(tag(item, "ev:location") ?? "")) || null;
    const venue = venueFor(locationText, config.defaults.venues);
    const category = tag(item, "category");
    const price = parsePrice(paragraphs);
    const flags: string[] = [];
    if (price.text) flags.push("price_from_text");
    if (!venue) flags.push("venue_from_source_text");
    events.push({
      sourceEventId: eid,
      title: title.replace(/^\s*(aflyst|cancelled)\s*[:\-–!]\s*/i, "").trim() || title,
      paragraphs,
      startsAt: start,
      endsAt: end,
      allDay: false,
      timezone: config.defaults.timezone,
      organizerName: venue?.organizerName ?? config.defaults.organizerName,
      organizerUrl: venue?.organizerUrl ?? config.defaults.organizerUrl,
      hostName: findHost(paragraphs),
      venueName: venue?.name ?? locationText,
      address: venue?.address ?? null,
      postalCode: venue?.postalCode ?? null,
      city: venue?.city ?? null,
      lat: venue?.lat ?? null,
      lon: venue?.lon ?? null,
      locationText,
      categoryHints: category ? [decodeEntities(category)] : [],
      price: price.minMinor === null && price.isFree === null ? null : { ...price, currency: "DKK" },
      signupUrl: fill(opts.signupUrlTemplate, eid) ?? tag(item, "link"),
      sourceUrl: fill(opts.sourceUrlTemplate, eid) ?? tag(item, "link"),
      imageUrl: config.imagePolicy === "allowed" ? attr(item, "media:content", "url") ?? attr(item, "enclosure", "url") : null,
      cancelled,
      qualityFlags: flags
    });
  }
  return { events, unreadable };
}

type MwEvent = { ttl?: string; adn?: string; adr?: { ad1?: string; ad2?: string; zip?: string; cit?: string; con?: string; loc?: [string, string] } };

export const membershipWorks: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const { org } = options(config);
    const res = await ctx.http.get(`https://api.membershipworks.com/v2/events?_op=rss&org=${org}`, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9" }, respectRobots: config.respectRobots
    });
    const { events, unreadable } = parseFeed(decodeBody(res.body, res.headers.get("content-type")), config);
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    const windowEnd = events.length ? Math.max(...events.map(e => e.startsAt)) : null;
    return { events: upcoming, windowEnd, unreadable };
  },

  /** The event's own public record: street address, postcode, town and coordinates (only believed inside Denmark). */
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    const { org } = options(config);
    const res = await ctx.http.get(`https://api.membershipworks.com/v2/event?eid=${encodeURIComponent(event.sourceEventId)}&org=${org}`, {
      headers: { accept: "application/json" }, respectRobots: config.respectRobots
    });
    const data = JSON.parse(new TextDecoder().decode(res.body)) as MwEvent;
    const adr = data.adr;
    if (!adr || (adr.con && adr.con !== "DK")) return event;
    const lon = Number(adr.loc?.[0]), lat = Number(adr.loc?.[1]);
    const inDenmark = Number.isFinite(lat) && Number.isFinite(lon) && lat > 54.4 && lat < 57.9 && lon > 7.9 && lon < 15.3;
    const zip = /^\d{4}$/.test(adr.zip ?? "") ? adr.zip! : null;
    // The house's own entry is more exact than the calendar's ("26B" rather than "26"): keep a configured venue's address.
    const keepVenue = !event.qualityFlags.includes("venue_from_source_text") && event.postalCode !== null && event.postalCode === zip;
    const finalLat = keepVenue && event.lat !== null ? event.lat : inDenmark ? lat : event.lat;
    const finalLon = keepVenue && event.lon !== null ? event.lon : inDenmark ? lon : event.lon;
    return {
      ...event,
      venueName: event.venueName ?? (data.adn ? collapse(decodeEntities(data.adn)) : null),
      address: keepVenue ? event.address : collapse([adr.ad1, adr.ad2].filter(Boolean).join(", ")) || event.address,
      postalCode: zip ?? event.postalCode,
      city: keepVenue ? event.city : adr.cit ? collapse(adr.cit) : event.city,
      lat: finalLat,
      lon: finalLon,
      qualityFlags: event.qualityFlags.filter(f => f !== "venue_from_source_text").concat(finalLat === null ? ["no_coordinates"] : [])
    };
  }
};
