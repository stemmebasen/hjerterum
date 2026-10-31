// Cirkelmøder i Hjerterums sal (Jake, 31. oktober 2026): CIRKLER planlægger et møde i den samme kalender som
// medlemmernes events og med de samme regler. Hjerterum svarer på tre ting, alle med den delte servicenøgle:
//
//   GET    /api/integrations/cirkler/room-day?date=YYYY-MM-DD      Dagens kalender for salen, som planlæggeren viser den.
//   PUT    /api/integrations/cirkler/reservations/<mødets id>       Reservér eller flyt; mødets id er nøglen, så et nyt forsøg
//                                                                    opdaterer den samme reservation og aldrig laver en dublet.
//   DELETE /api/integrations/cirkler/reservations/<mødets id>       Frigiv, når mødet aflyses eller skifter sted.
//
// Reservationen ejes af den faste konto "cirkler", hedder "CIRKLER-møde" og er fri leje: salen er stillet til rådighed.
// Hjerterum får ingen deltagerdata. Salen er optaget (409 booking_conflict), når klargøring og oprydning overlapper noget
// andet, præcis som for et medlem.
import { roomBookingProblems } from "../../../packages/core/src/legacy-room-pricing.js";
import type { D1Database } from "./db.js";
import { getExternalEvents, hasExternalEventConflict } from "./external-events.js";
import { listDayItems } from "./room-day.js";
import { WINDOW_END, WINDOW_START, roomWindow } from "./room-bookings.js";

export const CIRKLER_OWNER = "cirkler";
export const CIRKLER_TITLE = "CIRKLER-møde";
export const BUSY_LABEL = "Optaget af anden aktivitet";
const BUFFERS = [0, 15, 30, 45, 60];
const MEETING_ID = /^[A-Za-z0-9-]{8,80}$/;

export type Reservation = { reference: string; startsAt: string; endsAt: string; setupMinutes: number; cleanupMinutes: number };

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) }
  });
}

function localParts(startMs: number): { dayOfWeek: number; startMinutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startMs));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find((part) => part.type === "weekday")?.value ?? ""] ?? 0;
  return { dayOfWeek: weekday, startMinutes: Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value) };
}

export type ReservationInput = { startsAt: string; endsAt: string; setupMinutes: number; cleanupMinutes: number };

export function parseReservationInput(value: unknown, now: number): ReservationInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "invalid_body" };
  const body = value as Record<string, unknown>;
  const startMs = typeof body.startsAt === "string" ? Date.parse(body.startsAt) : NaN;
  const endMs = typeof body.endsAt === "string" ? Date.parse(body.endsAt) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return { error: "invalid_time" };
  if (startMs <= now) return { error: "invalid_booking_start" };
  const buffer = (raw: unknown) => raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
  const setupMinutes = buffer(body.setupMinutes), cleanupMinutes = buffer(body.cleanupMinutes);
  if (!BUFFERS.includes(setupMinutes)) return { error: "invalid_setup_minutes" };
  if (!BUFFERS.includes(cleanupMinutes)) return { error: "invalid_cleanup_minutes" };
  // Hjerterums regler gælder også for cirkelmøder (Jake): 2 til 10 timer i halve timer med klargøring og oprydning,
  // og på hverdage ikke hen over kl. 18.30, når lejen er fri.
  const window = roomWindow(startMs, endMs, { setupMinutes, cleanupMinutes });
  const { dayOfWeek, startMinutes } = localParts(window.fromMs);
  const problem = roomBookingProblems({ dayOfWeek, startMinutes, durationMinutes: Math.round((window.toMs - window.fromMs) / 60_000), bookingType: "free" })[0];
  if (problem) return { error: `invalid_${problem}` };
  return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(), setupMinutes, cleanupMinutes };
}

type ExistingRow = { id: number; status: string };

/** Reservér eller flyt cirkelmødets tid. Kaster booking_conflict, når salen er optaget. */
export async function reserveForMeeting(db: D1Database, meetingId: string, input: ReservationInput, now: number): Promise<Reservation> {
  const startMs = Date.parse(input.startsAt);
  const endMs = Date.parse(input.endsAt);
  const { fromMs, toMs } = roomWindow(startMs, endMs, input);
  const existing = await db.prepare("SELECT id, status FROM room_bookings WHERE cirkler_meeting_id = ?").bind(meetingId).first<ExistingRow>();
  const conflict = await db.prepare(
    `SELECT id FROM room_bookings WHERE status = 'scheduled' AND (cirkler_meeting_id IS NULL OR cirkler_meeting_id <> ?) AND ${WINDOW_START} < ? AND ${WINDOW_END} > ? LIMIT 1`
  ).bind(meetingId, toMs, fromMs).first<{ id: number }>();
  if (conflict || await hasExternalEventConflict(fromMs, toMs)) throw new Error("booking_conflict");

  if (existing) {
    await db.prepare(
      `UPDATE room_bookings SET starts_at_ms = ?, ends_at_ms = ?, setup_minutes = ?, cleanup_minutes = ?, status = 'scheduled', cancelled_at_ms = NULL, updated_at_ms = ? WHERE id = ?`
    ).bind(startMs, endMs, input.setupMinutes, input.cleanupMinutes, now, existing.id).run();
    return { reference: String(existing.id), ...input };
  }
  const insert = await db.prepare(
    `INSERT INTO room_bookings (
       clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, max_attendees, fee_minor, ticket_price_minor,
       payout_clerk_user_id, created_at_ms, updated_at_ms, booking_type, review_status, reviewed_by, reviewed_at_ms, non_member_price_minor,
       setup_minutes, cleanup_minutes, cirkler_meeting_id
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 0, 0, ?, ?, ?, 'free', 'approved', ?, ?, NULL, ?, ?, ?)`
  ).bind(
    CIRKLER_OWNER, "CIRKLER", "kontakt@cirkler.net", CIRKLER_TITLE, startMs, endMs, CIRKLER_OWNER, now, now,
    "CIRKLER-aftalen", now, input.setupMinutes, input.cleanupMinutes, meetingId
  ).run();
  const id = insert.meta?.last_row_id;
  if (typeof id !== "number") throw new Error("booking_insert_failed");
  return { reference: String(id), ...input };
}

/** Frigiv salen. Det er ikke en fejl, at der ikke var noget at frigive. */
export async function releaseForMeeting(db: D1Database, meetingId: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE room_bookings SET status = 'cancelled', cancelled_at_ms = ?, updated_at_ms = ? WHERE cirkler_meeting_id = ? AND status = 'scheduled'`
  ).bind(now, now, meetingId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function handleReservationRequest(request: Request, db: D1Database, now: number): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/integrations/cirkler/room-day") {
    const date = url.searchParams.get("date") ?? "";
    const external = await getExternalEvents().catch(() => []);
    const items = await listDayItems(db, CIRKLER_OWNER, date, external);
    if (!items) return json({ error: "invalid_date" }, { status: 400 });
    // CIRKLERs egne reservationer står med mødets id, så planlæggeren kan se bort fra det møde, der rettes.
    const rows = (await db.prepare(
      "SELECT id, cirkler_meeting_id FROM room_bookings WHERE clerk_user_id = ? AND cirkler_meeting_id IS NOT NULL AND status = 'scheduled'"
    ).bind(CIRKLER_OWNER).all<{ id: number; cirkler_meeting_id: string }>()).results ?? [];
    const meetingById = new Map(rows.map((row) => [row.id, row.cirkler_meeting_id]));
    // Hjerterums egne aktiviteter er ikke CIRKLERs sag (Jake 2026-11-01): kun tidsrummet
    // sendes, aldrig titlen. Cirklens deltagere ser blot, at salen er optaget.
    return json({ date, items: items.map((item) => item.own && item.id !== undefined
      ? { ...item, meetingId: meetingById.get(item.id) ?? null }
      : { ...item, label: BUSY_LABEL }) });
  }
  const match = /^\/api\/integrations\/cirkler\/reservations\/([^/]+)$/.exec(url.pathname);
  if (!match) return json({ error: "not_found" }, { status: 404 });
  const meetingId = decodeURIComponent(match[1] ?? "");
  if (!MEETING_ID.test(meetingId)) return json({ error: "invalid_meeting_id" }, { status: 400 });
  if (request.method === "DELETE") {
    const released = await releaseForMeeting(db, meetingId, now);
    return json({ released });
  }
  if (request.method === "PUT") {
    const body = await request.json().catch(() => null);
    const input = parseReservationInput(body, now);
    if ("error" in input) return json({ error: input.error }, { status: 400 });
    try {
      return json(await reserveForMeeting(db, meetingId, input, now));
    } catch (error) {
      const code = error instanceof Error ? error.message : "booking_failed";
      if (code === "booking_conflict") return json({ error: code }, { status: 409 });
      return json({ error: code }, { status: 503 });
    }
  }
  return json({ error: "not_found" }, { status: 404 });
}
