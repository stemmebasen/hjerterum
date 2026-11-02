import { describe, expect, it } from "vitest";
import { publicEvent, signUpGuest } from "./guest-signup.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas' notes: "Do they have to be a member to book an event?" - "Som gæst uden login".
describe("signing up as a guest", () => {
  const now = Date.now();
  async function event(db: ReturnType<typeof testDatabase>, fields: { max?: number | null; ticket?: number; nonMember?: number | null; review?: string } = {}) {
    const result = await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, max_attendees, ticket_price_minor, non_member_price_minor, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('teacher', 'Anna', 'anna@x.dk', 'Lydbad', ?, ?, ?, ?, ?, ?, 'scheduled', 1, 1)`).bind(now + 86_400_000, now + 90_000_000, fields.max ?? null, fields.ticket ?? 0, fields.nonMember ?? null, fields.review ?? "approved").run();
    return Number(result.meta!.last_row_id);
  }
  const form = (extra: Record<string, unknown> = {}) => ({ name: "Bo Jensen", email: " Bo@Example.dk ", started: now - 10_000, ...extra });

  it("signs up a guest without login, once per e-mail, and counts the seat", async () => {
    const db = testDatabase();
    const id = await event(db, { max: 2 });
    expect(await signUpGuest(db, id, form(), now)).toEqual({ ok: true, confirmed: true });
    expect(await db.prepare("SELECT clerk_user_id, member_name, member_email, registration_status FROM room_booking_attendees WHERE room_booking_id = ?").bind(id).first())
      .toEqual({ clerk_user_id: "guest:bo@example.dk", member_name: "Bo Jensen", member_email: "bo@example.dk", registration_status: "confirmed" });
    expect(await signUpGuest(db, id, form(), now)).toMatchObject({ error: "already_attending", status: 409 });
    expect((await publicEvent(db, id))?.taken).toBe(1);
    expect(await signUpGuest(db, id, form({ email: "eva@x.dk", name: "Eva" }), now)).toEqual({ ok: true, confirmed: true });
    expect(await signUpGuest(db, id, form({ email: "ole@x.dk", name: "Ole" }), now)).toMatchObject({ error: "booking_full" });
  });

  it("thanks a robot without signing it up, and asks for a name and an e-mail", async () => {
    const db = testDatabase();
    const id = await event(db);
    expect(await signUpGuest(db, id, form({ website: "spam" }), now)).toEqual({ ok: true, ignored: true });
    expect(await signUpGuest(db, id, form({ started: now }), now)).toEqual({ ok: true, ignored: true });
    expect(await signUpGuest(db, id, form({ email: "nope" }), now)).toMatchObject({ error: "missing_fields", status: 400 });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM room_booking_attendees").first<{ n: number }>())!.n).toBe(0);
  });

  it("waits with paid tickets for non-members, and shows only approved events", async () => {
    const db = testDatabase();
    expect(await signUpGuest(db, await event(db, { ticket: 10_000, nonMember: 15_000 }), form(), now)).toMatchObject({ error: "non_member_payment_unavailable", status: 409 });
    const pending = await event(db, { review: "pending" });
    expect(await publicEvent(db, pending)).toBeNull();
    expect(await signUpGuest(db, pending, form(), now)).toMatchObject({ error: "booking_not_found", status: 404 });
  });
});
