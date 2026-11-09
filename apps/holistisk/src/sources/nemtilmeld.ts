import { collapse, decodeEntities } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** An association's public event list on NemTilmeld (<forening>.nemtilmeld.dk), the sign-up system many Danish
 * associations use. One adapter serves any of them; each association is its own source with its own url.
 *
 * Each event is an <article> with
 *   <a href="https://<forening>.nemtilmeld.dk/204/"><h3>Title</h3></a> <p class="description">…</p>
 *   <span class="time-wrapper"><span class="no-wrap">Lørdag d.</span><span>14. november 2026</span><span>kl. 15:00</span>
 *     <span>til</span> <span>søndag d.</span><span>15. november 2026</span><span>kl. 13:00</span> …
 *   <p class="location">… Frederiksbjerg Skole</p> <p class="price">50 kr.</p> <span class="status registration_open">
 * Courses running for weeks and memberships are left out: only events of at most maxDays (default 2) are kept.
 * Options: url, maxDays, city (the town the association's places are in when the location names only a building). */

const text = (s: string) => collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));

type Stamp = { y: number; m: number; d: number; h: number; mi: number } | null;

/** "Lørdag d. 14. november 2026 kl. 15:00 til søndag d. 15. november 2026 kl. 13:00", "Søndag d. 29. november 2026 kl. 14:30 til 17:30". */
export function parseNemTilmeldTime(value: string): { start: NonNullable<Stamp>; end: Stamp } | null {
  const [from, to] = value.split(/\s+til\s+/i);
  const date = (s: string) => { const m = /(\d{1,2})\.\s*([a-zæøå]+)\s+(\d{4})/i.exec(s); const mo = m ? monthNumber(m[2]!) : null; return m && mo ? { y: Number(m[3]), m: mo, d: Number(m[1]) } : null; };
  const clock = (s: string) => { const m = /(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})/.exec(s); return m && Number(m[1]) < 24 ? { h: Number(m[1]), mi: Number(m[2]) } : null; };
  const d1 = date(from ?? "");
  if (!d1) return null;
  const c1 = clock(from!) ?? { h: 0, mi: 0 };
  const start = { ...d1, ...c1 };
  if (!to) return { start, end: null };
  const d2 = date(to) ?? d1;
  const c2 = clock(to);
  return { start, end: c2 ? { ...d2, ...c2 } : null };
}

export function parseNemTilmeld(html: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const maxDays = Number(config.options.maxDays ?? 2);
  const city = config.options.city ? String(config.options.city) : null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const a of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = a[1]!;
    const link = /<a\s[^>]*href="([^"]+)"[^>]*>\s*<h3>([\s\S]*?)<\/h3>/.exec(block);
    const timeText = /class="time-wrapper">([\s\S]*?)<span class="sr-only"/.exec(block)?.[1] ?? /class="time-wrapper">([\s\S]*?)<\/p>/.exec(block)?.[1];
    const when = timeText ? parseNemTilmeldTime(text(timeText)) : null;
    if (!link || !when) { unreadable++; continue; }
    const at = (s: NonNullable<Stamp>) => zonedToUtc({ year: s.y, month: s.m, day: s.d, hour: s.h, minute: s.mi }, zone);
    const startsAt = at(when.start);
    let endsAt = when.end ? at(when.end) : null;
    if (endsAt !== null && endsAt <= startsAt) endsAt = null;
    if (endsAt !== null && (endsAt - startsAt) / 86_400_000 > maxDays) continue;
    const title = text(link[2]!);
    const url = decodeEntities(link[1]!);
    const description = /<p class="description">([\s\S]*?)<\/p>/.exec(block)?.[1];
    const location = /<p class="location"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1];
    const place = location ? text(location) || null : null;
    const priceText = /<p class="price"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1];
    const parsed = priceText ? parsePrice([`Pris: ${text(priceText)}`]) : null;
    const status = /class="status ([a-z_]+)"/.exec(block)?.[1] ?? "";
    const img = /<img[^>]*\ssrc="([^"]+)"/.exec(block)?.[1];
    const venue = config.defaults.venues.find(v => v.match.test(place ?? "")) ?? null;
    events.push({
      sourceEventId: /\/(\d+)\/?$/.exec(url)?.[1] ?? url,
      title, paragraphs: description ? [text(description)] : [],
      startsAt, endsAt, allDay: false, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? place, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? city,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: place ? [place, city].filter(Boolean).join(", ") : city,
      categoryHints: [],
      price: parsed && (parsed.minMinor !== null || parsed.isFree) ? { ...parsed, currency: "DKK" } : null,
      signupUrl: url, sourceUrl: url, imageUrl: img ? decodeEntities(img) : null,
      cancelled: /cancel|aflyst/i.test(status) || /\baflyst\b/i.test(title),
      qualityFlags: /sold_out|full|waiting/i.test(status) ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const nemtilmeld: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url);
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events: all, unreadable } = parseNemTilmeld(decodeBody(res.body, res.headers.get("content-type")), config);
    const events = all.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
