import { collapse, decodeEntities } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Løve's Bog- og VinCafé (loeves.dk), the book café on Nørregade: book club, open poetry stage, readings.
 *
 * The calendar page is a plain list of paragraphs:
 *   <p>NOVEMBER 2026</p> <p>10. november</p> <p><a href="https://www.facebook.com/events/…">Bog-klub møde #169</a></p> …
 * A month heading gives the year, a date line the day, and the linked line that follows is the event, linked to its
 * Facebook event. The page gives no times, so the events are shown as all-day with a link to the café's own event.
 * Options: url. */

const DEFAULT_URL = "https://www.loeves.dk/bogcafeen-kalender.html";
const text = (s: string) => collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));

export function parseLoeves(html: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  let year: number | null = null, monthOfHeading: number | null = null;
  let date: { y: number; m: number; d: number } | null = null;
  for (const p of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const inner = p[1]!;
    const line = text(inner);
    if (!line) continue;
    const heading = /^([A-ZÆØÅa-zæøå]+)\s+(\d{4})$/.exec(line);
    if (heading && monthNumber(heading[1]!)) { year = Number(heading[2]); monthOfHeading = monthNumber(heading[1]!); date = null; continue; }
    const day = /^(\d{1,2})\.\s*([a-zæøå]+)$/i.exec(line);
    if (day && year) {
      const m = monthNumber(day[2]!);
      if (!m) { unreadable++; date = null; continue; }
      // A January date under a December heading belongs to the next year.
      date = { y: monthOfHeading && m < monthOfHeading ? year + 1 : year, m, d: Number(day[1]) };
      continue;
    }
    const link = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(inner);
    if (!link || !date) continue;
    const title = text(link[2]!);
    if (!title) { unreadable++; continue; }
    const url = decodeEntities(link[1]!);
    const startsAt = zonedToUtc({ year: date.y, month: date.m, day: date.d, hour: 0, minute: 0 }, zone);
    const id = /facebook\.com\/events\/(?:\d+\/)?(\d+)/.exec(url)?.[1] ?? `${date.y}-${date.m}-${date.d}-${title.toLowerCase()}`;
    events.push({
      sourceEventId: id,
      title: title.replace(/\s*-?\s*aflyst\s*!?$/i, "").replace(/^aflyst\s*[:!-]\s*/i, ""),
      paragraphs: [],
      startsAt, endsAt: zonedToUtc({ year: date.y, month: date.m, day: date.d, hour: 24, minute: 0 }, zone), allDay: true, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: [], price: null,
      signupUrl: url, sourceUrl: url, imageUrl: null,
      cancelled: /\baflyst\b/i.test(title), qualityFlags: ["no_time"]
    });
    // One event per date line; a second link under the same date needs its own date line.
    date = null;
  }
  return { events, unreadable };
}

export const loeves: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? DEFAULT_URL);
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events: all, unreadable } = parseLoeves(decodeBody(res.body, res.headers.get("content-type")), config);
    if (!all.length && !unreadable) throw new Error("loeves_no_calendar_found");
    const events = all.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 86_400_000);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
