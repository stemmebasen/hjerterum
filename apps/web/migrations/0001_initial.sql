-- Hjerterum target schema, baseline migration.
-- Legacy production data is imported separately after validation.
-- All *_at_ms and *_date_ms values are Unix epoch milliseconds in UTC.
-- All monetary *_minor values are DKK øre.
-- D1 enforces foreign keys by default; do not disable them during import.

CREATE TABLE teachers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  cvr TEXT,
  card_status TEXT NOT NULL DEFAULT 'no_card',
  stripe_customer_id TEXT,
  setup_link_token TEXT,
  default_payment_method_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_teachers_card_status ON teachers(card_status);
CREATE INDEX idx_teachers_stripe_customer_id ON teachers(stripe_customer_id);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  teacher_id INTEGER,
  teacher_name TEXT NOT NULL,
  event_name TEXT,
  start_date_ms INTEGER,
  end_date_ms INTEGER,
  hours_hundredths INTEGER,
  amount_dkk_minor INTEGER NOT NULL,
  amount_excl_vat_minor INTEGER,
  booking_type TEXT,
  sheet_status TEXT,
  invoice_status TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending_card',
  stripe_charge_id TEXT,
  failure_reason TEXT,
  sheets_row_id TEXT,
  seen_by TEXT,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
  CHECK (start_date_ms IS NULL OR end_date_ms IS NULL OR end_date_ms > start_date_ms)
) STRICT;

CREATE INDEX idx_bookings_teacher_id ON bookings(teacher_id);
CREATE INDEX idx_bookings_start_date_ms ON bookings(start_date_ms);
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX idx_bookings_invoice_status ON bookings(invoice_status);
CREATE INDEX idx_bookings_sheets_row_id ON bookings(sheets_row_id);
CREATE INDEX idx_bookings_stripe_charge_id ON bookings(stripe_charge_id);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL,
  interval TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  street_address TEXT,
  is_teacher INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (is_teacher IN (0, 1))
) STRICT;

CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_stripe_subscription_id ON members(stripe_subscription_id);
CREATE INDEX idx_members_email ON members(email);

CREATE TABLE room_bookings (
  id INTEGER PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  teacher_email TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER NOT NULL,
  max_attendees INTEGER,
  pr_email_sent INTEGER NOT NULL DEFAULT 0,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  fee_invoiced INTEGER NOT NULL DEFAULT 0,
  stripe_invoice_item_id TEXT,
  some_package INTEGER NOT NULL DEFAULT 0,
  some_package_invoice_item_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (ends_at_ms > starts_at_ms),
  CHECK (max_attendees IS NULL OR max_attendees > 0),
  CHECK (pr_email_sent IN (0, 1)),
  CHECK (fee_invoiced IN (0, 1)),
  CHECK (some_package IN (0, 1)),
  CHECK (fee_minor >= 0)
) STRICT;

CREATE INDEX idx_room_bookings_owner ON room_bookings(clerk_user_id);
CREATE INDEX idx_room_bookings_starts_at_ms ON room_bookings(starts_at_ms);
CREATE INDEX idx_room_bookings_time_window ON room_bookings(starts_at_ms, ends_at_ms);
CREATE INDEX idx_room_bookings_fee_invoiced ON room_bookings(fee_invoiced);
CREATE INDEX idx_room_bookings_stripe_invoice_item_id ON room_bookings(stripe_invoice_item_id);

CREATE TABLE room_booking_attendees (
  id INTEGER PRIMARY KEY,
  room_booking_id INTEGER NOT NULL,
  clerk_user_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  member_email TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (room_booking_id) REFERENCES room_bookings(id) ON DELETE CASCADE,
  UNIQUE (room_booking_id, clerk_user_id)
) STRICT;

CREATE INDEX idx_room_booking_attendees_user ON room_booking_attendees(clerk_user_id);
CREATE INDEX idx_room_booking_attendees_booking ON room_booking_attendees(room_booking_id);

-- Idempotency ledger for Stripe and other future webhooks.
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  first_seen_at_ms INTEGER NOT NULL,
  processed_at_ms INTEGER,
  last_error TEXT,
  UNIQUE (provider, event_id)
) STRICT;

CREATE INDEX idx_webhook_events_status ON webhook_events(status);
CREATE INDEX idx_webhook_events_first_seen ON webhook_events(first_seen_at_ms);

-- Single-claim ledger for scheduled work such as teacher auto-charge and sync jobs.
CREATE TABLE job_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL,
  scheduled_for_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  claimed_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  last_error TEXT,
  UNIQUE (job_key, scheduled_for_ms)
) STRICT;

CREATE INDEX idx_job_claims_status ON job_claims(status);

-- Explicit migration/billing anomalies requiring human or controlled-system review.
CREATE TABLE financial_reconciliation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  resolved_at_ms INTEGER,
  UNIQUE (source_type, source_id, reason)
) STRICT;

CREATE INDEX idx_financial_reconciliation_status ON financial_reconciliation(status);
