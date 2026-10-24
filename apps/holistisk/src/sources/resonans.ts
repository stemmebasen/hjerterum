import { collapse, decodeEntities } from "../text.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Resonans Bistro & Bar in Sydhavnen: concerts and jazz in the café. The site's own small JSON list
 * (/public/events/upcoming) gives title, start (UTC), status, picture and ticket link; no price or text.
 * Options: url. */

const DEFAULT_URL = "https://resonansbistro.dk/public/events/upcoming?limit=200";
export type ResonansEvent = { id: string; title: string | null; start_at: string | null; status: string | null; image_url: string | null; ticketUrl: string | null };

export function resonansEvents(rows: ResonansEvent[], config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const startsAt = Date.parse(r.start_at ?? "");
    if (!r.id || !r.title || !Number.isFinite(startsAt)) { unreadable++; continue; }
    events.push({
      sourceEventId: r.id, title: collapse(decodeEntities(r.title)), paragraphs: [],
      startsAt, endsAt: null, allDay: false, timezone: config.defaults.timezone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: ["koncert"], price: null,
      signupUrl: r.ticketUrl ?? config.defaults.organizerUrl, sourceUrl: r.ticketUrl ?? config.defaults.organizerUrl,
      imageUrl: r.image_url, cancelled: r.status === "cancelled",
      qualityFlags: r.status === "sold_out" ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const resonans: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const res = await ctx.http.get(String(config.options.url ?? DEFAULT_URL), { headers: { accept: "application/json" }, respectRobots: config.respectRobots });
    const rows = JSON.parse(decodeBody(res.body, res.headers.get("content-type"))) as ResonansEvent[];
    if (!Array.isArray(rows)) throw new Error("resonans_bad_response");
    const { events, unreadable } = resonansEvents(rows, config);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
