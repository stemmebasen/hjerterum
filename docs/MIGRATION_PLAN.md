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
- Cloudflare account ID and API token supplied as GitHub Actions secrets on 2026-09-08

Repository hygiene still needed:
- set GitHub default branch to `main`
- retire bootstrap initializer branch after verification

## Replit-exit workstream

### 1. Runtime/API

Move active backend behavior directly into Cloudflare Worker.

Already moved:
- `/api/health`
- `/api/readiness`
- public room-booking feed
- authenticated room-booking create/list/edit/delete
- attendee register/unregister + capacity/duplicate protection
- Clerk JWT verification through JWKS/Web Crypto
- member checkout
- current member lookup/profile update
- membership cancellation request
- Stripe Billing Portal session
- Stripe invoice history
- Stripe member webhook verification + idempotency ledger
- teacher CRUD/setup-link/card setup
- teacher Stripe webhook
- teacher auto-charge scheduler on Cloudflare Cron
- public/member development UI and Clerk browser auth bridge

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

Required behavior now implemented in Worker:
- membership checkout
- customer/subscription association
- cancel-at-period-end
- Billing Portal
- member webhook signature validation
- webhook idempotency
- teacher setup/payment-method flow
- teacher off-session auto-charge
- Stripe idempotency keys for scheduled charges

No Stripe secret or webhook secret may be committed to Git.

### 5. Scheduled jobs

Cloudflare owns scheduled jobs after cutover.

Active target schedule:
- teacher auto-charge every 5 minutes

Google Sheets sync is not a blocker for Replit exit. Reintroduce it only if the legacy teacher-booking import is still genuinely needed after the Cloudflare system is usable.

Only one runtime may own a payment scheduler at a time.

## Functional work still to move

High priority after permanent staging is online:
- admin members/bookings UI polish
- full end-to-end Clerk member flow against staging
- full end-to-end Stripe test flow against staging

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

Cloudflare account ID and API token are now present as GitHub encrypted secrets. The staging workflow automatically:
- creates or reuses `hjerterum-staging` D1 in WEUR
- binds it as `DB`
- applies all D1 migrations
- builds and deploys Worker + frontend
- smoke-tests `/api/health`, `/api/readiness` and the frontend

Clerk and Stripe application secrets are optional for the first Replit-independent staging cut. When present, the workflow syncs them to Cloudflare without committing them to Git.

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
10. booking/member flows are then exercised against staging services

## Cutover principle

Because the product is still in development, cut over once the new Cloudflare version can support the active development flows reliably. Do not wait for perfect migration of obsolete Replit-era scaffolding.

After cutover:
- Replit must not own code, database, webhooks, schedulers or production routing
- Replit may remain temporarily available only as read-only historical reference
- remove it completely once any useful remaining reference has been captured

## Current external blockers

Permanent Cloudflare staging is now being provisioned from GitHub after the required account credentials were supplied.

The only remaining repository-hygiene task that cannot be changed through the connected GitHub tool is:
- GitHub default branch metadata still needs to be changed from `migration/bootstrap-init` to `main`

Legacy source transfer and PostgreSQL export are explicitly non-blocking.
