import { addDays, weekdayIndex, zonedToUtc } from "../time.js";
import { collapse, findHost, htmlToParagraphs } from "../text.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { extractJsonLd, findEvents } from "./jsonld.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Diamond Way Buddhism (buddha.dk): every Danish centre's lecture events are schema.org Event objects on the front
 * page. Their dates are written as midnight UTC; the evenings and times are in the text, one line per day:
 *
 *   Onsdag: Emne: "Meditation" fra kl 19:00 - 21:00
 *
 * So each such line becomes its own event ("Meditation – Julianne Ferenczy", Wednesday 19–21). Options: url,
 * postalCodes (the centre's postcodes; events elsewhere in Denmark are left out). */

const WEEKDAYS = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
const DAY_LINE = /^(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s*:\s*(?:emne\s*:\s*)?["“”]?([^"“”]*?)["“”]?\s*fra\s+kl\.?\s*(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/i;

type Json = Record<string, unknown>;
const str = (v: unknown) => typeof v === "string" ? collapse(v) : "";

export function eventsFromDiamondWay(html: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const postcodes = Array.isArray(config.options.postalCodes) ? config.options.postalCodes.map(String) : [];
  const venue = config.defaults.venues[0] ?? null;
  const out: SourceEvent[] = [];
  let unreadable = 0;
  for (const obj of findEvents(extractJsonLd(html)) as Json[]) {
    const location = (obj.location ?? {}) as Json;
    const address = (location.address ?? {}) as Json;
    if (postcodes.length && !postcodes.includes(str(address.postalCode))) continue;
    const name = str(obj.name);
    const startIso = str(obj.startDate), endIso = str(obj.endDate) || startIso;
    if (!name || !/^\d{4}-\d{2}-\d{2}/.test(startIso)) { unreadable++; continue; }
    const firstDay = startIso.slice(0, 10), lastDay = endIso.slice(0, 10);
    const paragraphs = htmlToParagraphs((typeof obj.description === "string" ? obj.description : "").replace(/\n/g, "<br>"));
    const performer = (Array.isArray(obj.performer) ? obj.performer[0] : obj.performer) as Json | undefined;
    const host = str(performer?.name) || findHost(paragraphs);
    const price = parsePrice(paragraphs);
    const offers = (Array.isArray(obj.offers) ? obj.offers[0] : obj.offers) as Json | undefined;
    const link = str(offers?.url) || config.homepageUrl;
    const intro = paragraphs.filter(p => !DAY_LINE.test(p));
    const base = {
      paragraphs: intro, allDay: false, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: host || null,
      venueName: venue?.name ?? (str(location.name) || null), address: venue?.address ?? (str(address.streetAddress) || null),
      postalCode: venue?.postalCode ?? (str(address.postalCode) || null), city: venue?.city ?? (str(address.addressLocality) || null),
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: str(location.name) || null,
      categoryHints: ["Buddhisme", "Meditation"],
      price: price.minMinor === null && price.isFree === null ? null : { ...price, currency: "DKK" },
      signupUrl: link, sourceUrl: link, imageUrl: null,
      cancelled: /cancel/i.test(str(obj.eventStatus)), qualityFlags: price.text ? ["price_from_text"] : []
    };
    // One event per evening named in the text, on the dates the event spans.
    const days: string[] = [];
    for (let d = firstDay; d <= lastDay && days.length < 14; d = addDays(d, 1)) days.push(d);
    let found = 0;
    for (const line of paragraphs) {
      const m = DAY_LINE.exec(line);
      if (!m) continue;
      const date = days.find(d => WEEKDAYS[weekdayIndex(d)] === m[1]!.toLowerCase());
      if (!date) continue;
      const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
      const topic = collapse(m[2] ?? "");
      found++;
      out.push({
        ...base,
        sourceEventId: `${firstDay}-${date}-${topic.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-")}`,
        title: [topic ? `${topic}` : name, host].filter(Boolean).join(" – "),
        startsAt: zonedToUtc({ year: y, month: mo, day: d, hour: Number(m[3]), minute: Number(m[4]) }, zone),
        endsAt: zonedToUtc({ year: y, month: mo, day: d, hour: Number(m[5]), minute: Number(m[6]) }, zone)
      });
    }
    // No evening lines: one all-day event over the dates given (the times are unknown, so none are invented).
    if (!found) {
      const [y1, m1, d1] = firstDay.split("-").map(Number) as [number, number, number];
      const [y2, m2, d2] = addDays(lastDay, 1).split("-").map(Number) as [number, number, number];
      out.push({
        ...base, allDay: true, sourceEventId: `${firstDay}-${name.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-")}`,
        title: [name, host].filter(Boolean).join(" – "),
        startsAt: zonedToUtc({ year: y1, month: m1, day: d1, hour: 0, minute: 0 }, zone),
        endsAt: zonedToUtc({ year: y2, month: m2, day: d2, hour: 0, minute: 0 }, zone),
        qualityFlags: [...base.qualityFlags, "time_unknown"]
      });
    }
  }
  return { events: out, unreadable };
}

export const diamondWay: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "https://buddha.dk/");
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events, unreadable } = eventsFromDiamondWay(decodeBody(res.body, res.headers.get("content-type")), config);
    // The front page lists every centre's coming events: one that disappears (within the dates shown) was withdrawn.
    return { events: events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000), windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
