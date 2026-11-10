import { activeAreas, areaBySlug } from "../geo.js";
import { categoryBySlug } from "../categories.js";
import { groupBySlug, type Group } from "../groups.js";
import { activityBySlug } from "../activities.js";
import { addDays, localDate, startOfLocalDay, weekdayIndex } from "../time.js";
import { zoneBySlug, type Zone } from "../zones.js";

/** The event list's filters, read from the query string and checked: anything unknown is dropped, never echoed. */
export type Filters = {
  q: string;
  from: string | null;
  to: string | null;
  period: Period | null;
  categories: string[];
  /** One of the four main kinds (src/groups.ts): ?gruppe=. */
  group: Group["slug"] | null;
  area: string | null;
  /** A part of the Aarhus area (src/zones.ts): Midtbyen, Nord, Syd or Vest. Shares ?omraade= with the older areas. */
  zone: Zone | null;
  city: string | null;
  price: PriceFilter | null;
  page: number;
  /** A topic (src/activities.ts) the events' text must match: set by a topic's landing page, or ?emne=. */
  topic: string | null;
  /** An organiser's events only (the organiser's profile page). */
  organizer: string | null;
  /** Only the broad offer, without spiritual and alternative events (src/mainstream.ts): the front page's lists. */
  broad?: boolean;
};

export type Period = "idag" | "imorgen" | "weekend" | "14-dage" | "uge" | "maaned";
export type PriceFilter = "gratis" | "under-100" | "under-200" | "under-500";

export const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "idag", label: "I dag" },
  { value: "imorgen", label: "I morgen" },
  { value: "weekend", label: "I weekenden" },
  { value: "14-dage", label: "Næste 14 dage" },
  { value: "uge", label: "Næste 7 dage" },
  { value: "maaned", label: "Næste 30 dage" }
];

export const PRICES: Array<{ value: PriceFilter; label: string }> = [
  { value: "gratis", label: "Gratis" },
  { value: "under-100", label: "Under 100 kr." },
  { value: "under-200", label: "Under 200 kr." },
  { value: "under-500", label: "Under 500 kr." }
];

/** The periods offered as chips in the calendar's filters. The others still work in links. */
export const PERIOD_CHIPS: Period[] = ["idag", "imorgen", "weekend", "14-dage"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams, activeRegions: string[]): Filters {
  const areas = activeAreas(activeRegions);
  const q = (params.get("q") ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const date = (v: string | null) => v && DATE.test(v) && startOfLocalDay(v) !== null ? v : null;
  const period = PERIODS.find(p => p.value === params.get("periode"))?.value ?? null;
  const categories = [...new Set(params.getAll("kategori").filter(c => !!categoryBySlug(c)))].slice(0, 14);
  const areaParam = params.get("omraade");
  const zone = zoneBySlug(areaParam)?.slug ?? null;
  const area = !zone && areaParam && areas.some(a => a.slug === areaParam) ? areaParam : null;
  const city = (params.get("by") ?? "").trim().slice(0, 60) || null;
  const price = PRICES.find(p => p.value === params.get("pris"))?.value ?? null;
  const page = Math.min(200, Math.max(1, Number.parseInt(params.get("side") ?? "1", 10) || 1));
  const topicParam = params.get("emne");
  const topic = topicParam && activityBySlug(topicParam)?.groups ? topicParam : null;
  const group = groupBySlug(params.get("gruppe"))?.slug ?? null;
  return { q, from: date(params.get("fra")), to: date(params.get("til")), period, categories, group, area, zone, city, price, page, topic, organizer: null };
}

/** The date window (local days, inclusive) the filters ask for, or null for "from now on". */
export function dateWindow(f: Filters, now: number): { from: string; to: string | null } | null {
  const today = localDate(now);
  if (f.period === "idag") return { from: today, to: today };
  if (f.period === "imorgen") return { from: addDays(today, 1), to: addDays(today, 1) };
  if (f.period === "14-dage") return { from: today, to: addDays(today, 13) };
  if (f.period === "uge") return { from: today, to: addDays(today, 6) };
  if (f.period === "maaned") return { from: today, to: addDays(today, 29) };
  if (f.period === "weekend") {
    const wd = weekdayIndex(today);
    // Friday evening to Sunday: on a weekday the coming weekend, during the weekend the rest of it.
    const friday = wd <= 4 ? addDays(today, 4 - wd) : today;
    const sunday = addDays(today, 6 - wd);
    return { from: wd <= 4 ? friday : today, to: sunday };
  }
  if (f.from || f.to) return { from: f.from ?? today, to: f.to };
  return null;
}

/** The filters back to a query string (for links: pagination, removing one filter, the canonical URL). */
export function toQuery(f: Partial<Filters>, overrides: Partial<Filters> = {}): string {
  const v = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  if (v.period) p.set("periode", v.period);
  if (!v.period && v.from) p.set("fra", v.from);
  if (!v.period && v.to) p.set("til", v.to);
  if (v.group) p.set("gruppe", v.group);
  for (const c of v.categories ?? []) p.append("kategori", c);
  if (v.zone) p.set("omraade", v.zone);
  else if (v.area) p.set("omraade", v.area);
  if (v.city) p.set("by", v.city);
  if (v.price) p.set("pris", v.price);
  if (v.topic) p.set("emne", v.topic);
  if (v.page && v.page > 1) p.set("side", String(v.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const hasFilters = (f: Filters): boolean =>
  !!(f.q || f.from || f.to || f.period || f.group || f.categories.length || f.area || f.zone || f.city || f.price || f.topic);

export const areaName = (slug: string | null): string | null => slug ? areaBySlug(slug)?.name ?? null : null;
