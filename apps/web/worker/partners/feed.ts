import { parseMembershipWorksRss } from "../external-events.js";

/** A partner's calendar, read without the partner doing anything after the first yes: most calendars
 * (Google, Outlook, WordPress, booking systems) publish an iCal (.ics) address, and MembershipWorks-style
 * RSS is read with the parser Hjerterum's own calendar already uses. */

export type FeedEvent = {
  uid: string;
  title: string;
  startsAtMs: number;
  endsAtMs: number | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  link: string | null;
  imageUrl: string | null;
  category: string | null;
  cancelled: boolean;
};

export type ParsedFeed = { kind: "ics" | "rss"; events: FeedEvent[]; /** Repeating series, not shown in fase 1. */ recurring: number };

const DEFAULT_ZONE = "Europe/Copenhagen";

/** Only web links; a feed's javascript: or data: address never reaches a page. */
export function webUrl(value: string | null | undefined, httpsOnly = false): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || (!httpsOnly && url.protocol === "http:") ? url.href.slice(0, 500) : null;
  } catch { return null; }
}

function plain(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function zoneOrDefault(tzid: string | undefined): string {
  // "/mozilla.org/20070129_1/Europe/Copenhagen" and Windows names: the IANA part, else Copenhagen.
  const name = tzid ? (/[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.exec(tzid)?.[0] ?? tzid) : DEFAULT_ZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return name; } catch { return DEFAULT_ZONE; }
}

/** A wall-clock time in a time zone as an instant (summer and winter time included). */
export function zonedMs(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offset = (ms: number) => {
    const p = Object.fromEntries(format.formatToParts(ms).map(part => [part.type, Number(part.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - ms;
  };
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = wall - offset(wall);
  return wall - offset(first);
}

type Property = { name: string; params: Record<string, string>; value: string };

function property(line: string): Property | null {
  let quoted = false, split = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\"") quoted = !quoted;
    else if (line[i] === ":" && !quoted) { split = i; break; }
  }
  if (split < 1) return null;
  const [name, ...params] = line.slice(0, split).split(";");
  return { name: name!.toUpperCase(), value: line.slice(split + 1),
    params: Object.fromEntries(params.map(p => { const at = p.indexOf("="); return [p.slice(0, at).toUpperCase(), p.slice(at + 1).replace(/^"|"$/g, "")]; })) };
}

const text = (value: string) => value.replace(/\\([\\;,nN])/g, (_m, c: string) => c === "n" || c === "N" ? "\n" : c);

function icsTime(prop: Property | undefined): { ms: number; allDay: boolean } | null {
  if (!prop) return null;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(prop.value.trim());
  if (date) return { ms: zonedMs(+date[1]!, +date[2]!, +date[3]!, 0, 0, 0, DEFAULT_ZONE), allDay: true };
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(prop.value.trim());
  if (!time) return null;
  const [, y, mo, d, h, mi, s, utc] = time;
  const ms = utc ? Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!) : zonedMs(+y!, +mo!, +d!, +h!, +mi!, +s!, zoneOrDefault(prop.params.TZID));
  return Number.isFinite(ms) ? { ms, allDay: false } : null;
}

function durationMs(value: string | undefined): number | null {
  const match = value ? /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim()) : null;
  if (!match) return null;
  const [, w, d, h, m, s] = match.map(v => Number(v ?? 0));
  return ((((w! * 7 + d!) * 24 + h!) * 60 + m!) * 60 + s!) * 1000;
}

export function contentHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** The events in an iCal calendar. Repeating series are counted and left out (fase 1); private
 * events are never published. */
export function parseIcs(source: string): { events: FeedEvent[]; recurring: number } {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: FeedEvent[] = [];
  let recurring = 0, current: Property[] | null = null, nested = 0;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") { current = []; nested = 0; continue; }
    if (!current) continue;
    if (upper.startsWith("BEGIN:")) { nested++; continue; }
    if (upper.startsWith("END:") && upper !== "END:VEVENT") { nested = Math.max(0, nested - 1); continue; }
    if (upper === "END:VEVENT") {
      const props = current;
      current = null;
      const get = (name: string) => props.find(p => p.name === name);
      if (get("RRULE") || get("RDATE") || get("RECURRENCE-ID")) { recurring++; continue; }
      const access = get("CLASS")?.value.trim().toUpperCase();
      if (access === "PRIVATE" || access === "CONFIDENTIAL") continue;
      const title = get("SUMMARY") ? plain(text(get("SUMMARY")!.value)) : "";
      const start = icsTime(get("DTSTART"));
      if (!title || !start) continue;
      const end = icsTime(get("DTEND"));
      const duration = durationMs(get("DURATION")?.value);
      const endsAtMs = end && end.ms > start.ms ? end.ms : duration ? start.ms + duration : null;
      const image = get("IMAGE") ?? props.find(p => p.name === "ATTACH" && /^image\//i.test(p.params.FMTTYPE ?? ""));
      const description = get("DESCRIPTION") ? plain(text(get("DESCRIPTION")!.value)) : "";
      events.push({
        uid: (get("UID")?.value.trim() || `ics-${contentHash(`${start.ms}|${title}`)}`).slice(0, 200),
        title: title.slice(0, 300),
        startsAtMs: start.ms,
        endsAtMs,
        allDay: start.allDay,
        location: get("LOCATION") ? plain(text(get("LOCATION")!.value)).slice(0, 200) || null : null,
        description: description ? description.slice(0, 2000) : null,
        link: webUrl(get("URL") ? text(get("URL")!.value) : null),
        imageUrl: webUrl(image?.value, true),
        category: get("CATEGORIES") ? text(get("CATEGORIES")!.value).split(",")[0]!.trim().slice(0, 120) || null : null,
        cancelled: get("STATUS")?.value.trim().toUpperCase() === "CANCELLED"
      });
      continue;
    }
    if (nested > 0) continue;
    const prop = property(line);
    if (prop) current.push(prop);
  }
  return { events, recurring };
}

/** iCal or RSS, recognised by its content; null when it is neither. */
export function parseFeed(source: string): ParsedFeed | null {
  const head = source.trimStart().slice(0, 4000);
  if (/^BEGIN:VCALENDAR/i.test(head)) return { kind: "ics", ...parseIcs(source) };
  if (/<(?:rss|rdf:RDF|channel)\b/i.test(head)) {
    const events = parseMembershipWorksRss(source).map((event): FeedEvent => ({
      uid: event.id.slice(0, 200), title: plain(event.title).slice(0, 300), startsAtMs: Date.parse(event.startsAt), endsAtMs: event.endsAt ? Date.parse(event.endsAt) : null,
      allDay: false, location: event.location ? plain(event.location).slice(0, 200) : null, description: event.description?.slice(0, 2000) ?? null,
      link: webUrl(event.link), imageUrl: webUrl(event.imageUrl, true), category: event.category?.slice(0, 120) ?? null, cancelled: false }));
    return { kind: "rss", events: events.filter(e => Number.isFinite(e.startsAtMs)), recurring: 0 };
  }
  return null;
}
