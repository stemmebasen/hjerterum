import type { D1Database } from "./db.js";

export type AdminOverview = {
  totals: {
    members: number;
    activeMembers: number;
    externalMembers: number;
    teachers: number;
    upcomingBookings: number;
  };
  recentMembers: AdminMember[];
  upcomingBookings: AdminBooking[];
};

export type AdminMember = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  tier: string;
  interval: string;
  status: string;
  isTeacher: boolean;
  accessBlocked: boolean;
  createdAt: string;
};

export type AdminBooking = {
  id: number;
  title: string;
  teacherName: string;
  teacherEmail: string;
  startsAt: string;
  endsAt: string;
  maxAttendees: number | null;
  attendeeCount: number;
  feeKr: number;
  ticketPriceKr: number;
  status: string;
};

type MemberRow = {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  tier: string;
  interval: string;
  status: string;
  is_teacher: number;
  access_blocked: number;
  created_at_ms: number;
};

type BookingRow = {
  id: number;
  title: string;
  teacher_name: string;
  teacher_email: string;
  starts_at_ms: number;
  ends_at_ms: number;
  max_attendees: number | null;
  attendee_count: number;
  fee_minor: number;
  ticket_price_minor: number;
  status: string;
};

function memberView(row: MemberRow): AdminMember {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    tier: row.tier,
    interval: row.interval,
    status: row.status,
    isTeacher: row.is_teacher === 1,
    accessBlocked: row.access_blocked === 1,
    createdAt: new Date(row.created_at_ms).toISOString()
  };
}

function bookingView(row: BookingRow): AdminBooking {
  return {
    id: row.id,
    title: row.title,
    teacherName: row.teacher_name,
    teacherEmail: row.teacher_email,
    startsAt: new Date(row.starts_at_ms).toISOString(),
    endsAt: new Date(row.ends_at_ms).toISOString(),
    maxAttendees: row.max_attendees,
    attendeeCount: row.attendee_count,
    feeKr: row.fee_minor / 100,
    ticketPriceKr: row.ticket_price_minor / 100,
    status: row.status
  };
}

async function count(db: D1Database, sql: string, value?: number): Promise<number> {
  const statement = value === undefined ? db.prepare(sql) : db.prepare(sql).bind(value);
  const row = await statement.first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listAdminMembers(db: D1Database, limit = 200): Promise<AdminMember[]> {
  const result = await db.prepare(
    `SELECT id, full_name, email, phone, tier, interval, status, is_teacher, access_blocked, created_at_ms
     FROM members
     ORDER BY created_at_ms DESC
     LIMIT ?`
  ).bind(limit).all<MemberRow>();
  return (result.results ?? []).map(memberView);
}

export async function listAdminBookings(
  db: D1Database,
  options: { upcomingOnly?: boolean; limit?: number } = {}
): Promise<AdminBooking[]> {
  const upcomingOnly = options.upcomingOnly ?? false;
  const limit = options.limit ?? 200;
  const result = await db.prepare(
    `SELECT rb.id, rb.title, rb.teacher_name, rb.teacher_email,
            rb.starts_at_ms, rb.ends_at_ms, rb.max_attendees, rb.fee_minor,
            rb.ticket_price_minor, rb.status,
            SUM(CASE WHEN rba.registration_status = 'confirmed' THEN 1 ELSE 0 END) AS attendee_count
     FROM room_bookings rb
     LEFT JOIN room_booking_attendees rba ON rba.room_booking_id = rb.id
     WHERE (? = 0 OR (rb.status = 'scheduled' AND rb.ends_at_ms >= ?))
     GROUP BY rb.id
     ORDER BY rb.starts_at_ms ${upcomingOnly ? "ASC" : "DESC"}
     LIMIT ?`
  ).bind(upcomingOnly ? 1 : 0, Date.now(), limit).all<BookingRow>();
  return (result.results ?? []).map(bookingView);
}

export async function getAdminOverview(db: D1Database): Promise<AdminOverview> {
  const now = Date.now();
  const [localMembers, activeLocalMembers, externalMembers, activeExternalMembers, teachers, upcomingBookings, recentMembers, bookings] =
    await Promise.all([
      count(db, "SELECT COUNT(*) AS count FROM members"),
      count(db, "SELECT COUNT(*) AS count FROM members WHERE status = 'active' AND access_blocked = 0"),
      count(db, "SELECT COUNT(*) AS count FROM external_memberships WHERE source = 'membershipworks'"),
      count(db, "SELECT COUNT(*) AS count FROM external_memberships WHERE source = 'membershipworks' AND status = 'active' AND access_blocked = 0"),
      count(db, "SELECT COUNT(*) AS count FROM teachers"),
      count(db, "SELECT COUNT(*) AS count FROM room_bookings WHERE status = 'scheduled' AND ends_at_ms >= ?", now),
      listAdminMembers(db, 6),
      listAdminBookings(db, { upcomingOnly: true, limit: 6 })
    ]);

  return {
    totals: {
      members: localMembers + externalMembers,
      activeMembers: activeLocalMembers + activeExternalMembers,
      externalMembers,
      teachers,
      upcomingBookings
    },
    recentMembers,
    upcomingBookings: bookings
  };
}
