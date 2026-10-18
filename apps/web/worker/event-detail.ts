import { getExternalEvents, type ExternalEvent } from "./external-events.js";

/** Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside." An event from the
 * membership system's calendar gets its own page on hjerterum.info: the feed's words and picture, and the event's own details
 * from MembershipWorks' public event API (place, tickets, places). Signing up happens in Hjerterum's own system. */
export type EventDetail = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  host: string | null;
  category: string | null;
  imageUrl: string | null;
  address: string | null;
  /** Where the event is, for the map: MembershipWorks' coordinates, or the house's. */
  lat: number;
  lon: number;
  /** The description as paragraphs of plain text (the source's HTML is never passed on). */
  paragraphs: string[];
  tickets: string[];
  capacity: number | null;
  signUpUrl: string | null;
};

const ORG = "22308";
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; detail: EventDetail | null }>();

export const eventIdOf = (event: Pick<ExternalEvent, "id">): string | null => /^SF([0-9a-f]{24})$/.exec(event.id)?.[1] ?? null;

function decode(value: string): string {
  const named: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", oacute: "ó", eacute: "é", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name] ?? m);
}

/** HTML to paragraphs: block ends and line breaks become breaks, everything else is text. Empty and repeated lines go. */
export function htmlParagraphs(html: string): string[] {
  const text = decode(html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, ""));
  return text.split(/\n/).map((line) => line.replace(/[ \t ]+/g, " ").trim()).filter((line) => line.length > 0).slice(0, 120);
}

/** Guldsmedgade 26B, Aarhus - the house. */
export const HOUSE = { lat: 56.159318, lon: 10.207848 };
function coordinates(loc: [string, string] | undefined): { lat: number; lon: number } {
  const lon = Number(loc?.[0]), lat = Number(loc?.[1]);
  // Only a place in or near Aarhus is believed; anything else is the house.
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat - HOUSE.lat) < 0.5 && Math.abs(lon - HOUSE.lon) < 0.5 ? { lat, lon } : HOUSE;
}

type MwEvent = { ttl?: string; sdp?: number; edp?: number; lgo?: { l?: string }; adr?: { ad1?: string; zip?: string; cit?: string; loc?: [string, string] }; dtl?: string; tkt?: Array<{ lbl?: string }>; cap?: number };

export async function eventDetail(id: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<EventDetail | null> {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.detail;
  const feed = (await getExternalEvents(false, fetcher).catch(() => [])).find((event) => eventIdOf(event) === id) ?? null;
  let mw: MwEvent | null = null;
  try {
    const response = await fetcher(`https://api.membershipworks.com/v2/event?eid=${id}&org=${ORG}`, { headers: { accept: "application/json" } });
    if (response.ok) mw = await response.json() as MwEvent;
  } catch { mw = null; }
  if (!feed && !mw?.ttl) { cache.set(id, { at: now, detail: null }); return null; }
  const address = mw?.adr ? [mw.adr.ad1, [mw.adr.zip, mw.adr.cit].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;
  const detail: EventDetail = {
    id,
    title: feed?.title ?? decode(mw?.ttl ?? ""),
    startsAt: feed?.startsAt ?? new Date((mw?.sdp ?? 0) * 1000).toISOString(),
    endsAt: feed?.endsAt ?? (mw?.edp ? new Date(mw.edp * 1000).toISOString() : null),
    host: feed?.host ?? null,
    category: feed?.category ?? null,
    imageUrl: feed?.imageUrl ?? mw?.lgo?.l ?? null,
    address: address || feed?.location || null,
    ...coordinates(mw?.adr?.loc),
    paragraphs: mw?.dtl ? htmlParagraphs(mw.dtl) : (feed?.description ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean),
    tickets: (mw?.tkt ?? []).map((t) => decode(t.lbl ?? "").trim()).filter(Boolean),
    capacity: typeof mw?.cap === "number" && mw.cap > 0 ? mw.cap : null,
    signUpUrl: feed?.link ?? null
  };
  cache.set(id, { at: now, detail });
  return detail;
}

/** Events from the widget's list come without their text (external-events.ts). Where the text is wanted - the radio spots' feed - it is
 * read from each event's own details, for the events up to untilMs only. */
export async function withDescriptions(events: ExternalEvent[], untilMs: number, fetcher: typeof fetch = fetch, now = Date.now()): Promise<ExternalEvent[]> {
  return Promise.all(events.map(async (event) => {
    const id = eventIdOf(event);
    if (event.description || !id || Date.parse(event.startsAt) > untilMs || Date.parse(event.endsAt ?? event.startsAt) < now) return event;
    const detail = await eventDetail(id, fetcher, now).catch(() => null);
    return { ...event, description: detail?.paragraphs.join("\n") || null };
  }));
}
