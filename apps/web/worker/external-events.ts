const MEMBERSHIPWORKS_FEED_URL = "https://api.membershipworks.com/v2/events?_op=rss&org=22308";
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
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
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

export async function getExternalEvents(force = false): Promise<ExternalEvent[]> {
  const now = Date.now();
  if (!force && cachedEvents && now < cacheExpiresAt) return cachedEvents;

  const response = await fetch(MEMBERSHIPWORKS_FEED_URL, {
    headers: { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }
  });
  if (!response.ok) throw new Error(`membershipworks_fetch_failed_${response.status}`);

  const xml = await response.text();
  const events = parseMembershipWorksRss(xml)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  cachedEvents = events;
  cacheExpiresAt = now + CACHE_MS;
  return events;
}

export async function hasExternalEventConflict(startMs: number, endMs: number): Promise<boolean> {
  try {
    const events = await getExternalEvents();
    return events.some((event) => {
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
