import { collapse, findHost, htmlToParagraphs, summarize } from "../text.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Billetto's Public Event API for publishers (https://api.billetto.com/docs/overview.md). Requires an API key pair
 * (secret BILLETTO_API_KEYPAIR, sent as the Api-Keypair header) and Billetto's publisher terms: the event URL is used
 * in full with its UTM tags, and our event page names Billetto's page as canonical. Options: queries (a list of
 * query strings, e.g. "region=Midtjylland&category=yoga"). */

type Billetto = {
  id?: string | number; state?: string; title?: string; description?: string; url?: string; image_link?: string;
  organizer?: { id?: number | string; name?: string };
  minimum_price?: { amount?: string; currency?: string };
  categorisation?: { category?: string; category_localized?: string; subcategory_localized?: string | null };
  localized_type?: string;
  location?: { location_name?: string; address_line?: string; city?: string; postal_code?: string; coordinates?: { latitude?: number; longitude?: number } };
  startdate?: string; enddate?: string;
};

export function eventFromBilletto(b: Billetto, config: SourceConfig): SourceEvent | null {
  const start = Date.parse(b.startdate ?? "");
  const title = collapse(b.title);
  if (b.id === undefined || !title || !Number.isFinite(start) || !b.url) return null;
  const endParsed = Date.parse(b.enddate ?? "");
  const all = htmlToParagraphs(b.description ?? "");
  // Billetto's own page is the canonical home of the text; the portal shows a short excerpt.
  const excerpt = config.descriptionPolicy === "full" ? all : config.descriptionPolicy === "excerpt" ? [summarize(all, 300)].filter((p): p is string => !!p) : [];
  const amount = Number(b.minimum_price?.amount);
  const lat = Number(b.location?.coordinates?.latitude), lon = Number(b.location?.coordinates?.longitude);
  return {
    sourceEventId: String(b.id),
    title,
    paragraphs: excerpt,
    startsAt: start,
    endsAt: Number.isFinite(endParsed) && endParsed >= start ? endParsed : null,
    allDay: false,
    timezone: config.defaults.timezone,
    organizerName: collapse(b.organizer?.name) || null,
    organizerUrl: null,
    hostName: findHost(all),
    venueName: collapse(b.location?.location_name?.split(",")[0]) || null,
    address: collapse(b.location?.address_line) || null,
    postalCode: /^\d{4}$/.test(b.location?.postal_code ?? "") ? b.location!.postal_code! : null,
    city: collapse(b.location?.city) || null,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lon: Number.isFinite(lon) && lon !== 0 ? lon : null,
    locationText: collapse(b.location?.location_name) || null,
    categoryHints: [b.categorisation?.category_localized, b.categorisation?.subcategory_localized, b.localized_type].filter((x): x is string => !!x),
    price: Number.isFinite(amount) ? { minMinor: Math.round(amount * 100), maxMinor: null, isFree: amount === 0, text: amount > 0 ? "Fra-pris hos Billetto" : null, currency: b.minimum_price?.currency ?? "DKK" } : null,
    signupUrl: b.url,
    sourceUrl: b.url,
    imageUrl: config.imagePolicy === "allowed" ? b.image_link ?? null : null,
    cancelled: /cancel|aflyst/i.test(b.state ?? ""),
    qualityFlags: ["price_minimum_only"]
  };
}

export const billetto: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const keypair = ctx.env.BILLETTO_API_KEYPAIR;
    if (!keypair) throw new Error("billetto_key_missing");
    const queries = Array.isArray(config.options.queries) ? config.options.queries.map(String) : [];
    const byId = new Map<string, SourceEvent>();
    let unreadable = 0;
    for (const query of queries) {
      const res = await ctx.http.get(`https://billetto.dk/api/v3/public/events?limit=100&${query}`, {
        headers: { accept: "application/json", "Api-Keypair": keypair }, respectRobots: false
      });
      const data = JSON.parse(new TextDecoder().decode(res.body)) as { data?: Billetto[] };
      for (const item of data.data ?? []) {
        const ev = eventFromBilletto(item, config);
        if (ev) byId.set(ev.sourceEventId, ev); else unreadable++;
      }
    }
    // Each query returns at most 100 events, so the listing is not known to be complete.
    return { events: [...byId.values()].filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000), windowEnd: null, unreadable };
  }
};
