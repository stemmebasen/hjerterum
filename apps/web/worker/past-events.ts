import { isPartnerEvent } from "../partner-events.js";
import type { D1Database } from "./db.js";
import { designsByBooking } from "./event-designs.js";
import { filesByBooking } from "./event-files.js";

/** Douglas (forslag #3, 26 Nov 2026): "Show past events in the website and Min side calendars" - "finding a teacher or event again to check on
 * some detail". The events that have been held: the house's own (room_bookings, approved) and the MembershipWorks calendar's since 2019
 * (house_events, cockpit/events.ts), newest first. Only what the public calendar showed: no e-mails, no attendees, no partners' events. */
export type PastEvent = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; imageUrl: string | null; page: string | null };

const MAX = 1500;

export async function pastEvents(db: D1Database, nowMs: number): Promise<PastEvent[]> {
  const own = (await db.prepare(`SELECT id, title, teacher_name, starts_at_ms, ends_at_ms FROM room_bookings
      WHERE status = 'scheduled' AND review_status = 'approved' AND ends_at_ms < ? ORDER BY starts_at_ms DESC LIMIT ?`).bind(nowMs, MAX)
    .all<{ id: number; title: string; teacher_name: string; starts_at_ms: number; ends_at_ms: number }>()).results ?? [];
  // The pictures, 90 events at a time (D1 takes at most 100 values in one statement).
  const designs = new Map<number, string>(), covers = new Map<number, string>();
  for (let i = 0; i < own.length; i += 90) {
    const ids = own.slice(i, i + 90).map(r => r.id);
    for (const [id, url] of await designsByBooking(db, ids).catch(() => new Map<number, string>())) designs.set(id, url);
    for (const [id, list] of await filesByBooking(db, ids).catch(() => new Map<number, Array<{ kind: string; url: string }>>())) {
      const cover = list.find(f => f.kind === "cover"); if (cover) covers.set(id, cover.url);
    }
  }
  const archive = (await db.prepare(`SELECT id, title, host, category, location, image_url, starts_at_ms, ends_at_ms FROM house_events
      WHERE removed_at_ms IS NULL AND COALESCE(ends_at_ms, starts_at_ms) < ? ORDER BY starts_at_ms DESC LIMIT ?`).bind(nowMs, MAX)
    .all<{ id: string; title: string; host: string | null; category: string | null; location: string | null; image_url: string | null; starts_at_ms: number; ends_at_ms: number | null }>().catch(() => ({ results: [] }))).results ?? [];
  const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
  const mwPage = (id: string) => { const m = /^SF([0-9a-f]{24})$/.exec(id); return m ? `/events/${m[1]}` : null; };
  return [
    ...own.map(r => ({ key: `h${r.id}`, title: r.title, startsAt: iso(r.starts_at_ms)!, endsAt: iso(r.ends_at_ms), host: r.teacher_name || null, category: null,
      imageUrl: designs.get(r.id) ?? covers.get(r.id) ?? null, page: `/events/h${r.id}` })),
    ...archive.filter(r => !isPartnerEvent(r)).map(r => ({ key: `mw-${r.id}`, title: r.title, startsAt: iso(r.starts_at_ms)!, endsAt: iso(r.ends_at_ms), host: r.host,
      category: r.category, imageUrl: r.image_url, page: mwPage(r.id) }))
  ].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, MAX);
}
