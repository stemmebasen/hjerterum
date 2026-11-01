import { isPartnerEvent } from "../partner-events.js";
const MEMBERSHIPWORKS_FEED_URL = "https://api.membershipworks.com/v2/events?_op=rss&org=22308";
/** The list the membership system's own calendar widget reads. It holds every public event, also those in the categories that
 * are left out of the RSS feed ("Hjerterum events", "Dans & Bevægelse") - asked: "All of these appear in Membership works". */
export const membershipWorksListUrl = (fromMs: number, toMs: number) =>
  `https://api.membershipworks.com/v2/events?sdp=${Math.floor(fromMs / 1000)}&edp=${Math.floor(toMs / 1000)}&org=22308&_st`;
const LIST_DAYS = 183;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;

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
      link: item.url ? `https://holistisk.org/events/#!event/${item.url}` : null,
      host: null,
      description: null,
      category: category ? decodeXml(category) : null
    }];
  });
}

/** Asked: "Hvorfor er der den forskel på tekst? Alle events har jo en beskrivelse." The list has no text, so an event only the list has
 * gets its text from MembershipWorks' event details - the soonest first, at most MAX_TEXTS fetched in one round, each kept for hours. */
const TEXT_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_TEXTS = 40;
const textCache = new Map<string, { at: number; text: string | null }>();

async function eventText(eid: string, fetcher: typeof fetch, now: number): Promise<string | null> {
  const response = await fetcher(`https://api.membershipworks.com/v2/event?eid=${eid}&org=22308`, { headers: { accept: "application/json" } });
  const text = response.ok ? ((await response.json()) as { dtl?: string }).dtl : undefined;
  const plain = text ? stripHtml(text) || null : null;
  textCache.set(eid, { at: now, text: plain });
  return plain;
}

export async function withTexts(events: ExternalEvent[], fetcher: typeof fetch, now: number): Promise<ExternalEvent[]> {
  let fetches = 0;
  return Promise.all(events.map(async (event) => {
    const eid = /^SF([0-9a-f]{24})$/.exec(event.id)?.[1];
    if (event.description || !eid) return event;
    const hit = textCache.get(eid);
    if (hit && now - hit.at < TEXT_CACHE_MS) return { ...event, description: hit.text };
    if (fetches >= MAX_TEXTS) return event;
    fetches++;
    return { ...event, description: await eventText(eid, fetcher, now).catch(() => null) };
  }));
}

/** The feed's events with their text, and the events only the widget's list has. */
export function mergeExternalEvents(feed: ExternalEvent[], list: ExternalEvent[]): ExternalEvent[] {
  const known = new Set(feed.map((event) => event.id));
  return [...feed, ...list.filter((event) => !known.has(event.id))]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export async function getExternalEvents(force = false, fetcher: typeof fetch = fetch): Promise<ExternalEvent[]> {
  const now = Date.now();
  if (!force && cachedEvents && now < cacheExpiresAt) return cachedEvents;

  const [feed, list] = await Promise.all([
    fetcher(MEMBERSHIPWORKS_FEED_URL, {
      headers: { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }
    }).then(async (response) => {
      if (!response.ok) throw new Error(`membershipworks_fetch_failed_${response.status}`);
      return parseMembershipWorksRss(await response.text());
    }),
    // The list only adds to the feed; without it the feed's events are still shown.
    fetcher(membershipWorksListUrl(now - DAY_MS, now + LIST_DAYS * DAY_MS), { headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? parseMembershipWorksList(await response.json() as MembershipWorksList) : [])
      .catch(() => [] as ExternalEvent[])
  ]);
  const events = await withTexts(mergeExternalEvents(feed, list), fetcher, now);

  cachedEvents = events;
  cacheExpiresAt = now + CACHE_MS;
  return events;
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
