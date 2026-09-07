# Target architecture

## Goal

Hjerterum must be portable, inexpensive to operate, easy to continue developing and not depend on a specific coding agent or hosting provider.

The target architecture preserves validated legacy behavior and data contracts where they matter, while removing Replit-specific runtime coupling.

## Deployment shape

The initial Cloudflare deployment is a single React/Vite application with a Worker API and static assets in the same deployable unit. Browser navigation and assets stay same-origin with the API, reducing operational surface and avoiding an unnecessary CORS boundary.

This is an operational packaging choice, not a domain coupling decision. Business rules remain in provider-neutral packages and provider-specific infrastructure stays behind adapters.

## Boundaries

### Platform app

`apps/web` contains the public website, member/admin frontend and the thin Cloudflare Worker transport layer. Requests under `/api/*` execute Worker code first. Static assets and SPA navigation are served through Workers Static Assets.

### Core

`packages/core` contains provider-independent domain models and use-case contracts for members, teachers, events, room bookings, attendees, billing/pricing, payments, profiles and CIRKLER entitlements. Cloudflare, payment-provider and database SDK types must not leak into this package.

### Adapters

Concrete providers are isolated behind adapters. Required adapter families include:
- relational database
- Clerk identity
- Stripe
- Resend/SMTP email
- Google Sheets feed
- MembershipWorks RSS events
- DAWA
- AI provider
- object storage when/if persistent uploads are introduced
- CIRKLER entitlement lookup

## Data strategy

### Legacy source database

The current production source is PostgreSQL managed through `pg` + Drizzle. It must be exported read-only as actual DDL + data baseline before cutover because the legacy project used Drizzle `push` rather than a reliable versioned SQL migration history.

### Initial target database

Cloudflare D1 is the initial target database for Hjerterum.

Reasons:
- current Hjerterum data volume and write rate are small
- it keeps the initial operational stack on Cloudflare and reduces fixed hosting cost
- it provides a relational model, indexes, foreign keys and transaction-capable SQLite semantics suitable for the current workload
- the application already isolates database access behind provider-neutral boundaries, so D1 is replaceable later without moving domain logic

D1 is not allowed to become an accidental source of data loss. Target migrations must carry every active legacy field or have an explicit documented mapping/archive decision.

The target schema deliberately improves several legacy weaknesses with:
- versioned SQL migrations
- strict tables
- attendee uniqueness
- stronger foreign keys/checks
- webhook idempotency ledger
- scheduled-job claim ledger
- explicit financial reconciliation records
- private historical Tribes archive tables

Migration must reconcile:
1. actual production PostgreSQL DDL
2. active legacy source schema
3. validated runtime behavior
4. D1 target migrations

### Time contract

Legacy booking timestamps are PostgreSQL `timestamp without time zone`, while the validated Replit runtime behaves effectively as UTC for those values.

The target stores booking/event instants as Unix epoch milliseconds in UTC. Import conversion must be deterministic and regression-tested for Europe/Copenhagen browser input, UTC conversion, summer/winter time and DST transition edges. No implicit provider timezone behavior is acceptable.

### Money contract

Target monetary integer fields use DKK minor units (øre). Import must convert legacy decimal/krone fields deterministically and reject fractional minor units.

## Identity and membership

Legacy membership authority is:
- local Hjerterum `members`
- Clerk identity
- Stripe customer/subscription state

MembershipWorks is not the member database. Its current role is only external event RSS ingestion.

Existing Clerk IDs and Stripe IDs are migration invariants.

## Payments

Stripe remains behind a payment adapter, but migration must preserve:
- customer IDs
- subscription IDs
- teacher reusable payment-method/setup state
- invoice-item/payment references
- webhook paths and raw-body signature behavior
- DKK minor-unit conversion

Webhook and scheduled-payment side effects must have a single active runtime owner during cutover.

## Scheduled work

Legacy active schedules that need explicit target implementation:
- teacher booking auto-charge every 5 minutes
- Google Sheets sync hourly

Target jobs must be idempotent or otherwise duplicate-safe. Legacy Tribes schedulers remain disabled.

## File/storage boundary

The legacy application has no persistent upload backend. The event image picker is frontend-only and does not upload or persist files.

R2/object storage may be introduced later through the storage adapter, but that is a new capability, not part of 1:1 migration parity.

## Routing compatibility

Migration must preserve or intentionally redirect the validated URL/API contract, including:
- `/member-portal/` base path
- member dashboard/calendar/profile/contact/success paths
- admin teacher/booking/member/setup routes
- `/api/*`
- both Stripe webhook paths

## Pricing compatibility

The current backend room-price calculation is the migration authority until a separate product decision changes it.

Do not silently replace it with the different values shown by the legacy member UI.

## Environments

- local
- temporary preview
- staging
- production

Temporary previews are disposable runtime-verification environments and never contain production secrets or production data. Production data must never be used as a casual development database. Environment-specific configuration is injected at runtime and is not committed as secrets.

## Release rule

A deploy may only proceed when:
1. intended change is present on GitHub `main`
2. frozen dependency install succeeds
3. type checks pass
4. relevant automated tests pass
5. production build succeeds
6. target database migrations/constraints validate
7. staging/runtime smoke checks pass
8. changed flows are verified
9. deployed production revision is traceable to the verified GitHub commit

Production deployment remains intentionally non-automatic during migration.

## Product boundaries

CIRKLER remains separate. Hjerterum may grant or display CIRKLER access for eligible members, but membership matching is an integration contract rather than shared application code.

The old Tribes product is not part of the target product and must not be rebuilt. Historical Tribes data/export remains a private archive/recovery concern until retention decisions are complete.
