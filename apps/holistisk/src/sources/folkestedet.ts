import { collapse, decodeEntities } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Folkestedet (folkestedet.aarhus.dk), Aarhus Kommune's house for talks, singing, concerts and get-togethers on
 * Carl Blochs Gade. The calendar page lists every event as a card with date ("25. okt. 2026"), time ("15:00 - 17:00"),
 * address, a teaser and a tag. Events that run over many days or weeks (exhibitions, weekly courses) are left out.
 * The calendar gives no price; each event's page says it in its text ("Pris: 125,-", "Pris: 50 kr. inkl. kaffe og
 * kage", "helt gratis") or, for its own free activities, names no price; those pages are read within the enrichment
 * budget.
 * Options: url. */

const DEFAULT_URL = "https://folkestedet.aarhus.dk/kalender";
const text = (s: string) => collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));

export function parseFolkestedet(html: string, config: SourceConfig, base: string): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const m of html.matchAll(/<a\s[^>]*class="[^"]*card__event[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, card] = m as unknown as [string, string, string];
    const field = (icon: string) => { const f = new RegExp(`svg-${icon}[\\s\\S]*?</svg>([\\s\\S]*?)</li>`).exec(card)?.[1]; return f ? text(f) : null; };
    const title = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(card)?.[1];
    const date = field("date"), time = field("time");
    // A range ("01. okt. - 30. nov. 2026") is a recurring or long event: not one evening to go to together.
    const d = date && !/-/.test(date) ? /^(\d{1,2})\.\s*([a-zæøå]+)\.?\s+(\d{4})$/i.exec(date) : null;
    if (!title) { unreadable++; continue; }
    // Cards without a date are information about the house, not events.
    if (!d) continue;
    const month = monthNumber(d[2]!);
    if (!month) { unreadable++; continue; }
    const [h1, m1, h2, m2] = (/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/.exec(time ?? "") ?? []).slice(1).map(v => v === undefined ? null : Number(v));
    const at = (h: number, mi: number) => zonedToUtc({ year: Number(d[3]), month, day: Number(d[1]), hour: h, minute: mi }, zone);
    const timed = h1 !== null && h1 !== undefined;
    const startsAt = timed ? at(h1!, m1 ?? 0) : at(0, 0);
    const endsAt = timed && h2 !== null && h2 !== undefined ? at(h2, m2 ?? 0) : timed ? null : at(24, 0);
    const teaser = /card__event__content__text[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(card)?.[1];
    const tag = /card__tag">\s*<div[^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(card)?.[1];
    const img = /data-src="([^"]+)"/.exec(card)?.[1];
    const url = new URL(href, base).toString();
    events.push({
      sourceEventId: href.replace(/^\/kalender\//, "").replace(/\/$/, ""),
      title: text(title), paragraphs: teaser ? [text(teaser)] : [],
      startsAt, endsAt: endsAt !== null && endsAt > startsAt ? endsAt : null, allDay: !timed, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: field("location"),
      categoryHints: tag ? [text(tag)] : [], price: null,
      signupUrl: url, sourceUrl: url, imageUrl: img ? new URL(decodeEntities(img), base).toString() : null,
      cancelled: /\baflyst\b/i.test(title), qualityFlags: []
    });
  }
  return { events, unreadable };
}

/** The price in the event's own text (the <article>; the page's sidebar and footer name e.g. "gratishold" for other
 * things). A "Pris" line gives the amounts; "gratis" counts only in phrases that say the event itself is free. */
export function folkestedetPrice(html: string): SourceEvent["price"] {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
  const lines = article.replace(/<script[\s\S]*?<\/script>/g, "").split(/<(?:br|\/p|\/li|\/h\d|\/div)[^>]*>/i).map(l => text(l)).filter(Boolean);
  const priced = lines.filter(l => /^(?:billet)?pris\b/i.test(l) && /\d|gratis/i.test(l));
  if (priced.length) {
    const p = parsePrice(priced);
    if (p.minMinor !== null || p.isFree) return { ...p, currency: "DKK" };
  }
  const free = lines.find(l => /\b(?:helt gratis|gratis adgang|gratis entr[ée]|fri entr[ée]|ingen entr[ée]|det er gratis|gratis at deltage|deltagelse er gratis|gratis for alle)\b/i.test(l));
  return free ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" } : null;
}

export const folkestedet: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? DEFAULT_URL);
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseFolkestedet(decodeBody(res.body, res.headers.get("content-type")), config, url);
    if (!events.length && !unreadable) throw new Error("folkestedet_no_calendar_found");
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  },
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    if (!event.sourceUrl) return event;
    const res = await ctx.http.get(event.sourceUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const price = folkestedetPrice(decodeBody(res.body, res.headers.get("content-type")));
    if (price) return { ...event, price };
    // Folkestedet prints "Pris: …" and a "Køb billet" button whenever an event costs money; its own free activities
    // (SUND mandag, Byttebørs, fællessang, Værdibørsen) name no price. So a page without one is free.
    return { ...event, price: { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" }, qualityFlags: [...event.qualityFlags, "free_inferred"] };
  }
};
