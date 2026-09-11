import { calculateLegacyRoomFee } from "../../../packages/core/src/legacy-room-pricing.js";
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
  memberName?: string;
  memberEmail?: string;
};

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
  status: "scheduled" | "cancelled";
  cancelled_at_ms: number | null;
};

export type MemberCalendarRow = RoomBookingRow & {
  attendee_count: number;
  is_attending: number;
};

export type AttendeeRow = {
  id: number;
  clerk_user_id: string;
  member_name: string;
  member_email: string;
  created_at_ms: number;
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

function calculateFee(startMs: number, endMs: number): number {
  const { dayOfWeek, startMinutes } = localPricingParts(startMs);
  return calculateLegacyRoomFee({
    dayOfWeek,
    startMinutes,
    durationMinutes: (endMs - startMs) / 60_000
  }).feeKr;
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

  return {
    teacherName,
    teacherEmail,
    title,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    ...(typeof body.description === "string" ? { description: body.description.trim() || null } : {}),
    ...(maxAttendees !== null ? { maxAttendees } : { maxAttendees: null }),
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
              starts_at_ms, ends_at_ms, max_attendees, fee_minor, status, cancelled_at_ms
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
            b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.fee_minor, b.status,
            b.cancelled_at_ms, COUNT(a.id) AS attendee_count,
            MAX(CASE WHEN a.clerk_user_id = ? THEN 1 ELSE 0 END) AS is_attending
     FROM room_bookings b
     LEFT JOIN room_booking_attendees a ON a.room_booking_id = b.id
     WHERE b.status = 'scheduled' AND b.ends_at_ms >= ?
     GROUP BY b.id
     ORDER BY b.starts_at_ms ASC`
  ).bind(clerkUserId, fromMs).all<MemberCalendarRow>();
  return result.results ?? [];
}

export async function createRoomBooking(
  db: D1Database,
  ownerClerkUserId: string,
  input: CreateRoomBookingInput
): Promise<CreatedRoomBooking> {
  const startMs = Date.parse(input.startsAt);
  const endMs = Date.parse(input.endsAt);

  const conflict = await db
    .prepare(
      `SELECT id FROM room_bookings
       WHERE status = 'scheduled' AND starts_at_ms < ? AND ends_at_ms > ?
       LIMIT 1`
    )
    .bind(endMs, startMs)
    .first<{ id: number }>();
  if (conflict || await hasExternalEventConflict(startMs, endMs)) {
    throw new Error("booking_conflict");
  }

  const feeKr = calculateFee(startMs, endMs);
  const now = Date.now();
  const insert = await db
    .prepare(
      `INSERT INTO room_bookings (
         clerk_user_id, teacher_name, teacher_email, title, description,
         starts_at_ms, ends_at_ms, max_attendees, fee_minor,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now,
      now
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
           room_booking_id, clerk_user_id, member_name, member_email, created_at_ms
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, ownerClerkUserId, attendeeName, attendeeEmail, now)
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
  const endMs = Date.parse(input.endsAt);

  const conflict = await db
    .prepare(
      `SELECT id FROM room_bookings
       WHERE status = 'scheduled' AND id <> ? AND starts_at_ms < ? AND ends_at_ms > ?
       LIMIT 1`
    )
    .bind(bookingId, endMs, startMs)
    .first<{ id: number }>();
  if (conflict || await hasExternalEventConflict(startMs, endMs)) {
    throw new Error("booking_conflict");
  }

  const feeKr = calculateFee(startMs, endMs);
  const result = await db
    .prepare(
      `UPDATE room_bookings
       SET teacher_name = ?, teacher_email = ?, title = ?, description = ?,
           starts_at_ms = ?, ends_at_ms = ?, max_attendees = ?, fee_minor = ?,
           updated_at_ms = ?
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
      Date.now(),
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
      `SELECT id, clerk_user_id, member_name, member_email, created_at_ms
       FROM room_booking_attendees
       WHERE room_booking_id = ?
       ORDER BY created_at_ms ASC`
    )
    .bind(bookingId)
    .all<AttendeeRow>();
  return result.results ?? [];
}

export async function attendRoomBooking(
  db: D1Database,
  clerkUserId: string,
  bookingId: number,
  attendee: { memberName: string; memberEmail: string }
): Promise<void> {
  const booking = await db
    .prepare(
      "SELECT id, starts_at_ms, max_attendees FROM room_bookings WHERE id = ? AND status = 'scheduled'"
    )
    .bind(bookingId)
    .first<{ id: number; starts_at_ms: number; max_attendees: number | null }>();
  if (!booking) throw new Error("booking_not_found");
  if (booking.starts_at_ms <= Date.now()) throw new Error("booking_started");

  const existing = await db
    .prepare(
      `SELECT id FROM room_booking_attendees
       WHERE room_booking_id = ? AND clerk_user_id = ?`
    )
    .bind(bookingId, clerkUserId)
    .first<{ id: number }>();
  if (existing) throw new Error("already_attending");

  const result = await db.prepare(
    `INSERT INTO room_booking_attendees
     (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms)
     SELECT b.id, ?, ?, ?, ?
     FROM room_bookings b
     WHERE b.id = ? AND b.status = 'scheduled' AND b.starts_at_ms > ?
       AND (
         b.max_attendees IS NULL OR
         (SELECT COUNT(*) FROM room_booking_attendees WHERE room_booking_id = b.id) < b.max_attendees
       )`
  ).bind(
    clerkUserId,
    attendee.memberName,
    attendee.memberEmail,
    Date.now(),
    bookingId,
    Date.now()
  ).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("booking_full");
}

export async function unattendRoomBooking(
  db: D1Database,
  clerkUserId: string,
  bookingId: number
): Promise<void> {
  const booking = await db.prepare(
    "SELECT starts_at_ms FROM room_bookings WHERE id = ? AND status = 'scheduled'"
  ).bind(bookingId).first<{ starts_at_ms: number }>();
  if (!booking) throw new Error("booking_not_found");
  if (booking.starts_at_ms <= Date.now()) throw new Error("booking_started");

  const result = await db
    .prepare(
      `DELETE FROM room_booking_attendees
       WHERE room_booking_id = ? AND clerk_user_id = ?`
    )
    .bind(bookingId, clerkUserId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("attendance_not_found");
}
