import type { D1Database } from "../db.js";
import { parseMembershipWorksRss, type ExternalEvent } from "../external-events.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { claimJob, serviceStatus, setServiceStatus } from "../saga/store.js";

/** Requested: "You can also use this direct link so that Saga knows coming and historic events - could
 * be nice to showcase, and to be able to search through and even ask Saga about". The public calendar
 * (only coming events) is read every hour; with sdp=1 it holds every event since 2019 (15 MB), read
 * once a day, and only what changed is written. The first full read is spread over a few runs. */

export const EVENTS_FEED = "https://api.membershipworks.com/v2/events?_op=rss&org=22308";
const COLUMNS = ["id", "title", "starts_at_ms", "ends_at_ms", "location", "host", "category", "link", "image_url", "description", "content_hash", "updated_at_ms"] as const;
const ROWS_PER_STATEMENT = 8; // D1 takes at most 100 bound values per statement.
const MAX_WRITES = 800;
const HOUR = 3_600_000;

export type HouseEvent = { id: string; title: string; starts_at_ms: number; ends_at_ms: number | null; location: string | null; host: string | null;
  category: string | null; link: string | null; image_url: string | null; description: string | null; removed_at_ms: number | null };

const LATIN: Record<string, string> = { aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è", auml: "ä", euml: "ë", ouml: "ö", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ouml: "Ö", Uuml: "Ü", Auml: "Ä", ntilde: "ñ", ccedil: "ç", szlig: "ß", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", amp: "&", quot: "\"", nbsp: " " };
/** The calendar's text with the HTML names for letters (Karítas) the feed reader leaves behind. */
const letters = (text: string) => text.replace(/&([a-zA-Z]+);/g, (whole, name: string) => LATIN[name] ?? whole);

/** The teacher, when the text names one ("Underviser: …", "Facilitator: …", "Ved …"). */
export function eventHost(event: ExternalEvent): string | null {
  if (event.host) return letters(event.host).slice(0, 120);
  const match = /(?:^|\n)\s*(?:undervisere?|facilitatorer?|facilitator|vært(?:er)?|værtinde|ved|teacher|host|guide)\s*[:\-–]\s*([^\n]{2,80})/i.exec(letters(event.description ?? ""));
  // "Cathrine Catalia - Certificeret sexolog, ..." is the name and a title: the name is kept.
  const name = match?.[1]!.replace(/\s+/g, " ").trim().split(/\s+[-–—|]\s+/)[0]!;
  return name ? (name.length > 50 ? name.split(/,\s/)[0]! : name).replace(/[.,;:]$/, "").trim() || null : null;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function row(event: ExternalEvent, nowMs: number): unknown[] {
  const values = { title: letters(event.title).slice(0, 300), starts: Date.parse(event.startsAt), ends: event.endsAt ? Date.parse(event.endsAt) : null, location: event.location?.slice(0, 200) ?? null,
    host: eventHost(event), category: event.category?.slice(0, 120) ?? null, link: event.link?.slice(0, 500) ?? null, image: event.imageUrl?.slice(0, 500) ?? null,
    description: event.description ? letters(event.description).replace(/\n{3,}/g, "\n\n").slice(0, 2000) : null };
  return [event.id.slice(0, 200), values.title, values.starts, values.ends, values.location, values.host, values.category, values.link, values.image, values.description,
    hash(JSON.stringify(values)), nowMs];
}

/** Reads the calendar and writes what is new or changed. Returns how many rows are still to write. */
export async function syncHouseEvents(db: D1Database, deps: SagaDeps, full: boolean): Promise<{ seen: number; written: number; left: number }> {
  const response = await deps.fetcher(full ? `${EVENTS_FEED}&sdp=1` : EVENTS_FEED, { headers: { accept: "application/rss+xml, application/xml" }, signal: AbortSignal.timeout(full ? 60_000 : 15_000) });
  if (!response.ok) throw new Error(`events_feed_failed: ${response.status}`);
  const now = deps.now();
  const events = parseMembershipWorksRss(await response.text()).filter(e => Number.isFinite(Date.parse(e.startsAt)));
  const known = new Map(((await db.prepare("SELECT id, content_hash, removed_at_ms FROM house_events").all<{ id: string; content_hash: string; removed_at_ms: number | null }>()).results ?? [])
    .map(r => [r.id, r]));
  const rows = events.map(e => row(e, now)).filter(r => { const was = known.get(r[0] as string); return !was || was.content_hash !== r[10] || was.removed_at_ms !== null; });
  const batch = rows.slice(0, MAX_WRITES);
  for (let i = 0; i < batch.length; i += ROWS_PER_STATEMENT) {
    const chunk = batch.slice(i, i + ROWS_PER_STATEMENT);
    await db.prepare(`INSERT INTO house_events (${COLUMNS.join(", ")}) VALUES ${chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ")}
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, starts_at_ms = excluded.starts_at_ms, ends_at_ms = excluded.ends_at_ms, location = excluded.location, host = excluded.host,
      category = excluded.category, link = excluded.link, image_url = excluded.image_url, description = excluded.description, content_hash = excluded.content_hash,
      removed_at_ms = NULL, updated_at_ms = excluded.updated_at_ms`).bind(...chunk.flat()).run();
  }
  // A coming event that is no longer in the calendar was most likely cancelled.
  if (!full && events.length) {
    const ids = new Set(events.map(e => e.id));
    const gone = [...known.keys()].filter(id => !ids.has(id));
    for (let i = 0; i < gone.length; i += 90) {
      const chunk = gone.slice(i, i + 90);
      await db.prepare(`UPDATE house_events SET removed_at_ms = ? WHERE removed_at_ms IS NULL AND starts_at_ms > ? AND id IN (${chunk.map(() => "?").join(", ")})`).bind(now, now, ...chunk).run();
    }
  }
  return { seen: events.length, written: batch.length, left: rows.length - batch.length };
}

/** Every five minutes from the cron: the coming events once an hour, the whole history once a day -
 * every quarter of an hour while the first full read is not done. No AI. */
export async function runEventSync(env: SagaEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db) return;
  const now = deps.now();
  const backfill = await serviceStatus(db, "house_events_full");
  const fullSlot = backfill?.ok ? Math.floor(now / (24 * HOUR)) : Math.floor(now / (HOUR / 4));
  if (await claimJob(db, backfill?.ok ? "house_events_full" : "house_events_backfill", fullSlot, now)) {
    try {
      const result = await syncHouseEvents(db, deps, true);
      await setServiceStatus(db, "house_events_full", result.left === 0, `${result.seen} arrangementer, ${result.written} skrevet, ${result.left} mangler`, now);
      // The day's full read is then done too.
      if (!backfill?.ok && result.left === 0) await claimJob(db, "house_events_full", Math.floor(now / (24 * HOUR)), now);
    } catch (error) { await setServiceStatus(db, "house_events_full", Boolean(backfill?.ok), error instanceof Error ? error.message : "events_failed", now); }
    return;
  }
  if (await claimJob(db, "house_events_coming", Math.floor(now / HOUR), now)) {
    await syncHouseEvents(db, deps, false).catch(error => console.warn("house_events_failed", error instanceof Error ? error.message : error));
  }
}

const EVENT = "id, title, starts_at_ms, ends_at_ms, location, host, category, link, image_url, description, removed_at_ms";

export async function comingEvents(db: D1Database, nowMs: number, days = 60, limit = 80): Promise<HouseEvent[]> {
  const rows = await db.prepare(`SELECT ${EVENT} FROM house_events WHERE starts_at_ms >= ? AND starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms LIMIT ?`)
    .bind(nowMs - 3 * HOUR, nowMs + days * 24 * HOUR, limit).all<HouseEvent>();
  return rows.results ?? [];
}

/** Events whose title, teacher, category or text holds every word searched for (newest first), optionally in one year. */
export async function searchEvents(db: D1Database, query: string, options: { year?: number | null; limit?: number } = {}): Promise<HouseEvent[]> {
  const words = query.toLocaleLowerCase("da-DK").split(/\s+/).map(w => w.replace(/[%_]/g, "")).filter(w => w.length >= 2).slice(0, 6);
  const where = words.map(() => "LOWER(title || ' ' || COALESCE(host, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(description, '')) LIKE ?");
  const values: unknown[] = words.map(w => `%${w}%`);
  if (options.year) { where.push("starts_at_ms >= ? AND starts_at_ms < ?"); values.push(Date.UTC(options.year, 0, 1) - 2 * HOUR, Date.UTC(options.year + 1, 0, 1) - 2 * HOUR); }
  const rows = await db.prepare(`SELECT ${EVENT} FROM house_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY starts_at_ms DESC LIMIT ?`)
    .bind(...values, options.limit ?? 100).all<HouseEvent>();
  return rows.results ?? [];
}

export type EventStats = { total: number; first: number | null; byYear: Array<{ year: string; n: number }>; hosts: Array<{ host: string; n: number }>;
  categories: Array<{ category: string; n: number }>; coming30: number };

export async function eventStats(db: D1Database, nowMs: number): Promise<EventStats> {
  const year = "strftime('%Y', starts_at_ms / 1000, 'unixepoch', '+2 hours')";
  const [totals, byYear, hosts, categories, coming] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n, MIN(starts_at_ms) AS first FROM house_events WHERE removed_at_ms IS NULL").first<{ n: number; first: number | null }>(),
    db.prepare(`SELECT ${year} AS year, COUNT(*) AS n FROM house_events WHERE removed_at_ms IS NULL GROUP BY year ORDER BY year`).all<{ year: string; n: number }>(),
    db.prepare("SELECT host, COUNT(*) AS n FROM house_events WHERE host IS NOT NULL AND removed_at_ms IS NULL AND starts_at_ms >= ? AND starts_at_ms < ? GROUP BY host ORDER BY n DESC LIMIT 12")
      .bind(nowMs - 365 * 24 * HOUR, nowMs).all<{ host: string; n: number }>(),
    db.prepare("SELECT category, COUNT(*) AS n FROM house_events WHERE category IS NOT NULL AND removed_at_ms IS NULL GROUP BY category ORDER BY n DESC LIMIT 8").all<{ category: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM house_events WHERE removed_at_ms IS NULL AND starts_at_ms >= ? AND starts_at_ms < ?").bind(nowMs, nowMs + 30 * 24 * HOUR).first<{ n: number }>()
  ]);
  return { total: Number(totals?.n ?? 0), first: totals?.first ?? null, byYear: byYear.results ?? [], hosts: hosts.results ?? [], categories: categories.results ?? [], coming30: Number(coming?.n ?? 0) };
}
