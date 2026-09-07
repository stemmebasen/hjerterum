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

Transactional data uses PostgreSQL with explicit, versioned migrations in the target platform.

This is a deliberate improvement over the legacy Drizzle `push` model, which had no reliable checked-in DDL migration journal.

Migration must reconcile:
1. actual production DDL
2. active legacy source schema
3. validated runtime behavior

Provider SDK/database types must not leak into core domain contracts.

### Time contract

Legacy booking timestamps are PostgreSQL `timestamp without time zone`, while the validated Replit runtime behaves effectively as UTC for those values.

The migration must define and test this explicitly for Europe/Copenhagen browser input, UTC conversion, summer/winter time and DST transition edges. No implicit provider timezone behavior is acceptable.

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
6. staging/runtime smoke checks pass
7. changed flows are verified
8. deployed production revision is traceable to the verified GitHub commit

Production deployment remains intentionally non-automatic during migration.

## Product boundaries

CIRKLER remains separate. Hjerterum may grant or display CIRKLER access for eligible members, but membership matching is an integration contract rather than shared application code.

The old Tribes product is not part of the target product and must not be rebuilt. Historical Tribes data/export remains a private archive/recovery concern until retention decisions are complete.
