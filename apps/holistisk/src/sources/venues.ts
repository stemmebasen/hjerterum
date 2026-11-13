import { decodeEntities, htmlToParagraphs } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { stageText, upcoming } from "./stage.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Aarhus' bigger cultural houses, added at the project owner's request (2026-11-13) after looking through
 * migogaarhus.dk, aarhusguiden.dk and aarhusinside.dk for organisers: Hermans and the stage in Tivoli Friheden,
 * Aarhus Teater, Moesgaard Museum and the cinema Øst for Paradis. Each is read from the venue's own site, one or two
 * requests a night. Only events with an exact date and time are taken. */

async function text(url: string, accept: string, config: SourceConfig, ctx: AdapterContext): Promise<string> {
  const res = await ctx.http.get(url, { headers: { accept }, respectRobots: config.respectRobots });
  return decodeBody(res.body, res.headers.get("content-type"));
}

const result = (events: SourceEvent[], unreadable: number): FetchResult =>
  ({ events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable });

const pad = (n: number) => String(n).padStart(2, "0");

/** A SourceEvent with the source's default venue and organiser filled in. */
function base(config: SourceConfig, e: Pick<SourceEvent, "sourceEventId" | "title" | "startsAt"> & Partial<SourceEvent>): SourceEvent {
  const venue = config.defaults.venues[0] ?? null;
  return {
    paragraphs: [], endsAt: null, allDay: false, timezone: config.defaults.timezone,
    organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
    venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
    lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: e.venueName ?? venue?.name ?? null,
    categoryHints: [], price: null, signupUrl: null, sourceUrl: null, imageUrl: null, cancelled: false, qualityFlags: [],
    ...e
  };
}

const withinDays = (events: SourceEvent[], config: SourceConfig, now: number): SourceEvent[] => {
  const horizon = now + Number(config.options.daysAhead ?? 90) * 86_400_000;
  return upcoming(events, now).filter(e => e.startsAt <= horizon);
};

// ---------------------------------------------------------------------------------------------------------------
/** Tivoli Friheden (friheden.dk). The front page lists the coming events as
 *   <article class="event-item"> … <a href="/arrangementer/hermans/bente-klarlund" class="event-item__link"> …
 *   <span class="event-item__tag …">Hermans</span><div class="event-item__date">29. november 2026 - 18.00</div>
 *   <h3 class="event-item__headline">Bente Klarlund</h3><p class="event-item__teaser">…</p> … "Køb billet" link.
 * Only /arrangementer/ (talks and comedy in Hermans, concerts on the stage) are taken; the park's own seasonal
 * activities (/begivenheder/, /oplev-friheden/) are not events to go to together. */
export function parseFriheden(html: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const site = String(config.options.base ?? "https://friheden.dk");
  const seen = new Set<string>();
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const m of html.matchAll(/<article class="event-item">([\s\S]*?)<\/article>/g)) {
    const block = m[1]!;
    const href = /href="([^"]+)" class="event-item__link"/.exec(block)?.[1];
    if (!href || !/^\/arrangementer\//.test(href)) continue;
    const key = href.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const date = /event-item__date">\s*(\d{1,2})\.\s*([^\s<]+)\s+(\d{4})\s*-\s*(\d{1,2})[.:](\d{2})/.exec(block);
    const title = /event-item__headline">([\s\S]*?)<\/h3>/.exec(block)?.[1];
    const month = date ? monthNumber(decodeEntities(date[2]!)) : null;
    if (!date || !month || !title) { unreadable++; continue; }
    const startsAt = zonedToUtc({ year: Number(date[3]), month, day: Number(date[1]), hour: Number(date[4]), minute: Number(date[5]) }, zone);
    const tag = stageText(/event-item__tag[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1] ?? "");
    const teaser = stageText(/event-item__teaser">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "");
    const ticket = /href="([^"]+)"[^>]*class="event-item__links-link-ticket"/.exec(block)?.[1];
    const image = /data-src="([^"?]+)/.exec(block)?.[1];
    const url = site + key;
    events.push(base(config, {
      sourceEventId: `${key.replace(/^\/arrangementer\//, "")}@${date[3]}-${pad(month)}-${pad(Number(date[1]))}T${pad(Number(date[4]))}${date[5]}`,
      title: stageText(title), paragraphs: teaser ? [teaser] : [], startsAt,
      venueName: tag && !/^scenen$/i.test(tag) ? `${tag}, Tivoli Friheden` : "Tivoli Friheden",
      categoryHints: [/\/hermans\//.test(key) ? "hermans" : "scenen"],
      signupUrl: ticket ? decodeEntities(ticket) : url, sourceUrl: url,
      imageUrl: image ? site + decodeEntities(image) : null
    }));
  }
  return { events, unreadable };
}

export const friheden: SourceAdapter = {
  async fetch(config, ctx) {
    const { events, unreadable } = parseFriheden(await text(String(config.options.url), "text/html", config, ctx), config);
    if (!events.length && !unreadable) throw new Error("friheden_no_events_found");
    return result(withinDays(events, config, ctx.now), unreadable);
  }
};

// ---------------------------------------------------------------------------------------------------------------
/** Aarhus Teater (aarhusteater.dk). The site's own JSON (/api/shows/, the list its programme page loads): one row
 * per production with name, url, previewTeaserText, poster, venues (the stage), categories, and events[].showTimes[]
 * – every performance with its local start, isSoldOut and the ticket link. One GET a night; only performances within
 * options.daysAhead (default 90). */
type AtShowTime = { date: string; showNo: number; isSoldOut?: boolean; salesStop?: { reason?: string } | null; purchaseUrls?: Array<{ TwoLetterCulture?: string; Link?: string }> };
export type AtShow = {
  name: string; url: string; heading?: string; previewTeaserText?: string | null;
  poster?: { umbracoFile?: { src?: string } } | null; venues?: Array<{ name?: string }>; categories?: string[];
  events?: Array<{ showTimes?: AtShowTime[] }>;
};

export function aarhusTeaterEvents(shows: AtShow[], config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const site = String(config.options.base ?? "https://www.aarhusteater.dk");
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const s of shows) {
    const teaser = stageText(s.previewTeaserText ?? "") || stageText(s.heading ?? "");
    const stage = s.venues?.[0]?.name?.trim();
    const kids = (s.categories ?? []).some(c => /børn/i.test(c));
    for (const ev of s.events ?? []) for (const t of ev.showTimes ?? []) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t.date ?? "");
      if (!s.name || !m) { unreadable++; continue; }
      const startsAt = zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }, zone);
      const ticket = t.purchaseUrls?.find(p => p.TwoLetterCulture === "da")?.Link ?? t.purchaseUrls?.[0]?.Link ?? null;
      events.push(base(config, {
        sourceEventId: String(t.showNo), title: s.name.trim(), paragraphs: teaser ? [teaser] : [], startsAt,
        venueName: stage ? `Aarhus Teater, ${stage}` : "Aarhus Teater",
        categoryHints: kids ? ["for børn"] : [],
        signupUrl: ticket, sourceUrl: s.url,
        imageUrl: s.poster?.umbracoFile?.src ? site + s.poster.umbracoFile.src : null,
        qualityFlags: t.isSoldOut || t.salesStop?.reason === "SoldOut" ? ["sold_out"] : []
      }));
    }
  }
  return { events, unreadable };
}

export const aarhusTeater: SourceAdapter = {
  async fetch(config, ctx) {
    const shows = JSON.parse(await text(String(config.options.url), "application/json", config, ctx)) as unknown;
    if (!Array.isArray(shows)) throw new Error("aarhusteater_bad_response");
    const { events, unreadable } = aarhusTeaterEvents(shows as AtShow[], config);
    return result(withinDays(events, config, ctx.now), unreadable);
  }
};

// ---------------------------------------------------------------------------------------------------------------
/** Moesgaard Museum (moesgaardmuseum.dk/besoeg-os/kalender). The calendar page loads /cms/events?queryByDate=true&
 * dateFilter=all_dates&limit=…&offset=… : { events: [{ date, events: [{ event: { id, title, description (HTML), image,
 * url, type, categories }, event_date: { id, start_date, end_date } }] }], hasMore, total }. The daily guided tours
 * of the current exhibition (category guided_tours) are left out (options.skipCategories): they are the museum's
 * standing offer, not an event. robots.txt asks for 5 s between requests; one or two requests a night. */
type MoesItem = { event?: { id?: string; title?: string; description?: string; image?: string; url?: string; categories?: string[] | string; cta_url?: string }; event_date?: { id?: string; start_date?: string; end_date?: string } };
export type MoesResponse = { events?: Array<{ date?: string; events?: MoesItem[] }>; hasMore?: boolean };

const localStamp = (value: string | undefined, zone: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  return m ? zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }, zone) : null;
};

export function moesgaardEvents(pages: MoesResponse[], config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const site = String(config.options.base ?? "https://moesgaardmuseum.dk");
  const skip = (config.options.skipCategories as string[] | undefined) ?? ["guided_tours"];
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const day of pages.flatMap(p => p.events ?? [])) for (const item of day.events ?? []) {
    const ev = item.event, when = item.event_date;
    const cats = Array.isArray(ev?.categories) ? ev!.categories : String(ev?.categories ?? "").match(/[a-z_]+/g) ?? [];
    if (cats.some(c => skip.includes(c))) continue;
    const startsAt = localStamp(when?.start_date, zone);
    if (!ev?.title || !when?.id || startsAt === null) { unreadable++; continue; }
    const endsAt = localStamp(when.end_date, zone);
    const paragraphs = htmlToParagraphs(ev.description ?? "", 12);
    const p = parsePrice(paragraphs);
    const url = ev.url ? new URL(ev.url, site).toString() : `${site}/besoeg-os/kalender`;
    events.push(base(config, {
      sourceEventId: when.id, title: ev.title.trim(), paragraphs, startsAt,
      endsAt: endsAt !== null && endsAt > startsAt ? endsAt : null,
      categoryHints: cats, price: p.minMinor !== null || p.isFree ? { ...p, currency: "DKK" } : null,
      signupUrl: ev.cta_url || url, sourceUrl: url,
      imageUrl: ev.image ? new URL(ev.image, site).toString() : null
    }));
  }
  return { events, unreadable };
}

export const moesgaard: SourceAdapter = {
  async fetch(config, ctx) {
    const base = String(config.options.url);
    const limit = 200, maxPages = Number(config.options.maxPages ?? 3);
    const pages: MoesResponse[] = [];
    for (let i = 0; i < maxPages; i++) {
      const page = JSON.parse(await text(`${base}?queryByDate=true&dateFilter=all_dates&limit=${limit}&offset=${i * limit}`, "application/json", config, ctx)) as MoesResponse;
      if (!Array.isArray(page.events)) throw new Error("moesgaard_bad_response");
      pages.push(page);
      if (!page.hasMore) break;
    }
    const { events, unreadable } = moesgaardEvents(pages, config);
    return result(withinDays(events, config, ctx.now), unreadable);
  }
};

// ---------------------------------------------------------------------------------------------------------------
/** Øst for Paradis (paradisbio.dk). The cinema's events page (/cms_page_291: premieres with a talk or a drink, film
 * clubs, festivals) lists the coming events by day:
 *   <h3>Fredag den 13. november </h3> … <h5>Blodig Weekend 2026 - Pet Sematary</h5> … <a href="/movie_details/16031" …>
 *   <img src="…" alt="…"> … <a href="/order_movie_ticket/227003"><button title="Event" …>Event 19:00</button></a>
 *   <span class="specialeventtxtInside">Blodig Weekend! Med intro v. …</span>
 * The page gives no year: a date more than two months back is read as next year. Ordinary screenings are not taken. */
export function parseParadis(html: string, config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const site = String(config.options.base ?? "https://www.paradisbio.dk");
  const nowYear = new Date(now).getUTCFullYear();
  const events: SourceEvent[] = [];
  let unreadable = 0;
  const parts = html.split(/<div class="CategoryDate[^"]*">/).slice(1);
  for (const part of parts) {
    const day = /<h3>\s*[^<]*?den\s+(\d{1,2})\.\s*([^\s<]+)\s*<\/h3>/i.exec(part);
    const month = day ? monthNumber(decodeEntities(day[2]!)) : null;
    if (!day || !month) { unreadable++; continue; }
    let year = nowYear;
    if (Date.UTC(year, month - 1, Number(day[1])) < now - 60 * 86_400_000) year++;
    for (const item of part.split(/<div class="col-md-6 col-lg-6 film-wrap-item">/).slice(1)) {
      const title = /<h5>([\s\S]*?)<\/h5>/.exec(item)?.[1];
      const film = /href="\/movie_details\/(\d+)"/.exec(item)?.[1];
      const times = [...item.matchAll(/href="(\/order_movie_ticket\/(\d+))"[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/g)];
      if (!title || !times.length) { unreadable++; continue; }
      const note = stageText(/specialeventtxtInside">([\s\S]*?)<\/span>/.exec(item)?.[1] ?? "");
      const image = /<img src="([^"]+)"/.exec(item)?.[1];
      for (const t of times) {
        const clock = /(\d{1,2}):(\d{2})/.exec(stageText(t[3]!));
        if (!clock) { unreadable++; continue; }
        const startsAt = zonedToUtc({ year, month, day: Number(day[1]), hour: Number(clock[1]), minute: Number(clock[2]) }, zone);
        const url = film ? `${site}/movie_details/${film}_date=${year}-${pad(month)}-${pad(Number(day[1]))}` : `${site}/cms_page_291`;
        events.push(base(config, {
          sourceEventId: t[2]!, title: stageText(title), paragraphs: note ? [note] : [], startsAt,
          categoryHints: ["film"], signupUrl: site + t[1], sourceUrl: url,
          imageUrl: image ? new URL(decodeEntities(image).replace(/\/\/+/g, "/"), site).toString() : null
        }));
      }
    }
  }
  return { events, unreadable };
}

export const paradis: SourceAdapter = {
  async fetch(config, ctx) {
    const { events, unreadable } = parseParadis(await text(String(config.options.url), "text/html", config, ctx), config, ctx.now);
    if (!events.length && !unreadable) throw new Error("paradis_no_events_found");
    return result(withinDays(events, config, ctx.now), unreadable);
  }
};
