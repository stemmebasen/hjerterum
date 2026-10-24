import { collapse, decodeEntities } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Folkestedet (folkestedet.aarhus.dk), Aarhus Kommune's house for talks, singing, concerts and get-togethers on
 * Carl Blochs Gade. The calendar page lists every event as a card with date ("25. okt. 2026"), time ("15:00 - 17:00"),
 * address, a teaser and a tag. Events that run over many days or weeks (exhibitions, weekly courses) are left out.
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

export const folkestedet: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? DEFAULT_URL);
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseFolkestedet(decodeBody(res.body, res.headers.get("content-type")), config, url);
    if (!events.length && !unreadable) throw new Error("folkestedet_no_calendar_found");
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
