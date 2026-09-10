# Hjerterum migration plan

## Primary objective

Make Hjerterum independent of Replit as quickly as possible without losing the product identity that already works.

GitHub `main` is the development/release source of truth. Cloudflare is the web/API/scheduled-runtime backbone. D1 is the initial target database behind an adapter. Replit is only an optional legacy reference, never a required development or deployment dependency.

Hjerterum is still in development, so preserving the current development database byte-for-byte is not a release gate. Preserve known behavioral rules and useful data contracts, but do not delay Replit exit for archival perfection.

Visual identity is a separate acceptance dimension. A technical migration must not become an accidental redesign. See `docs/DESIGN_SYSTEM.md`.

## Completed foundation

- private GitHub repository
- real platform on `main`
- React/Vite + Cloudflare Worker deployment model
- provider-neutral core package
- D1 baseline + legacy-parity migrations
- CI with frozen install, typecheck, tests, build and D1 schema validation
- permanent Cloudflare staging deployment
- live Cloudflare staging smoke test
- validated legacy read-only snapshot
- exact legacy room-pricing fixture
- booking overlap rule
- event/admin-fee policy tests
- Cloudflare account ID and API token supplied as GitHub Actions secrets
- Hjerterum visual design contract in `docs/DESIGN_SYSTEM.md`

Repository hygiene completed:
- GitHub default branch is `main`
- staging deployment and post-merge smoke tests pass on `main`

## Replit-exit workstream

### 1. Runtime/API

Move active backend behavior directly into Cloudflare Worker.

Already moved:
- `/api/health`
- `/api/readiness`
- public room-booking feed
- authenticated room-booking create/list/edit/delete
- attendee register/unregister + capacity/duplicate protection
- MembershipWorks RSS external event feed through `/api/events/external`
- merged MembershipWorks + D1 calendar presentation
- MembershipWorks event conflict protection for room bookings
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

Legacy PostgreSQL DDL/data export is optional reference/rollback material, not an exit gate.

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

High priority:
- admin members/bookings UI polish
- full end-to-end Clerk member flow against staging
- full end-to-end Stripe test flow against staging
- complete public/member content parity with the current Hjerterum experience
- approved reference screenshots for desktop/tablet/mobile
- visual regression baselines for the key pages after design approval

Medium priority:
- DAWA autocomplete
- Resend/SMTP mail flows
- event moderation/review

Non-blocking legacy/reference:
- sanitized legacy source ZIP import
- PostgreSQL DDL/data export
- Google Sheets sync
- retired Tribes CRUD/application/invitation UI

## MembershipWorks bridge

Current source during transition:
`https://api.membershipworks.com/v2/events?_op=rss&org=22308`

The Cloudflare Worker:
- fetches and parses the RSS feed
- caches parsed events for about 5 minutes per warm Worker isolate
- preserves title, start/end, location, image, link, host/author when present, description and category
- merges external events with D1 room/events chronologically in the public calendar
- still shows D1 events if MembershipWorks is temporarily unavailable
- checks MembershipWorks time intervals when creating or editing a room booking

The staging pipeline smoke-tests `/api/events/external` on every deploy. The first permanent live validation returned 50 parsed MembershipWorks events.

## Visual parity gate

Architecture can change aggressively. Visual identity must not drift by accident.

Until an explicit redesign is approved, the existing Hjerterum/member-portal experience is the visual reference. The shared rules are defined in `docs/DESIGN_SYSTEM.md`.

For each important page or flow:
1. capture approved desktop and mobile reference screenshots
2. reproduce the same overall visual language, hierarchy, density and tone using shared design tokens/components
3. compare old/reference and new side-by-side
4. obtain visual approval separately from functional approval
5. save approved screenshots as regression baselines
6. use automated screenshot regression tests for the most important breakpoints when practical

A page is not considered migrated simply because its API calls work.

Visual acceptance must cover at minimum:
- public home
- member portal/dashboard
- calendar
- profile/contact
- login/sign-up
- event/room booking flow

## Legacy room pricing authority

Until explicitly redesigned, backend pricing remains:
- A-time: weekend or weekday start >= 18:30; first 2h 200 DKK, then +75 DKK/hour
- B-time: weekday start < 18:30; first 2h 75 DKK, then +37.5 DKK/hour, rounded to whole DKK
- legacy SoMe item: 390 DKK

The old frontend price table did not match backend billing. Do not silently use that table as payment authority.

## Permanent staging gate

Permanent Cloudflare staging is online at:
`https://hjerterum-platform-staging.speak-e18.workers.dev`

The staging workflow automatically:
- creates or reuses `hjerterum-staging` D1 in WEUR
- binds it as `DB`
- applies all D1 migrations
- builds and deploys Worker + frontend
- syncs configured application secrets
- smoke-tests `/api/health`, `/api/readiness`, `/api/events/external`, client config and frontend

Clerk and Stripe application secrets can be added incrementally without reintroducing Replit.

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
10. MembershipWorks external events endpoint returns a valid event array
11. booking/member flows are exercised against staging services
12. visual/content parity is reviewed against approved Hjerterum references

## Cutover principle

Because the product is still in development, cut over once the new Cloudflare version can support the active development flows reliably and the important public/member experiences have acceptable visual/content parity. Do not wait for perfect migration of obsolete Replit-era scaffolding.

After cutover:
- Replit must not own code, database, webhooks, schedulers or production routing
- Replit may remain temporarily available only as read-only historical reference
- remove it completely once any useful remaining reference has been captured

## Current external blockers

Permanent Cloudflare staging is online and verified from `main`. Remaining cutover
blockers are product and operational work: final public/member visual parity, full
Clerk/Stripe end-to-end acceptance, explicit reconciliation of two historical room-fee
rows without Stripe invoice-item references, and production routing/webhook/scheduler
verification. Legacy source transfer and PostgreSQL export are explicitly non-blocking.
