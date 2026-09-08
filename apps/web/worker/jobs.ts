import type { D1Database } from "./db.js";
import { stripeRequest } from "./stripe.js";

type DueBooking = {
  id: number;
  event_name: string | null;
  start_date_ms: number;
  amount_dkk_minor: number;
  stripe_customer_id: string;
  default_payment_method_id: string;
};

async function claimBooking(db: D1Database, booking: DueBooking): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO job_claims
       (job_key, scheduled_for_ms, status, claimed_at_ms)
       VALUES (?, ?, 'claimed', ?)`
    )
    .bind(`teacher-charge:${booking.id}`, booking.start_date_ms, Date.now())
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function finishClaim(
  db: D1Database,
  booking: DueBooking,
  status: "completed" | "failed",
  error?: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE job_claims
       SET status = ?, completed_at_ms = ?, last_error = ?
       WHERE job_key = ? AND scheduled_for_ms = ?`
    )
    .bind(
      status,
      Date.now(),
      error?.slice(0, 1000) ?? null,
      `teacher-charge:${booking.id}`,
      booking.start_date_ms
    )
    .run();
}

export async function runTeacherAutoCharge(
  db: D1Database,
  stripeSecretKey: string,
  scheduledTimeMs: number
): Promise<{ processed: number; charged: number; failed: number }> {
  const windowMs = 5 * 60_000;
  const rows = await db
    .prepare(
      `SELECT b.id, b.event_name, b.start_date_ms, b.amount_dkk_minor,
              t.stripe_customer_id, t.default_payment_method_id
       FROM bookings b
       JOIN teachers t ON t.id = b.teacher_id
       WHERE b.payment_status = 'card_saved'
         AND b.start_date_ms BETWEEN ? AND ?
         AND t.stripe_customer_id IS NOT NULL
         AND t.default_payment_method_id IS NOT NULL`
    )
    .bind(scheduledTimeMs - windowMs, scheduledTimeMs + windowMs)
    .all<DueBooking>();

  let processed = 0;
  let charged = 0;
  let failed = 0;

  for (const booking of rows.results ?? []) {
    if (!(await claimBooking(db, booking))) continue;
    processed += 1;

    try {
      if (!Number.isInteger(booking.amount_dkk_minor) || booking.amount_dkk_minor <= 0) {
        throw new Error("invalid_booking_amount");
      }

      const paymentIntent = await stripeRequest<{ id?: string }>(
        stripeSecretKey,
        "POST",
        "/payment_intents",
        {
          amount: booking.amount_dkk_minor,
          currency: "dkk",
          customer: booking.stripe_customer_id,
          payment_method: booking.default_payment_method_id,
          confirm: true,
          off_session: true,
          description: booking.event_name ?? `Hjerterum booking ${booking.id}`,
          "metadata[booking_id]": booking.id
        },
        { idempotencyKey: `hjerterum-teacher-charge-${booking.id}-${booking.start_date_ms}` }
      );

      if (!paymentIntent.id) throw new Error("stripe_payment_intent_missing");
      await db
        .prepare(
          `UPDATE bookings
           SET payment_status = 'charged', stripe_charge_id = ?, failure_reason = NULL,
               updated_at_ms = ?
           WHERE id = ?`
        )
        .bind(paymentIntent.id, Date.now(), booking.id)
        .run();
      await finishClaim(db, booking, "completed");
      charged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "teacher_charge_failed";
      await db
        .prepare(
          `UPDATE bookings
           SET payment_status = 'failed', failure_reason = ?, updated_at_ms = ?
           WHERE id = ?`
        )
        .bind(message.slice(0, 1000), Date.now(), booking.id)
        .run();
      await finishClaim(db, booking, "failed", message);
      failed += 1;
    }
  }

  return { processed, charged, failed };
}
