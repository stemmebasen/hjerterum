import type { D1Database } from "./db.js";

/** Requested: "Saga skal også spørge om interesserede må kontakte underviseren - man kan vælge email, telefon eller begge dele".
 * The organiser chooses per event; the e-mail and phone number are read from their member profile when the event is shown, so a
 * changed number is never stale. Shown only to signed-in members in the calendar, never on the public site. */
export const CONTACT_SHARES = ["email", "phone", "both"] as const;
export type ContactShare = (typeof CONTACT_SHARES)[number];
export const isContactShare = (value: unknown): value is ContactShare => typeof value === "string" && (CONTACT_SHARES as readonly string[]).includes(value);

export type EventContact = { share: ContactShare | null; email: string | null; phone: string | null };

export async function setContactShare(db: D1Database, bookingId: number, share: ContactShare | null): Promise<void> {
  await db.prepare("UPDATE room_bookings SET contact_share = ? WHERE id = ?").bind(share, bookingId).run();
}

/** Per event: the choice, and the e-mail and phone it allows - from the organiser's profile, falling back to the booking's e-mail. */
export async function contactsByBooking(db: D1Database, ids: number[]): Promise<Map<number, EventContact>> {
  const out = new Map<number, EventContact>();
  if (!ids.length) return out;
  const rows = await db.prepare(`SELECT b.id, b.contact_share, b.teacher_email, m.email AS member_email, m.phone
      FROM room_bookings b LEFT JOIN members m ON m.clerk_user_id = b.clerk_user_id
      WHERE b.id IN (${ids.map(() => "?").join(", ")})`).bind(...ids)
    .all<{ id: number; contact_share: string | null; teacher_email: string | null; member_email: string | null; phone: string | null }>()
    .then(r => r.results ?? []).catch(() => []);
  for (const row of rows) out.set(row.id, contactOf(row));
  return out;
}

export function contactOf(row: { contact_share: string | null; teacher_email: string | null; member_email: string | null; phone: string | null }): EventContact {
  const share = isContactShare(row.contact_share) ? row.contact_share : null;
  const email = (row.member_email || row.teacher_email || "").trim() || null;
  const phone = (row.phone ?? "").trim() || null;
  return {
    share,
    email: share === "email" || share === "both" ? email : null,
    phone: share === "phone" || share === "both" ? phone : null
  };
}
