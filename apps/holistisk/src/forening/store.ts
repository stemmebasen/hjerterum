import type { D1Database } from "../db.js";
import { slugify } from "../text.js";
import type { EventRow } from "../web/queries.js";

/** Foreningen Samfolk: the ture (created by members, or Samfolk's own events), Samfolk-brevet, and the interest list
 * from before Samfolk. Column names from earlier versions (picks, flokk_*) are kept. */

export type PickRow = {
  id: string; slug: string; event_id: string | null; title: string; starts_at: number; ends_at: number | null;
  venue_name: string | null; address: string | null; city: string | null; association: string; association_url: string | null;
  event_url: string | null; description: string | null; image_url: string | null; places: number | null;
  own_payment: string | null; aftermeeting: string | null; status: "approved" | "withdrawn"; created_at: number; updated_at: number;
  /** Practical information for the flock: where and when to meet, and the programme. */
  meeting_place: string | null; meeting_at: number | null; programme: string | null;
  /** When the tur was cancelled (by the one who created it, or by Samfolk). confirmed_at is from an earlier version. */
  confirmed_at: number | null; flokk_cancelled_at: number | null;
  /** Created by a member, or Samfolk's own event (free for members); who created it; when sign-up and cancellation close. */
  kind: PickKind; created_by: string | null; closes_at: number | null;
};
export type PickKind = "member" | "samfolk";

export type PickFields = Omit<PickRow, "id" | "slug" | "event_id" | "created_at" | "updated_at" | "confirmed_at" | "flokk_cancelled_at" | "kind" | "created_by">;

const ENDS = "COALESCE(ends_at, starts_at + 10800000)";

export async function upcomingPicks(db: D1Database, now: number): Promise<PickRow[]> {
  return (await db.prepare(`SELECT * FROM picks WHERE status = 'approved' AND ${ENDS} >= ? ORDER BY starts_at LIMIT 100`).bind(now).all<PickRow>()).results;
}

export type PickWithCreator = PickRow & { creator_name: string | null };

/** For the volunteers: every tur from a month back, with the first name of the member who created it. */
export async function adminPicks(db: D1Database, now: number): Promise<PickWithCreator[]> {
  return (await db.prepare(`SELECT p.*, m.first_name AS creator_name FROM picks p LEFT JOIN members m ON m.id = p.created_by
    WHERE ${ENDS} >= ? ORDER BY p.starts_at LIMIT 300`).bind(now - 30 * 86_400_000).all<PickWithCreator>()).results;
}

/** The coming ture a member has created, cancelled ones too. */
export async function picksByCreator(db: D1Database, memberId: string, now: number): Promise<PickRow[]> {
  return (await db.prepare(`SELECT * FROM picks WHERE created_by = ? AND ${ENDS} >= ? ORDER BY starts_at`).bind(memberId, now - 86_400_000).all<PickRow>()).results;
}

/** The first name of the member who created a tur, if they are still a member. */
export async function creatorName(db: D1Database, p: Pick<PickRow, "created_by">): Promise<string | null> {
  if (!p.created_by) return null;
  return (await db.prepare("SELECT first_name FROM members WHERE id = ?").bind(p.created_by).first<{ first_name: string }>())?.first_name ?? null;
}

export const pickBySlug = (db: D1Database, slug: string) => db.prepare("SELECT * FROM picks WHERE slug = ?").bind(slug).first<PickRow>();
export const pickById = (db: D1Database, id: string) => db.prepare("SELECT * FROM picks WHERE id = ?").bind(id).first<PickRow>();

function newSlug(title: string, id: string): string {
  return `${slugify(title, 60) || "event"}-${id.replace(/-/g, "").slice(0, 6)}`;
}

export async function createPick(db: D1Database, fields: PickFields, kind: PickKind, eventId: string | null, memberId: string | null, now: number): Promise<PickRow> {
  const id = crypto.randomUUID();
  const pick: PickRow = { ...fields, id, slug: newSlug(fields.title, id), event_id: eventId, created_at: now, updated_at: now, confirmed_at: null, flokk_cancelled_at: null, kind, created_by: memberId };
  await db.prepare(`INSERT INTO picks (id, slug, event_id, title, starts_at, ends_at, venue_name, address, city, association, association_url,
      event_url, description, image_url, places, own_payment, aftermeeting, status, meeting_place, meeting_at, programme, created_by, created_at, updated_at, kind, closes_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    pick.id, pick.slug, eventId, pick.title, pick.starts_at, pick.ends_at, pick.venue_name, pick.address, pick.city, pick.association,
    pick.association_url, pick.event_url, pick.description, pick.image_url, pick.places, pick.own_payment, pick.aftermeeting, pick.status,
    pick.meeting_place, pick.meeting_at, pick.programme, memberId, now, now, kind, pick.closes_at).run();
  return pick;
}

export async function updatePick(db: D1Database, id: string, f: PickFields, now: number): Promise<void> {
  await db.prepare(`UPDATE picks SET title = ?, starts_at = ?, ends_at = ?, venue_name = ?, address = ?, city = ?, association = ?,
      association_url = ?, event_url = ?, description = ?, image_url = ?, places = ?, own_payment = ?, aftermeeting = ?, status = ?,
      meeting_place = ?, meeting_at = ?, programme = ?, closes_at = ?, updated_at = ?
    WHERE id = ?`).bind(f.title, f.starts_at, f.ends_at, f.venue_name, f.address, f.city, f.association, f.association_url, f.event_url,
    f.description, f.image_url, f.places, f.own_payment, f.aftermeeting, f.status, f.meeting_place, f.meeting_at, f.programme, f.closes_at, now, id).run();
}

/** A collected event as the start of a tur; the volunteer checks and completes it. */
export function fieldsFromEvent(e: EventRow): PickFields {
  return {
    title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, venue_name: e.venue_name, address: e.address, city: e.city,
    association: (e.organizer_name ?? e.source_name ?? "Ukendt forening").slice(0, 160), association_url: e.organizer_url,
    event_url: e.signup_url ?? e.source_url, description: e.summary, image_url: e.image_url, places: null, own_payment: null,
    aftermeeting: null, status: "approved", meeting_place: null, meeting_at: null, programme: null, closes_at: null
  };
}

/** The collector's coming events, to pick from: not picked yet, optionally matching a search. */
export async function suggestions(db: D1Database, regions: string[], now: number, q: string): Promise<EventRow[]> {
  const where = ["e.status = 'scheduled'", "e.starts_at >= ?", "e.starts_at < ?", `e.region IN (${regions.map(() => "?").join(",")})`,
    "NOT EXISTS (SELECT 1 FROM picks p WHERE p.event_id = e.id)"];
  const params: unknown[] = [now, now + 120 * 86_400_000, ...regions];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  for (const w of words) {
    where.push("(lower(e.title) LIKE ? OR lower(COALESCE(o.name, '')) LIKE ? OR lower(COALESCE(e.venue_name, '')) LIKE ?)");
    params.push(`%${w}%`, `%${w}%`, `%${w}%`);
  }
  const { results } = await db.prepare(`SELECT e.*, s.name AS source_name, s.attribution AS source_attribution, s.homepage_url AS source_homepage,
      o.name AS organizer_name, o.website_url AS organizer_url, NULL AS categories, 0 AS flock_count
    FROM events e JOIN sources s ON s.id = e.primary_source_id LEFT JOIN organizers o ON o.id = e.organizer_id
    WHERE ${where.join(" AND ")} ORDER BY e.starts_at LIMIT 80`).bind(...params).all<EventRow>();
  return results;
}

export const eventById = (db: D1Database, id: string) => db.prepare(`SELECT e.*, s.name AS source_name, s.attribution AS source_attribution,
    s.homepage_url AS source_homepage, o.name AS organizer_name, o.website_url AS organizer_url, NULL AS categories, 0 AS flock_count
  FROM events e JOIN sources s ON s.id = e.primary_source_id LEFT JOIN organizers o ON o.id = e.organizer_id WHERE e.id = ?`).bind(id).first<EventRow>();

// ————————————————————————————————————————— Samfolk-brevet

/** Signs an e-mail up for the weekly letter; signing up again keeps the first date. */
export async function subscribe(db: D1Database, email: string, memberId: string | null, now: number): Promise<void> {
  await db.prepare(`INSERT INTO newsletter (email, member_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET member_id = COALESCE(excluded.member_id, newsletter.member_id)`).bind(email.trim().toLowerCase(), memberId, now).run();
}

export async function unsubscribe(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM newsletter WHERE email = ?").bind(email.trim().toLowerCase()).run();
}

export async function isSubscribed(db: D1Database, email: string | null): Promise<boolean> {
  return !!email && !!(await db.prepare("SELECT 1 AS x FROM newsletter WHERE email = ?").bind(email.toLowerCase()).first());
}

export type Subscriber = { email: string; member_name: string | null; created_at: number };

export async function listSubscribers(db: D1Database): Promise<Subscriber[]> {
  return (await db.prepare(`SELECT n.email, m.first_name AS member_name, n.created_at FROM newsletter n LEFT JOIN members m ON m.id = n.member_id
    ORDER BY n.created_at DESC LIMIT 10000`).all<Subscriber>()).results;
}

// ————————————————————————————————————————— The interest list (from before Samfolk)

export type Interest = {
  id: string; first_name: string; email: string; age_group: string | null; interests: string | null; area: string | null;
  pick_id: string | null; with_friend: number; created_at: number; updated_at: number;
};
export type InterestFields = Pick<Interest, "first_name" | "email" | "age_group" | "interests" | "area" | "pick_id" | "with_friend">;

/** One line per e-mail and event: signing up again for the same event updates it. */
export async function saveInterest(db: D1Database, f: InterestFields, now: number): Promise<void> {
  const email = f.email.toLowerCase();
  const existing = await db.prepare("SELECT id FROM interests WHERE email = ? AND COALESCE(pick_id, '') = ?").bind(email, f.pick_id ?? "").first<{ id: string }>();
  if (existing) {
    await db.prepare("UPDATE interests SET first_name = ?, age_group = ?, interests = ?, area = ?, with_friend = ?, updated_at = ? WHERE id = ?")
      .bind(f.first_name, f.age_group, f.interests, f.area, f.with_friend, now, existing.id).run();
    return;
  }
  await db.prepare(`INSERT INTO interests (id, first_name, email, age_group, interests, area, pick_id, with_friend, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), f.first_name, email, f.age_group, f.interests, f.area, f.pick_id, f.with_friend, now, now).run();
}

export async function listInterests(db: D1Database): Promise<Array<Interest & { pick_title: string | null; pick_starts_at: number | null }>> {
  return (await db.prepare(`SELECT i.*, p.title AS pick_title, p.starts_at AS pick_starts_at FROM interests i LEFT JOIN picks p ON p.id = i.pick_id
    ORDER BY i.created_at DESC LIMIT 5000`).all<Interest & { pick_title: string | null; pick_starts_at: number | null }>()).results;
}

export async function deleteInterests(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM interests WHERE email = ?").bind(email.trim().toLowerCase()).run();
}

export async function countInterests(db: D1Database): Promise<{ people: number; lines: number }> {
  const r = await db.prepare("SELECT COUNT(DISTINCT email) AS people, COUNT(*) AS lines FROM interests").first<{ people: number; lines: number }>();
  return { people: r?.people ?? 0, lines: r?.lines ?? 0 };
}

export async function isAdmin(db: D1Database, memberId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM members WHERE id = ? AND is_admin = 1").bind(memberId).first<{ ok: number }>());
}
