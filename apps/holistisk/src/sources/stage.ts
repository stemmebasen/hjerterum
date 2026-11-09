import { collapse, decodeEntities } from "../text.js";
import { monthNumber, zonedToUtc } from "../time.js";
import type { SourceConfig, SourceEvent } from "./types.js";

/** Shared reading for theatres' programmes, which name a production's run ("17. – 19. november 2026",
 * "29. november – 17. december 2026", "20. feb. - 6. mar. 2027", "7. marts 2027") and often one curtain time
 * ("19:30", "KL. 19.30, LØR. KL. 16"). A short run with a known time becomes one event per evening. A longer run, or one
 * without a time, has no exact performances to go to together, so it is left out (the project owner's choice,
 * 2026-11-09); `showRuns: true` would show it as one event for the whole run instead. */

export const stageText = (s: string): string => collapse(decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

export type Day = { y: number; m: number; d: number };

/** "8. – 12. november 2026", "29. november – 17. december 2026", "20. feb. - 6. mar. 2027", "7. marts 2027",
 * "18. - 19. NOVEMBER", with `fallbackYear` when the text has none. */
export function parseDanishRange(value: string, fallbackYear?: number): { start: Day; end: Day } | null {
  const v = collapse(value).toLowerCase().replace(/[–—]/g, "-");
  const year = /(\d{4})/.exec(v)?.[1];
  const y = year ? Number(year) : fallbackYear;
  if (!y) return null;
  const range = /(\d{1,2})\.\s*(?:([a-zæøå]+)\.?\s*)?(?:\d{4}\s*)?-\s*(\d{1,2})\.\s*([a-zæøå]+)\.?/.exec(v);
  if (range) {
    const m2 = monthNumber(range[4]!);
    const m1 = range[2] ? monthNumber(range[2]) : m2;
    if (!m1 || !m2) return null;
    // A run over New Year ("28. dec. - 3. jan. 2027"): the year printed is the end's.
    return { start: { y: m1 > m2 ? y - 1 : y, m: m1, d: Number(range[1]) }, end: { y, m: m2, d: Number(range[3]) } };
  }
  const one = /(\d{1,2})\.\s*([a-zæøå]+)\.?/.exec(v);
  const m = one ? monthNumber(one[2]!) : null;
  return one && m ? { start: { y, m, d: Number(one[1]) }, end: { y, m, d: Number(one[1]) } } : null;
}

/** The first clock time in "19:30", "kl. 19.30, lør. kl. 16", "Tidspunkt 20:00"; null when there is none. */
export function parseCurtain(value: string | null): [number, number] | null {
  if (!value) return null;
  const m = /(?:kl\.?\s*)?\b(\d{1,2})[:.](\d{2})\b/i.exec(value) ?? /\bkl\.?\s*(\d{1,2})\b/i.exec(value);
  if (!m || Number(m[1]) > 23) return null;
  return [Number(m[1]), Number(m[2] ?? 0)];
}

const dayMs = (d: Day) => Date.UTC(d.y, d.m - 1, d.d);
export const daysBetween = (a: Day, b: Day): number => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);
const addDays = (d: Day, n: number): Day => { const t = new Date(dayMs(d) + n * 86_400_000); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

export type Production = {
  id: string; title: string; url: string; teaser: string | null; image: string | null;
  start: Day; end: Day; time: [number, number] | null; price: SourceEvent["price"]; signupUrl?: string | null;
  venueName?: string | null; hints?: string[]; soldOut?: boolean; cancelled?: boolean;
};

/** One event per evening for a run of at most `expandDays` evenings with a known time; otherwise nothing, or with
 * `showRuns` one event for the run. Runs longer than `maxRunDays` (a whole season) are always left out. */
export function productionEvents(p: Production, config: SourceConfig): SourceEvent[] {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const expandDays = Number(config.options.expandDays ?? 4);
  const maxRunDays = Number(config.options.maxRunDays ?? 45);
  const span = daysBetween(p.start, p.end);
  if (span < 0 || span > maxRunDays) return [];
  if (!(p.time && span + 1 <= expandDays) && config.options.showRuns !== true) return [];
  const base = (startsAt: number, endsAt: number | null, allDay: boolean, id: string, flags: string[]): SourceEvent => ({
    sourceEventId: id, title: p.title, paragraphs: p.teaser ? [p.teaser] : [],
    startsAt, endsAt, allDay, timezone: zone,
    organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
    venueName: p.venueName ?? venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
    lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: p.venueName ?? venue?.name ?? null,
    categoryHints: p.hints ?? [], price: p.price,
    signupUrl: p.signupUrl ?? p.url, sourceUrl: p.url, imageUrl: p.image,
    cancelled: !!p.cancelled, qualityFlags: [...flags, ...(p.soldOut ? ["sold_out"] : [])]
  });
  const at = (d: Day, h: number, mi: number) => zonedToUtc({ year: d.y, month: d.m, day: d.d, hour: h, minute: mi }, zone);
  if (p.time && span + 1 <= expandDays) {
    return Array.from({ length: span + 1 }, (_, i) => {
      const d = addDays(p.start, i);
      return base(at(d, p.time![0], p.time![1]), null, false, `${p.id}@${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`, []);
    });
  }
  return [base(at(p.start, 0, 0), at(p.end, 24, 0), true, p.id, span > 0 ? ["run"] : [])];
}

export const upcoming = (events: SourceEvent[], now: number): SourceEvent[] => events.filter(e => (e.endsAt ?? e.startsAt) >= now);
