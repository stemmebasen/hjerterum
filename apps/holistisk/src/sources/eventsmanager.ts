import { collapse, decodeEntities, htmlToParagraphs } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import { venueFor } from "./membershipworks.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** WordPress "Events Manager" RSS (/events/feed/). Each item's description holds the date and place as lines:
 *
 *   mandag d. 12. oktober 2026 - 18:30 - 19:20 <br />Brahma Kumaris, Århus <br />Ålborggade 22, 3. tv. <br />Aarhus
 *
 * Options: url; place (a pattern the place lines must match, e.g. one city of a national organisation);
 * skipTitles (a pattern for routine sessions shown as standing offerings instead of as events). */

const DATE = /(?:\p{L}+\s+)?d\.\s*(\d{1,2})\.\s*(\p{L}+)\s+(\d{4})/u;
const TIME = /(\d{1,2})[:.](\d{2})/g;

type Parsed = { date: { y: number; m: number; d: number }; endDate: { y: number; m: number; d: number } | null; start: [number, number] | null; end: [number, number] | null };

export function parseWhen(line: string): Parsed | null {
  const parts = line.split(/\s+-\s+/);
  const first = DATE.exec(parts[0] ?? "");
  const m1 = first ? monthNumber(first[2]!) : null;
  if (!first || !m1) return null;
  const date = { y: Number(first[3]), m: m1, d: Number(first[1]) };
  let endDate: Parsed["endDate"] = null;
  const times: Array<[number, number]> = [];
  for (const part of parts.slice(1)) {
    const other = DATE.exec(part);
    const mo = other ? monthNumber(other[2]!) : null;
    if (other && mo) { endDate = { y: Number(other[3]), m: mo, d: Number(other[1]) }; continue; }
    for (const t of part.matchAll(TIME)) times.push([Number(t[1]), Number(t[2])]);
  }
  return { date, endDate, start: times[0] ?? null, end: times[1] ?? null };
}

export function parseEventsManagerFeed(xml: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number; skipped: number } {
  const zone = config.defaults.timezone;
  const place = typeof config.options.place === "string" ? new RegExp(config.options.place, "i") : null;
  const skip = typeof config.options.skipTitles === "string" ? new RegExp(config.options.skipTitles, "i") : null;
  const events: SourceEvent[] = [];
  let unreadable = 0, skipped = 0;
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(item)?.[1];
      return m ? m.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() : null;
    };
    const title = collapse(decodeEntities(get("title") ?? ""));
    const link = get("link");
    const lines = htmlToParagraphs(get("description") ?? "");
    const when = lines[0] ? parseWhen(lines[0]) : null;
    if (!title || !link || !when) { unreadable++; continue; }
    const placeLines = lines.slice(1);
    if (place && !placeLines.some(l => place.test(l))) { skipped++; continue; }
    if (skip?.test(title)) { skipped++; continue; }
    const startDay = when.date, endDay = when.endDate ?? when.date;
    const allDay = !when.start;
    const startsAt = zonedToUtc({ year: startDay.y, month: startDay.m, day: startDay.d, hour: when.start?.[0] ?? 0, minute: when.start?.[1] ?? 0 }, zone);
    const endsAt = when.end ? zonedToUtc({ year: endDay.y, month: endDay.m, day: endDay.d, hour: when.end[0], minute: when.end[1] }, zone)
      : allDay ? zonedToUtc({ year: endDay.y, month: endDay.m, day: endDay.d + 1, hour: 0, minute: 0 }, zone) : null;
    const locationText = placeLines.join(", ") || null;
    const venue = venueFor(locationText, config.defaults.venues);
    const [venueLine, streetLine, cityLine] = placeLines;
    events.push({
      sourceEventId: link.replace(/\/+$/, "").split("/").pop() ?? link,
      title,
      paragraphs: [],
      startsAt,
      endsAt: endsAt !== null && endsAt >= startsAt ? endsAt : null,
      allDay,
      timezone: zone,
      organizerName: venue?.organizerName ?? config.defaults.organizerName,
      organizerUrl: venue?.organizerUrl ?? config.defaults.organizerUrl,
      hostName: null,
      venueName: venue?.name ?? (venueLine ? collapse(venueLine) : null),
      address: venue?.address ?? (streetLine ? collapse(streetLine) : null),
      postalCode: venue?.postalCode ?? null,
      city: venue?.city ?? (cityLine ? collapse(cityLine) : null),
      lat: venue?.lat ?? null,
      lon: venue?.lon ?? null,
      locationText,
      categoryHints: [],
      price: null,
      signupUrl: link,
      sourceUrl: link,
      imageUrl: null,
      cancelled: /\baflyst\b/i.test(title),
      qualityFlags: ["price_unknown"]
    });
  }
  return { events, unreadable, skipped };
}

export const eventsManager: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "");
    if (!/^https:\/\//.test(url)) throw new Error("eventsmanager_url_missing");
    const res = await ctx.http.get(url, { headers: { accept: "application/rss+xml, application/xml;q=0.9" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseEventsManagerFeed(decodeBody(res.body, res.headers.get("content-type")), config);
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    // The feed shows the next ~50 occurrences: an event later than the last one shown is not missing.
    return { events: upcoming, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
