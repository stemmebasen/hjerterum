import { collapse, decodeEntities } from "../text.js";
import { localDate, monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Godsbanen (godsbanen.dk/kalender/), Aarhus' culture yard: concerts in Radar, workshops, courses, talks and markets.
 *
 * The calendar page lists every event as
 *   <article class="event-overview__item" data-event-type="billedkunst,gratis" data-event-start="202610" data-event-end="">
 *     … <h3>Billedkunst</h3><h2>Title</h2><div class="event-overview__item__date">23.-24.okt.</div>
 * The day and month are in the date text, the year in data-event-start/-end. Each event's page then has
 * "DATO: … TID: Kl. 9.15 - 12.55 LOKALE: Radar … ENTRÉ: 150.-" and a ticket link, read within the enrichment budget.
 * Exhibitions running for weeks are left out: they would sit at the top of the calendar as already begun.
 * Options: url, maxDays (default 14). */

const DEFAULT_URL = "https://godsbanen.dk/kalender/";
const text = (s: string) => collapse(decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")));

export type GodsItem = { id: string; url: string; types: string[]; label: string | null; title: string; image: string | null; start: { y: number; m: number; d: number }; end: { y: number; m: number; d: number } | null };

/** "23.-24.okt.", "3.okt.-12.dec.", "5.- 6.dec.", "24.okt." with the years from the data attributes. */
export function parseGodsDate(value: string, startYm: string, endYm: string): { start: { y: number; m: number; d: number }; end: { y: number; m: number; d: number } | null } | null {
  const v = value.replace(/\s+/g, "").toLowerCase();
  const y1 = Number(startYm.slice(0, 4)), y2 = Number((endYm || startYm).slice(0, 4));
  let m = /^(\d{1,2})\.([a-zæøå]+)\.?-(\d{1,2})\.([a-zæøå]+)\.?$/.exec(v);
  if (m) {
    const m1 = monthNumber(m[2]!), m2 = monthNumber(m[4]!);
    return m1 && m2 ? { start: { y: y1, m: m1, d: Number(m[1]) }, end: { y: y2, m: m2, d: Number(m[3]) } } : null;
  }
  m = /^(\d{1,2})\.-(\d{1,2})\.([a-zæøå]+)\.?$/.exec(v);
  if (m) {
    const mo = monthNumber(m[3]!);
    return mo ? { start: { y: y1, m: mo, d: Number(m[1]) }, end: { y: y2, m: mo, d: Number(m[2]) } } : null;
  }
  m = /^(\d{1,2})\.([a-zæøå]+)\.?$/.exec(v);
  if (m) {
    const mo = monthNumber(m[2]!);
    return mo ? { start: { y: y1, m: mo, d: Number(m[1]) }, end: null } : null;
  }
  return null;
}

export function parseGodsList(html: string): { items: GodsItem[]; unreadable: number } {
  const items: GodsItem[] = [];
  let unreadable = 0;
  for (const m of html.matchAll(/<article\s+class="event-overview__item"([^>]*)>([\s\S]*?)<\/article>/g)) {
    const attrs = m[1]!, block = m[2]!;
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    const url = /<a\s[^>]*href="([^"]+)"/.exec(block)?.[1];
    const title = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1];
    const dateText = /event-overview__item__date[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    const when = dateText ? parseGodsDate(text(dateText), attr("data-event-start"), attr("data-event-end")) : null;
    if (!url || !title || !when) { unreadable++; continue; }
    const label = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block)?.[1];
    items.push({
      id: attr("data-event-id") || url, url, types: attr("data-event-type").split(",").map(t => t.trim()).filter(Boolean),
      label: label ? text(label) : null, title: text(title), image: /<img[^>]*\ssrc="([^"]+)"/.exec(block)?.[1] ?? null, start: when.start, end: when.end
    });
  }
  return { items, unreadable };
}

const day = (d: { y: number; m: number; d: number }, zone: string, h = 0, mi = 0) => zonedToUtc({ year: d.y, month: d.m, day: d.d, hour: h, minute: mi }, zone);

export function godsEvents(items: GodsItem[], config: SourceConfig): SourceEvent[] {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const maxDays = Number(config.options.maxDays ?? 14);
  const out: SourceEvent[] = [];
  for (const it of items) {
    const startsAt = day(it.start, zone);
    const endsAt = day(it.end ?? it.start, zone, 24);
    if ((endsAt - startsAt) / 86_400_000 > maxDays) continue;
    const cancelled = /^aflyst\s*:/i.test(it.title);
    const free = it.types.includes("gratis");
    out.push({
      sourceEventId: it.id,
      title: it.title.replace(/^aflyst\s*:\s*/i, ""),
      paragraphs: [],
      startsAt, endsAt, allDay: true, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: [it.label, ...it.types.filter(t => t !== "gratis")].filter((x): x is string => !!x),
      price: free ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" } : null,
      signupUrl: it.url, sourceUrl: it.url, imageUrl: it.image, cancelled,
      qualityFlags: ["time_from_event_page"]
    });
  }
  return out;
}

export type GodsPage = { time: string | null; room: string | null; entrance: string | null; entry: string | null; ticket: string | null; teaser: string | null };

export function parseGodsPage(html: string): GodsPage {
  const meta = /event-single__item__meta[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const lines = meta.split(/<br\s*\/?>/i).map(l => text(l)).filter(Boolean);
  const value = (key: string) => {
    const line = lines.find(l => l.toUpperCase().startsWith(key + ":"));
    const v = line?.slice(key.length + 1).trim();
    return v ? v : null;
  };
  const teaser = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? /<meta\s+property="og:description"\s+content="([^"]*)"/.exec(html)?.[1];
  return {
    time: value("TID"), room: value("LOKALE"), entrance: value("NÆRMESTE INDGANG"), entry: value("ENTRÉ"),
    ticket: /<a\s+class="event-single__item__ticket"\s+href="([^"]+)"/.exec(html)?.[1] ?? null,
    teaser: teaser ? collapse(decodeEntities(teaser)) || null : null
  };
}

/** "Døre kl. 19.00, koncert kl. 20.00" -> 20:00; "Kl. 9.15 - 12.55" -> 9:15–12:55; "kl. 11-17" -> 11–17; "TBC" -> null. */
export function parseGodsTime(value: string): { start: [number, number]; end: [number, number] | null } | null {
  const v = value.toLowerCase();
  const t = (s: string) => { const m = /^(\d{1,2})(?:[.:](\d{2}))?$/.exec(s); return m && Number(m[1]) < 24 ? [Number(m[1]), Number(m[2] ?? 0)] as [number, number] : null; };
  const main = /(?:koncert|start|show|forestilling)\D{0,12}?(\d{1,2}(?:[.:]\d{2})?)/.exec(v);
  if (main) { const s = t(main[1]!); if (s) return { start: s, end: null }; }
  const range = /(\d{1,2}(?:[.:]\d{2})?)\s*[-–]\s*(\d{1,2}(?:[.:]\d{2})?)/.exec(v);
  if (range) { const s = t(range[1]!), e = t(range[2]!); if (s) return { start: s, end: e }; }
  const one = /kl\.?\s*(\d{1,2}(?:[.:]\d{2})?)/.exec(v);
  if (one) { const s = t(one[1]!); if (s) return { start: s, end: null }; }
  return null;
}

export function applyGodsPage(event: SourceEvent, page: GodsPage, zone: string): SourceEvent {
  const out: SourceEvent = { ...event, qualityFlags: event.qualityFlags.filter(f => f !== "time_from_event_page") };
  const time = page.time ? parseGodsTime(page.time) : null;
  const multiDay = event.endsAt !== null && event.endsAt - event.startsAt > 86_400_000 + 3_600_000;
  if (time && !multiDay) {
    const [y, mo, d] = localDate(event.startsAt, zone).split("-").map(Number) as [number, number, number];
    const at = ([h, m]: [number, number]) => zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: m }, zone);
    out.allDay = false;
    out.startsAt = at(time.start);
    out.endsAt = time.end ? at(time.end) : null;
    if (out.endsAt !== null && out.endsAt <= out.startsAt) out.endsAt = null;
  }
  if (page.room) { out.venueName = `Godsbanen, ${page.room}`; out.locationText = `${page.room}, Godsbanen`; }
  if (page.entrance && /\d/.test(page.entrance)) out.address = page.entrance;
  if (page.entry) {
    const parsed = parsePrice([`Entré: ${page.entry.replace(/(\d)\.-/g, "$1,-")}`]);
    if (parsed.minMinor !== null || parsed.isFree) out.price = { ...parsed, currency: "DKK" };
  }
  if (page.ticket) out.signupUrl = page.ticket;
  if (page.teaser) out.paragraphs = [page.teaser];
  return out;
}

export const godsbanen: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const res = await ctx.http.get(String(config.options.url ?? DEFAULT_URL), { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { items, unreadable } = parseGodsList(decodeBody(res.body, res.headers.get("content-type")));
    if (!items.length && !unreadable) throw new Error("godsbanen_no_calendar_found");
    const events = godsEvents(items, config).filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 86_400_000);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  },
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    if (!event.sourceUrl) return event;
    const res = await ctx.http.get(event.sourceUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    return applyGodsPage(event, parseGodsPage(decodeBody(res.body, res.headers.get("content-type"))), config.defaults.timezone);
  }
};
