import type { D1Database } from "../db.js";
import { localDate, nextLocalDate, startOfLocalDay, wallClock } from "../time.js";
import { dateWindow, type Filters } from "./filters.js";
import { activityBySlug } from "../activities.js";

/** Read side of the portal. Visible = scheduled or cancelled, not yet over, and in an active region. */

export type EventRow = {
  id: string; slug: string; title: string; description: string | null; summary: string | null;
  starts_at: number; ends_at: number | null; all_day: number; timezone: string;
  organizer_id: string | null; organizer_name: string | null; organizer_url: string | null; host_name: string | null;
  venue_name: string | null; address: string | null; postal_code: string | null; city: string | null; area: string | null; region: string | null;
  lat: number | null; lon: number | null;
  price_min_minor: number | null; price_max_minor: number | null; price_currency: string | null; price_text: string | null; is_free: number | null;
  signup_url: string | null; image_url: string | null; image_credit: string | null;
  primary_source_id: string; source_name: string; source_attribution: string; source_homepage: string | null; source_url: string | null;
  status: "scheduled" | "cancelled" | "past" | "withdrawn";
  quality_flags: string; last_checked_at: number; updated_at: number; first_seen_at: number;
  categories: string | null;
  /** Open flocks going to the event (Flokken). */
  flock_count: number | null;
};

const ENDS = "COALESCE(e.ends_at, e.starts_at + 10800000)";
const SELECT = `SELECT e.*, s.name AS source_name, s.attribution AS source_attribution, s.homepage_url AS source_homepage,
  o.name AS organizer_name, o.website_url AS organizer_url,
  (SELECT group_concat(category, ',') FROM (SELECT category FROM event_categories c WHERE c.event_id = e.id ORDER BY c.rank)) AS categories,
  (SELECT COUNT(*) FROM flocks f WHERE f.event_id = e.id AND f.status = 'open') AS flock_count
  FROM events e JOIN sources s ON s.id = e.primary_source_id LEFT JOIN organizers o ON o.id = e.organizer_id`;

type Where = { sql: string[]; params: unknown[] };

function visible(regions: string[], now: number): Where {
  return {
    sql: [`e.status IN ('scheduled', 'cancelled')`, `${ENDS} >= ?`, `e.region IN (${regions.map(() => "?").join(",")})`],
    params: [now, ...regions]
  };
}

const likeEscape = (term: string) => `%${term.replace(/[\\%_]/g, m => "\\" + m)}%`;

export function filterWhere(f: Filters, regions: string[], now: number): Where {
  const w = visible(regions, now);
  const window = dateWindow(f, now);
  if (window) {
    const from = startOfLocalDay(window.from);
    if (from !== null) { w.sql.push(`${ENDS} >= ?`); w.params.push(from); }
    const until = window.to ? startOfLocalDay(nextLocalDate(window.to)) : null;
    if (until !== null) { w.sql.push("e.starts_at < ?"); w.params.push(until); }
  }
  if (f.categories.length) {
    w.sql.push(`EXISTS (SELECT 1 FROM event_categories c WHERE c.event_id = e.id AND c.category IN (${f.categories.map(() => "?").join(",")}))`);
    w.params.push(...f.categories);
  }
  if (f.area) { w.sql.push("e.area = ?"); w.params.push(f.area); }
  if (f.city) { w.sql.push("e.city = ?"); w.params.push(f.city); }
  if (f.price === "gratis") w.sql.push("e.is_free = 1");
  if (f.price === "under-100") w.sql.push("(e.is_free = 1 OR e.price_min_minor <= 10000)");
  if (f.price === "under-200") w.sql.push("(e.is_free = 1 OR e.price_min_minor <= 20000)");
  if (f.price === "under-500") w.sql.push("(e.is_free = 1 OR e.price_min_minor <= 50000)");
  if (f.topic && activityBySlug(f.topic)?.groups) {
    w.sql.push("EXISTS (SELECT 1 FROM event_topics t WHERE t.event_id = e.id AND t.topic = ?)");
    w.params.push(f.topic);
  }
  if (f.organizer) { w.sql.push("e.organizer_id = ?"); w.params.push(f.organizer); }
  for (const term of f.q.toLowerCase().split(" ").filter(t => t.length > 1).slice(0, 6)) {
    w.sql.push("e.search_text LIKE ? ESCAPE '\\'");
    w.params.push(likeEscape(term));
  }
  return w;
}

export const PAGE_SIZE = 30;

/** How many visible events match the filters. */
export async function countEvents(db: D1Database, f: Filters, regions: string[], now: number): Promise<number> {
  const w = filterWhere(f, regions, now);
  return (await db.prepare(`SELECT COUNT(*) AS n FROM events e WHERE ${w.sql.join(" AND ")}`).bind(...w.params).first<{ n: number }>())?.n ?? 0;
}

/** How many visible events match the filters, per area. */
export async function countByArea(db: D1Database, f: Filters, regions: string[], now: number): Promise<Map<string, number>> {
  const w = filterWhere(f, regions, now);
  const { results } = await db.prepare(`SELECT e.area, COUNT(*) AS n FROM events e WHERE ${w.sql.join(" AND ")} GROUP BY e.area`).bind(...w.params).all<{ area: string; n: number }>();
  return new Map(results.map(r => [r.area, r.n]));
}

export async function listEvents(db: D1Database, f: Filters, regions: string[], now: number, pageSize = PAGE_SIZE): Promise<{ events: EventRow[]; total: number }> {
  const w = filterWhere(f, regions, now);
  const where = w.sql.join(" AND ");
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM events e WHERE ${where}`).bind(...w.params).first<{ n: number }>();
  const { results } = await db.prepare(`${SELECT} WHERE ${where} ORDER BY e.starts_at, e.id LIMIT ? OFFSET ?`)
    .bind(...w.params, pageSize, (f.page - 1) * pageSize).all<EventRow>();
  return { events: results, total: total?.n ?? 0 };
}

/** A few upcoming events to show with pictures on the front page: soonest first, at most two per organiser, preferring
 * events with a picture. */
/** The front page's three tickets: coming events on three different days of the next week, an evening one where the day
 * has one, from different organisers, and a free one among them when the week has one. */
export async function heroEvents(db: D1Database, regions: string[], now: number): Promise<EventRow[]> {
  const w = visible(regions, now);
  w.sql.push("e.status = 'scheduled'", "e.all_day = 0", "e.starts_at >= ?", "e.starts_at < ?");
  w.params.push(now, now + 7 * 86400_000);
  const { results } = await db.prepare(`${SELECT} WHERE ${w.sql.join(" AND ")} ORDER BY e.starts_at LIMIT 400`).bind(...w.params).all<EventRow>();
  const evening = (e: EventRow) => wallClock(e.starts_at).hour >= 17;
  const pool = [...results.filter(evening), ...results.filter(e => !evening(e))];
  const picked: EventRow[] = [];
  const sameDay = (a: EventRow, b: EventRow) => localDate(a.starts_at) === localDate(b.starts_at);
  const sameOrganizer = (a: EventRow, b: EventRow) => (a.organizer_id ?? a.id) === (b.organizer_id ?? b.id);
  // Different days and organisers; failing that, different days; failing that, what there is.
  for (const differs of [(e: EventRow) => !picked.some(p => sameDay(p, e) || sameOrganizer(p, e)), (e: EventRow) => !picked.some(p => sameDay(p, e)), (e: EventRow) => !picked.includes(e)])
    for (const e of pool) if (picked.length < 3 && differs(e)) picked.push(e);
  const free = pool.find(e => e.is_free === 1);
  if (free && !picked.some(e => e.is_free === 1)) {
    const onItsDay = picked.findIndex(p => sameDay(p, free));
    picked[onItsDay >= 0 ? onItsDay : picked.length - 1] = free;
  }
  return picked.sort((a, b) => a.starts_at - b.starts_at);
}

export async function categoryCounts(db: D1Database, regions: string[], now: number, area: string | null = null): Promise<Map<string, number>> {
  const w = visible(regions, now);
  if (area) { w.sql.push("e.area = ?"); w.params.push(area); }
  const { results } = await db.prepare(`SELECT c.category, COUNT(*) AS n FROM event_categories c JOIN events e ON e.id = c.event_id WHERE ${w.sql.join(" AND ")} GROUP BY c.category`)
    .bind(...w.params).all<{ category: string; n: number }>();
  return new Map(results.map(r => [r.category, r.n]));
}

export async function areaCounts(db: D1Database, regions: string[], now: number): Promise<Map<string, number>> {
  const w = visible(regions, now);
  const { results } = await db.prepare(`SELECT e.area, COUNT(*) AS n FROM events e WHERE ${w.sql.join(" AND ")} GROUP BY e.area`)
    .bind(...w.params).all<{ area: string; n: number }>();
  return new Map(results.map(r => [r.area, r.n]));
}

export async function cities(db: D1Database, regions: string[], now: number, area: string | null): Promise<Array<{ city: string; n: number }>> {
  const w = visible(regions, now);
  w.sql.push("e.city IS NOT NULL");
  if (area) { w.sql.push("e.area = ?"); w.params.push(area); }
  const { results } = await db.prepare(`SELECT e.city, COUNT(*) AS n FROM events e WHERE ${w.sql.join(" AND ")} GROUP BY e.city ORDER BY e.city`)
    .bind(...w.params).all<{ city: string; n: number }>();
  return results;
}

export async function hasPrices(db: D1Database, regions: string[], now: number): Promise<boolean> {
  const w = visible(regions, now);
  const row = await db.prepare(`SELECT 1 AS ok FROM events e WHERE ${w.sql.join(" AND ")} AND (e.price_min_minor IS NOT NULL OR e.is_free = 1) LIMIT 1`).bind(...w.params).first<{ ok: number }>();
  return !!row;
}

export async function eventBySlug(db: D1Database, slug: string): Promise<EventRow | null> {
  return db.prepare(`${SELECT} WHERE e.slug = ?`).bind(slug).first<EventRow>();
}

export async function relatedEvents(db: D1Database, event: EventRow, regions: string[], now: number, count = 3): Promise<EventRow[]> {
  const category = event.categories?.split(",")[0];
  const w = visible(regions, now);
  w.sql.push("e.id != ?", "e.status = 'scheduled'");
  w.params.push(event.id);
  if (category) { w.sql.push("EXISTS (SELECT 1 FROM event_categories c WHERE c.event_id = e.id AND c.category = ?)"); w.params.push(category); }
  const { results } = await db.prepare(`${SELECT} WHERE ${w.sql.join(" AND ")} ORDER BY (e.area = ?) DESC, e.starts_at LIMIT ?`)
    .bind(...w.params, event.area, count).all<EventRow>();
  return results;
}

export async function sitemapEvents(db: D1Database, regions: string[], now: number): Promise<Array<{ slug: string; updated_at: number }>> {
  const w = visible(regions, now);
  w.sql.push("e.status = 'scheduled'");
  const { results } = await db.prepare(`SELECT e.slug, e.updated_at FROM events e WHERE ${w.sql.join(" AND ")} ORDER BY e.starts_at LIMIT 5000`)
    .bind(...w.params).all<{ slug: string; updated_at: number }>();
  return results;
}

export async function sourcesForAbout(db: D1Database): Promise<Array<{ id: string; name: string; homepage_url: string | null; permission_basis: string; attribution: string; enabled: number }>> {
  const { results } = await db.prepare("SELECT id, name, homepage_url, permission_basis, attribution, enabled FROM sources ORDER BY priority DESC, name").all<{ id: string; name: string; homepage_url: string | null; permission_basis: string; attribution: string; enabled: number }>();
  return results;
}
