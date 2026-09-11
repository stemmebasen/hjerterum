export interface D1RunMeta {
  changes?: number;
  last_row_id?: number;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: D1RunMeta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type PublicRoomBookingRow = {
  id: number;
  teacher_name: string;
  teacher_email: string;
  title: string;
  description: string | null;
  starts_at_ms: number;
  ends_at_ms: number;
  max_attendees: number | null;
};

export async function checkDatabase(db: D1Database): Promise<void> {
  const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  if (row?.ok !== 1) throw new Error("database_unhealthy");
}

export async function listUpcomingPublicRoomBookings(
  db: D1Database,
  fromMs = Date.now()
): Promise<PublicRoomBookingRow[]> {
  const result = await db
    .prepare(
      `SELECT id, teacher_name, teacher_email, title, description,
              starts_at_ms, ends_at_ms, max_attendees
       FROM room_bookings
       WHERE status = 'scheduled' AND ends_at_ms >= ?
       ORDER BY starts_at_ms ASC`
    )
    .bind(fromMs)
    .all<PublicRoomBookingRow>();

  return result.results ?? [];
}
