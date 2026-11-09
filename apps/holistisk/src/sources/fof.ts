import { collapse, decodeEntities } from "../text.js";
import { localDate, weekdayIndex, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** FOF Aarhus' talks (fof.dk/aarhus/foredrag-i-aarhus). The site is built with Next.js: the list pages
 * (?page=1…8, twelve talks each) carry every card as JSON in the page's React payload
 *   {"id":"…","title":"Anders Agger: Indefra","link":"/aftenskolen/fof-aarhus/anders-agger-indefra",
 *    "image":{"src":"/media/…"},"subText1":"Aarhus C","splashTextExtra":"Tirsdag 10/11", …}
 * with the weekday and date but no year or time; the year is the one in which that date falls on that weekday.
 * Each talk's page has schema.org Course data (date, place, price, the booking link per "hold") and, in its payload,
 * "variantStartTime":"19:00:00" and "variantEndTime"; those are read within the enrichment budget.
 * Options: url, maxPages (default 10). */

const DEFAULT_URL = "https://www.fof.dk/aarhus/foredrag-i-aarhus";
const BASE = "https://www.fof.dk";
const WEEKDAYS = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];

/** The text of the page's React payload: every self.__next_f.push([1,"…"]) string, decoded and joined. */
export function nextPayload(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]!) as string; } catch { /* a chunk that is not a plain string */ }
  }
  return out;
}

/** The JSON object that starts at `start` in `s` (brace-matched, strings respected), or null. */
function objectAt(s: string, start: number): unknown {
  let depth = 0, inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

export type FofCard = { id: string; title: string; link: string; image: { src?: string } | null; subText1?: string; splashTextExtra?: string; eyebrowText?: string };

export function parseFofList(html: string): { cards: FofCard[]; lastPage: number } {
  const payload = nextPayload(html);
  const cards = new Map<string, FofCard>();
  for (const m of payload.matchAll(/\{"id":"[^"]+","title":"/g)) {
    const card = objectAt(payload, m.index!) as FofCard | null;
    if (card && typeof card.title === "string" && typeof card.link === "string" && card.link.startsWith("/aftenskolen/") && !cards.has(card.link)) cards.set(card.link, card);
  }
  const pages = [...html.matchAll(/[?&](?:amp;)?page=(\d+)/g)].map(m => Number(m[1]));
  return { cards: [...cards.values()], lastPage: pages.length ? Math.max(...pages) : 1 };
}

/** "Tirsdag 10/11" -> the date on or after `now` (within a year) on which 10 November is a Tuesday. */
export function fofDate(value: string, now: number, zone: string): { y: number; m: number; d: number } | null {
  const m = /([a-zæøå]+)\s+(\d{1,2})\/(\d{1,2})/i.exec(value);
  if (!m) return null;
  const wd = WEEKDAYS.indexOf(m[1]!.toLowerCase());
  const day = Number(m[2]), month = Number(m[3]);
  const thisYear = Number(localDate(now, zone).slice(0, 4));
  for (const y of [thisYear, thisYear + 1, thisYear - 1]) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (wd < 0 || weekdayIndex(iso) === wd) return { y, m: month, d: day };
  }
  return null;
}

export function fofEvents(cards: FofCard[], config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const c of cards) {
    const date = c.splashTextExtra ? fofDate(c.splashTextExtra, now, zone) : null;
    // A card without a date is an ongoing offer or a course with many meetings, not one evening.
    if (!date) { if (!c.splashTextExtra) continue; unreadable++; continue; }
    const url = new URL(c.link, BASE).toString();
    const startsAt = zonedToUtc({ year: date.y, month: date.m, day: date.d, hour: 0, minute: 0 }, zone);
    events.push({
      sourceEventId: c.link.replace(/^\/aftenskolen\//, ""),
      title: collapse(decodeEntities(c.title)), paragraphs: [],
      startsAt, endsAt: zonedToUtc({ year: date.y, month: date.m, day: date.d, hour: 24, minute: 0 }, zone), allDay: true, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: null, address: null, postalCode: null, city: c.subText1 ?? null,
      lat: null, lon: null, locationText: c.subText1 ?? null,
      categoryHints: ["foredrag"], price: null,
      signupUrl: url, sourceUrl: url, imageUrl: c.image?.src ? new URL(c.image.src.split("?")[0]!, BASE).toString() : null,
      cancelled: /\baflyst\b/i.test(c.title), qualityFlags: ["time_from_event_page"]
    });
  }
  return { events, unreadable };
}

type CourseInstance = { startDate?: string; location?: string; offers?: { price?: number; priceCurrency?: string; url?: string; availability?: string } };
export type FofPage = { description: string | null; keywords: string | null; instances: Array<CourseInstance & { holdnr: string | null; startTime: string | null; endTime: string | null }> };

export function parseFofPage(html: string): FofPage {
  let course: { description?: string; keywords?: string; hasCourseInstance?: CourseInstance[] } | null = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]!); if (j?.["@type"] === "Course") { course = j; break; } } catch { /* not JSON */ }
  }
  const payload = nextPayload(html);
  const times = new Map<string, { start: string | null; end: string | null }>();
  for (const m of payload.matchAll(/"variantCourseNo":"(\d+)"[^{}]*?"variantStartTime":"([\d:]+)"[^{}]*?"variantEndTime":"([\d:]*)"/g)) times.set(m[1]!, { start: m[2]!, end: m[3] || null });
  const instances = (course?.hasCourseInstance ?? []).map(i => {
    const holdnr = /holdnr=(\d+)/.exec(i.offers?.url ?? "")?.[1] ?? null;
    const t = holdnr ? times.get(holdnr) : undefined;
    return { ...i, holdnr, startTime: t?.start ?? null, endTime: t?.end ?? null };
  });
  return { description: course?.description ? collapse(course.description) : null, keywords: course?.keywords ?? null, instances };
}

export function applyFofPage(event: SourceEvent, page: FofPage, zone: string): SourceEvent {
  const out: SourceEvent = { ...event, qualityFlags: event.qualityFlags.filter(f => f !== "time_from_event_page") };
  const day = localDate(event.startsAt, zone);
  const inst = page.instances.find(i => i.startDate?.slice(0, 10) === day) ?? page.instances[0];
  if (page.description) out.paragraphs = [page.description];
  if (page.keywords) out.categoryHints = [...new Set([...out.categoryHints, ...page.keywords.split(",").map(k => k.trim()).filter(Boolean)])];
  if (!inst) return out;
  const date = inst.startDate?.slice(0, 10) ?? day;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const clock = (t: string | null) => { const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null; return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null; };
  const start = clock(inst.startTime), end = clock(inst.endTime);
  if (start) {
    out.allDay = false;
    out.startsAt = zonedToUtc({ year: y, month: mo, day: d, ...start }, zone);
    out.endsAt = end ? zonedToUtc({ year: y, month: mo, day: d, ...end }, zone) : null;
    if (out.endsAt !== null && out.endsAt <= out.startsAt) out.endsAt = null;
  } else if (date !== day) {
    out.startsAt = zonedToUtc({ year: y, month: mo, day: d, hour: 0, minute: 0 }, zone);
    out.endsAt = zonedToUtc({ year: y, month: mo, day: d, hour: 24, minute: 0 }, zone);
  }
  if (inst.location) {
    out.venueName = inst.location;
    out.locationText = inst.location;
    // "VIA Campus, Bygn. A, Aarhus C": the town is the last part.
    const town = inst.location.split(",").pop()?.trim();
    if (town && /^[A-ZÆØÅ][\wæøå ]+$/.test(town)) out.city = town;
  }
  const price = inst.offers?.price;
  if (typeof price === "number") out.price = price === 0
    ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" }
    : { minMinor: price * 100, maxMinor: price * 100, isFree: false, text: `${price} kr.`, currency: inst.offers?.priceCurrency ?? "DKK" };
  if (inst.offers?.url) out.signupUrl = inst.offers.url;
  if (/SoldOut/i.test(inst.offers?.availability ?? "")) out.qualityFlags = [...out.qualityFlags, "sold_out"];
  return out;
}

export const fof: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? DEFAULT_URL);
    const maxPages = Number(config.options.maxPages ?? 10);
    const get = async (u: string) => {
      const res = await ctx.http.get(u, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
      return parseFofList(decodeBody(res.body, res.headers.get("content-type")));
    };
    const first = await get(url);
    const cards = [...first.cards];
    for (let p = 2; p <= Math.min(first.lastPage, maxPages); p++) {
      const next = await get(`${url}?page=${p}`);
      const fresh = next.cards.filter(c => !cards.some(x => x.link === c.link));
      if (!fresh.length) break;
      cards.push(...fresh);
    }
    if (!cards.length) throw new Error("fof_no_talks_found");
    const { events: all, unreadable } = fofEvents(cards, config, ctx.now);
    const events = all.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 86_400_000);
    return { events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  },
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    if (!event.sourceUrl) return event;
    const res = await ctx.http.get(event.sourceUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    return applyFofPage(event, parseFofPage(decodeBody(res.body, res.headers.get("content-type"))), config.defaults.timezone);
  }
};
