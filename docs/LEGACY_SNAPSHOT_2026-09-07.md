# Validated legacy Hjerterum snapshot — 2026-09-07

This document is the migration contract extracted read-only from the current Replit Hjerterum application. It records observed runtime behavior and data shape. It is not a target-architecture endorsement.

## Source baseline

Legacy stack:
- pnpm monorepo
- Express 5 API
- React/Vite admin SPA
- React/Vite member/public SPA
- PostgreSQL via `pg` + Drizzle ORM
- Clerk authentication
- Stripe subscriptions, Billing Portal, webhooks, teacher payments and room-booking invoice items
- Resend + SMTP
- Google Sheets CSV sync
- MembershipWorks RSS events only
- DAWA address autocomplete
- OpenAI event/applicant analysis
- Replit runtime/deployment

Primary legacy packages:
- `artifacts/api-server`
- `artifacts/hjerterum`
- `artifacts/member-portal`
- `lib/db/src/schema`
- `lib/api-spec`
- `lib/api-zod`
- `lib/api-client-react`
- `lib/integrations-openai-ai-server`

A sanitized source export exists in the legacy workspace as `hjerterum-sanitized-bootstrap.zip`, SHA-256 `24b7eb4cce879a5b32fd91f9b531ee50c5d70c30b1a9a5b9689f57f6730dd002`. It intentionally excludes secrets, database dumps, generated dist, node_modules and Replit control-plane state.

## Runtime routing that must be preserved during migration

Production behavior:
- `/` redirects/serves the member portal surface
- `/member-portal/*` is the member/public SPA
- `/api/*` is the API
- remaining admin routes fall back to the admin SPA

Critical frontend routes:
- `/member-portal/`
- `/member-portal/dashboard`
- `/member-portal/kalender`
- `/member-portal/profil`
- `/member-portal/kontakt`
- `/member-portal/success`
- `/setup/:token`
- `/teachers`
- `/bookings`
- `/members`
- `/tribe-eksport`

Critical API paths include:
- `/api/healthz`
- `/api/teachers/*`
- `/api/setup/:token/*`
- `/api/bookings/*`
- `/api/dashboard/stats`
- `/api/stripe/webhook`
- `/api/stripe/member-webhook`
- `/api/members/*`
- `/api/room-bookings/*`
- `/api/events/external`
- `/api/dawa/autocomplete`
- `/api/room-bookings/review`

## Identity and membership contract

Authoritative legacy membership state is the combination of:
- local `members` table
- Clerk user identity
- Stripe customer/subscription state

MembershipWorks is **not** a membership backend in the current application. It is only used as an external event RSS source.

Legacy subscription prices:
- standard: 222 DKK/month or 2,310 DKK/year
- reduced: 111 DKK/month or 1,155 DKK/year
- support: 50 DKK/month or 540 DKK/year

Preserve unchanged during migration:
- `members.clerk_user_id`
- Stripe customer IDs
- Stripe subscription IDs
- tier / interval / status
- cancel-at-period-end behavior
- Billing Portal behavior
- invoice history

## Active database tables

Active application tables observed in source/runtime:
- `teachers`
- `bookings`
- `members`
- `room_bookings`
- `room_booking_attendees`
- `tribes`
- `tribe_members`
- `tribe_applicants`
- `tribe_email_logs`

Legacy `conversations` and `messages` schema files exist but are not active runtime exports.

Important database limitations:
- no versioned SQL migration journal; schema was managed with Drizzle push
- booking timestamps use PostgreSQL `timestamp without time zone`
- no database-level room-overlap constraint
- no unique `(room_booking_id, clerk_user_id)` attendee constraint
- several identity/display fields are intentionally denormalized
- stale generated `lib/db/dist` must not be treated as authoritative

## Read-only production baseline previously observed

Approximate row counts from the validated baseline:
- bookings: 156
- members: 2
- room_booking_attendees: 2
- room_bookings: 2
- teachers: 28
- tribe_applicants: 13
- tribe_email_logs: 0
- tribe_members: 0
- tribes: 1

Observed integrity checks were clean for orphan relations, duplicate attendee groups, overlapping room bookings and invalid intervals.

Known payment deviation requiring explicit review:
- 2 `room_bookings` had `fee_kr > 0` without a local `stripe_invoice_item_id`

Do not auto-repair this during migration.

## Room/event booking behavior

Legacy create flow:
1. authenticated Clerk user submits event
2. server validates event/time/owner
3. overlap check against room/external events
4. AI moderation
5. fee calculation
6. booking insert
7. Stripe invoice item creation
8. creator auto-attendance
9. best-effort email delivery
10. separate AI review
11. rejected review can delete booking and attempt invoice-item cleanup

Current moderation is fail-open on AI exceptions. Preserve behavior until deliberately changed.

## Actual server room pricing

The server, not the UI table, is the current billing authority.

Duration:
`ceil((endsAt - startsAt) / 1 hour)`

A-time:
- weekend, or weekday start at/after 18:30
- up to 2 hours: 200 DKK
- then +75 DKK per additional rounded-up hour

B-time:
- weekday start before 18:30
- up to 2 hours: 75 DKK
- then +37.5 DKK per additional rounded-up hour
- final result rounded to whole DKK

Legacy SoMe invoice item: 390 DKK.

Known UI/backend mismatch:
- member UI displays a different 360/720/... rental table
- UI displays SoMe as 250 DKK
- backend bills using the A/B formula and 390 DKK SoMe

Migration rule: preserve backend behavior 1:1 until a separate product decision resolves the mismatch.

## Teacher booking/payment flow

Google Sheets sync runs:
- at API startup
- hourly
- manually through `/api/bookings/sync`

Teacher card setup:
- admin generates setup link
- teacher opens `/setup/:token`
- Stripe SetupIntent stores reusable payment method
- webhook updates teacher/card state

Auto-charge scheduler:
- runs every 5 minutes
- selects `card_saved` bookings within approximately +/- 5 minutes of start
- creates Stripe PaymentIntent in DKK
- stores charged/failed status and failure reason

Google Sheets Danish date parsing has legacy UTC behavior that must be regression-tested.

## Stripe cutover contract

Preserve:
- customer IDs
- subscription IDs
- SetupIntent/payment-method references
- invoice-item references
- webhook paths and raw-body signature verification
- status mappings
- DKK-to-minor-unit conversion

Cutover must prevent simultaneous old/new webhook processing from causing duplicate effects. Secrets must be newly injected, never copied into source.

## External integrations

Clerk:
- authentication and identity
- admin/member owner-scoping
- frontend publishable key and server secret
- legacy production proxy behavior must be assessed

MembershipWorks:
- external events RSS only
- approximately 5-minute in-memory cache

Google Sheets:
- fixed CSV feed/source in code
- startup + hourly sync

DAWA:
- address autocomplete

OpenAI:
- event moderation and review
- legacy applicant/Tribes analysis

CIRKLER:
- external destination/integration boundary; not Hjerterum domain logic

## Mail

Active providers:
- Resend for application/system/event mail
- SMTP/Nodemailer primarily for teacher setup links

Migration must preserve event/member/admin recipient semantics and avoid exposing recipient lists in bulk flows.

## Background jobs to replace outside Replit

Required active jobs:
- teacher booking auto-charge every 5 minutes
- Google Sheets sync hourly

Legacy Tribes jobs exist but are effectively disabled and must not be silently reactivated.

## Tribes retirement boundary

Preserve as archive/recovery data:
- Tribes tables and rows
- applicant answers
- historical email logs
- admin-gated applicant export

Do not rebuild the old Tribes product automatically.

Legacy Tribes CRUD/application/invitation UI/routes are largely unmounted. `ai-analysis` still exposes some applicant-related surface and must be explicitly retired or retained as archive functionality.

Old Tribes URLs should get an explicit redirect/closed/archive policy instead of accidental 404 behavior.

## Environment variable names found in legacy source

Runtime/auth:
- `DATABASE_URL`
- `PORT`
- `NODE_ENV`
- `LOG_LEVEL`
- `BASE_PATH`
- `ALLOWED_EMAILS`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_CLERK_PROXY_URL`

Stripe:
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MEMBER_WEBHOOK_SECRET`
- `MEMBER_PORTAL_URL`

Mail:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `TRIBES_FROM_EMAIL`
- `ADMIN_EMAIL`
- `BCC_EMAIL`
- `ROOM_BOOKING_PR_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`

Application/AI:
- `APP_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

Legacy flags:
- `TRIBES_ENABLED`
- `VITE_TRIBES_ENABLED`

Replit-specific runtime names are not migration targets.

## Highest-risk migration invariants

1. Export actual production DDL before creating the new database.
2. Treat source schema as stronger evidence than stale generated dist, but reconcile it with production DDL.
3. Preserve timezone semantics for `timestamp without time zone`; current runtime behavior is effectively UTC.
4. Preserve current backend billing formula until explicitly changed.
5. Prevent duplicate Stripe webhook processing during cutover.
6. Preserve all external IDs and denormalized historical display fields.
7. Recreate active cron jobs exactly once, never on both runtimes concurrently.
8. Keep Tribes historical PII private and outside public bundles.
9. Preserve `/member-portal/` and webhook/API paths through cutover or provide controlled redirects.
10. Production cutover must remain reversible until data/runtime parity is verified.
