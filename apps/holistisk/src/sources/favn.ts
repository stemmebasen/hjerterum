import { collapse, decodeEntities, findHost, htmlToParagraphs } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { resolveDate } from "./lysetshus.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Favn Aarhus' workshop calendar (favnaarhus.dk/workshop-kalender-aarhus/): one link per date, with
 *
 *   <h4 class="calendar-team-name">Intuitiv chakradans med Anne</h4>
 *   <p class="calendar-team-information">…teaser…</p>
 *   <p class="calendar-team-time">Fredag d. 9. oktober kl. 16:30-18</p>
 *   <p class="calendar-team-price">Pris: 200 kr.</p>
 *
 * The dates carry no year; the weekday decides it (as for Lysets Hus). A workshop held on several dates links to
 * the same page, so the date is part of the id. Options: url. */

const WHEN = /^(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:d\.\s*)?(\d{1,2})\.\s*(\p{L}+)\.?(?:\s+(\d{4}))?\s*(?:kl\.?\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?)?)?/iu;

const cls = (block: string, name: string) => {
  const m = new RegExp(`<[a-z0-9]+[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:p|h\\d|div|span)>`, "i").exec(block)?.[1];
  return m ?? null;
};

export function parseFavnCalendar(html: string, config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const m of html.matchAll(/<a\s[^>]*class="[^"]*\bcalendar-team-item\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = /href="([^"]+)"/.exec(m[0].slice(0, m[0].indexOf(">") + 1))?.[1];
    const block = m[1]!;
    if (!link) { unreadable++; continue; }
    const title = collapse(decodeEntities((cls(block, "calendar-team-name") ?? "").replace(/<[^>]+>/g, "")));
    const whenText = collapse(decodeEntities((cls(block, "calendar-team-time") ?? "").replace(/<[^>]+>/g, " ")));
    const w = WHEN.exec(whenText);
    if (!title || !w) { unreadable++; continue; }
    const month = monthNumber(w[3]!);
    const date = month ? (w[4] ? `${w[4]}-${String(month).padStart(2, "0")}-${w[2]!.padStart(2, "0")}` : resolveDate(w[1]!, Number(w[2]), month, now)) : null;
    if (!date) {
      // Past workshops stay on the page in an "expired" column; outside the year window they are simply over.
      const col = html.slice(html.lastIndexOf("calendar-col", m.index), m.index);
      if (!/calendar-col-expired/.test(col)) unreadable++;
      continue;
    }
    const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
    const timed = w[5] !== undefined;
    const startsAt = zonedToUtc({ year: y, month: mo, day: d, hour: timed ? Number(w[5]) : 0, minute: Number(w[6] ?? 0) }, zone);
    const endsAt = timed && w[7] !== undefined ? zonedToUtc({ year: y, month: mo, day: d, hour: Number(w[7]), minute: Number(w[8] ?? 0) }, zone)
      : timed ? null : zonedToUtc({ year: y, month: mo, day: d + 1, hour: 0, minute: 0 }, zone);
    const teaser = htmlToParagraphs(cls(block, "calendar-team-information") ?? "");
    const priceLines = htmlToParagraphs(cls(block, "calendar-team-price") ?? "");
    const price = parsePrice(priceLines.map(l => /pris|kr/i.test(l) ? l : `Pris: ${l}`));
    const soldOut = priceLines.some(l => /udsolgt/i.test(l));
    events.push({
      sourceEventId: `${link.replace(/\/+$/, "").split("/").pop()}-${date}`,
      title,
      paragraphs: teaser,
      startsAt,
      endsAt: endsAt !== null && endsAt > startsAt ? endsAt : null,
      allDay: !timed,
      timezone: zone,
      organizerName: config.defaults.organizerName,
      organizerUrl: config.defaults.organizerUrl,
      hostName: /\bmed\s+([A-ZÆØÅ][\p{L}-]+(?:(?:,\s*|\s+og\s+|\s+)[A-ZÆØÅ][\p{L}-]+)*)\s*$/u.exec(title)?.[1] ?? findHost(teaser),
      venueName: venue?.name ?? null,
      address: venue?.address ?? null,
      postalCode: venue?.postalCode ?? null,
      city: venue?.city ?? null,
      lat: venue?.lat ?? null,
      lon: venue?.lon ?? null,
      locationText: venue?.name ?? null,
      categoryHints: [],
      price: price.minMinor === null && price.isFree === null ? null : { ...price, currency: "DKK" },
      signupUrl: link,
      sourceUrl: link,
      imageUrl: null,
      cancelled: /\baflyst\b/i.test(title),
      qualityFlags: [...(price.text ? ["price_from_text"] : []), ...(soldOut ? ["sold_out"] : [])]
    });
  }
  return { events, unreadable };
}

export const favn: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "https://favnaarhus.dk/workshop-kalender-aarhus/");
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseFavnCalendar(decodeBody(res.body, res.headers.get("content-type")), config, ctx.now);
    if (!events.length && unreadable === 0) throw new Error("favn_no_calendar_found");
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    return { events: upcoming, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  }
};
