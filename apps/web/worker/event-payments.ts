import type { D1Database } from "./db.js";
import { stripeRequest, stripeV2Request, type StripeEvent } from "./stripe.js";

const PLATFORM_FEE_PERCENT = 5;
const CHECKOUT_RESERVATION_MINUTES = 31;

type PayoutRow = {
  stripe_account_id: string;
  status: string;
  details_submitted: number;
  charges_enabled: number;
  payouts_enabled: number;
};

type StripeAccount = {
  id: string;
  details_submitted?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
};

function payoutStatus(account: StripeAccount): "pending" | "active" | "restricted" {
  if (account.charges_enabled && account.payouts_enabled) return "active";
  if (account.details_submitted) return "restricted";
  return "pending";
}

async function savePayoutState(
  db: D1Database,
  clerkUserId: string,
  account: StripeAccount
): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO member_payout_accounts
     (clerk_user_id, stripe_account_id, status, details_submitted,
      charges_enabled, payouts_enabled, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(clerk_user_id) DO UPDATE SET
       stripe_account_id = excluded.stripe_account_id,
       status = excluded.status,
       details_submitted = excluded.details_submitted,
       charges_enabled = excluded.charges_enabled,
       payouts_enabled = excluded.payouts_enabled,
       updated_at_ms = excluded.updated_at_ms`
  ).bind(
    clerkUserId,
    account.id,
    payoutStatus(account),
    account.details_submitted ? 1 : 0,
    account.charges_enabled ? 1 : 0,
    account.payouts_enabled ? 1 : 0,
    now,
    now
  ).run();
}

export async function getPayoutAccount(
  db: D1Database,
  stripeSecretKey: string,
  clerkUserId: string
): Promise<{
  status: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
} | null> {
  const stored = await db.prepare(
    `SELECT stripe_account_id, status, details_submitted, charges_enabled, payouts_enabled
     FROM member_payout_accounts WHERE clerk_user_id = ? LIMIT 1`
  ).bind(clerkUserId).first<PayoutRow>();
  if (!stored) return null;

  const account = await stripeRequest<StripeAccount>(
    stripeSecretKey,
    "GET",
    `/accounts/${encodeURIComponent(stored.stripe_account_id)}`
  );
  await savePayoutState(db, clerkUserId, account);
  return {
    status: payoutStatus(account),
    detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true
  };
}

export async function createPayoutOnboarding(
  db: D1Database,
  stripeSecretKey: string,
  appBaseUrl: string,
  clerkUserId: string,
  member: { fullName: string; email: string }
): Promise<{ onboardingUrl: string }> {
  let stored = await db.prepare(
    "SELECT stripe_account_id FROM member_payout_accounts WHERE clerk_user_id = ? LIMIT 1"
  ).bind(clerkUserId).first<{ stripe_account_id: string }>();

  if (!stored) {
    const created = await stripeV2Request<{ id: string }>(
      stripeSecretKey,
      "POST",
      "/core/accounts",
      {
        contact_email: member.email,
        display_name: member.fullName,
        dashboard: "full",
        identity: { country: "dk" },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true }
            }
          }
        },
        defaults: {
          currency: "dkk",
          locales: ["da-DK"],
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe"
          }
        },
        include: ["configuration.merchant", "defaults"]
      },
      { idempotencyKey: `hjerterum-payout-${clerkUserId}` }
    );
    await savePayoutState(db, clerkUserId, { id: created.id });
    stored = { stripe_account_id: created.id };
  }

  const base = appBaseUrl.replace(/\/$/, "");
  const link = await stripeRequest<{ url?: string }>(
    stripeSecretKey,
    "POST",
    "/account_links",
    {
      account: stored.stripe_account_id,
      refresh_url: `${base}/member-portal/events?stripe=refresh`,
      return_url: `${base}/member-portal/events?stripe=return`,
      type: "account_onboarding",
      "collection_options[fields]": "eventually_due"
    }
  );
  if (!link.url) throw new Error("stripe_onboarding_url_missing");
  return { onboardingUrl: link.url };
}

export async function requireActivePayoutAccount(
  db: D1Database,
  stripeSecretKey: string,
  clerkUserId: string
): Promise<string> {
  const row = await db.prepare(
    "SELECT stripe_account_id FROM member_payout_accounts WHERE clerk_user_id = ? LIMIT 1"
  ).bind(clerkUserId).first<{ stripe_account_id: string }>();
  if (!row) throw new Error("payout_onboarding_required");
  const account = await stripeRequest<StripeAccount>(
    stripeSecretKey,
    "GET",
    `/accounts/${encodeURIComponent(row.stripe_account_id)}`
  );
  await savePayoutState(db, clerkUserId, account);
  if (!account.charges_enabled || !account.payouts_enabled) {
    throw new Error("payout_onboarding_required");
  }
  return account.id;
}

export function calculateEventFees(ticketAmountMinor: number, handlingFeeMinor: number): {
  platformShareMinor: number;
  applicationFeeMinor: number;
  buyerTotalMinor: number;
} {
  const platformShareMinor = Math.round(ticketAmountMinor * PLATFORM_FEE_PERCENT / 100);
  return {
    platformShareMinor,
    applicationFeeMinor: platformShareMinor + handlingFeeMinor,
    buyerTotalMinor: ticketAmountMinor + handlingFeeMinor
  };
}

export async function getHandlingFeeMinor(db: D1Database): Promise<number> {
  const row = await db.prepare(
    "SELECT setting_value FROM platform_settings WHERE setting_key = 'event_transaction_fee_minor'"
  ).first<{ setting_value: string }>();
  const value = Number(row?.setting_value ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function setHandlingFeeMinor(
  db: D1Database,
  value: unknown,
  adminEmail: string
): Promise<{ handlingFeeMinor: number }> {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const amount = Number((value as Record<string, unknown>).handlingFeeMinor);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000) {
    throw new Error("invalid_handling_fee");
  }
  await db.prepare(
    `UPDATE platform_settings
     SET setting_value = ?, updated_by_email = ?, updated_at_ms = ?
     WHERE setting_key = 'event_transaction_fee_minor'`
  ).bind(String(amount), adminEmail, Date.now()).run();
  return { handlingFeeMinor: amount };
}

export async function createEventCheckout(
  db: D1Database,
  stripeSecretKey: string,
  appBaseUrl: string,
  bookingId: number,
  clerkUserId: string,
  attendee: { fullName: string; email: string }
): Promise<{ checkoutUrl?: string; status: "attending" | "payment_required" }> {
  const booking = await db.prepare(
    `SELECT rb.id, rb.title, rb.starts_at_ms, rb.max_attendees, rb.ticket_price_minor,
            pa.stripe_account_id
     FROM room_bookings rb
     JOIN member_payout_accounts pa ON pa.clerk_user_id = rb.payout_clerk_user_id
     WHERE rb.id = ? AND rb.status = 'scheduled' AND rb.starts_at_ms > ?
       AND pa.status = 'active'`
  ).bind(bookingId, Date.now()).first<{
    id: number;
    title: string;
    starts_at_ms: number;
    max_attendees: number | null;
    ticket_price_minor: number;
    stripe_account_id: string;
  }>();
  if (!booking) throw new Error("booking_not_found");
  if (booking.ticket_price_minor <= 0) throw new Error("event_payment_not_required");

  const handlingFeeMinor = await getHandlingFeeMinor(db);
  const { applicationFeeMinor } = calculateEventFees(
    booking.ticket_price_minor,
    handlingFeeMinor
  );
  const expiresAt = Date.now() + CHECKOUT_RESERVATION_MINUTES * 60_000;
  const now = Date.now();

  const existing = await db.prepare(
    `SELECT id, registration_status, expires_at_ms
     FROM room_booking_attendees
     WHERE room_booking_id = ? AND clerk_user_id = ? LIMIT 1`
  ).bind(bookingId, clerkUserId).first<{
    id: number;
    registration_status: string;
    expires_at_ms: number | null;
  }>();
  if (existing?.registration_status === "confirmed") throw new Error("already_attending");

  let registrationId: number;
  if (existing) {
    const reserved = await db.prepare(
      `UPDATE room_booking_attendees
       SET member_name = ?, member_email = ?, registration_status = 'pending',
           stripe_checkout_session_id = NULL, ticket_amount_minor = ?,
           handling_fee_minor = ?, platform_fee_minor = ?, expires_at_ms = ?,
           cancelled_at_ms = NULL
       WHERE id = ? AND (
         registration_status = 'cancelled' OR
         (registration_status = 'pending' AND COALESCE(expires_at_ms, 0) <= ?)
       ) AND (
         (SELECT max_attendees FROM room_bookings WHERE id = ?) IS NULL OR
         (SELECT COUNT(*) FROM room_booking_attendees
          WHERE room_booking_id = ? AND id <> ? AND (
            registration_status = 'confirmed' OR
            (registration_status = 'pending' AND expires_at_ms > ?)
          )) <
         (SELECT max_attendees FROM room_bookings WHERE id = ?)
       )`
    ).bind(
      attendee.fullName, attendee.email, booking.ticket_price_minor,
      handlingFeeMinor, applicationFeeMinor, expiresAt, existing.id, now,
      bookingId, bookingId, existing.id, now, bookingId
    ).run();
    if ((reserved.meta?.changes ?? 0) === 0) throw new Error("booking_full_or_pending");
    registrationId = existing.id;
  } else {
    const reserved = await db.prepare(
      `INSERT INTO room_booking_attendees
       (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms,
        registration_status, ticket_amount_minor, handling_fee_minor,
        platform_fee_minor, expires_at_ms)
       SELECT id, ?, ?, ?, ?, 'pending', ?, ?, ?, ?
       FROM room_bookings
       WHERE id = ? AND status = 'scheduled' AND starts_at_ms > ?
         AND (
           max_attendees IS NULL OR
           (SELECT COUNT(*) FROM room_booking_attendees
            WHERE room_booking_id = ? AND (
              registration_status = 'confirmed' OR
              (registration_status = 'pending' AND expires_at_ms > ?)
            )) < max_attendees
         )`
    ).bind(
      clerkUserId, attendee.fullName, attendee.email, now,
      booking.ticket_price_minor, handlingFeeMinor, applicationFeeMinor, expiresAt,
      bookingId, now, bookingId, now
    ).run();
    if ((reserved.meta?.changes ?? 0) === 0) throw new Error("booking_full");
    const id = reserved.meta?.last_row_id;
    if (typeof id !== "number") throw new Error("registration_reservation_failed");
    registrationId = id;
  }

  try {
    const base = appBaseUrl.replace(/\/$/, "");
    const session = await stripeRequest<{ id?: string; url?: string }>(
      stripeSecretKey,
      "POST",
      "/checkout/sessions",
      {
        mode: "payment",
        success_url: `${base}/member-portal/kalender?payment=success`,
        cancel_url: `${base}/member-portal/kalender?payment=cancelled`,
        customer_email: attendee.email,
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": "dkk",
        "line_items[0][price_data][unit_amount]": booking.ticket_price_minor,
        "line_items[0][price_data][product_data][name]": booking.title,
        ...(handlingFeeMinor > 0 ? {
          "line_items[1][quantity]": 1,
          "line_items[1][price_data][currency]": "dkk",
          "line_items[1][price_data][unit_amount]": handlingFeeMinor,
          "line_items[1][price_data][product_data][name]": "Håndteringsgebyr"
        } : {}),
        "payment_intent_data[application_fee_amount]": applicationFeeMinor,
        "metadata[booking_id]": String(bookingId),
        "metadata[clerk_user_id]": clerkUserId,
        "metadata[registration_id]": String(registrationId),
        expires_at: Math.floor(expiresAt / 1000)
      },
      {
        connectedAccount: booking.stripe_account_id,
        idempotencyKey: `event-registration-${registrationId}-${expiresAt}`
      }
    );
    if (!session.id || !session.url) throw new Error("stripe_checkout_url_missing");
    await db.prepare(
      "UPDATE room_booking_attendees SET stripe_checkout_session_id = ? WHERE id = ?"
    ).bind(session.id, registrationId).run();
    return { checkoutUrl: session.url, status: "payment_required" };
  } catch (error) {
    await db.prepare(
      `UPDATE room_booking_attendees
       SET registration_status = 'cancelled', cancelled_at_ms = ?, expires_at_ms = NULL
       WHERE id = ? AND registration_status = 'pending'`
    ).bind(Date.now(), registrationId).run();
    throw error;
  }
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  return typeof object[key] === "string" ? object[key] as string : undefined;
}

export async function processEventPaymentWebhook(
  db: D1Database,
  event: StripeEvent
): Promise<{ duplicate: boolean }> {
  const claimed = await db.prepare(
    `INSERT OR IGNORE INTO webhook_events
     (provider, event_id, event_type, first_seen_at_ms)
     VALUES ('stripe_event', ?, ?, ?)`
  ).bind(event.id, event.type, Date.now()).run();
  if ((claimed.meta?.changes ?? 0) === 0) return { duplicate: true };

  try {
    const object = event.data?.object ?? {};
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    const registrationId = Number(stringField(metadata, "registration_id"));
    const bookingId = Number(stringField(metadata, "booking_id"));
    const clerkUserId = stringField(metadata, "clerk_user_id");
    const sessionId = stringField(object, "id");
    const paymentIntentId = stringField(object, "payment_intent");
    const paymentStatus = stringField(object, "payment_status");

    if (!Number.isInteger(registrationId) || !Number.isInteger(bookingId) ||
        !clerkUserId || !sessionId || !event.account) {
      throw new Error("event_checkout_metadata_incomplete");
    }

    const registration = await db.prepare(
      `SELECT a.id, a.room_booking_id, a.clerk_user_id, a.stripe_checkout_session_id,
              p.stripe_account_id
       FROM room_booking_attendees a
       JOIN room_bookings b ON b.id = a.room_booking_id
       JOIN member_payout_accounts p ON p.clerk_user_id = b.payout_clerk_user_id
       WHERE a.id = ?`
    ).bind(registrationId).first<{
      id: number;
      room_booking_id: number;
      clerk_user_id: string;
      stripe_checkout_session_id: string | null;
      stripe_account_id: string;
    }>();

    if (!registration ||
        registration.room_booking_id !== bookingId ||
        registration.clerk_user_id !== clerkUserId ||
        registration.stripe_account_id !== event.account ||
        (registration.stripe_checkout_session_id &&
          registration.stripe_checkout_session_id !== sessionId)) {
      throw new Error("event_checkout_mismatch");
    }

    const succeeded = event.type === "checkout.session.async_payment_succeeded" ||
      (event.type === "checkout.session.completed" && paymentStatus === "paid");
    if (succeeded) {
      const result = await db.prepare(
        `UPDATE room_booking_attendees
         SET registration_status = 'confirmed', stripe_checkout_session_id = ?,
             stripe_payment_intent_id = ?, confirmed_at_ms = ?, expires_at_ms = NULL
         WHERE id = ? AND registration_status = 'pending'`
      ).bind(sessionId, paymentIntentId ?? null, Date.now(), registrationId).run();
      if ((result.meta?.changes ?? 0) === 0) {
        const current = await db.prepare(
          "SELECT registration_status FROM room_booking_attendees WHERE id = ?"
        ).bind(registrationId).first<{ registration_status: string }>();
        if (current?.registration_status !== "confirmed") {
          throw new Error("event_registration_not_pending");
        }
      }
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await db.prepare(
        `UPDATE room_booking_attendees
         SET registration_status = 'cancelled', cancelled_at_ms = ?, expires_at_ms = NULL
         WHERE id = ? AND registration_status = 'pending'`
      ).bind(Date.now(), registrationId).run();
    }

    await db.prepare(
      `UPDATE webhook_events SET status = 'processed', processed_at_ms = ?
       WHERE provider = 'stripe_event' AND event_id = ?`
    ).bind(Date.now(), event.id).run();
    return { duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "event_payment_webhook_failed";
    await db.prepare(
      `UPDATE webhook_events SET status = 'failed', last_error = ?
       WHERE provider = 'stripe_event' AND event_id = ?`
    ).bind(message.slice(0, 1000), event.id).run();
    throw error;
  }
}
