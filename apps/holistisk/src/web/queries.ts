import type { D1Database } from "../db.js";
import { localDate, nextLocalDate, startOfLocalDay, wallClock } from "../time.js";
import { dateWindow, type Filters } from "./filters.js";
import { activityBySlug } from "../activities.js";
import { zoneSql } from "../zones.js";
import { GROUPS, groupBySlug, type Group } from "../groups.js";
import { broadOnly, isAlternativeEvent } from "../mainstream.js";

/** Read side of the portal. Visible = scheduled (not cancelled), not yet over, and in an active region. A cancelled
 * event drops out of every list, count and calendar; its own page (eventBySlug) still opens and says it is cancelled. */

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
  /** The open flock furthest along that still has room (else the fullest): "members/size", e.g. "2/5". */
  flock_fill: string | null;
};

const ENDS = "COALESCE(e.ends_at, e.starts_at + 10800000)";
const SELECT = `SELECT e.*, s.name AS source_name, s.attribution AS source_attribution, s.homepage_url AS source_homepage,
  o.name AS organizer_name, o.website_url AS organizer_url,
  (SELECT group_concat(category, ',') FROM (SELECT category FROM event_categories c WHERE c.event_id = e.id ORDER BY c.rank)) AS categories,
  (SELECT COUNT(*) FROM flocks f WHERE f.event_id = e.id AND f.status = 'open' AND EXISTS (SELECT 1 FROM flock_members m WHERE m.flock_id = f.id AND m.left_at IS NULL)) AS flock_count,
  (SELECT x.n || '/' || x.max_size FROM (SELECT f.max_size, f.created_at, (SELECT COUNT(*) FROM flock_members m WHERE m.flock_id = f.id AND m.left_at IS NULL) AS n
    FROM flocks f WHERE f.event_id = e.id AND f.status = 'open') x WHERE x.n > 0 ORDER BY (x.n < x.max_size) DESC, x.n DESC, x.created_at LIMIT 1) AS flock_fill
  FROM events e JOIN sources s ON s.id = e.primary_source_id LEFT JOIN organizers o ON o.id = e.organizer_id`;

type Where = { sql: string[]; params: unknown[] };

function visible(regions: string[], now: number): Where {
  return {
    sql: [`e.status = 'scheduled'`, `${ENDS} >= ?`, `e.region IN (${regions.map(() => "?").join(",")})`],
    params: [now, ...regions]
  };
}

const ZONE = zoneSql("e");

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
  const group = groupBySlug(f.group);
  if (group) {
    w.sql.push(`EXISTS (SELECT 1 FROM event_categories c WHERE c.event_id = e.id AND c.category IN (${group.categories.map(() => "?").join(",")}))`);
    w.params.push(...group.categories);
  }
  if (f.area) { w.sql.push("e.area = ?"); w.params.push(f.area); }
  if (f.zone) { w.sql.push(`${ZONE} = ?`); w.params.push(f.zone); }
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
  if (f.broad) { const b = broadOnly(); w.sql.push(b.sql); w.params.push(...b.params); }
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

/** The front page's three tickets (the broad offer first, src/mainstream.ts): coming events on three different days of the next week, an evening one where the day
 * has one, from different organisers, with a picture where there is one, and a free one among them when the week has one. */
export async function heroEvents(db: D1Database, regions: string[], now: number): Promise<EventRow[]> {
  const w = visible(regions, now);
  w.sql.push("e.status = 'scheduled'", "e.all_day = 0", "e.starts_at >= ?", "e.starts_at < ?");
  w.params.push(now, now + 7 * 86400_000);
  const { results } = await db.prepare(`${SELECT} WHERE ${w.sql.join(" AND ")} ORDER BY e.starts_at LIMIT 400`).bind(...w.params).all<EventRow>();
  const evening = (e: EventRow) => wallClock(e.starts_at).hour >= 17;
  // The broad offer first (src/mainstream.ts); then events with a picture, as the tickets show it; evening ones before the rest.
  const pictured = (e: EventRow) => !!e.image_url;
  const pool = [false, true].flatMap(alt => [true, false].flatMap(p => {
    const these = results.filter(e => isAlternativeEvent(e) === alt && pictured(e) === p);
    return [...these.filter(evening), ...these.filter(e => !evening(e))];
  }));
  const picked: EventRow[] = [];
  const sameDay = (a: EventRow, b: EventRow) => localDate(a.starts_at) === localDate(b.starts_at);
  const sameOrganizer = (a: EventRow, b: EventRow) => (a.organizer_id ?? a.id) === (b.organizer_id ?? b.id);
  // Different days and organisers; failing that, different days; failing that, what there is.
  // The broad offer is used up before any spiritual or alternative event is taken.
  const tiers = [pool.filter(e => !isAlternativeEvent(e)), pool.filter(isAlternativeEvent)];
  for (const tier of tiers)
    for (const differs of [(e: EventRow) => !picked.some(p => sameDay(p, e) || sameOrganizer(p, e)), (e: EventRow) => !picked.some(p => sameDay(p, e)), (e: EventRow) => !picked.includes(e)])
      for (const e of tier) if (picked.length < 3 && differs(e)) picked.push(e);
  const free = pool.find(e => e.is_free === 1);
  if (free && !picked.some(e => e.is_free === 1) && !(isAlternativeEvent(free) && picked.every(e => !isAlternativeEvent(e)))) {
    const onItsDay = picked.findIndex(p => sameDay(p, free));
    picked[onItsDay >= 0 ? onItsDay : picked.length - 1] = free;
  }
  return picked.sort((a, b) => a.starts_at - b.starts_at);
}

/** "Lad os komme godt i gang": coming events to flick through and pick some to go to with others, the broad offer
 * first (src/mainstream.ts). Events where a flock
 * already has room come first, then the soonest; at most two per organiser where there are enough others, events that last all day at the back. From
 * twelve hours from now (time to gather a flock) and four weeks ahead. */
export async function kickoffEvents(db: D1Database, regions: string[], now: number, skip: string[] = [], limit = 20): Promise<EventRow[]> {
  const w = visible(regions, now);
  w.sql.push("e.status = 'scheduled'", "e.starts_at > ?", "e.starts_at < ?");
  w.params.push(now + 12 * 3600_000, now + 28 * 86400_000);
  const room = `EXISTS (SELECT 1 FROM flocks f WHERE f.event_id = e.id AND f.status = 'open'
    AND (SELECT COUNT(*) FROM flock_members m WHERE m.flock_id = f.id AND m.left_at IS NULL) BETWEEN 1 AND f.max_size - 1)`;
  const { results: rows } = await db.prepare(`${SELECT} WHERE ${w.sql.join(" AND ")} ORDER BY ${room} DESC, e.all_day, e.starts_at LIMIT 300`)
    .bind(...w.params).all<EventRow>();
  // The broad offer first (src/mainstream.ts), keeping events whose flock has room at the very front.
  const broad = (e: EventRow) => Number(isAlternativeEvent(e));
  const results = [...rows].sort((a, b) => Number(hasFlockRoom(b)) - Number(hasFlockRoom(a)) || broad(a) - broad(b));
  const perOrganizer = new Map<string, number>();
  const picked: EventRow[] = [];
  for (const e of results) {
    if (picked.length >= limit) break;
    if (skip.includes(e.slug)) continue;
    const hasRoom = hasFlockRoom(e);
    const key = e.organizer_id ?? e.venue_name ?? e.id;
    const n = perOrganizer.get(key) ?? 0;
    if (!hasRoom && n >= 2) continue;
    perOrganizer.set(key, n + 1);
    picked.push(e);
  }
  // Too few with that rule (a quiet week, few organisers): fill up in the same order.
  for (const e of results) if (picked.length < limit && !picked.includes(e) && !skip.includes(e.slug)) picked.push(e);
  return picked.sort((a, b) => Number(hasFlockRoom(b)) - Number(hasFlockRoom(a)) || broad(a) - broad(b) || a.all_day - b.all_day || a.starts_at - b.starts_at);
}

/** The open flock furthest along that still has room, from `flock_fill`: members and size, or null. */
export function flockRoom(e: Pick<EventRow, "flock_fill">): { members: number; size: number } | null {
  const [members, size] = (e.flock_fill ?? "").split("/").map(Number);
  return members && size && members < size ? { members, size } : null;
}
const hasFlockRoom = (e: Pick<EventRow, "flock_fill">) => flockRoom(e) !== null;

/** Every coming event with a position, for the map: from now until `days` days ahead. */
export async function mapEvents(db: D1Database, regions: string[], now: number, until: number): Promise<EventRow[]> {
  const w = visible(regions, now);
  w.sql.push("e.status = 'scheduled'", "e.lat IS NOT NULL", "e.lon IS NOT NULL", "e.starts_at < ?");
  w.params.push(until);
  const { results } = await db.prepare(`${SELECT} WHERE ${w.sql.join(" AND ")} ORDER BY e.starts_at LIMIT 3000`).bind(...w.params).all<EventRow>();
  return results;
}

/** How many coming events each of the four main kinds has (an event can count in more than one). */
export async function groupCounts(db: D1Database, regions: string[], now: number): Promise<Map<Group["slug"], number>> {
  const w = visible(regions, now);
  const sums = GROUPS.map((g, i) => `SUM(EXISTS (SELECT 1 FROM event_categories c WHERE c.event_id = e.id AND c.category IN (${g.categories.map(c => `'${c}'`).join(",")}))) AS g${i}`);
  const row = await db.prepare(`SELECT ${sums.join(", ")} FROM events e WHERE ${w.sql.join(" AND ")}`).bind(...w.params).first<Record<string, number | null>>();
  return new Map(GROUPS.map((g, i) => [g.slug, row?.[`g${i}`] ?? 0]));
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
