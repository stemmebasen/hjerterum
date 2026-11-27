import { storedEventById, type ExternalEvent } from "./external-events.js";

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

/** A link in the source: its text and address as [text](address) (site/event-links.ts), so the link is not lost. Only web and mail addresses;
 * a link whose text is its own address stays the bare address. */
function writtenLinks(html: string): string {
  return html.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_all, _q: string, rawHref: string, inner: string) => {
    const text = decode(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
    const href = decode(rawHref).trim().replace(/\s/g, "%20").replace(/\)/g, "%29");
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return inner;
    if (!text) return "";
    const bare = (value: string) => value.replace(/^(https?:\/\/)?(www\.)?/i, "").replace(/\/$/, "").toLowerCase();
    if (bare(text) === bare(href)) return href;
    return `[${text}](${href})`;
  });
}

/** HTML to paragraphs: block ends and line breaks become breaks, links keep their address, everything else is text. Empty and repeated lines go. */
export function htmlParagraphs(html: string): string[] {
  const text = decode(writtenLinks(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, ""));
  return text.split(/\n/).map((line) => line.replace(/[ \t ]+/g, " ").trim()).filter((line) => line.length > 0).slice(0, 120);
}

/** Guldsmedgade 26B, Aarhus - the house. */
export const HOUSE = { lat: 56.159318, lon: 10.207848 };

/** An event of the kept calendar (external-events.ts storedEventById), coming or past - read from D1 only, never from MembershipWorks
 * (the chair, 27 Nov 2026: "alle forbindelser ... skal klippes"). What only MembershipWorks' own event page had (tickets, places) is not shown. */
export async function eventDetail(id: string, now = Date.now()): Promise<EventDetail | null> {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.detail;
  const event = await storedEventById(`SF${id}`);
  const detail: EventDetail | null = event ? {
    id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, host: event.host, category: event.category, imageUrl: event.imageUrl,
    address: event.location, ...HOUSE,
    paragraphs: /<[a-z][^>]*>/i.test(event.description ?? "") ? htmlParagraphs(event.description!) : (event.description ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean),
    tickets: [], capacity: null, signUpUrl: null
  } : null;
  cache.set(id, { at: now, detail });
  return detail;
}

