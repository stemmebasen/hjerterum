import { chunk, MAX_BOUND, runBatched, type D1Database, type D1PreparedStatement } from "../db.js";
import { normalizeTitle, titleSimilarity } from "../text.js";
import type { AdapterContext, SourceAdapter, SourceConfig, SourceEvent } from "../sources/types.js";
import { contentHash, normalize, type EventRecord } from "./normalize.js";

/** Writing one source's events: new events are created, changed ones updated (with a change log), the same event from
 * another source (or posted twice) is merged into the one already there, and an event that has disappeared from a
 * complete listing is withdrawn after two runs. Re-running with the same data changes nothing but "last checked". */

/** enriched = detail lookups made (a failed lookup keeps the listing's data and is flagged enrich_failed). */
export type SourceStats = { fetched: number; created: number; updated: number; unchanged: number; duplicates: number; rejected: number; withdrawn: number; enriched: number };

/** At most this many detail requests per source and run, so one run stays well inside the Workers subrequest budget. */
export const ENRICH_BUDGET = 25;
const MATCH_WINDOW_MS = 30 * 60_000;
const MISSING_RUNS_BEFORE_WITHDRAWN = 2;

type Link = { source_event_id: string; event_id: string; content_hash: string };
type Candidate = { id: string; title: string; starts_at: number; area: string | null; primary_source_id: string; status: string };
type CurrentRow = { id: string; title: string; starts_at: number; ends_at: number | null; status: string; venue_name: string | null; address: string | null; signup_url: string | null; price_min_minor: number | null; primary_source_id: string };

const EVENT_COLUMNS = [
  "title", "description", "summary", "starts_at", "ends_at", "all_day", "timezone", "organizer_id", "host_name", "venue_name", "address",
  "postal_code", "city", "area", "region", "lat", "lon", "price_min_minor", "price_max_minor", "price_currency", "price_text", "is_free",
  "signup_url", "image_url", "image_credit", "primary_source_id", "source_url", "status", "fingerprint", "search_text", "quality_flags", "content_hash"
] as const;

/** The same event: start within half an hour, nearly the same title, and not in two different areas. */
export function isSameEvent(a: { title: string; starts_at: number; area: string | null }, b: { title: string; starts_at: number; area: string | null }): boolean {
  if (Math.abs(a.starts_at - b.starts_at) > MATCH_WINDOW_MS) return false;
  if (a.area && b.area && a.area !== b.area) return false;
  return titleSimilarity(normalizeTitle(a.title), normalizeTitle(b.title)) >= 0.6;
}

export async function syncSources(db: D1Database, sources: SourceConfig[], now: number): Promise<void> {
  await runBatched(db, sources.map(s => db.prepare(
    `INSERT INTO sources (id, name, adapter, homepage_url, permission_basis, attribution, image_policy, description_policy, priority, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, adapter = excluded.adapter, homepage_url = excluded.homepage_url,
       permission_basis = excluded.permission_basis, attribution = excluded.attribution, image_policy = excluded.image_policy,
       description_policy = excluded.description_policy, priority = excluded.priority, enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).bind(s.id, s.name, s.adapter, s.homepageUrl, s.permissionBasis, s.attribution, s.imagePolicy, s.descriptionPolicy, s.priority, 1, now)));
}

export async function markSourceEnabled(db: D1Database, id: string, enabled: boolean): Promise<void> {
  await db.prepare("UPDATE sources SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, id).run();
}

function organizerStatement(db: D1Database, r: EventRecord, now: number): D1PreparedStatement | null {
  if (!r.organizer_id || !r.organizer_name) return null;
  return db.prepare(
    `INSERT INTO organizers (id, name, website_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, website_url = COALESCE(excluded.website_url, organizers.website_url), updated_at = excluded.updated_at`
  ).bind(r.organizer_id, r.organizer_name, r.organizer_url, now, now);
}

function categoryStatements(db: D1Database, eventId: string, categories: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM event_categories WHERE event_id = ?").bind(eventId),
    ...categories.map((c, rank) => db.prepare("INSERT INTO event_categories (event_id, category, rank) VALUES (?, ?, ?)").bind(eventId, c, rank))
  ];
}

const change = (db: D1Database, eventId: string, runId: string, now: number, kind: string, details: unknown) =>
  db.prepare("INSERT INTO event_changes (event_id, run_id, changed_at, kind, details) VALUES (?, ?, ?, ?, ?)").bind(eventId, runId, now, kind, JSON.stringify(details));

const values = (r: EventRecord, hash: string) => EVENT_COLUMNS.map(c => c === "content_hash" ? hash : r[c]);

async function loadLinks(db: D1Database, sourceId: string): Promise<Map<string, Link>> {
  const { results } = await db.prepare("SELECT source_event_id, event_id, content_hash FROM event_sources WHERE source_id = ?").bind(sourceId).all<Link>();
  return new Map(results.map(l => [l.source_event_id, l]));
}

async function loadRows<T>(db: D1Database, sql: (placeholders: string) => string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk(ids, MAX_BOUND)) {
    if (!part.length) continue;
    const { results } = await db.prepare(sql(part.map(() => "?").join(","))).bind(...part).all<T>();
    out.push(...results);
  }
  return out;
}

export async function processSource(
  db: D1Database, config: SourceConfig, adapter: SourceAdapter, ctx: AdapterContext, runId: string,
  priorities: Map<string, number>, enrichLimit = ENRICH_BUDGET
): Promise<SourceStats> {
  const now = ctx.now;
  const stats: SourceStats = { fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, withdrawn: 0, enriched: 0 };
  const result = await adapter.fetch(config, ctx);

  // One record per source id (a feed listing the same item twice counts it once).
  const items = new Map<string, SourceEvent>();
  for (const e of result.events) if (!items.has(e.sourceEventId)) items.set(e.sourceEventId, e);
  stats.fetched = items.size;
  stats.rejected += result.unreadable;

  const links = await loadLinks(db, config.id);
  const starts = [...items.values()].map(e => e.startsAt);
  const candidates: Candidate[] = starts.length ? (await db.prepare(
    "SELECT id, title, starts_at, area, primary_source_id, status FROM events WHERE starts_at BETWEEN ? AND ? AND status != 'withdrawn'"
  ).bind(Math.min(...starts) - MATCH_WINDOW_MS, Math.max(...starts) + MATCH_WINDOW_MS).all<Candidate>()).results : [];

  const changedLinks = [...items.values()].map(e => links.get(e.sourceEventId)).filter((l): l is Link => !!l);
  const current = new Map((await loadRows<CurrentRow>(db, p => `SELECT id, title, starts_at, ends_at, status, venue_name, address, signup_url, price_min_minor, primary_source_id FROM events WHERE id IN (${p})`, [...new Set(changedLinks.map(l => l.event_id))])).map(r => [r.id, r]));

  const writes: D1PreparedStatement[] = [];
  const seenEvents = new Set<string>();
  const touched: string[] = [];
  const touchedLinks: string[] = [];
  let enrichBudget = enrichLimit;

  for (const raw of items.values()) {
    const hash = await contentHash(raw);
    const link = links.get(raw.sourceEventId);
    if (link && link.content_hash === hash && current.has(link.event_id)) {
      stats.unchanged++;
      seenEvents.add(link.event_id);
      touched.push(link.event_id);
      touchedLinks.push(raw.sourceEventId);
      continue;
    }

    let event = raw;
    // Over the detail budget: stored as not yet checked, so the next run looks it up (and only then counts it unchanged).
    let storedHash = hash;
    if (adapter.enrich && enrichBudget <= 0) storedHash = `pending:${hash}`;
    if (adapter.enrich && enrichBudget > 0) {
      enrichBudget--;
      stats.enriched++;
      try { event = await adapter.enrich(raw, config, ctx); }
      catch (error) { event = { ...raw, qualityFlags: [...raw.qualityFlags, "enrich_failed"] }; console.warn(JSON.stringify({ event: "enrich_failed", source: config.id, id: raw.sourceEventId, error: String(error instanceof Error ? error.message : error) })); }
    }
    const normalized = await normalize(event, config);
    if (!normalized.ok) { stats.rejected++; continue; }
    const record = normalized.record;
    const org = organizerStatement(db, record, now);

    if (link && current.has(link.event_id)) {
      // A record we know, changed at the source.
      const before = current.get(link.event_id)!;
      seenEvents.add(before.id);
      writes.push(db.prepare("UPDATE event_sources SET content_hash = ?, last_seen_at = ?, source_url = ? WHERE source_id = ? AND source_event_id = ?").bind(storedHash, now, record.source_url, config.id, raw.sourceEventId));
      const leads = before.primary_source_id === config.id || (priorities.get(config.id) ?? 0) > (priorities.get(before.primary_source_id) ?? 0);
      if (leads) {
        if (org) writes.push(org);
        writes.push(db.prepare(`UPDATE events SET ${EVENT_COLUMNS.map(c => `${c} = ?`).join(", ")}, missing_runs = 0, last_checked_at = ?, updated_at = ? WHERE id = ?`)
          .bind(...values(record, hash), now, now, before.id));
        writes.push(...categoryStatements(db, before.id, record.categories));
        const changes = diff(before, record);
        // Only a visible change is logged (not a detail lookup or a new way of categorising).
        if (Object.keys(changes).length) writes.push(change(db, before.id, runId, now, changeKind(before, record), changes));
      } else {
        writes.push(db.prepare("UPDATE events SET last_checked_at = ?, missing_runs = 0 WHERE id = ?").bind(now, before.id));
      }
      if (link.content_hash.startsWith("pending:") && link.content_hash.slice(8) === hash) stats.unchanged++; else stats.updated++;
      continue;
    }

    // A record we have not seen: the same event from another source (or posted twice) is merged, else it is new.
    const same = candidates.find(c => isSameEvent(c, record));
    if (same) {
      seenEvents.add(same.id);
      writes.push(db.prepare(
        `INSERT INTO event_sources (source_id, source_event_id, event_id, source_url, content_hash, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, source_event_id) DO UPDATE SET event_id = excluded.event_id, content_hash = excluded.content_hash, last_seen_at = excluded.last_seen_at`
      ).bind(config.id, raw.sourceEventId, same.id, record.source_url, storedHash, now, now));
      const leads = same.primary_source_id !== config.id && (priorities.get(config.id) ?? 0) > (priorities.get(same.primary_source_id) ?? 0);
      if (org) writes.push(org);
      if (leads) {
        writes.push(db.prepare(`UPDATE events SET ${EVENT_COLUMNS.map(c => `${c} = ?`).join(", ")}, missing_runs = 0, last_checked_at = ?, updated_at = ? WHERE id = ?`)
          .bind(...values(record, hash), now, now, same.id));
        writes.push(...categoryStatements(db, same.id, record.categories));
        same.primary_source_id = config.id;
      } else {
        // The leading source keeps its text; the other source only fills what is missing.
        writes.push(db.prepare(
          `UPDATE events SET image_url = COALESCE(image_url, ?), image_credit = CASE WHEN image_url IS NULL THEN ? ELSE image_credit END,
             price_min_minor = COALESCE(price_min_minor, ?), price_max_minor = COALESCE(price_max_minor, ?), price_currency = COALESCE(price_currency, ?),
             is_free = COALESCE(is_free, ?), lat = COALESCE(lat, ?), lon = COALESCE(lon, ?), address = COALESCE(address, ?),
             postal_code = COALESCE(postal_code, ?), signup_url = COALESCE(signup_url, ?), missing_runs = 0, last_checked_at = ?, updated_at = ?
           WHERE id = ?`
        ).bind(record.image_url, record.image_credit, record.price_min_minor, record.price_max_minor, record.price_currency, record.is_free,
          record.lat, record.lon, record.address, record.postal_code, record.signup_url, now, now, same.id));
      }
      writes.push(change(db, same.id, runId, now, "merged_duplicate", { source: config.id, sourceEventId: raw.sourceEventId, title: record.title }));
      stats.duplicates++;
      continue;
    }

    if (org) writes.push(org);
    writes.push(db.prepare(
      `INSERT INTO events (id, slug, ${EVENT_COLUMNS.join(", ")}, missing_runs, first_seen_at, last_checked_at, updated_at)
       VALUES (?, ?, ${EVENT_COLUMNS.map(() => "?").join(", ")}, 0, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(record.id, record.slug, ...values(record, hash), now, now, now));
    writes.push(...categoryStatements(db, record.id, record.categories));
    writes.push(db.prepare(
      `INSERT INTO event_sources (source_id, source_event_id, event_id, source_url, content_hash, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_event_id) DO UPDATE SET event_id = excluded.event_id, content_hash = excluded.content_hash, last_seen_at = excluded.last_seen_at`
    ).bind(config.id, raw.sourceEventId, record.id, record.source_url, storedHash, now, now));
    writes.push(change(db, record.id, runId, now, "created", { source: config.id, sourceEventId: raw.sourceEventId }));
    candidates.push({ id: record.id, title: record.title, starts_at: record.starts_at, area: record.area, primary_source_id: config.id, status: record.status });
    seenEvents.add(record.id);
    stats.created++;
  }

  // Seen again unchanged: checked now; an event that had been withdrawn is back.
  const reappeared = (await loadRows<{ id: string }>(db, p => `SELECT id FROM events WHERE status = 'withdrawn' AND id IN (${p})`, touched)).map(r => r.id);
  for (const id of reappeared) writes.push(change(db, id, runId, now, "reappeared", { source: config.id }));
  for (const part of chunk(touched, MAX_BOUND)) {
    writes.push(db.prepare(`UPDATE events SET last_checked_at = ?, missing_runs = 0, status = CASE WHEN status = 'withdrawn' THEN 'scheduled' ELSE status END WHERE id IN (${part.map(() => "?").join(",")})`).bind(now, ...part));
  }
  for (const part of chunk(touchedLinks, MAX_BOUND - 2)) {
    writes.push(db.prepare(`UPDATE event_sources SET last_seen_at = ? WHERE source_id = ? AND source_event_id IN (${part.map(() => "?").join(",")})`).bind(now, config.id, ...part));
  }

  // Gone from a complete listing: an upcoming event within the listing's window that no record of this source showed.
  if (config.completeListing && result.windowEnd !== null) {
    const missing = [...new Set([...links.values()].filter(l => !items.has(l.source_event_id)).map(l => l.event_id))].filter(id => !seenEvents.has(id));
    const rows = await loadRows<{ id: string; starts_at: number; missing_runs: number; status: string; primary_source_id: string }>(db,
      p => `SELECT id, starts_at, missing_runs, status, primary_source_id FROM events WHERE id IN (${p})`, missing);
    for (const row of rows) {
      if (row.status === "withdrawn" || row.status === "past" || row.starts_at <= now || row.starts_at > result.windowEnd) continue;
      // Another source still carrying the event keeps it alive.
      const others = await db.prepare("SELECT COUNT(*) AS n FROM event_sources WHERE event_id = ? AND source_id != ? AND last_seen_at >= ?").bind(row.id, config.id, now - 3 * 86400_000).first<{ n: number }>();
      if ((others?.n ?? 0) > 0) continue;
      const runs = row.missing_runs + 1;
      if (runs >= MISSING_RUNS_BEFORE_WITHDRAWN) {
        writes.push(db.prepare("UPDATE events SET missing_runs = ?, status = 'withdrawn', updated_at = ? WHERE id = ?").bind(runs, now, row.id));
        writes.push(change(db, row.id, runId, now, "withdrawn", { source: config.id, missingRuns: runs }));
        stats.withdrawn++;
      } else {
        writes.push(db.prepare("UPDATE events SET missing_runs = ? WHERE id = ?").bind(runs, row.id));
      }
    }
  }

  await runBatched(db, writes);
  return stats;
}

function changeKind(before: CurrentRow, after: EventRecord): string {
  if (before.status !== "cancelled" && after.status === "cancelled") return "cancelled";
  if (before.status === "cancelled" && after.status !== "cancelled") return "reinstated";
  if (before.starts_at !== after.starts_at || before.ends_at !== after.ends_at) return "rescheduled";
  return "updated";
}

function diff(before: CurrentRow, after: EventRecord): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of ["title", "starts_at", "ends_at", "status", "venue_name", "address", "signup_url", "price_min_minor"] as const) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]];
  }
  return out;
}

/** Ended events leave the listings: scheduled -> past once their end (or start + 3 hours) has gone by. */
export async function expireEvents(db: D1Database, now: number): Promise<number> {
  const res = await db.prepare(
    "UPDATE events SET status = 'past', updated_at = ? WHERE status = 'scheduled' AND COALESCE(ends_at, starts_at + 10800000) < ?"
  ).bind(now, now).run();
  return res.meta?.changes ?? 0;
}
