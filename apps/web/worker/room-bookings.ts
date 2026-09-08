import { calculateLegacyRoomFee } from "../../../packages/core/src/legacy-room-pricing.js";
import type { D1Database } from "./db.js";

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
       WHERE starts_at_ms < ? AND ends_at_ms > ?
       LIMIT 1`
    )
    .bind(endMs, startMs)
    .first<{ id: number }>();
  if (conflict) throw new Error("booking_conflict");

  const { dayOfWeek, startMinutes } = localPricingParts(startMs);
  const pricing = calculateLegacyRoomFee({
    dayOfWeek,
    startMinutes,
    durationMinutes: (endMs - startMs) / 60_000
  });

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
      pricing.feeKr * 100,
      now,
      now
    )
    .run();

  const id = insert.meta?.last_row_id;
  if (!Number.isInteger(id)) throw new Error("booking_insert_failed");

  const attendeeName = input.memberName ?? input.teacherName;
  const attendeeEmail = input.memberEmail ?? input.teacherEmail;
  await db
    .prepare(
      `INSERT INTO room_booking_attendees (
         room_booking_id, clerk_user_id, member_name, member_email, created_at_ms
       ) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, ownerClerkUserId, attendeeName, attendeeEmail, now)
    .run();

  return { id, feeKr: pricing.feeKr };
}
