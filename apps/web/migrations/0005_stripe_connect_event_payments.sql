-- Stripe Connect event payments and auditable registration lifecycle.

CREATE TABLE platform_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by_email TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO platform_settings
(setting_key, setting_value, updated_by_email, updated_at_ms)
VALUES ('event_transaction_fee_minor', '0', NULL, 0);

CREATE TABLE member_payout_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'restricted')),
  details_submitted INTEGER NOT NULL DEFAULT 0 CHECK (details_submitted IN (0, 1)),
  charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK (charges_enabled IN (0, 1)),
  payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payouts_enabled IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

ALTER TABLE room_bookings
ADD COLUMN ticket_price_minor INTEGER NOT NULL DEFAULT 0
CHECK (ticket_price_minor >= 0);

ALTER TABLE room_bookings
ADD COLUMN payout_clerk_user_id TEXT;

ALTER TABLE room_booking_attendees
ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'confirmed'
CHECK (registration_status IN ('pending', 'confirmed', 'cancelled'));

ALTER TABLE room_booking_attendees
ADD COLUMN stripe_checkout_session_id TEXT;

ALTER TABLE room_booking_attendees
ADD COLUMN stripe_payment_intent_id TEXT;

ALTER TABLE room_booking_attendees
ADD COLUMN ticket_amount_minor INTEGER NOT NULL DEFAULT 0
CHECK (ticket_amount_minor >= 0);

ALTER TABLE room_booking_attendees
ADD COLUMN handling_fee_minor INTEGER NOT NULL DEFAULT 0
CHECK (handling_fee_minor >= 0);

ALTER TABLE room_booking_attendees
ADD COLUMN platform_fee_minor INTEGER NOT NULL DEFAULT 0
CHECK (platform_fee_minor >= 0);

ALTER TABLE room_booking_attendees
ADD COLUMN expires_at_ms INTEGER;

ALTER TABLE room_booking_attendees
ADD COLUMN confirmed_at_ms INTEGER;

ALTER TABLE room_booking_attendees
ADD COLUMN cancelled_at_ms INTEGER;

CREATE UNIQUE INDEX idx_room_attendees_checkout_session
ON room_booking_attendees(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX idx_room_attendees_registration_state
ON room_booking_attendees(room_booking_id, registration_status, expires_at_ms);
