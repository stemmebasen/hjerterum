import type { D1Database } from "./db.js";
import { calculateRoomPriceQuote, type RoomBookingType } from "../../../packages/core/src/legacy-room-pricing.js";

/** Requested: "Medlemsbesparelse xxx kr. Siden *dato* (siden medlemmet oprettede sig)". For each event in the new system the member
 * took part in (a confirmed sign-up, the event has begun) since joining: what a non-member pays minus what the member paid. Without a
 * non-member price, an event on free rent counts the price calculator's minimum for non-members; any other event counts nothing. */
export type Savings = { savedKr: number; since: string | null; events: number };

const TZ = "Europe/Copenhagen";
function timing(startMs: number, endMs: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(startMs).map(p => [p.type, p.value]));
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return { dayOfWeek, startMinutes: Number(parts.hour) * 60 + Number(parts.minute), durationMinutes: Math.round((endMs - startMs) / 60_000) };
}

export function nonMemberMinor(row: { non_member_price_minor: number | null; booking_type: string; starts_at_ms: number; ends_at_ms: number }): number {
  if (row.non_member_price_minor !== null) return row.non_member_price_minor;
  if (row.booking_type !== "free") return 0;
  try {
    const quote = calculateRoomPriceQuote({ ...timing(row.starts_at_ms, row.ends_at_ms), bookingType: row.booking_type as RoomBookingType });
    return (quote.minimumNonMemberPriceKr ?? 0) * 100;
  } catch { return 0; }
}

export async function memberSavings(db: D1Database, clerkUserId: string, nowMs: number): Promise<Savings> {
  const member = await db.prepare("SELECT joined_on, created_at_ms FROM members WHERE clerk_user_id = ? LIMIT 1").bind(clerkUserId)
    .first<{ joined_on: string | null; created_at_ms: number }>();
  const since = member ? (member.joined_on && /^\d{4}-\d{2}-\d{2}$/.test(member.joined_on) ? member.joined_on : new Date(member.created_at_ms).toISOString().slice(0, 10)) : null;
  if (!since) return { savedKr: 0, since: null, events: 0 };
  const rows = await db.prepare(`SELECT b.non_member_price_minor, b.booking_type, b.starts_at_ms, b.ends_at_ms, a.ticket_amount_minor
      FROM room_booking_attendees a JOIN room_bookings b ON b.id = a.room_booking_id
      WHERE a.clerk_user_id = ? AND a.registration_status = 'confirmed' AND b.status = 'scheduled' AND b.starts_at_ms >= ? AND b.starts_at_ms <= ?`)
    .bind(clerkUserId, Date.parse(`${since}T00:00:00Z`), nowMs)
    .all<{ non_member_price_minor: number | null; booking_type: string; starts_at_ms: number; ends_at_ms: number; ticket_amount_minor: number }>()
    .then(r => r.results ?? []);
  const saved = rows.reduce((sum, row) => sum + Math.max(0, nonMemberMinor(row) - (row.ticket_amount_minor ?? 0)), 0);
  return { savedKr: Math.round(saved / 100), since, events: rows.length };
}
