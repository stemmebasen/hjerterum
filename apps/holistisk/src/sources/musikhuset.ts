import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Musikhuset Aarhus (musikhuset.dk). The site's own JSON API, two GETs a night:
 *   /api/v2/events/showings?limit=2000&from=YYYY-MM-DD – one row per performance: title, start (UTC), genres, poster,
 *     status (0 on sale, 1 few left, 2 waiting list, 3 not on sale, 4 sold out, 5 cancelled, 6 held);
 *   /api/v2/events?limit=2000 – one row per production: lowest and highest price in kroner (0 = free), promoter.
 * Only performances within options.daysAhead (default 120) are taken, so the calendar is not filled years ahead.
 * Options: base, daysAhead. */

type Genre = { slug: string };
export type MhShowing = { id: string; eventId: string; title: string; subtitle: string; path: string; date: string; eventStatus: number; genres: Genre[]; poster: { src?: string } | null };
export type MhEvent = { eventId: string; minimumPrice: number | null; maximumPrice: number | null; promoter: string | null; genres: Genre[] };

export function musikhusetEvents(showings: MhShowing[], productions: MhEvent[], config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const base = String(config.options.base ?? "https://www.musikhuset.dk");
  const horizon = now + Number(config.options.daysAhead ?? 120) * 86_400_000;
  const byEvent = new Map(productions.map(p => [p.eventId, p]));
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const s of showings) {
    const startsAt = Date.parse(s.date);
    if (!s.title || !s.path || !Number.isFinite(startsAt)) { unreadable++; continue; }
    if (startsAt > horizon || s.eventStatus === 6) continue;
    const prod = byEvent.get(s.eventId);
    const genres = (s.genres ?? []).map(g => g.slug);
    const free = genres.includes("gratis") || (prod?.minimumPrice === 0 && prod?.maximumPrice === 0);
    const min = prod?.minimumPrice ?? null, max = prod?.maximumPrice ?? null;
    const promoter = prod?.promoter?.trim() || null;
    events.push({
      sourceEventId: s.id,
      title: s.title.trim(),
      paragraphs: [s.subtitle?.trim() || null, promoter && promoter !== "Musikhuset Aarhus" ? `Arrangør: ${promoter}` : null].filter((p): p is string => !!p),
      startsAt, endsAt: null, allDay: false, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: genres.filter(g => g !== "gratis"),
      price: free ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" }
        : min !== null && min > 0 ? { minMinor: Math.round(min * 100), maxMinor: Math.round((max && max >= min ? max : min) * 100), isFree: false, text: null, currency: "DKK" } : null,
      signupUrl: base + s.path, sourceUrl: base + s.path,
      imageUrl: s.poster?.src ? `${s.poster.src}?w=1200&auto=format` : null,
      cancelled: s.eventStatus === 5,
      qualityFlags: s.eventStatus === 4 || s.eventStatus === 2 ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const musikhuset: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const base = String(config.options.base ?? "https://www.musikhuset.dk");
    const from = new Date(ctx.now).toISOString().slice(0, 10);
    const get = async <T>(path: string): Promise<T> => {
      const res = await ctx.http.get(base + path, { headers: { accept: "application/json" }, respectRobots: config.respectRobots });
      const body = JSON.parse(decodeBody(res.body, res.headers.get("content-type"))) as { data?: T };
      if (!Array.isArray(body.data)) throw new Error(`musikhuset_bad_response ${path}`);
      return body.data;
    };
    const showings = await get<MhShowing[]>(`/api/v2/events/showings?limit=2000&from=${from}`);
    const productions = await get<MhEvent[]>("/api/v2/events?limit=2000");
    const { events, unreadable } = musikhusetEvents(showings, productions, config, ctx.now);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
