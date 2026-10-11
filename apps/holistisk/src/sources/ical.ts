import { addDays, localDate, TIMEZONE, wallClock, weekdayIndex, zonedToUtc } from "../time.js";
import { collapse, findHost, htmlToParagraphs } from "../text.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { venueFor } from "./membershipworks.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** iCalendar (RFC 5545) feeds, e.g. an organiser's shared Google Calendar. Options: url, horizonDays (default 120).
 * Recurring events are expanded within the horizon (DAILY/WEEKLY/MONTHLY with INTERVAL, COUNT, UNTIL, BYDAY,
 * BYMONTHDAY, EXDATE and moved occurrences); anything rarer keeps its first occurrence and is flagged. */

type Prop = { name: string; params: Record<string, string>; value: string };
type VEvent = Prop[];

export function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

export function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM="b:c":value - the first colon outside quotes ends the name and parameters.
  let inQuotes = false, split = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) { split = i; break; }
  }
  if (split < 0) return null;
  const head = line.slice(0, split), value = line.slice(split + 1);
  const [name, ...params] = head.split(";");
  const out: Record<string, string> = {};
  for (const p of params) {
    const eq = p.indexOf("=");
    if (eq > 0) out[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params: out, value };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

export function parseCalendar(text: string): VEvent[] {
  const events: VEvent[] = [];
  let current: VEvent | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT$/i.test(line)) { current = []; depth = 0; continue; }
    if (!current) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:VEVENT$/i.test(line)) { events.push(current); current = null; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue; // VALARM and other nested components
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }
  return events;
}

const get = (ev: VEvent, name: string) => ev.find(p => p.name === name);
const getAll = (ev: VEvent, name: string) => ev.filter(p => p.name === name);

function validZone(tz: string | undefined): string | null {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

type ParsedDate = { ms: number; allDay: boolean; zone: string };

/** A DTSTART/DTEND/EXDATE value: UTC (Z), zoned (TZID), floating (the feed's zone) or a date (all day). */
export function parseDate(prop: Prop | undefined, fallbackZone: string): ParsedDate | null {
  if (!prop) return null;
  const v = prop.value.trim().split(",")[0] ?? "";
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  const zone = validZone(prop.params.TZID) ?? fallbackZone;
  if (date || prop.params.VALUE === "DATE") {
    const d = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!d) return null;
    return { ms: zonedToUtc({ year: +d[1]!, month: +d[2]!, day: +d[3]!, hour: 0, minute: 0 }, zone), allDay: true, zone };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const parts = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]!, second: +(m[6] ?? 0) };
  if (m[7]) return { ms: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second), allDay: false, zone };
  return { ms: zonedToUtc(parts, zone), allDay: false, zone };
}

/** ISO 8601 duration (P1DT2H30M) to milliseconds. */
export function parseDuration(value: string | undefined): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value ?? "");
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Occurrence starts of a recurring event, in local wall-clock time so 19:00 stays 19:00 across summer time. */
export function expandRule(rule: string, start: ParsedDate, from: number, until: number, max = 200): { starts: number[]; supported: boolean } {
  const r: Record<string, string> = {};
  for (const part of rule.split(";")) { const [k, v] = part.split("="); if (k && v) r[k.toUpperCase()] = v.toUpperCase(); }
  const freq = r.FREQ, interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const ruleUntil = r.UNTIL ? parseDate({ name: "UNTIL", params: {}, value: r.UNTIL }, start.zone)?.ms ?? Infinity : Infinity;
  const unsupported = Object.keys(r).some(k => !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"].includes(k));
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(freq) || unsupported) return { starts: [start.ms], supported: false };
  const w = wallClock(start.ms, start.zone);
  const firstDate = localDate(start.ms, start.zone);
  const at = (date: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return start.allDay ? zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, start.zone) : zonedToUtc({ year: y, month: m, day: d, hour: w.hour, minute: w.minute, second: w.second }, start.zone);
  };
  const byDay = (r.BYDAY ?? "").split(",").filter(Boolean);
  const byMonthDay = (r.BYMONTHDAY ?? "").split(",").filter(Boolean).map(Number);
  const starts: number[] = [];
  let produced = 0;
  const emit = (date: string): boolean => {
    if (date < firstDate) return true;
    const ms = at(date);
    if (ms > ruleUntil || produced >= count) return false;
    produced++;
    if (ms >= from && ms <= until) starts.push(ms);
    return ms <= until && starts.length < max;
  };
  if (freq === "DAILY") {
    for (let date = firstDate; ; date = addDays(date, interval)) if (!emit(date)) break;
  } else if (freq === "WEEKLY") {
    const days = byDay.length ? byDay.map(d => DAYS.indexOf(d.slice(-2))).filter(i => i >= 0).sort() : [weekdayIndex(firstDate)];
    const weekStart = addDays(firstDate, -weekdayIndex(firstDate));
    outer: for (let week = weekStart; ; week = addDays(week, 7 * interval)) {
      for (const d of days) if (!emit(addDays(week, d))) break outer;
    }
  } else {
    const [y0, m0] = firstDate.split("-").map(Number) as [number, number];
    outer: for (let i = 0; ; i += interval) {
      const y = y0 + Math.floor((m0 - 1 + i) / 12), m = ((m0 - 1 + i) % 12) + 1;
      if (at(`${y}-${String(m).padStart(2, "0")}-01`) > until) break;
      const dates = monthDates(y, m, byDay, byMonthDay.length ? byMonthDay : byDay.length ? [] : [Number(firstDate.slice(8))]);
      for (const date of dates) if (!emit(date)) break outer;
    }
  }
  return { starts, supported: true };
}

function monthDates(year: number, month: number, byDay: string[], byMonthDay: number[]): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out = new Set<string>();
  for (const md of byMonthDay) {
    const day = md > 0 ? md : length + md + 1;
    if (day >= 1 && day <= length) out.add(`${year}-${pad(month)}-${pad(day)}`);
  }
  for (const spec of byDay) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(spec);
    if (!m) continue;
    const target = DAYS.indexOf(m[2]!);
    const matching: number[] = [];
    for (let d = 1; d <= length; d++) if (weekdayIndex(`${year}-${pad(month)}-${pad(d)}`) === target) matching.push(d);
    const nth = m[1] ? Number(m[1]) : 0;
    const picked = nth === 0 ? matching : nth > 0 ? [matching[nth - 1]] : [matching[matching.length + nth]];
    for (const d of picked) if (d) out.add(`${year}-${pad(month)}-${pad(d)}`);
  }
  return [...out].sort();
}

/** "Studio Lys, Vestergade 1, 8000 Aarhus C" -> address, postcode, town. */
export function splitLocation(text: string | null): { name: string | null; address: string | null; postalCode: string | null; city: string | null } {
  if (!text) return { name: null, address: null, postalCode: null, city: null };
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  const idx = parts.findIndex(p => /^\d{4}\s+\S/.test(p));
  if (idx < 0) return { name: parts[0] ?? null, address: parts.length > 1 ? parts.slice(1).join(", ") : null, postalCode: null, city: null };
  const m = /^(\d{4})\s+(.+)$/.exec(parts[idx]!)!;
  const before = parts.slice(0, idx);
  const address = before.length ? before[before.length - 1]! : null;
  const name = before.length > 1 ? before.slice(0, -1).join(", ") : null;
  return { name, address, postalCode: m[1]!, city: m[2]!.replace(/\s*(danmark|denmark)$/i, "").trim() };
}

export function eventsFromCalendar(text: string, config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number; windowEnd: number } {
  const zone = validZone(String(config.options.timezone ?? "")) ?? config.defaults.timezone ?? TIMEZONE;
  const horizonDays = Number(config.options.horizonDays ?? 120) || 120;
  const from = now - 24 * 3600_000, until = now + horizonDays * 86400_000;
  const vevents = parseCalendar(text);
  const overrides = new Map<string, VEvent>();
  for (const ev of vevents) {
    const rid = parseDate(get(ev, "RECURRENCE-ID"), zone);
    const uid = get(ev, "UID")?.value;
    if (rid && uid) overrides.set(`${uid}@${rid.ms}`, ev);
  }
  const out: SourceEvent[] = [];
  let unreadable = 0;
  // Routine sessions (a temple's daily practice) are a standing offering on the organiser's page, not events.
  const skip = typeof config.options.skipTitles === "string" ? new RegExp(config.options.skipTitles, "i") : null;
  for (const ev of vevents) {
    if (get(ev, "RECURRENCE-ID")) continue;
    if (skip && skip.test(unescapeText(get(ev, "SUMMARY")?.value ?? ""))) continue;
    const uid = get(ev, "UID")?.value?.trim();
    const start = parseDate(get(ev, "DTSTART"), zone);
    const summary = collapse(unescapeText(get(ev, "SUMMARY")?.value ?? ""));
    if (!uid || !start || !summary) { unreadable++; continue; }
    const end = parseDate(get(ev, "DTEND"), zone);
    const duration = end ? end.ms - start.ms : parseDuration(get(ev, "DURATION")?.value) ?? (start.allDay ? 86400_000 : null);
    const rrule = get(ev, "RRULE")?.value;
    const exdates = new Set(getAll(ev, "EXDATE").flatMap(p => p.value.split(",").map(v => parseDate({ ...p, value: v }, zone)?.ms).filter((x): x is number => x !== undefined)));
    let starts = [start.ms], flags: string[] = [];
    if (rrule) {
      const expanded = expandRule(rrule, start, from, until);
      starts = expanded.starts;
      if (!expanded.supported) flags = ["recurrence_not_expanded"];
    }
    for (const occurrence of starts) {
      if (exdates.has(occurrence)) continue;
      const override = rrule ? overrides.get(`${uid}@${occurrence}`) : undefined;
      const item = override ?? ev;
      const s = override ? parseDate(get(item, "DTSTART"), zone)?.ms ?? occurrence : occurrence;
      const e = override ? parseDate(get(item, "DTEND"), zone)?.ms ?? (duration !== null ? s + duration : null) : duration !== null ? s + duration : null;
      if ((e ?? s) < from || s > until) continue;
      const title = collapse(unescapeText(get(item, "SUMMARY")?.value ?? summary));
      const altHtml = get(item, "X-ALT-DESC")?.value;
      const paragraphs = altHtml ? htmlToParagraphs(unescapeText(altHtml)) : htmlToParagraphs(unescapeText(get(item, "DESCRIPTION")?.value ?? "").replace(/\n/g, "<br>"));
      const locationText = collapse(unescapeText(get(item, "LOCATION")?.value ?? "")) || null;
      const venue = venueFor(locationText, config.defaults.venues);
      const loc = splitLocation(locationText);
      const geo = /^(-?\d+(?:\.\d+)?)[;,](-?\d+(?:\.\d+)?)$/.exec(get(item, "GEO")?.value ?? "");
      const status = (get(item, "STATUS")?.value ?? "").toUpperCase();
      const price = parsePrice(paragraphs);
      const url = get(item, "URL")?.value?.trim() || null;
      out.push({
        sourceEventId: rrule ? `${uid}@${new Date(occurrence).toISOString()}` : uid,
        title: title.replace(/^\s*(aflyst|cancelled)\s*[:\-–!]\s*/i, "").trim() || title,
        paragraphs,
        startsAt: s,
        endsAt: e !== null && e >= s ? e : null,
        allDay: start.allDay,
        timezone: zone,
        organizerName: venue?.organizerName ?? config.defaults.organizerName,
        organizerUrl: venue?.organizerUrl ?? config.defaults.organizerUrl,
        hostName: findHost(paragraphs),
        venueName: venue?.name ?? loc.name,
        address: venue?.address ?? loc.address,
        postalCode: venue?.postalCode ?? loc.postalCode,
        city: venue?.city ?? loc.city,
        lat: venue?.lat ?? (geo ? Number(geo[1]) : null),
        lon: venue?.lon ?? (geo ? Number(geo[2]) : null),
        locationText,
        categoryHints: getAll(item, "CATEGORIES").flatMap(p => unescapeText(p.value).split(",")).map(collapse).filter(Boolean),
        price: price.minMinor === null && price.isFree === null ? null : { ...price, currency: "DKK" },
        signupUrl: url ?? (typeof config.options.signupUrl === "string" ? config.options.signupUrl : null),
        sourceUrl: url ?? config.homepageUrl,
        imageUrl: null,
        cancelled: status === "CANCELLED" || /\baflyst\b|\bcancel+ed\b/i.test(title),
        qualityFlags: [...flags, ...(price.text ? ["price_from_text"] : [])]
      });
    }
  }
  return { events: out, unreadable, windowEnd: until };
}

export const ical: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "");
    if (!/^https:\/\//.test(url)) throw new Error("ical_url_missing");
    const res = await ctx.http.get(url, { headers: { accept: "text/calendar, text/plain;q=0.5" }, respectRobots: config.respectRobots });
    return eventsFromCalendar(decodeBody(res.body, res.headers.get("content-type")), config, ctx.now);
  }
};
