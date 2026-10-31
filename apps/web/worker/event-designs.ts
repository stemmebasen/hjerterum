import type { D1Database } from "./db.js";
import { coverSizeOk, type EventMediaBucket } from "./event-files.js";

/** Requested: "Det giver jo mening, at det er vores nye design, der skal være overalt på hjemmesiden og ikke kun på sociale medier".
 * The event's chosen design as its wide picture (1920 × 1005, the same frame as the event photo), drawn in the organiser's browser
 * (src/event-design.ts) and kept here. Shown wherever the event's picture is shown, once the event is approved; the bare photo
 * stays, because the designs are drawn from it. */

const MAX_BYTES = 4 * 1024 * 1024;
const kindOf = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? { type: "image/png", ext: "png" }
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { type: "image/jpeg", ext: "jpg" } : null;

export type DesignResult = { ok: true; url: string } | { ok: false; error: "not_an_image" | "design_size" | "too_large" };

export async function storeDesign(db: D1Database, bucket: EventMediaBucket, bookingId: number, bytes: ArrayBuffer, now: number): Promise<DesignResult> {
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: "too_large" };
  const head = new Uint8Array(bytes);
  const kind = kindOf(head);
  if (!kind) return { ok: false, error: "not_an_image" };
  if (!coverSizeOk(head)) return { ok: false, error: "design_size" };
  const key = `designs/${bookingId}/${crypto.randomUUID()}.${kind.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  const old = await db.prepare("SELECT r2_key FROM room_booking_designs WHERE room_booking_id = ?").bind(bookingId).first<{ r2_key: string }>();
  await db.prepare(`INSERT INTO room_booking_designs (room_booking_id, r2_key, content_type, size_bytes, created_at_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(room_booking_id) DO UPDATE SET r2_key = excluded.r2_key, content_type = excluded.content_type, size_bytes = excluded.size_bytes, created_at_ms = excluded.created_at_ms`)
    .bind(bookingId, key, kind.type, bytes.byteLength, now).run();
  if (old) await bucket.delete(old.r2_key).catch(() => undefined);
  return { ok: true, url: designUrl(bookingId, now) };
}

export async function removeDesign(db: D1Database, bucket: EventMediaBucket, bookingId: number): Promise<void> {
  const old = await db.prepare("SELECT r2_key FROM room_booking_designs WHERE room_booking_id = ?").bind(bookingId).first<{ r2_key: string }>();
  if (!old) return;
  await db.prepare("DELETE FROM room_booking_designs WHERE room_booking_id = ?").bind(bookingId).run();
  await bucket.delete(old.r2_key).catch(() => undefined);
}

/** ?v= changes with each new design, so a cached old one is never shown. */
export const designUrl = (bookingId: number, at: number) => `/api/event-designs/${bookingId}?v=${at}`;

export async function designsByBooking(db: D1Database, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const rows = await db.prepare(`SELECT room_booking_id, created_at_ms FROM room_booking_designs WHERE room_booking_id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids).all<{ room_booking_id: number; created_at_ms: number }>().then(r => r.results ?? []).catch(() => []);
  for (const r of rows) out.set(r.room_booking_id, designUrl(r.room_booking_id, r.created_at_ms));
  return out;
}

/** The design of an event, with what decides whether everyone may see it (as for the cover photo: approved and on). */
export async function designForDownload(db: D1Database, bookingId: number) {
  return db.prepare(`SELECT d.r2_key, d.content_type, b.clerk_user_id AS owner_id, b.status, COALESCE(b.review_status, 'approved') AS review_status
    FROM room_booking_designs d JOIN room_bookings b ON b.id = d.room_booking_id WHERE d.room_booking_id = ?`).bind(bookingId)
    .first<{ r2_key: string; content_type: string; owner_id: string; status: string; review_status: string }>();
}
