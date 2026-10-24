import { collapse, decodeEntities } from "../text.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Aarhus Kommunes Biblioteker (aakb.dk), including Dokk1. Their public events API returns every ongoing and coming
 * event in one GET (/api/v1/events/happening?_format=json): start and end with offset, branch, address, ticket prices
 * (0 = free), state (Active, SoldOut, Cancelled, …), categories and pictures. robots.txt asks for 10 s between requests;
 * this is one request a night.
 * Options: url, branches (names to keep, e.g. ["Hovedbiblioteket"]), daysAhead (default 60), maxDays (default 14). */

const DEFAULT_URL = "https://www.aakb.dk/api/v1/events/happening?_format=json";

export type AakbEvent = {
  uuid: string; title: string; description: string | null; url: string; state: string | null; all_day: boolean | null;
  date_time: { start: string; end: string | null } | null; branches: string[] | null;
  address: { locationType?: string; location?: string | null; street?: string | null; zip_code?: number | string | null; city?: string | null } | null;
  ticket_categories: Array<{ price?: { value?: number | null } | null }> | null; categories: string[] | null;
  image: { url?: string | null } | null; external_data: { url?: string | null } | null;
};

/** "Hovedbiblioteket" is Dokk1. */
const branchName = (b: string | undefined) => b === "Hovedbiblioteket" ? "Dokk1" : b ?? null;

export function aakbEvents(rows: AakbEvent[], config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const keep = Array.isArray(config.options.branches) ? (config.options.branches as string[]) : null;
  const horizon = now + Number(config.options.daysAhead ?? 60) * 86_400_000;
  const maxDays = Number(config.options.maxDays ?? 14);
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const startsAt = Date.parse(r.date_time?.start ?? "");
    const endsAt = r.date_time?.end ? Date.parse(r.date_time.end) : NaN;
    if (!r.title || !r.url || !Number.isFinite(startsAt)) { unreadable++; continue; }
    if (keep && !(r.branches ?? []).some(b => keep.includes(b))) continue;
    if (r.address?.locationType === "online") continue;
    const skip = Array.isArray(config.options.skipCategories) ? (config.options.skipCategories as string[]) : [];
    if ((r.categories ?? []).some(c => skip.includes(c))) continue;
    if (startsAt > horizon || (Number.isFinite(endsAt) ? endsAt : startsAt) < now) continue;
    if (Number.isFinite(endsAt) && (endsAt - startsAt) / 86_400_000 > maxDays) continue;
    const prices = (r.ticket_categories ?? []).map(t => t.price?.value).filter((v): v is number => typeof v === "number" && v >= 0);
    const min = prices.length ? Math.min(...prices) : null, max = prices.length ? Math.max(...prices) : null;
    const title = collapse(decodeEntities(r.title));
    const branch = branchName(r.branches?.[0]);
    events.push({
      sourceEventId: r.uuid,
      title: title.replace(/^\s*aflyst\s*[:!-]?\s*/i, ""),
      paragraphs: r.description ? [collapse(decodeEntities(r.description))] : [],
      startsAt, endsAt: Number.isFinite(endsAt) && endsAt > startsAt ? endsAt : null, allDay: r.all_day === true, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: branch, address: r.address?.street ?? null, postalCode: r.address?.zip_code ? String(r.address.zip_code) : null, city: r.address?.city ?? null,
      lat: null, lon: null, locationText: [r.address?.location, branch].filter(Boolean).join(", ") || null,
      categoryHints: r.categories ?? [],
      price: min === null ? null : min === 0 && max === 0 ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" }
        : { minMinor: Math.round(min * 100), maxMinor: Math.round((max ?? min) * 100), isFree: false, text: null, currency: "DKK" },
      signupUrl: r.external_data?.url || r.url, sourceUrl: r.url, imageUrl: r.image?.url ?? null,
      cancelled: r.state === "Cancelled" || /^\s*aflyst\b/i.test(r.title),
      qualityFlags: r.state === "SoldOut" ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const aakb: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const res = await ctx.http.get(String(config.options.url ?? DEFAULT_URL), { headers: { accept: "application/json" }, respectRobots: config.respectRobots });
    const rows = JSON.parse(decodeBody(res.body, res.headers.get("content-type"))) as AakbEvent[];
    if (!Array.isArray(rows)) throw new Error("aakb_bad_response");
    const { events, unreadable } = aakbEvents(rows, config, ctx.now);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
