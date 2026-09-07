# Hjerterum legacy production baseline

Validated read-only against the legacy Replit production database on 2026-09-07. No production data or schema changes were made and no raw PII was exported.

## Production application objects

Nine business tables exist in `public`:

- `teachers`
- `bookings`
- `members`
- `room_bookings`
- `room_booking_attendees`
- `tribes`
- `tribe_members`
- `tribe_applicants`
- `tribe_email_logs`

`conversations` and `messages` do not exist in production. Replit also maintains `_system.replit_database_migrations_v1`; this is platform metadata and must not be migrated as Hjerterum business data.

There are no application views, materialized views or user-defined triggers.

## Row-count baseline

| Table | Rows |
|---|---:|
| bookings | 156 |
| members | 2 |
| room_booking_attendees | 2 |
| room_bookings | 2 |
| teachers | 28 |
| tribe_applicants | 13 |
| tribe_email_logs | 0 |
| tribe_members | 0 |
| tribes | 1 |

## Business-state baseline

### Members

- active: 2
- standard tier: 2
- monthly: 2
- teacher flag false: 2

### Teachers

- `no_card`: 28

### Legacy bookings

- `pending_card`: 156
- invoice status: 155 null, 1 `Sendt`
- sheet status: 155 null, 1 `Booket`

Booking categories:

- null: 2
- Fuld pris: 8
- Halv pris: 7
- Ny model 50 % rabat indtil 31/8: 43
- Ny model efter 31/8: 95
- Workshop: 1

### Room bookings

- 2 total
- `fee_invoiced=false`: 2
- `some_package=false`: 2
- `pr_email_sent=true`: 2

### Historical Tribes data

- tribes: 1
- applicants: 13, all `pending`
- applicant membership marker: 8 `member`, 5 `will-join`
- tribe members: 0
- tribe email logs: 0

The applicant table contains sensitive free-text/profile fields and must be treated as restricted historical data during migration.

## Validated production schema

The active production schema matches the active Drizzle TypeScript schema for table set, columns, data types, nullability, defaults, primary keys, foreign keys, cascade behavior and the two member unique constraints. Differences observed are column order only and are not behaviorally relevant.

Production foreign keys:

- `bookings.teacher_id -> teachers.id`
- `room_booking_attendees.room_booking_id -> room_bookings.id ON DELETE CASCADE`
- `tribe_applicants.tribe_id -> tribes.id`
- `tribe_email_logs.tribe_id -> tribes.id ON DELETE CASCADE`
- `tribe_members.tribe_id -> tribes.id ON DELETE CASCADE`

Production unique constraints beyond primary keys:

- `members.clerk_user_id`
- `members.stripe_customer_id`

Notably missing:

- uniqueness for `(room_booking_id, clerk_user_id)`
- broad application indexes for time/status/FK lookup
- application-level versioned migration history

## Read-only integrity checks

All values below were validated as separate scalar aggregate queries with no raw rows returned.

| Check | Count |
|---|---:|
| orphan `bookings.teacher_id` | 0 |
| orphan attendee booking references | 0 |
| orphan applicant tribe references | 0 |
| duplicate attendee groups by booking + Clerk user | 0 |
| overlapping room-booking pairs | 0 |
| invalid room-booking intervals | 0 |
| invalid legacy booking intervals | 0 |
| active members missing Stripe customer reference | 0 |
| active members missing Stripe subscription reference | 0 |
| SoMe bookings missing SoMe invoice item | 0 |
| `card_saved` teachers missing Stripe references | 0 |
| charged bookings missing charge reference | 0 |
| room bookings with fee > 0 but missing Stripe invoice item | **2** |

### Reconciliation rule

The two room bookings with a positive fee but no `stripe_invoice_item_id` must be carried into migration as an explicit reconciliation item. Migration code must not silently create or backfill Stripe invoice items for these rows. They require deliberate billing review before any financial mutation.

## Sequence baseline

- bookings: 156
- members: 2
- room booking attendees: 6
- room bookings: 3
- teachers: 28
- tribe applicants: 26
- tribe email logs: 2
- tribe members: unused/null
- tribes: 1

Sequence values higher than row counts are expected after historical inserts/deletes. Original IDs must be preserved during migration and target sequences reset above the imported maximum IDs.

## Legacy runtime facts relevant to migration

- Node/Express API with PostgreSQL via Drizzle/pg
- Clerk authentication
- Stripe subscriptions, webhooks, SetupIntents, PaymentIntents and room-booking invoice items
- Resend with SMTP fallback
- Google Sheets CSV source for legacy teacher bookings
- MembershipWorks RSS only for external events, not members
- scheduled teacher auto-charge and sheet sync jobs
- legacy Tribes jobs are hard-disabled
- CIRKLER is only an external link in legacy and has no API/data integration

## Migration guardrails

1. Preserve original business IDs and external Clerk/Stripe/Sheets references.
2. Do not migrate Replit `_system` metadata as business data.
3. Do not recreate `conversations`/`messages`; they are not production tables.
4. Keep historical Tribes data separated from active Hjerterum product flows.
5. Add idempotency before moving Stripe webhooks or automatic charging.
6. Add database-level attendee uniqueness and transaction-safe capacity handling in the target system.
7. Resolve the room-pricing discrepancy before production cutover.
8. Keep the two unresolved room-fee rows as explicit financial reconciliation items.
9. Production remains the rollback reference until the target has passed count, relationship and payment-state validation.
