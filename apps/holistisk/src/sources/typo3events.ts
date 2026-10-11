import { collapse, decodeEntities, htmlToParagraphs } from "../text.js";
import { decodeBody } from "./http.js";
import { venueFor } from "./membershipworks.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** TYPO3 "news" event lists as RSS (as Aarhus University's sites publish them): each item carries <eventStart>,
 * <eventEnd>, <eventPlace> and <eventOrganizer>. The text is read for categorising only; what is stored and shown
 * follows the source's descriptionPolicy (for AU: facts and a link, no text). Options: url. */

function tag(item: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(item)?.[1];
  if (!m) return null;
  return m.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() || null;
}

export function parseTypo3Events(xml: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = collapse(decodeEntities(tag(item, "title") ?? ""));
    const start = Date.parse(tag(item, "eventStart") ?? "");
    const endParsed = Date.parse(tag(item, "eventEnd") ?? "");
    const link = tag(item, "link");
    const id = tag(item, "guid") ?? link;
    if (!title || !Number.isFinite(start) || !id) { unreadable++; continue; }
    const place = collapse(decodeEntities(tag(item, "eventPlace") ?? "")) || null;
    const venue = venueFor(place, config.defaults.venues);
    const paragraphs = htmlToParagraphs(tag(item, "content:encoded") ?? tag(item, "description") ?? "");
    events.push({
      sourceEventId: id,
      title,
      paragraphs,
      startsAt: start,
      endsAt: Number.isFinite(endParsed) && endParsed >= start ? endParsed : null,
      allDay: false,
      timezone: config.defaults.timezone,
      organizerName: config.defaults.organizerName,
      organizerUrl: config.defaults.organizerUrl,
      hostName: null,
      venueName: venue?.name ?? null,
      address: venue?.address ?? null,
      postalCode: venue?.postalCode ?? null,
      city: venue?.city ?? null,
      lat: venue?.lat ?? null,
      lon: venue?.lon ?? null,
      locationText: place,
      categoryHints: [tag(item, "category") ?? ""].filter(Boolean),
      price: null,
      signupUrl: link,
      sourceUrl: link,
      imageUrl: null,
      cancelled: /\baflyst\b/i.test(title),
      qualityFlags: place && !venue ? ["place_is_region_only"] : []
    });
  }
  return { events, unreadable };
}

export const typo3Events: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "");
    if (!/^https:\/\//.test(url)) throw new Error("typo3_url_missing");
    const res = await ctx.http.get(url, { headers: { accept: "application/rss+xml, application/xml;q=0.9" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseTypo3Events(decodeBody(res.body, res.headers.get("content-type")), config);
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    return { events: upcoming, windowEnd: null, unreadable };
  }
};
