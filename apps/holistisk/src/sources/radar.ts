import { collapse, decodeEntities } from "../text.js";
import { localDate, monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Radar (radarlive.dk), the small music venue at Godsbanen: concerts, residencies and seminars.
 *
 * The calendar page lists every event as
 *   <a href="/kalender/2026/november/mercedess/?ytroute=…" class="article" title="Mercedess [SUPPORT: Solow]">
 *     <img src="/media/…"> <span class="day">12</span><span class="month">nov</span> <h2>…</h2><h5>teaser</h5></a>
 * The year is in the link. Each event's page has the times and price in its sidebar
 *   <div class="lbl lbl-hours">Døre/Koncert</div><div class="val val-hours">19:00/20:00</div>
 *   <div class="lbl lbl-price">Pris</div><div class="val val-price">DKK 165,-</div>
 * and a YourTicket button; those are read within the enrichment budget.
 * Options: url. */

const DEFAULT_URL = "https://radarlive.dk/kalender/";
const text = (s: string) => collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));

export function parseRadarList(html: string, config: SourceConfig, base: string): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const m of html.matchAll(/<a\s+href="(\/kalender\/(\d{4})\/[a-z]+\/[^"?]+\/?)[^"]*"\s+class="article"\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, path, year, rawTitle, card] = m as unknown as [string, string, string, string, string];
    if (seen.has(path)) continue;
    seen.add(path);
    const day = /<span class="day">(\d{1,2})<\/span>/.exec(card)?.[1];
    const month = monthNumber(/<span class="month">([^<]+)<\/span>/.exec(card)?.[1] ?? "");
    const title = text(rawTitle);
    if (!day || !month || !title) { unreadable++; continue; }
    const startsAt = zonedToUtc({ year: Number(year), month, day: Number(day), hour: 0, minute: 0 }, zone);
    const teaser = /<h5>([\s\S]*?)<\/h5>/.exec(card)?.[1];
    const img = /<img[^>]*\ssrc="([^"]+)"/.exec(card)?.[1];
    const url = new URL(path, base).toString();
    const free = /\[gratis\]/i.test(title);
    events.push({
      sourceEventId: path.replace(/^\/kalender\//, "").replace(/\/$/, ""),
      title: title.replace(/\s*\[(?:gratis|få billetter|udsolgt)\]\s*/gi, " ").trim(),
      paragraphs: teaser ? [text(teaser)] : [],
      startsAt, endsAt: zonedToUtc({ year: Number(year), month, day: Number(day), hour: 24, minute: 0 }, zone), allDay: true, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: [],
      price: free ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" } : null,
      signupUrl: url, sourceUrl: url, imageUrl: img ? new URL(decodeEntities(img), base).toString() : null,
      cancelled: /\baflyst\b/i.test(title),
      qualityFlags: [...(/\[udsolgt\]/i.test(title) ? ["sold_out"] : []), "time_from_event_page"]
    });
  }
  return { events, unreadable };
}

export type RadarPage = { hoursLabel: string | null; hours: string | null; price: string | null; genre: string | null; ticket: string | null };

export function parseRadarPage(html: string): RadarPage {
  const val = (key: string) => { const v = new RegExp(`class="val val-${key}">([\\s\\S]*?)</div>`).exec(html)?.[1]; return v ? text(v) || null : null; };
  const label = /class="lbl lbl-hours">([\s\S]*?)<\/div>/.exec(html)?.[1];
  return {
    hoursLabel: label ? text(label) : null, hours: val("hours"), price: val("price"), genre: val("genre"),
    ticket: /<a class="button ticket"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? null
  };
}

/** "19:00/20:00" under "Døre/Koncert" -> the concert at 20:00; "19:30" -> 19:30; "10:00-16:00" -> a range. */
export function radarTimes(label: string | null, hours: string): { start: [number, number]; end: [number, number] | null } | null {
  const times = [...hours.matchAll(/(\d{1,2})[:.](\d{2})/g)].map(m => [Number(m[1]), Number(m[2])] as [number, number]).filter(([h]) => h < 24);
  if (!times.length) return null;
  if (times.length >= 2 && /\//.test(hours) && /d[øo]re/i.test(label ?? "")) return { start: times[1]!, end: null };
  if (times.length >= 2 && /[-–]/.test(hours)) return { start: times[0]!, end: times[1]! };
  return { start: times[0]!, end: null };
}

export function applyRadarPage(event: SourceEvent, page: RadarPage, zone: string): SourceEvent {
  const out: SourceEvent = { ...event, qualityFlags: event.qualityFlags.filter(f => f !== "time_from_event_page") };
  const time = page.hours ? radarTimes(page.hoursLabel, page.hours) : null;
  if (time) {
    const [y, mo, d] = localDate(event.startsAt, zone).split("-").map(Number) as [number, number, number];
    const at = ([h, m]: [number, number]) => zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: m }, zone);
    out.allDay = false;
    out.startsAt = at(time.start);
    out.endsAt = time.end ? at(time.end) : null;
    if (out.endsAt !== null && out.endsAt <= out.startsAt) out.endsAt = null;
  }
  if (page.price) {
    const parsed = /^dkk\s*0\s*,-?$/i.test(page.price) ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis" } : parsePrice([`Pris: ${page.price}`]);
    if (parsed.minMinor !== null || parsed.isFree) out.price = { ...parsed, currency: "DKK" };
  }
  if (page.genre) out.categoryHints = [...new Set([...out.categoryHints, ...page.genre.split("/").map(g => g.trim()).filter(Boolean)])];
  if (page.ticket) out.signupUrl = decodeEntities(page.ticket);
  return out;
}

export const radar: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? DEFAULT_URL);
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events: all, unreadable } = parseRadarList(decodeBody(res.body, res.headers.get("content-type")), config, url);
    if (!all.length && !unreadable) throw new Error("radar_no_calendar_found");
    const events = all.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 86_400_000);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  },
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    if (!event.sourceUrl) return event;
    const res = await ctx.http.get(event.sourceUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    return applyRadarPage(event, parseRadarPage(decodeBody(res.body, res.headers.get("content-type"))), config.defaults.timezone);
  }
};
