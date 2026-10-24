import { localDate, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Train (train.dk): the concert venue on Kalkværksvej and the rooms it books (TRACK, HeadQuarters, VinDanmark, …).
 * Its calendar comes from its content system's public query API (Sanity, no key): one GET returns every coming concert
 * with date, start time, venue and address, price, ticket link and status. Options: project, dataset. */

export const TRAIN_QUERY = `*[_type=="event" && date >= $from && date < $to && is_archive != true && (!defined(publish_date) || publish_date <= now())] | order(date asc, time_start asc) {_id, _updatedAt, "slug": slug.current, date, time_open, time_start, status, free_event, price, show_price, ticket_fee, ticket_link, ticket_link_label, support, "artists": artists[]->{name, country}, "venue": venue->{title, address}, "image": image.asset->url, "description": pt::text(blockContent)}`;

export type TrainEvent = {
  _id: string; slug: string | null; date: string | null; time_open: string | null; time_start: string | null;
  status: string | null; free_event: boolean | null; price: string | null; show_price: boolean | null;
  ticket_link: string | null; support: string | null; artists: Array<{ name: string | null }> | null;
  venue: { title: string | null; address: string | null } | null; image: string | null; description: string | null;
};

const hm = (v: string | null): [number, number] | null => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(v?.trim() ?? ""); return m && Number(m[1]) < 24 ? [Number(m[1]), Number(m[2])] : null; };

/** "Kalkværksvej 13, 8000 Aarhus C" */
function splitAddress(value: string | null): { address: string | null; postalCode: string | null; city: string | null } {
  const m = /^(.*?),\s*(\d{4})\s+(.+)$/.exec(value?.trim() ?? "");
  return m ? { address: m[1]!, postalCode: m[2]!, city: m[3]! } : { address: value?.trim() || null, postalCode: null, city: null };
}

export function trainEvents(rows: TrainEvent[], config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date ?? "");
    const names = (r.artists ?? []).map(a => a.name?.trim()).filter((n): n is string => !!n);
    if (!date || !names.length || !r.slug) { unreadable++; continue; }
    const [y, mo, d] = date.slice(1).map(Number) as [number, number, number];
    const start = hm(r.time_start) ?? hm(r.time_open);
    const startsAt = zonedToUtc({ year: y, month: mo, day: d, hour: start?.[0] ?? 0, minute: start?.[1] ?? 0 }, zone);
    const place = splitAddress(r.venue?.address ?? null);
    const price = Number.parseInt(r.price ?? "", 10);
    const firstParagraph = (r.description ?? "").split(/\n{2,}/).map(p => p.trim()).find(p => p && !/^obs:/i.test(p)) ?? null;
    const status = r.status ?? "";
    events.push({
      sourceEventId: r._id,
      title: names.join(" + "),
      paragraphs: [firstParagraph, r.support ? `Support: ${r.support.trim()}` : null, r.time_open && start ? `Døre ${r.time_open}` : null].filter((p): p is string => !!p),
      startsAt, endsAt: null, allDay: !start, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: r.venue?.title?.trim() || "Train", ...place, lat: null, lon: null,
      locationText: [r.venue?.title, r.venue?.address].filter(Boolean).join(", ") || null,
      categoryHints: ["koncert"],
      price: r.free_event ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" }
        : r.show_price && Number.isFinite(price) && price > 0 ? { minMinor: price * 100, maxMinor: price * 100, isFree: false, text: null, currency: "DKK" } : null,
      signupUrl: r.ticket_link?.trim() || `https://train.dk/kalender/${encodeURIComponent(r.slug)}`,
      sourceUrl: `https://train.dk/kalender/${encodeURIComponent(r.slug)}`,
      imageUrl: r.image ? `${r.image}?w=1200&fit=max&auto=format` : null,
      cancelled: status === "cancelled",
      qualityFlags: status === "sold_out" || status === "waiting_list" ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const train: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const project = String(config.options.project ?? "zr3nrpl4");
    const dataset = String(config.options.dataset ?? "production");
    const from = localDate(ctx.now, config.defaults.timezone);
    const url = `https://${project}.apicdn.sanity.io/v2021-10-21/data/query/${dataset}?query=${encodeURIComponent(TRAIN_QUERY)}&%24from=${encodeURIComponent(JSON.stringify(from))}&%24to=${encodeURIComponent(JSON.stringify("2099-01-01"))}`;
    const res = await ctx.http.get(url, { headers: { accept: "application/json" }, respectRobots: config.respectRobots });
    const body = JSON.parse(decodeBody(res.body, res.headers.get("content-type"))) as { result?: TrainEvent[] };
    if (!Array.isArray(body.result)) throw new Error("train_no_result");
    const { events, unreadable } = trainEvents(body.result, config);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
