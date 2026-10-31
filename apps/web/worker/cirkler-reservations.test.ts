import { describe, expect, it, vi } from "vitest";
import type { D1Database, D1PreparedStatement } from "./db.js";
import { handleCirklerIntegrationRequest } from "./cirkler-integration.js";
import { BUSY_LABEL, CIRKLER_OWNER, CIRKLER_TITLE, parseReservationInput, releaseForMeeting, reserveForMeeting } from "./cirkler-reservations.js";

vi.mock("./external-events.js", () => ({
  getExternalEvents: async () => [],
  hasExternalEventConflict: async () => false
}));

type Booking = {
  id: number; clerk_user_id: string; title: string; starts_at_ms: number; ends_at_ms: number; setup_minutes: number; cleanup_minutes: number;
  status: string; review_status: string; cirkler_meeting_id: string | null; cancelled_at_ms: number | null;
};

/** Lige nok af D1 til reservationerne: rækker i hukommelsen og de få forespørgsler, koden stiller. */
class MemoryDb implements D1Database {
  bookings: Booking[] = [];
  nextId = 1;
  prepare(query: string): D1PreparedStatement { return new Stmt(this, query); }
}

class Stmt implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryDb, private readonly query: string) {}
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  private window(row: Booking) { return { from: row.starts_at_ms - row.setup_minutes * 60000, to: row.ends_at_ms + row.cleanup_minutes * 60000 }; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const q = this.query;
    if (q.includes("WHERE cirkler_meeting_id = ?")) {
      const row = this.db.bookings.find((b) => b.cirkler_meeting_id === this.values[0]);
      return (row ? { id: row.id, status: row.status } : null) as T | null;
    }
    if (q.includes("LIMIT 1")) {
      const [meetingId, toMs, fromMs] = this.values as [string, number, number];
      const hit = this.db.bookings.find((b) => b.status === "scheduled" && b.cirkler_meeting_id !== meetingId && this.window(b).from < toMs && this.window(b).to > fromMs);
      return (hit ? { id: hit.id } : null) as T | null;
    }
    return null;
  }
  async all<T = Record<string, unknown>>() {
    const q = this.query;
    if (q.includes("FROM room_bookings") && q.includes("review_status FROM")) {
      const [toMs, fromMs] = this.values as [number, number];
      const results = this.db.bookings.filter((b) => b.status === "scheduled" && this.window(b).from < toMs && this.window(b).to > fromMs)
        .map((b) => ({ id: b.id, clerk_user_id: b.clerk_user_id, title: b.title, starts_at_ms: this.window(b).from, ends_at_ms: this.window(b).to, review_status: b.review_status }));
      return { results: results as T[] };
    }
    if (q.includes("cirkler_meeting_id IS NOT NULL")) {
      return { results: this.db.bookings.filter((b) => b.cirkler_meeting_id && b.status === "scheduled").map((b) => ({ id: b.id, cirkler_meeting_id: b.cirkler_meeting_id })) as T[] };
    }
    return { results: [] as T[] };
  }
  async run<T = unknown>() {
    const q = this.query;
    if (q.startsWith("INSERT INTO room_bookings")) {
      const v = this.values;
      const row: Booking = { id: this.db.nextId++, clerk_user_id: v[0] as string, title: v[3] as string, starts_at_ms: v[4] as number, ends_at_ms: v[5] as number, status: "scheduled", review_status: "approved", setup_minutes: v[11] as number, cleanup_minutes: v[12] as number, cirkler_meeting_id: v[13] as string, cancelled_at_ms: null };
      this.db.bookings.push(row);
      return { success: true, results: [] as T[], meta: { last_row_id: row.id, changes: 1 } };
    }
    if (q.startsWith("UPDATE room_bookings SET starts_at_ms")) {
      const [s, e, setup, cleanup, , id] = this.values as [number, number, number, number, number, number];
      const row = this.db.bookings.find((b) => b.id === id)!;
      Object.assign(row, { starts_at_ms: s, ends_at_ms: e, setup_minutes: setup, cleanup_minutes: cleanup, status: "scheduled", cancelled_at_ms: null });
      return { success: true, results: [] as T[], meta: { changes: 1 } };
    }
    if (q.startsWith("UPDATE room_bookings SET status = 'cancelled'")) {
      const meetingId = this.values[2];
      const rows = this.db.bookings.filter((b) => b.cirkler_meeting_id === meetingId && b.status === "scheduled");
      for (const row of rows) { row.status = "cancelled"; row.cancelled_at_ms = this.values[0] as number; }
      return { success: true, results: [] as T[], meta: { changes: rows.length } };
    }
    return { success: true, results: [] as T[], meta: { changes: 0 } };
  }
}

// En onsdag aften i Danmark: 19.00 til 21.30 med en halv times klargøring og oprydning (2 timer og 30 min. + 1 time = 3,5 timer).
const NOW = Date.parse("2027-01-04T10:00:00Z");
const start = "2027-01-13T18:00:00.000Z"; // 19.00 dansk tid
const end = "2027-01-13T20:30:00.000Z";   // 21.30 dansk tid

describe("CIRKLER reservations", () => {
  it("follows Hjerterum's rules: whole half hours, at least two hours, not across 18.30 on a weekday", () => {
    expect(parseReservationInput({ startsAt: start, endsAt: end, setupMinutes: 30, cleanupMinutes: 30 }, NOW)).toMatchObject({ setupMinutes: 30 });
    expect(parseReservationInput({ startsAt: start, endsAt: "2027-01-13T18:40:00.000Z", setupMinutes: 0, cleanupMinutes: 0 }, NOW)).toEqual({ error: "invalid_duration_too_short" });
    expect(parseReservationInput({ startsAt: start, endsAt: "2027-01-13T20:40:00.000Z", setupMinutes: 0, cleanupMinutes: 0 }, NOW)).toEqual({ error: "invalid_duration_not_half_hours" });
    expect(parseReservationInput({ startsAt: "2027-01-13T16:00:00.000Z", endsAt: "2027-01-13T19:00:00.000Z", setupMinutes: 0, cleanupMinutes: 0 }, NOW)).toEqual({ error: "invalid_crosses_a_time_boundary" });
    expect(parseReservationInput({ startsAt: start, endsAt: end, setupMinutes: 20, cleanupMinutes: 0 }, NOW)).toEqual({ error: "invalid_setup_minutes" });
    expect(parseReservationInput({ startsAt: "2026-01-13T18:00:00.000Z", endsAt: "2026-01-13T20:30:00.000Z", setupMinutes: 0, cleanupMinutes: 0 }, NOW)).toEqual({ error: "invalid_booking_start" });
  });

  it("reserves once per meeting, moves the same reservation and releases it", async () => {
    const db = new MemoryDb();
    const input = { startsAt: start, endsAt: end, setupMinutes: 30, cleanupMinutes: 30 };
    const first = await reserveForMeeting(db, "m-1", input, NOW);
    const again = await reserveForMeeting(db, "m-1", { ...input, startsAt: "2027-01-13T18:30:00.000Z", endsAt: "2027-01-13T21:00:00.000Z" }, NOW);
    expect(again.reference).toBe(first.reference);
    expect(db.bookings).toHaveLength(1);
    expect(db.bookings[0]).toMatchObject({ clerk_user_id: CIRKLER_OWNER, title: CIRKLER_TITLE, starts_at_ms: Date.parse("2027-01-13T18:30:00.000Z"), cirkler_meeting_id: "m-1" });
    expect(await releaseForMeeting(db, "m-1", NOW)).toBe(true);
    expect(db.bookings[0]).toMatchObject({ status: "cancelled" });
    expect(await releaseForMeeting(db, "m-1", NOW)).toBe(false);
  });

  it("refuses when setup or cleanup overlaps another booking, but not the meeting's own reservation", async () => {
    const db = new MemoryDb();
    db.bookings.push({ id: 50, clerk_user_id: "user_9", title: "Qi Gong", starts_at_ms: Date.parse("2027-01-13T16:00:00.000Z"), ends_at_ms: Date.parse("2027-01-13T17:45:00.000Z"), setup_minutes: 0, cleanup_minutes: 30, status: "scheduled", review_status: "approved", cirkler_meeting_id: null, cancelled_at_ms: null });
    db.nextId = 51;
    // Oprydningen efter Qi Gong slutter 18.15 UTC; klargøringen til mødet begynder 17.30 UTC.
    await expect(reserveForMeeting(db, "m-2", { startsAt: start, endsAt: end, setupMinutes: 30, cleanupMinutes: 30 }, NOW)).rejects.toThrow("booking_conflict");
    const ok = await reserveForMeeting(db, "m-2", { startsAt: "2027-01-13T18:30:00.000Z", endsAt: "2027-01-13T21:00:00.000Z", setupMinutes: 0, cleanupMinutes: 30 }, NOW);
    expect(ok.reference).toBe("51");
    await expect(reserveForMeeting(db, "m-2", { startsAt: "2027-01-13T18:30:00.000Z", endsAt: "2027-01-13T21:00:00.000Z", setupMinutes: 15, cleanupMinutes: 30 }, NOW)).resolves.toMatchObject({ reference: "51" });
  });

  it("answers the day's calendar and the reservation endpoints only with the service key", async () => {
    const db = new MemoryDb();
    // En medlemsbooking samme morgen: CIRKLER får tidsrummet, men aldrig titlen.
    db.bookings.push({ id: 7, clerk_user_id: "user_9", title: "Hjerterum Medlemscafé", starts_at_ms: Date.parse("2027-01-13T08:00:00.000Z"), ends_at_ms: Date.parse("2027-01-13T10:00:00.000Z"), setup_minutes: 0, cleanup_minutes: 0, status: "scheduled", review_status: "approved", cirkler_meeting_id: null, cancelled_at_ms: null });
    db.nextId = 1;
    const env = { DB: db, CIRKLER_SERVICE_KEY: "delt-nogle" };
    const deps = { now: () => NOW };
    const call = (method: string, path: string, body?: unknown, key = "delt-nogle") => handleCirklerIntegrationRequest(
      new Request(`https://hjerterum.example${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? null : JSON.stringify(body) }), env, deps
    );
    expect((await call("GET", "/api/integrations/cirkler/room-day?date=2027-01-13", undefined, "forkert")).status).toBe(401);
    expect((await call("PUT", "/api/integrations/cirkler/reservations/00000000-0000-4000-8000-000000000003", { startsAt: start, endsAt: end }, "forkert")).status).toBe(401);
    expect((await call("GET", "/api/integrations/cirkler/room-day?date=13-01-2027")).status).toBe(400);
    expect((await call("PUT", "/api/integrations/cirkler/reservations/x", { startsAt: start, endsAt: end })).status).toBe(400);

    const reserved = await call("PUT", "/api/integrations/cirkler/reservations/00000000-0000-4000-8000-000000000003", { startsAt: start, endsAt: end, setupMinutes: 30, cleanupMinutes: 30 });
    expect(reserved.status).toBe(200);
    expect(await reserved.json()).toMatchObject({ reference: "1", startsAt: start, endsAt: end, setupMinutes: 30, cleanupMinutes: 30 });

    const day = await call("GET", "/api/integrations/cirkler/room-day?date=2027-01-13");
    expect(day.status).toBe(200);
    const { items } = await day.json() as { items: Array<Record<string, unknown>> };
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ label: BUSY_LABEL, own: false, external: false, waiting: false, startsAt: "2027-01-13T08:00:00.000Z", endsAt: "2027-01-13T10:00:00.000Z" });
    expect(items[1]).toMatchObject({ label: CIRKLER_TITLE, own: true, id: 1, meetingId: "00000000-0000-4000-8000-000000000003", startsAt: "2027-01-13T17:30:00.000Z", endsAt: "2027-01-13T21:00:00.000Z" });

    const clash = await call("PUT", "/api/integrations/cirkler/reservations/00000000-0000-4000-8000-000000000004", { startsAt: start, endsAt: end, setupMinutes: 0, cleanupMinutes: 0 });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: "booking_conflict" });

    const released = await call("DELETE", "/api/integrations/cirkler/reservations/00000000-0000-4000-8000-000000000003");
    expect(await released.json()).toEqual({ released: true });
    expect((await (await call("GET", "/api/integrations/cirkler/room-day?date=2027-01-13")).json() as { items: unknown[] }).items).toHaveLength(1);
  });
});
