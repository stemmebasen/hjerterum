# Hjerterum migration plan

## Primary objective

Make Hjerterum independent of Replit as quickly as possible.

GitHub `main` is the development/release source of truth. Cloudflare becomes the web/API/scheduled-runtime backbone. D1 is the initial target database behind an adapter. Replit is now only an optional legacy reference, never a required development or deployment dependency.

Hjerterum is still in development, so preserving the current development database byte-for-byte is not a release gate. Preserve known behavioral rules and useful data contracts, but do not delay Replit exit for archival perfection.

## Completed foundation

- private GitHub repository
- real platform on `main`
- React/Vite + Cloudflare Worker deployment model
- provider-neutral core package
- D1 baseline + legacy-parity migrations
- CI with frozen install, typecheck, tests, build and D1 schema validation
- temporary Cloudflare runtime deploy + live smoke test
- validated legacy read-only snapshot
- exact legacy room-pricing fixture
- booking overlap rule
- event/admin-fee policy tests

Repository hygiene still needed:
- set GitHub default branch to `main`
- retire bootstrap initializer branch after verification

## Replit-exit workstream

### 1. Runtime/API

Move active backend behavior directly into Cloudflare Worker.

Already moved or in progress:
- `/api/health`
- `/api/readiness`
- public room-booking feed
- authenticated room-booking creation
- Clerk JWT verification through JWKS/Web Crypto
- member checkout
- current member lookup
- membership cancellation request
- Stripe Billing Portal session
- Stripe member webhook verification + idempotency ledger
- teacher auto-charge scheduler on Cloudflare Cron

Do not reintroduce an Express/Node server merely to reproduce Replit architecture.

### 2. Database

D1 is the initial target database because Hjerterum has a small dataset and the system is still under development.

Rules:
- keep all D1 changes as explicit versioned migrations
- use UTC epoch milliseconds for persisted timestamps
- use integer minor currency units
- keep provider access behind adapters
- preserve historical Tribes tables privately, but do not rebuild Tribes as a product

Legacy PostgreSQL DDL/data export is now optional reference/rollback material, not an exit gate.

### 3. Identity

Keep Clerk as identity provider for now. Cloudflare Worker validates Clerk JWTs directly using the issuer JWKS endpoint, avoiding any Replit/Express dependency.

Preserve:
- Clerk user IDs
- owner scoping
- authenticated/private route boundaries

### 4. Stripe

Keep Stripe as payment provider and call it directly from Worker over HTTPS.

Required behavior:
- membership checkout
- customer/subscription association
- cancel-at-period-end
- Billing Portal
- member webhook signature validation
- webhook idempotency
- teacher off-session auto-charge
- Stripe idempotency keys for scheduled charges

No Stripe secret or webhook secret may be committed to Git.

### 5. Scheduled jobs

Cloudflare owns scheduled jobs after cutover.

Active target schedule:
- teacher auto-charge every 5 minutes

Google Sheets sync is not a blocker for Replit exit. Reintroduce it only if the legacy teacher-booking import is still genuinely needed after the Cloudflare system is usable.

Only one runtime may own a payment scheduler at a time.

## Functional parity still to move

High priority:
- authenticated room-booking list/edit/delete
- attendee register/unregister + capacity protection
- member profile update
- Stripe invoice history
- teacher setup/payment-method flow
- admin members/teachers/bookings views and endpoints
- permanent D1 binding + staging deployment

Medium priority:
- MembershipWorks RSS event feed
- DAWA autocomplete
- Resend/SMTP mail flows
- event moderation/review

Non-blocking legacy/reference:
- sanitized legacy source ZIP import
- PostgreSQL DDL/data export
- Google Sheets sync
- retired Tribes CRUD/application/invitation UI

## Legacy room pricing authority

Until explicitly redesigned, backend pricing remains:
- A-time: weekend or weekday start >= 18:30; first 2h 200 DKK, then +75 DKK/hour
- B-time: weekday start < 18:30; first 2h 75 DKK, then +37.5 DKK/hour, rounded to whole DKK
- legacy SoMe item: 390 DKK

The old frontend price table did not match backend billing. Do not silently use that table as payment authority.

## Permanent staging gate

To stop depending on temporary Cloudflare previews, permanent staging needs:
- Cloudflare account ID in GitHub encrypted secret
- least-privilege Cloudflare API token in GitHub encrypted secret
- a D1 staging database bound as `DB`
- Clerk issuer configured
- Stripe test credentials configured
- application base URL configured

Acceptance:
1. `main` revision identified
2. frozen install passes
3. typecheck passes
4. tests pass
5. build passes
6. D1 migrations apply
7. Worker deploys
8. `/api/health` passes
9. `/api/readiness` reports database ready
10. booking/member flows pass against staging services

## Cutover principle

Because the product is still in development, cut over once the new Cloudflare version can support the active development flows reliably. Do not wait for perfect migration of obsolete Replit-era scaffolding.

After cutover:
- Replit must not own code, database, webhooks, schedulers or production routing
- Replit may remain temporarily available only as read-only historical reference
- remove it completely once any useful remaining reference has been captured

## Current external blockers

Only two external/account-level items materially block a permanent Replit-free staging runtime:
- GitHub default branch metadata still needs to be changed to `main`
- Cloudflare staging credentials/D1 resource must be configured

Legacy source transfer and PostgreSQL export are explicitly non-blocking.
