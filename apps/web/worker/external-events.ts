import { isPartnerEvent } from "../partner-events.js";
import type { D1Database } from "./db.js";

/** The chair (27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes så vores nye siden er et helt og lukket økosystem".
 * Nothing is fetched from MembershipWorks any more. Its calendar as it last was is kept in D1 (house_events, cockpit/events.ts) and is read from
 * there: the events it had still hold the hall and are shown, but what is changed in MembershipWorks from now on does not come over - new events
 * are made in Hjerterum's own system. The parsing below is kept for that copy. */
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const MAX_EVENTS = 500;

export type ExternalEvent = {
  id: string;
  source: "membershipworks";
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  imageUrl: string | null;
  link: string | null;
  host: string | null;
  description: string | null;
  category: string | null;
};

let cachedEvents: ExternalEvent[] | null = null;
let cacheExpiresAt = 0;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value: string): string {
  const htmlEntities: Record<string, string> = {
    nbsp: " ",
    aring: "å",
    Aring: "Å",
    aelig: "æ",
    AElig: "Æ",
    oslash: "ø",
    Oslash: "Ø",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Eacute: "É", agrave: "à", egrave: "è",
    atilde: "ã", otilde: "õ", ntilde: "ñ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", ccedil: "ç",
    ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»"
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&([a-zA-Z]+);/g, (_match, name: string) => htmlEntities[name] ?? _match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .trim();
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function tag(block: string, name: string): string | null {
  const escaped = escapeRegExp(name);
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : null;
}

function attribute(block: string, tagName: string, attrName: string): string | null {
  const tagMatch = block.match(new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "i"));
  if (!tagMatch?.[0]) return null;
  const attrMatch = tagMatch[0].match(new RegExp(`${escapeRegExp(attrName)}\\s*=\\s*["']([^"']+)["']`, "i"));
  return attrMatch?.[1] ? decodeXml(attrMatch[1]) : null;
}

function validIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function firstNonEmpty(...values: Array<string | null>): string | null {
  return values.find((value) => value !== null && value.trim().length > 0) ?? null;
}

export function parseMembershipWorksRss(xml: string): ExternalEvent[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return items.flatMap((item, index) => {
    const title = tag(item, "title");
    const startsAt = validIso(tag(item, "ev:startdate"));
    if (!title || !startsAt) return [];

    const link = tag(item, "link");
    const guid = tag(item, "guid");
    const endsAt = validIso(tag(item, "ev:enddate"));
    const imageUrl = firstNonEmpty(
      attribute(item, "media:content", "url"),
      attribute(item, "enclosure", "url")
    );
    const descriptionHtml = firstNonEmpty(tag(item, "content:encoded"), tag(item, "description"));
    const host = firstNonEmpty(
      tag(item, "ev:organizer"),
      tag(item, "dc:creator"),
      tag(item, "author")
    );

    return [{
      id: guid ?? link ?? `membershipworks-${index}-${startsAt}`,
      source: "membershipworks" as const,
      title,
      startsAt,
      endsAt,
      location: tag(item, "ev:location"),
      imageUrl,
      link,
      host,
      description: descriptionHtml ? stripHtml(descriptionHtml) : null,
      category: tag(item, "category")
    }];
  });
}

export type MembershipWorksList = {
  evt?: Array<{ eid?: string; ttl?: string; sdp?: number; edp?: number; ezp?: string; grp?: number; url?: string; lgo?: { l?: string } }>;
  _st?: { evg?: Array<{ ttl?: string }> };
};

const COPENHAGEN_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Reported (Gitta): "Fri morgendans den 30. oktober fra kl. 9 til 22" - in MembershipWorks the end is set to 22.00 while the event's own text
 * says "kl 10.00". When the end text has a clock that differs from the end time, the text wins (the same day, at most a day's shift). */
export function endFromText(startMs: number, endMs: number, text: string | undefined): number {
  const plain = text ? decodeXml(text) : "";
  const danish = /kl\.?\s*(\d{1,2})[.:](\d{2})/i.exec(plain);
  const english = danish ? null : /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(plain);
  const match = danish ?? english;
  if (!match) return endMs;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (english) hour = (hour % 12) + (english[3]!.toLowerCase() === "pm" ? 12 : 0);
  if (hour > 24 || minute > 59) return endMs;
  const [h, m] = COPENHAGEN_CLOCK.format(endMs).split(":").map(Number);
  const shift = ((hour % 24) * 60 + minute - (h! * 60 + m!)) * 60_000;
  const end = endMs + shift;
  return shift !== 0 && Math.abs(shift) < 24 * 3_600_000 && end > startMs ? end : endMs;
}

/** The widget's list: title, time, category, picture and address of each event. The text is read on the event's own page (event-detail.ts). */
export function parseMembershipWorksList(data: MembershipWorksList): ExternalEvent[] {
  const groups = data._st?.evg ?? [];
  return (data.evt ?? []).flatMap((item) => {
    const title = item.ttl ? decodeXml(item.ttl.replace(/<br\s*\/?>/gi, " – ")).replace(/\s+/g, " ") : "";
    if (!item.eid || !/^[0-9a-f]{24}$/.test(item.eid) || !title || typeof item.sdp !== "number") return [];
    const category = item.grp === undefined ? null : groups[item.grp]?.ttl ?? null;
    return [{
      id: `SF${item.eid}`,
      source: "membershipworks" as const,
      title,
      startsAt: new Date(item.sdp * 1000).toISOString(),
      endsAt: typeof item.edp === "number" ? new Date(endFromText(item.sdp * 1000, item.edp * 1000, item.ezp)).toISOString() : null,
      location: null,
      imageUrl: item.lgo?.l ?? null,
      link: null,
      host: null,
      description: null,
      category: category ? decodeXml(category) : null
    }];
  });
}

/** The feed's events with their text, and the events only the widget's list has. */
export function mergeExternalEvents(feed: ExternalEvent[], list: ExternalEvent[]): ExternalEvent[] {
  const known = new Set(feed.map((event) => event.id));
  return [...feed, ...list.filter((event) => !known.has(event.id))]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Requested (5 Nov 2026): "Når et event er aflyst bør det fjernes fra listen - ligesom Mediterende yoga". MembershipWorks keeps a cancelled
 * event in its calendar and only writes it on it: "Onsdage 16-17.20 - Aflyst -" in the title, "- AFLYST - CANCELLED -" at the start of the text.
 * Such an event is left out everywhere (the calendars, the front page, PR, Saga) and does not hold the hall. A text that only mentions
 * cancelling further down ("aflyses ved for få tilmeldte") is not a cancelled event. */
export function isCancelledEvent(event: { title: string; description?: string | null }): boolean {
  const said = /(^|[^\p{L}])(aflyst|cancell?ed)([^\p{L}]|$)/iu;
  return said.test(event.title) || said.test((event.description ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 60));
}

/** Where the kept calendar is: set once per request and scheduled run (config-entry.ts), so the many readers need not pass it. */
let store: D1Database | null = null;
export function useEventStore(db: D1Database | null | undefined): void {
  if (db !== store) { store = db ?? null; cachedEvents = null; }
}

type StoredRow = { id: string; title: string; starts_at_ms: number; ends_at_ms: number | null; location: string | null; host: string | null; category: string | null; image_url: string | null; description: string | null };
export const storedEvent = (row: StoredRow): ExternalEvent => ({ id: row.id, source: "membershipworks", title: row.title, startsAt: new Date(row.starts_at_ms).toISOString(),
  endsAt: row.ends_at_ms === null ? null : new Date(row.ends_at_ms).toISOString(), location: row.location, imageUrl: row.image_url,
  // The old event page on holistisk.org is not linked to any more: each event has its own page here (event-detail.ts).
  link: null, host: row.host, description: row.description, category: row.category });

/** The kept calendar's coming events (from yesterday), without the cancelled ones - read from D1, never from MembershipWorks. */
export async function getExternalEvents(force = false): Promise<ExternalEvent[]> {
  const now = Date.now();
  if (!force && cachedEvents && now < cacheExpiresAt) return cachedEvents;
  if (!store) return [];
  const rows = (await store.prepare(`SELECT id, title, starts_at_ms, ends_at_ms, location, host, category, image_url, description FROM house_events
      WHERE removed_at_ms IS NULL AND COALESCE(ends_at_ms, starts_at_ms) >= ? ORDER BY starts_at_ms LIMIT ?`).bind(now - DAY_MS, MAX_EVENTS)
    .all<StoredRow>().catch(() => ({ results: [] as StoredRow[] }))).results ?? [];
  const events = rows.map(storedEvent).filter((event) => !isCancelledEvent(event));
  cachedEvents = events;
  cacheExpiresAt = now + CACHE_MS;
  return events;
}

/** One event of the kept calendar by its id ("SF" + 24 hex), coming or past - for its own page (event-detail.ts). */
export async function storedEventById(id: string): Promise<ExternalEvent | null> {
  if (!store) return null;
  const row = await store.prepare("SELECT id, title, starts_at_ms, ends_at_ms, location, host, category, image_url, description FROM house_events WHERE id = ? AND removed_at_ms IS NULL")
    .bind(id).first<StoredRow>().catch(() => null);
  return row ? storedEvent(row) : null;
}

export async function hasExternalEventConflict(startMs: number, endMs: number): Promise<boolean> {
  try {
    const events = await getExternalEvents();
    // Partnerhusenes events (Hjerteland) holdes et andet sted og optager ikke salen.
    return events.filter((event) => !isPartnerEvent(event)).some((event) => {
      const externalStart = Date.parse(event.startsAt);
      const externalEnd = event.endsAt ? Date.parse(event.endsAt) : externalStart;
      if (!Number.isFinite(externalStart) || !Number.isFinite(externalEnd)) return false;
      return externalStart < endMs && externalEnd > startMs;
    });
  } catch {
    // External calendar outages must not make the room-booking system unusable.
    return false;
  }
}
