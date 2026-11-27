import { calculateRoomPriceQuote, roomBookingProblems, type RoomBookingType } from "../../../packages/core/src/legacy-room-pricing.js";
import type { D1Database } from "./db.js";
import { hasExternalEventConflict } from "./external-events.js";

export type CreateRoomBookingInput = {
  teacherName: string;
  teacherEmail: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  maxAttendees?: number | null;
  ticketPriceMinor: number;
  /** What a non-member pays; null when the organiser gave none. */
  nonMemberPriceMinor?: number | null;
  /** Minutes the room is taken before and after the event (0, 15, 30, 45 or 60). */
  setupMinutes?: number;
  cleanupMinutes?: number;
  /** The calculator's booking type: standard (package price), reduced (member discount) or free rent. */
  bookingType?: RoomBookingType;
  /** Douglas (18 Nov 2026), for the board: "book a whole weekend" - days in a row with the same times (1-4). */
  days?: number;
  /** Set by the server, never from the request: a fixed teacher's or the board's event needs no approval. */
  preApproved?: boolean;
  memberName?: string;
  memberEmail?: string;
};

/** Requested: "Saga skal godkende events som medlemmer selv sætter op" - only an approved event is public. */
export type ReviewStatus = "pending" | "approved" | "needs_board" | "rejected";

export type CreatedRoomBooking = {
  id: number;
  feeKr: number;
};

export type RoomBookingRow = {
  id: number;
  clerk_user_id: string;
  teacher_name: string;
  teacher_email: string;
  title: string;
  description: string | null;
  starts_at_ms: number;
  ends_at_ms: number;
  max_attendees: number | null;
  fee_minor: number;
  ticket_price_minor: number;
  non_member_price_minor?: number | null;
  setup_minutes?: number;
  cleanup_minutes?: number;
  days?: number;
  booking_type?: RoomBookingType;
  review_status?: ReviewStatus;
  review_note?: string | null;
  status: "scheduled" | "cancelled";
  cancelled_at_ms: number | null;
};

export type MemberCalendarRow = RoomBookingRow & {
  attendee_count: number;
  is_attending: number;
  registration_status: "pending" | "confirmed" | "cancelled" | null;
  /** How many places the member's own registration holds (forslag #6). */
  my_seats: number | null;
};

export type AttendeeRow = {
  id: number;
  clerk_user_id: string;
  member_name: string;
  member_email: string;
  created_at_ms: number;
  registration_status: "pending" | "confirmed" | "cancelled";
  seats?: number;
};

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid_${field}`);
  }
  return value.trim();
}

function localPricingParts(startMs: number): { dayOfWeek: number; startMinutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(new Date(startMs));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const dayOfWeek = weekday ? weekdayMap[weekday] : undefined;

  if (dayOfWeek === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("invalid_booking_local_time");
  }

  return { dayOfWeek, startMinutes: hour * 60 + minute };
}

/** Requested: "Det er denne prisberegners data alt skal baseres på https://holistisk.org/lejepriser/".
 * The room fee is the price calculator's (it was the old WordPress server's), and its rules hold:
 * 2 to 10 hours in half hours, and no weekday booking across 18:30 with member discount or free rent. */
function calculateFee(startMs: number, endMs: number, bookingType: RoomBookingType = "standard"): number {
  const { dayOfWeek, startMinutes } = localPricingParts(startMs);
  const timing = { dayOfWeek, startMinutes, durationMinutes: Math.round((endMs - startMs) / 60_000) };
  const problem = roomBookingProblems({ ...timing, bookingType })[0];
  if (problem) throw new Error(`invalid_${problem}`);
  return calculateRoomPriceQuote({ ...timing, bookingType, ...(bookingType === "reduced" ? { memberPriceKr: 0 } : {}) }).totalPriceKr;
}

/** Decision 0006 and the price table, in the event form too (the chair, 4 Nov 2026, on the teacher Douglas' feedback: "Afvis med en klar forklaring"):
 * the lowest price for non-members a rent type allows - free rent at least 100 kr. a person in A-time and 75 kr. in B-time (decision 0013), reduced at least the member price plus the surcharge (A-time
 * +100 kr., B-time +75 kr. under 400 kr.) - or null for standard rent. A blank non-member price is the members' price. The board's own events (from
 * admin, "cockpit:") are not held to it, as decision 0006 says. */
export function nonMemberMinimumKr(startMs: number, bookingType: RoomBookingType | undefined, memberPriceKr: number): number | null {
  if (!bookingType || bookingType === "standard") return null;
  const { dayOfWeek, startMinutes } = localPricingParts(startMs);
  const quote = calculateRoomPriceQuote({ dayOfWeek, startMinutes, durationMinutes: 120, bookingType, ...(bookingType === "reduced" ? { memberPriceKr } : {}) });
  return bookingType === "free" ? quote.minimumNonMemberPriceKr : quote.nonMemberPriceKr;
}
/** Douglas (forslag #4, decision 0013): "Maybe only warn them, and then we can approve or not as we wish." A price under the minimum is no longer
 * refused: the form warns, and Saga sends such an event to the board instead of approving it (cockpit/eventDesk.ts belowMinimum). */
export function belowNonMemberMinimum(startMs: number, bookingType: RoomBookingType | undefined, memberPriceMinor: number, nonMemberPriceMinor: number | null): number | null {
  const minimum = nonMemberMinimumKr(startMs, bookingType, memberPriceMinor / 100);
  return minimum !== null && (nonMemberPriceMinor ?? memberPriceMinor) / 100 < minimum ? minimum : null;
}

const BOOKING_TYPES: readonly RoomBookingType[] = ["standard", "reduced", "free"];

/** The time the room is taken: the event plus setup before and cleanup after. Conflicts and rent go by this. */
export const WINDOW_START = "(starts_at_ms - setup_minutes * 60000)";
export const WINDOW_END = "(ends_at_ms + cleanup_minutes * 60000)";
/** The rent goes by half hours: a window with quarter-hour setup or cleanup is priced from the half hour before it starts to the
 * half hour after it ends (Copenhagen is a whole number of hours from UTC, so UTC half hours are local half hours). */
const HALF_HOUR_MS = 30 * 60_000;
export function pricedWindow(fromMs: number, toMs: number) {
  return { fromMs: Math.floor(fromMs / HALF_HOUR_MS) * HALF_HOUR_MS, toMs: Math.ceil(toMs / HALF_HOUR_MS) * HALF_HOUR_MS };
}
export const MAX_DAYS = 4;
const COPENHAGEN_OFFSET = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", timeZoneName: "shortOffset" });
const offsetMinutes = (ms: number) => { const m = /GMT([+-]\d+)(?::(\d+))?/.exec(COPENHAGEN_OFFSET.format(ms)); return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0; };
/** The same clock time `n` days later in Denmark (over a change to or from summer time too). */
export const laterDay = (ms: number, n: number) => { const t = ms + n * 86_400_000; return t - (offsetMinutes(t) - offsetMinutes(ms)) * 60_000; };
/** Each day of a booking over several days, as its own start and end (the first day's times, day after day). */
export function dayWindows(startMs: number, firstEndMs: number, days: number): Array<{ startMs: number; endMs: number }> {
  return Array.from({ length: Math.max(1, days) }, (_, i) => ({ startMs: laterDay(startMs, i), endMs: laterDay(firstEndMs, i) }));
}

export function roomWindow(startMs: number, endMs: number, input: { setupMinutes?: number; cleanupMinutes?: number }) {
  return { fromMs: startMs - (input.setupMinutes ?? 0) * 60_000, toMs: endMs + (input.cleanupMinutes ?? 0) * 60_000 };
}

/** Every day of the booking must find the room free - of the house's bookings (but the one being changed) and of the calendar's events. */
async function assertRoomFree(db: D1Database, windows: Array<{ startMs: number; endMs: number }>, input: { setupMinutes?: number; cleanupMinutes?: number }, exceptId: number | null): Promise<void> {
  for (const day of windows) {
    const { fromMs, toMs } = roomWindow(day.startMs, day.endMs, input);
    const conflict = await db.prepare(`SELECT id FROM room_bookings WHERE status = 'scheduled' AND id <> ? AND ${WINDOW_START} < ? AND ${WINDOW_END} > ? LIMIT 1`)
      .bind(exceptId ?? -1, toMs, fromMs).first<{ id: number }>();
    if (conflict || await hasExternalEventConflict(fromMs, toMs)) throw new Error("booking_conflict");
  }
}

/** The rent of every day, added up. */
function feeForDays(windows: Array<{ startMs: number; endMs: number }>, input: { setupMinutes?: number; cleanupMinutes?: number; bookingType?: RoomBookingType }): number {
  return windows.reduce((sum, day) => {
    const { fromMs, toMs } = roomWindow(day.startMs, day.endMs, input);
    return sum + calculateFee(pricedWindow(fromMs, toMs).fromMs, pricedWindow(fromMs, toMs).toMs, input.bookingType);
  }, 0);
}

export function normalizeCreateRoomBookingInput(value: unknown): CreateRoomBookingInput {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;

  const teacherName = requireText(body.teacherName, "teacher_name");
  const teacherEmail = requireText(body.teacherEmail, "teacher_email");
  const title = requireText(body.title, "title");
  const startsAt = requireText(body.startsAt, "starts_at");
  const endsAt = requireText(body.endsAt, "ends_at");

  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("invalid_booking_interval");
  }
  if (startMs <= Date.now()) throw new Error("invalid_booking_start");

  const maxAttendeesRaw = body.maxAttendees;
  const maxAttendees =
    maxAttendeesRaw === undefined || maxAttendeesRaw === null
      ? null
      : Number(maxAttendeesRaw);
  if (maxAttendees !== null && (!Number.isInteger(maxAttendees) || maxAttendees <= 0)) {
    throw new Error("invalid_max_attendees");
  }

  const ticketPriceKr = body.ticketPriceKr === undefined ? 0 : Number(body.ticketPriceKr);
  if (!Number.isFinite(ticketPriceKr) || ticketPriceKr < 0 || ticketPriceKr > 100_000) {
    throw new Error("invalid_ticket_price");
  }
  const ticketPriceMinor = Math.round(ticketPriceKr * 100);
  const nonMemberRaw = body.nonMemberPriceKr;
  const nonMemberPriceKr = nonMemberRaw === undefined || nonMemberRaw === null || nonMemberRaw === "" ? null : Number(nonMemberRaw);
  if (nonMemberPriceKr !== null && (!Number.isFinite(nonMemberPriceKr) || nonMemberPriceKr < 0 || nonMemberPriceKr > 100_000)) throw new Error("invalid_non_member_price");
  const nonMemberPriceMinor = nonMemberPriceKr === null ? null : Math.round(nonMemberPriceKr * 100);
  const buffer = (value: unknown, name: string) => {
    if (value === undefined || value === null || value === "") return 0;
    const n = Number(value);
    if (![0, 15, 30, 45, 60].includes(n)) throw new Error(`invalid_${name}`);
    return n;
  };
  const setupMinutes = buffer(body.setupMinutes, "setup_minutes"), cleanupMinutes = buffer(body.cleanupMinutes, "cleanup_minutes");
  const days = body.days === undefined || body.days === null || body.days === "" ? 1 : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error("invalid_days");
  const bookingType = body.bookingType === undefined ? "standard" : body.bookingType;
  if (!BOOKING_TYPES.includes(bookingType as RoomBookingType)) throw new Error("invalid_booking_type");

  return {
    teacherName,
    teacherEmail,
    title,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    ...(typeof body.description === "string" ? { description: body.description.trim() || null } : {}),
    ...(maxAttendees !== null ? { maxAttendees } : { maxAttendees: null }),
    ticketPriceMinor,
    nonMemberPriceMinor,
    setupMinutes,
    cleanupMinutes,
    days,
    bookingType: bookingType as RoomBookingType,
    ...(typeof body.memberName === "string" && body.memberName.trim()
      ? { memberName: body.memberName.trim() }
      : {}),
    ...(typeof body.memberEmail === "string" && body.memberEmail.trim()
      ? { memberEmail: body.memberEmail.trim() }
      : {})
  };
}

export function normalizeAttendeeInput(value: unknown): { memberName: string; memberEmail: string } {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  return {
    memberName: requireText(body.memberName, "member_name"),
    memberEmail: requireText(body.memberEmail, "member_email")
  };
}

export async function listOwnedRoomBookings(
  db: D1Database,
  ownerClerkUserId: string
): Promise<RoomBookingRow[]> {
  const result = await db
    .prepare(
      `SELECT id, clerk_user_id, teacher_name, teacher_email, title, description,
              starts_at_ms, ends_at_ms, max_attendees, fee_minor, ticket_price_minor, non_member_price_minor, setup_minutes, cleanup_minutes, days, booking_type, review_status, review_note, status, cancelled_at_ms
       FROM room_bookings
       WHERE clerk_user_id = ? AND status = 'scheduled'
       ORDER BY starts_at_ms ASC`
    )
    .bind(ownerClerkUserId)
    .all<RoomBookingRow>();
  return result.results ?? [];
}

export async function listMemberCalendarBookings(
  db: D1Database,
  clerkUserId: string,
  fromMs = Date.now()
): Promise<MemberCalendarRow[]> {
  const result = await db.prepare(
    `SELECT b.id, b.clerk_user_id, b.teacher_name, b.teacher_email, b.title, b.description,
            b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.fee_minor, b.ticket_price_minor, b.booking_type, b.status,
            -- Reported (Gitta): her event waiting for the board said "Godkendt og offentligt" - the review status was not read, so it counted as approved.
            b.non_member_price_minor, b.setup_minutes, b.cleanup_minutes, b.days, b.review_status, b.review_note,
            b.cancelled_at_ms,
            SUM(CASE WHEN a.registration_status = 'confirmed' THEN a.seats ELSE 0 END) AS attendee_count,
            MAX(CASE WHEN a.clerk_user_id = ? AND a.registration_status = 'confirmed' THEN 1 ELSE 0 END) AS is_attending,
            MAX(CASE WHEN a.clerk_user_id = ? THEN a.registration_status ELSE NULL END) AS registration_status,
            MAX(CASE WHEN a.clerk_user_id = ? AND a.registration_status IN ('pending', 'confirmed') THEN a.seats ELSE NULL END) AS my_seats
     FROM room_bookings b
     LEFT JOIN room_booking_attendees a ON a.room_booking_id = b.id
     WHERE b.status = 'scheduled' AND b.ends_at_ms >= ? AND (b.review_status = 'approved' OR b.clerk_user_id = ?)
     GROUP BY b.id
     ORDER BY b.starts_at_ms ASC`
  ).bind(clerkUserId, clerkUserId, clerkUserId, fromMs, clerkUserId).all<MemberCalendarRow>();
  return result.results ?? [];
}

/** Requested (the chair): "Som underviser kan man booke et gratis event om ugen". Free rent (booking type "free") at most once in a
 * week, Monday to Sunday in Copenhagen, per organiser. The board's own events from admin ("cockpit:...") are not limited. */
export function copenhagenWeek(ms: number): { fromMs: number; toMs: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(ms).map(x => [x.type, x.value]));
  const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!);
  // Local midnight of that day, then back to Monday; one hour either side is settled by the clock change, so it is taken from the parts.
  const sinceMidnight = (Number(p.hour) * 60 + Number(p.minute)) * 60_000 + (ms % 60_000);
  const monday = ms - sinceMidnight - back * 86_400_000;
  return { fromMs: monday, toMs: monday + 7 * 86_400_000 };
}

async function freeRentUsed(db: D1Database, ownerClerkUserId: string, startMs: number, exceptId: number | null): Promise<boolean> {
  if (ownerClerkUserId.startsWith("cockpit:")) return false;
  const week = copenhagenWeek(startMs);
  const row = await db.prepare(`SELECT id FROM room_bookings WHERE clerk_user_id = ? AND status = 'scheduled' AND booking_type = 'free'
    AND starts_at_ms >= ? AND starts_at_ms < ? AND id <> ? LIMIT 1`).bind(ownerClerkUserId, week.fromMs, week.toMs, exceptId ?? -1).first<{ id: number }>();
  return Boolean(row);
}

export async function createRoomBooking(
  db: D1Database,
  ownerClerkUserId: string,
  input: CreateRoomBookingInput
): Promise<CreatedRoomBooking> {
  const startMs = Date.parse(input.startsAt);
  const windows = dayWindows(startMs, Date.parse(input.endsAt), input.days ?? 1);
  const endMs = windows[windows.length - 1]!.endMs;
  await assertRoomFree(db, windows, input, null);
  if (input.bookingType === "free" && await freeRentUsed(db, ownerClerkUserId, startMs, null)) throw new Error("free_rent_week_used");

  const feeKr = feeForDays(windows, input);
  const now = Date.now();
  const insert = await db
    .prepare(
      `INSERT INTO room_bookings (
         clerk_user_id, teacher_name, teacher_email, title, description,
         starts_at_ms, ends_at_ms, max_attendees, fee_minor, ticket_price_minor,
         payout_clerk_user_id, created_at_ms, updated_at_ms, booking_type,
         review_status, reviewed_by, reviewed_at_ms, non_member_price_minor, setup_minutes, cleanup_minutes, days
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      ownerClerkUserId,
      input.teacherName,
      input.teacherEmail,
      input.title,
      input.description ?? null,
      startMs,
      endMs,
      input.maxAttendees ?? null,
      feeKr * 100,
      input.ticketPriceMinor,
      ownerClerkUserId,
      now,
      now,
      input.bookingType ?? "standard",
      input.preApproved ? "approved" : "pending",
      input.preApproved ? "Fast underviser eller bestyrelsen" : null,
      input.preApproved ? now : null,
      input.nonMemberPriceMinor ?? null,
      input.setupMinutes ?? 0,
      input.cleanupMinutes ?? 0,
      windows.length
    )
    .run();

  const id = insert.meta?.last_row_id;
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("booking_insert_failed");
  }

  const attendeeName = input.memberName ?? input.teacherName;
  const attendeeEmail = input.memberEmail ?? input.teacherEmail;
  try {
    await db
      .prepare(
        `INSERT INTO room_booking_attendees (
           room_booking_id, clerk_user_id, member_name, member_email, created_at_ms,
           registration_status, confirmed_at_ms
         ) VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`
      )
      .bind(id, ownerClerkUserId, attendeeName, attendeeEmail, now, now)
      .run();
  } catch (error) {
    await db.prepare("DELETE FROM room_bookings WHERE id = ?").bind(id).run();
    throw error;
  }

  return { id, feeKr };
}

export async function updateOwnedRoomBooking(
  db: D1Database,
  ownerClerkUserId: string,
  bookingId: number,
  input: CreateRoomBookingInput
): Promise<{ feeKr: number }> {
  const startMs = Date.parse(input.startsAt);
  const windows = dayWindows(startMs, Date.parse(input.endsAt), input.days ?? 1);
  const endMs = windows[windows.length - 1]!.endMs;
  await assertRoomFree(db, windows, input, bookingId);
  if (input.bookingType === "free" && await freeRentUsed(db, ownerClerkUserId, startMs, bookingId)) throw new Error("free_rent_week_used");

  const current = await db.prepare(
    "SELECT ticket_price_minor FROM room_bookings WHERE id = ? AND clerk_user_id = ?"
  ).bind(bookingId, ownerClerkUserId).first<{ ticket_price_minor: number }>();
  if (!current) throw new Error("booking_not_found");
  if (current.ticket_price_minor !== input.ticketPriceMinor) {
    const registrations = await db.prepare(
      `SELECT COUNT(*) AS count FROM room_booking_attendees
       WHERE room_booking_id = ? AND clerk_user_id <> ?
         AND registration_status IN ('pending', 'confirmed')`
    ).bind(bookingId, ownerClerkUserId).first<{ count: number }>();
    if ((registrations?.count ?? 0) > 0) throw new Error("booking_has_registrations");
  }

  const feeKr = feeForDays(windows, input);
  const result = await db
    .prepare(
      `UPDATE room_bookings
       SET teacher_name = ?, teacher_email = ?, title = ?, description = ?,
           starts_at_ms = ?, ends_at_ms = ?, max_attendees = ?, fee_minor = ?,
           ticket_price_minor = ?, payout_clerk_user_id = ?, updated_at_ms = ?, booking_type = ?,
           review_status = ?, review_note = NULL, reviewed_by = ?, reviewed_at_ms = ?, non_member_price_minor = ?,
           setup_minutes = ?, cleanup_minutes = ?, days = ?
       WHERE id = ? AND clerk_user_id = ?`
    )
    .bind(
      input.teacherName,
      input.teacherEmail,
      input.title,
      input.description ?? null,
      startMs,
      endMs,
      input.maxAttendees ?? null,
      feeKr * 100,
      input.ticketPriceMinor,
      ownerClerkUserId,
      Date.now(),
      input.bookingType ?? "standard",
      // A changed event is approved again, unless its teacher is exempt.
      input.preApproved ? "approved" : "pending",
      input.preApproved ? "Fast underviser eller bestyrelsen" : null,
      input.preApproved ? Date.now() : null,
      input.nonMemberPriceMinor ?? null,
      input.setupMinutes ?? 0,
      input.cleanupMinutes ?? 0,
      windows.length,
      bookingId,
      ownerClerkUserId
    )
    .run();

  if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_not_found");
  return { feeKr };
}

export async function deleteOwnedRoomBooking(
  db: D1Database,
  ownerClerkUserId: string,
  bookingId: number
): Promise<void> {
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE room_bookings
       SET status = 'cancelled', cancelled_at_ms = ?, updated_at_ms = ?
       WHERE id = ? AND clerk_user_id = ? AND status = 'scheduled' AND starts_at_ms > ?`
    )
    .bind(now, now, bookingId, ownerClerkUserId, now)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_not_found");
}

export async function cancelRoomBookingAsAdmin(
  db: D1Database,
  bookingId: number
): Promise<void> {
  const now = Date.now();
  const result = await db.prepare(
    `UPDATE room_bookings
     SET status = 'cancelled', cancelled_at_ms = ?, updated_at_ms = ?
     WHERE id = ? AND status = 'scheduled'`
  ).bind(now, now, bookingId).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_not_found");
}

/** Requested by the chair: "Som admin skal man kunne redigere og slette events oprettet i systemet." The board changes a member's event from
 * admin (cockpit/systemEvents.ts): its words and its time. The prices stay as the organiser set them (participants may have paid). A new
 * time must be free in the hall and follow the rent rules; the rent is worked out again. The approval stands - the board made the change. */
export type AdminEventChange = { title: string; description: string | null; teacherName: string; startsAt: number; endsAt: number; maxAttendees: number | null };

export async function updateRoomBookingAsAdmin(db: D1Database, bookingId: number, change: AdminEventChange): Promise<void> {
  const row = await db.prepare("SELECT booking_type, setup_minutes, cleanup_minutes, starts_at_ms, ends_at_ms FROM room_bookings WHERE id = ? AND status = 'scheduled'")
    .bind(bookingId).first<{ booking_type: RoomBookingType | null; setup_minutes: number | null; cleanup_minutes: number | null; starts_at_ms: number; ends_at_ms: number }>();
  if (!row) throw new Error("booking_not_found");
  if (!(change.endsAt > change.startsAt)) throw new Error("invalid_time");
  const setup = row.setup_minutes ?? 0, cleanup = row.cleanup_minutes ?? 0;
  let feeMinor: number | null = null;
  if (change.startsAt !== row.starts_at_ms || change.endsAt !== row.ends_at_ms) {
    const { fromMs, toMs } = roomWindow(change.startsAt, change.endsAt, { setupMinutes: setup, cleanupMinutes: cleanup });
    const conflict = await db.prepare(`SELECT id FROM room_bookings WHERE status = 'scheduled' AND id <> ? AND ${WINDOW_START} < ? AND ${WINDOW_END} > ? LIMIT 1`)
      .bind(bookingId, toMs, fromMs).first<{ id: number }>();
    if (conflict || await hasExternalEventConflict(fromMs, toMs)) throw new Error("booking_conflict");
    const priced = pricedWindow(fromMs, toMs);
    feeMinor = calculateFee(priced.fromMs, priced.toMs, row.booking_type ?? "standard") * 100;
  }
  await db.prepare(`UPDATE room_bookings SET title = ?, description = ?, teacher_name = ?, starts_at_ms = ?, ends_at_ms = ?, max_attendees = ?,
      fee_minor = COALESCE(?, fee_minor), updated_at_ms = ? WHERE id = ? AND status = 'scheduled'`)
    .bind(change.title, change.description, change.teacherName, change.startsAt, change.endsAt, change.maxAttendees, feeMinor, Date.now(), bookingId).run();
}

export async function listBookingAttendees(
  db: D1Database,
  ownerClerkUserId: string,
  bookingId: number
): Promise<AttendeeRow[]> {
  const owned = await db
    .prepare("SELECT id FROM room_bookings WHERE id = ? AND clerk_user_id = ?")
    .bind(bookingId, ownerClerkUserId)
    .first<{ id: number }>();
  if (!owned) throw new Error("booking_not_found");

  const result = await db
    .prepare(
      `SELECT id, clerk_user_id, member_name, member_email, created_at_ms, registration_status, seats
       FROM room_booking_attendees
       WHERE room_booking_id = ? AND registration_status = 'confirmed'
       ORDER BY created_at_ms ASC`
    )
    .bind(bookingId)
    .all<AttendeeRow>();
  return result.results ?? [];
}

export const MAX_SEATS = 6;

export async function attendRoomBooking(
  db: D1Database,
  clerkUserId: string,
  bookingId: number,
  attendee: { memberName: string; memberEmail: string },
  /** Requested: "Man skal også kunne tilmelde sig et event som ikke-medlem" - a non-member pays the non-member price, when the event has one. */
  nonMember = false,
  /** Douglas (13 Nov 2026), for the board: "book more than one person" - the places this sign-up holds (1-6). */
  seats = 1
): Promise<void> {
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) throw new Error("invalid_seats");
  const now = Date.now();
  const booking = await db.prepare(
    `SELECT id, clerk_user_id, starts_at_ms, max_attendees, ticket_price_minor, non_member_price_minor
     FROM room_bookings WHERE id = ? AND status = 'scheduled' AND review_status = 'approved'`
  ).bind(bookingId).first<{
    id: number; clerk_user_id: string; starts_at_ms: number;
    max_attendees: number | null; ticket_price_minor: number; non_member_price_minor: number | null;
  }>();
  // Douglas (18 Nov 2026), of his test event waiting for approval: "I cannot register for the event even when logged in" - and now it says why.
  if (!booking && await db.prepare("SELECT 1 AS hit FROM room_bookings WHERE id = ? AND status = 'scheduled'").bind(bookingId).first()) throw new Error("booking_not_approved");
  if (!booking) throw new Error("booking_not_found");
  if (booking.starts_at_ms <= now) throw new Error("booking_started");
  // Checkout charges the members' price, so a non-member's paid ticket waits until it can charge theirs.
  if (nonMember && (booking.non_member_price_minor ?? booking.ticket_price_minor) > 0) throw new Error("non_member_payment_unavailable");
  if (booking.ticket_price_minor > 0) throw new Error("event_payment_required");

  const existing = await db.prepare(
    `SELECT id, registration_status FROM room_booking_attendees
     WHERE room_booking_id = ? AND clerk_user_id = ?`
  ).bind(bookingId, clerkUserId).first<{ id: number; registration_status: string }>();
  if (existing?.registration_status === "confirmed") throw new Error("already_attending");
  if (existing?.registration_status === "pending") throw new Error("booking_full_or_pending");

  if (existing) {
    const result = await db.prepare(
      `UPDATE room_booking_attendees
       SET member_name = ?, member_email = ?, registration_status = 'confirmed', seats = ?,
           confirmed_at_ms = ?, cancelled_at_ms = NULL
       WHERE id = ? AND registration_status = 'cancelled'
         AND ((SELECT max_attendees FROM room_bookings WHERE id = ?) IS NULL OR
           (SELECT COALESCE(SUM(seats), 0) FROM room_booking_attendees
            WHERE room_booking_id = ? AND registration_status = 'confirmed') + ? <=
           (SELECT max_attendees FROM room_bookings WHERE id = ?))`
    ).bind(attendee.memberName, attendee.memberEmail, seats, now, existing.id, bookingId, bookingId, seats, bookingId).run();
    if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_full");
    return;
  }

  const result = await db.prepare(
    `INSERT INTO room_booking_attendees
     (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms,
      registration_status, confirmed_at_ms, seats)
     SELECT b.id, ?, ?, ?, ?, 'confirmed', ?, ?
     FROM room_bookings b
     WHERE b.id = ? AND b.status = 'scheduled' AND b.starts_at_ms > ?
       AND (b.max_attendees IS NULL OR
         (SELECT COALESCE(SUM(seats), 0) FROM room_booking_attendees
          WHERE room_booking_id = b.id AND (
            registration_status = 'confirmed' OR
            (registration_status = 'pending' AND expires_at_ms > ?)
          )) + ? <= b.max_attendees)`
  ).bind(clerkUserId, attendee.memberName, attendee.memberEmail, now, now, seats, bookingId, now, now, seats).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_full");
}

export async function unattendRoomBooking(
  db: D1Database,
  clerkUserId: string,
  bookingId: number
): Promise<void> {
  const now = Date.now();
  const booking = await db.prepare(
    "SELECT clerk_user_id, starts_at_ms FROM room_bookings WHERE id = ? AND status = 'scheduled'"
  ).bind(bookingId).first<{ clerk_user_id: string; starts_at_ms: number }>();
  if (!booking) throw new Error("booking_not_found");
  if (booking.starts_at_ms <= now) throw new Error("booking_started");
  // Douglas (17 Nov 2026): "When I click 'Cancel Registration', nothing seems to happen" - an organiser may sign up for their own event, and so take it back.

  const result = await db.prepare(
    `UPDATE room_booking_attendees
     SET registration_status = 'cancelled', cancelled_at_ms = ?, expires_at_ms = NULL
     WHERE room_booking_id = ? AND clerk_user_id = ?
       AND registration_status IN ('pending', 'confirmed')`
  ).bind(now, bookingId, clerkUserId).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("attendance_not_found");
}

/** Douglas (forslag #6, 27 Nov 2026): "When one person in a group drops out, the member shouldn't have to cancel everyone and sign up again." A confirmed
 * registration for several places keeps `seats` of them (at least 1, fewer than now); the others are free on the event again at once, as the places are
 * counted from the registrations. Only before the event begins, and only the member's own. Paid registrations are for one place, so this is the free ones. */
export async function reduceAttendance(db: D1Database, clerkUserId: string, bookingId: number, seats: number): Promise<number> {
  if (!Number.isInteger(seats) || seats < 1) throw new Error("invalid_seats");
  const booking = await db.prepare("SELECT starts_at_ms FROM room_bookings WHERE id = ? AND status = 'scheduled'").bind(bookingId).first<{ starts_at_ms: number }>();
  if (!booking) throw new Error("booking_not_found");
  if (booking.starts_at_ms <= Date.now()) throw new Error("booking_started");
  const result = await db.prepare(`UPDATE room_booking_attendees SET seats = ?
     WHERE room_booking_id = ? AND clerk_user_id = ? AND registration_status = 'confirmed' AND seats > ?`).bind(seats, bookingId, clerkUserId, seats).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("attendance_not_found");
  return seats;
}

/** Security review (3 Nov 2026), point 4: a member could type a fixed teacher's address on their profile and have their own events approved at once.
 * Whether someone is a fixed teacher is decided by the e-mail Clerk has verified for their account - never by the one on their profile. */
export async function fixedTeacherByAccount(db: D1Database, clerkUserId: string, clerkSecretKey: string | undefined,
  primaryEmail: (userId: string, secretKey: string) => Promise<string>): Promise<boolean> {
  if (!clerkSecretKey) return false;
  const email = await primaryEmail(clerkUserId, clerkSecretKey).catch(() => null);
  return email ? isFixedTeacher(db, email) : false;
}

/** The fixed teachers (the board's list): their events are approved at once. */
export async function isFixedTeacher(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS hit FROM fixed_teachers WHERE email = ?").bind(email.trim().toLowerCase()).first<{ hit: number }>();
  return Boolean(row);
}
