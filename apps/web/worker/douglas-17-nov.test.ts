import { describe, expect, it } from "vitest";
import { attendRoomBooking, unattendRoomBooking } from "./room-bookings.js";
import { memberNewsletter } from "./mailchimp-sync.js";
import { rowWhen, spansDays } from "../src/event-row.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas' email nr. 9 (17 Nov 2026).
describe("Douglas' email nr. 9", () => {
  it("lets an organiser who signed up for their own event cancel it again (\"nothing seems to happen\")", async () => {
    const db = testDatabase();
    const start = Date.now() + 10 * 86_400_000;
    const id = Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('douglas', 'Douglas', 'd@x.dk', 'Test', ?, ?, 'approved', 'scheduled', 1, 1)`).bind(start, start + 3_600_000).run()).meta!.last_row_id);
    await attendRoomBooking(db, "douglas", id, { memberName: "Douglas", memberEmail: "d@x.dk" });
    await unattendRoomBooking(db, "douglas", id);
    expect((await db.prepare("SELECT registration_status FROM room_booking_attendees WHERE room_booking_id = ?").bind(id).first<{ registration_status: string }>())!.registration_status).toBe("cancelled");
  });

  it("turns the newsletter off in Min profil also before Mailchimp is connected", async () => {
    const db = testDatabase();
    const env = { DB: db } as never, deps = { fetcher: fetch, now: () => 1 };
    const me = { email: "lise@x.dk", name: "Lise" };
    expect(await memberNewsletter(env, deps, me, true)).toEqual({ subscribed: true });
    expect(await memberNewsletter(env, deps, me)).toEqual({ subscribed: true });
    expect(await memberNewsletter(env, deps, me, false)).toEqual({ subscribed: false });
    expect(await memberNewsletter(env, deps, me)).toEqual({ subscribed: false });
  });

  it("shows a weekend course with both its days (\"only the Saturday\")", () => {
    expect(spansDays("2026-11-28T09:00:00Z", "2026-11-29T17:00:00Z")).toBe(true);
    expect(rowWhen("2026-11-28T09:00:00Z", "2026-11-29T17:00:00Z")).toBe("Lørdag 10.00 – søndag 18.00");
    expect(rowWhen("2026-11-28T09:00:00Z", "2026-11-28T17:00:00Z")).toBe("Lørdag 10.00–18.00");
  });
});
