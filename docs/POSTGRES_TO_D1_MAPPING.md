# PostgreSQL → D1 migration mapping contract

This document defines the known import mappings from the validated legacy Hjerterum PostgreSQL model to the initial Cloudflare D1 target.

It is intentionally conservative. Any source column discovered in the actual production DDL that is not covered here must block the import until mapped, archived or explicitly rejected.

## Global conversion rules

### IDs

Preserve existing integer primary keys exactly. Do not re-number imported records.

Preserve external identifiers exactly, including:
- Clerk user IDs
- Stripe customer IDs
- Stripe subscription IDs
- Stripe SetupIntent/payment-method/payment/invoice-item references
- invitation tokens
- Google Sheets row identifiers

### Timestamps

Legacy PostgreSQL booking/event values use `timestamp without time zone` and the validated Replit runtime treats those values effectively as UTC wall-clock.

Target `*_ms` fields are Unix epoch milliseconds in UTC.

Import rule:
1. read the raw source timestamp without applying a local machine timezone
2. interpret its calendar components using the validated legacy UTC runtime contract
3. convert to Unix epoch milliseconds
4. round-trip test representative summer/winter/DST values before production import

Do not parse source values using the migration workstation's default timezone.

### Money

Target monetary fields are integer DKK minor units (øre).

Conversion must use decimal/string-safe arithmetic, not binary floating-point multiplication.

Examples:
- `200.00 DKK` → `20000`
- `37.50 DKK` → `3750`
- `112.50 DKK` → `11250`

Legacy server fee calculations that round to whole kroner must be rounded according to legacy behavior **before** converting the final billed result to minor units.

### Booleans

Target D1 STRICT tables store booleans as constrained INTEGER `0/1` where applicable.

Historical fields such as `tribe_applicants.is_member` remain TEXT because the legacy source stored them as text rather than a real boolean.

## teachers

| Legacy PostgreSQL | D1 target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `name` | `name` | preserve |
| `email` | `email` | preserve nullable state |
| `phone` | `phone` | preserve |
| `cvr` | `cvr` | preserve |
| `card_status` | `card_status` | preserve exact legacy value |
| `stripe_customer_id` | `stripe_customer_id` | preserve |
| `setup_intent_id` | `setup_intent_id` | preserve |
| setup-link token field | `setup_link_token` | verify actual production column name from DDL |
| `default_payment_method_id` | `default_payment_method_id` | preserve |
| `created_at` | `created_at_ms` | UTC-ms conversion |
| `updated_at` | `updated_at_ms` | UTC-ms conversion |

## bookings

| Legacy PostgreSQL | D1 target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `teacher_id` | `teacher_id` | preserve FK, nullable |
| `teacher_name` | `teacher_name` | preserve denormalized historical value |
| `event_name` | `event_name` | preserve |
| `start_date` | `start_date_ms` | UTC-ms conversion |
| `end_date` | `end_date_ms` | UTC-ms conversion |
| `hours` | `hours_hundredths` | verify source precision; convert deterministically |
| `amount_dkk` | `amount_dkk_minor` | DKK→øre |
| `amount_excl_vat` | `amount_excl_vat_minor` | DKK→øre |
| `booking_type` | `booking_type` | preserve |
| payment/status fields | corresponding target status fields | reconcile exact names from production DDL |
| `stripe_charge_id` | `stripe_charge_id` | preserve |
| `phone` | `phone` | preserve |
| `cvr` | `cvr` | preserve |
| sheet row/source ID | `sheets_row_id` | preserve exact source identifier |
| `seen_by` | `seen_by` | preserve |
| `notes` | `notes` | preserve |
| `failure_reason` | `failure_reason` | preserve |
| `created_at` | `created_at_ms` | UTC-ms conversion |
| `updated_at` | `updated_at_ms` | UTC-ms conversion |

Denormalized teacher/event/customer display values are historical data and must not be rebuilt from current related records.

## members

| Legacy PostgreSQL | D1 target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `clerk_user_id` | `clerk_user_id` | preserve exactly |
| `stripe_customer_id` | `stripe_customer_id` | preserve exactly |
| `stripe_subscription_id` | `stripe_subscription_id` | preserve exactly |
| `tier` | `tier` | preserve |
| `interval` | `interval` | preserve |
| `status` | `status` | preserve legacy status mapping |
| `full_name` | `full_name` | preserve |
| `email` | `email` | preserve |
| `phone` | `phone` | preserve |
| `address` | `street_address` | semantic rename, no data change |
| `is_teacher` | `is_teacher` | boolean→0/1 |
| `created_at` | `created_at_ms` | UTC-ms conversion |
| `updated_at` | `updated_at_ms` | UTC-ms conversion |

The actual production DDL must confirm whether `stripe_customer_id` is nullable for non-active/incomplete historical rows. If nullable source records exist, target constraints must be adjusted before import rather than fabricating Stripe IDs.

## room_bookings

| Legacy PostgreSQL | D1 target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `owner_clerk_user_id` | `clerk_user_id` | semantic rename, preserve exact Clerk ID |
| `teacher_name` | `teacher_name` | preserve |
| `teacher_email` | `teacher_email` | preserve |
| `title` | `title` | preserve |
| `description` | `description` | preserve |
| `starts_at` | `starts_at_ms` | UTC-ms conversion |
| `ends_at` | `ends_at_ms` | UTC-ms conversion |
| `max_attendees` | `max_attendees` | preserve nullable state |
| `pr_emailed` | `pr_email_sent` | boolean→0/1 |
| `fee_kr` | `fee_minor` | DKK→øre |
| `fee_invoiced` | `fee_invoiced` | boolean→0/1 |
| `stripe_invoice_item_id` | `stripe_invoice_item_id` | preserve; null is valid legacy state |
| `some_package` | `some_package` | boolean→0/1 |
| `some_package_invoice_item_id` | `some_package_invoice_item_id` | preserve |
| `created_at` | `created_at_ms` | UTC-ms conversion |
| `updated_at` | `updated_at_ms` | UTC-ms conversion |

Known reconciliation rule:
- legacy rows with `fee_kr > 0` and missing `stripe_invoice_item_id` are imported unchanged and receive a `financial_reconciliation` record; do not create a Stripe invoice item automatically during import.

## room_booking_attendees

| Legacy PostgreSQL | D1 target | Rule |
|---|---|---|
| `id` | `id` | preserve |
| `room_booking_id` | `room_booking_id` | preserve FK |
| `clerk_user_id` | `clerk_user_id` | preserve |
| `member_name` | `member_name` | preserve denormalized value |
| `member_email` | `member_email` | preserve denormalized value |
| `created_at` | `created_at_ms` | UTC-ms conversion |

Target adds `UNIQUE(room_booking_id, clerk_user_id)`. Baseline integrity checks found no duplicate groups, so this should be import-safe, but it must be rechecked on the final production snapshot.

## Tribes archive tables

The retired Tribes product is not reactivated. Historical data is imported into private archive tables for recovery/export continuity.

### tribes

Preserve IDs, name, contact name/email and timestamps.

### tribe_members

Preserve IDs, tribe FK, full name, raw/ISO birthdate representation, email, address and timestamps.

### tribe_applicants

Preserve all historical text answers and metadata, including:
- identity/contact fields
- status
- birthdate/gender/address
- motivation/hopes/themes/group style/depth/safety/hidden-trait answers
- preferred meeting time
- textual `is_member`
- member number
- invitation token/timestamps
- reminder timestamps
- personal welcome timestamp
- tribe reference

Do not normalize or reinterpret historical free-text/JSON-like answer fields during migration.

### tribe_email_logs

Preserve tribe FK, subject, body, recipient count, sender email and sent timestamp.

## New target-only integrity tables

These are not imported from legacy source:

### webhook_events

Used to deduplicate Stripe and future webhook events.

### job_claims

Used to make scheduled jobs single-claim/idempotent across retries and cutover.

### financial_reconciliation

Used for explicit migration/billing anomalies that must not be silently repaired.

## Import acceptance checks

Before any target database is considered valid:
- source and target row counts match for all imported tables
- all preserved IDs match exactly
- FK check returns zero violations
- attendee uniqueness check passes
- no invalid booking intervals are introduced
- timestamp sample round-trips match legacy meaning
- Stripe/Clerk identifiers compare exactly
- monetary totals reconcile before/after conversion
- known billing anomalies are represented in reconciliation rather than repaired
- Tribes PII remains accessible only through private/admin archive paths
