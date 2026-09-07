# Hjerterum migration plan

## Migration principle

GitHub `main` is the release source of truth. Replit is now only a legacy source/runtime reference during migration. Cloudflare becomes the web/API/edge backbone, while stateful services remain replaceable behind adapters.

The goal is behavioral and data continuity, not a 1:1 copy of Replit infrastructure.

## Phase 0 — source of truth and validated baseline

Status: substantially complete.

Completed:
- real `main` platform foundation
- CI with frozen dependency graph, typecheck, tests and production build
- private repository before legacy import
- provider-neutral core/adapters
- validated read-only legacy snapshot captured in `docs/LEGACY_SNAPSHOT_2026-09-07.md`

Remaining repository hygiene:
- change GitHub default branch from `migration/bootstrap-init` to `main`
- retire bootstrap initializer branch after verification

## Phase 1 — import legacy source safely

Goal: bring the sanitized legacy source into GitHub without importing Replit control-plane state or secrets.

Source package expected from legacy workspace:
- sanitized bootstrap export hash: `24b7eb4cce879a5b32fd91f9b531ee50c5d70c30b1a9a5b9689f57f6730dd002`
- active source areas: API server, admin SPA, member/public SPA, DB source schema, API contracts and OpenAI integration helpers

Rules:
- never import `.replit`, Replit runtime state, secrets, `node_modules`, generated `dist`, private keys or database dumps into Git history
- preserve legacy source initially as reference/import material; do not let it replace the new target architecture wholesale
- compare imported behavior against the validated snapshot before deleting any legacy path

## Phase 2 — production database extraction and migration contract

This phase is a hard prerequisite before production data migration.

Required read-only exports:
- actual production schema/DDL
- table/index/constraint/FK inventory
- row counts
- selected integrity checks
- data-only backup/snapshot stored outside Git

Reconcile three sources of truth:
1. actual production DDL
2. active source schema in `lib/db/src/schema`
3. validated runtime behavior

Do **not** trust stale generated DB artifacts.

Active data sets to preserve:
- members
- teachers
- bookings
- room_bookings
- room_booking_attendees
- tribes
- tribe_members
- tribe_applicants
- tribe_email_logs

Known deviation to carry into reconciliation:
- 2 room bookings previously observed with a fee but without local Stripe invoice-item reference

No automatic repair during migration.

## Phase 3 — identity, Stripe and external integration adapters

### Identity

Preserve Clerk IDs and current login/owner-scoping semantics. Evaluate whether the legacy Clerk proxy is still required on the new runtime.

### Membership

Correct legacy model:
- membership is local `members` + Clerk + Stripe
- MembershipWorks is **not** a membership backend
- MembershipWorks is only an external RSS event source

Any future introductory/free membership period is a target-product change and must not be confused with legacy migration behavior.

### Stripe

Preserve all existing customer, subscription, payment-method, SetupIntent and invoice-item IDs.

Before cutover:
- configure new webhook endpoints
- verify raw-body signature validation
- introduce explicit event idempotency/deduplication if needed
- ensure old and new runtimes never perform the same auto-charge/webhook side effect simultaneously

### Other adapters

Recreate:
- Resend
- SMTP teacher setup mails
- Google Sheets CSV sync
- MembershipWorks RSS
- DAWA
- OpenAI moderation/review

## Phase 4 — runtime and job migration to Cloudflare-compatible services

The target deployment is a combined React/Vite + Cloudflare Worker platform for web/API edge orchestration.

Stateful and scheduled behavior must be moved deliberately.

Required active schedules:
- teacher booking auto-charge every 5 minutes
- Google Sheets sync hourly

Rules:
- exactly one active scheduler owner during cutover
- jobs must be idempotent or protected against duplicate execution
- Tribes schedulers remain disabled unless explicitly reintroduced

Production routing must preserve or deliberately redirect:
- `/member-portal/`
- `/member-portal/dashboard`
- `/member-portal/kalender`
- `/member-portal/profil`
- `/member-portal/kontakt`
- `/member-portal/success`
- admin routes such as `/teachers`, `/bookings`, `/members`, `/setup/:token`
- `/api/*`
- both Stripe webhook paths

## Phase 5 — event, room and money parity

Port the current behavior as testable domain rules before redesigning it.

Must be regression-tested:
- room overlap logic
- capacity and duplicate attendance protection
- owner-only edit/delete
- creator auto-attendance
- public upcoming event feed
- MembershipWorks event merge/cache
- event mail triggers
- AI moderation/review sequencing including current fail-open behavior
- timezone conversion around Europe/Copenhagen DST boundaries

### Legacy room pricing authority

Until a separate product decision is made, the backend A/B formula is authoritative:
- A-time: weekend or weekday start >= 18:30; first 2h 200 DKK, then +75 DKK/hour
- B-time: weekday start < 18:30; first 2h 75 DKK, then +37.5 DKK/hour, rounded to whole DKK
- legacy SoMe invoice item: 390 DKK

The current UI price table and UI SoMe price do not match backend billing. Do not silently resolve this mismatch as part of migration.

## Phase 6 — public website and member experience

Migrate useful public content and redesign confusing flows only after behavior/data contracts are safe.

Preserve search/link equity with redirects where needed.

CIRKLER remains a separate product/organisation. Hjerterum may expose an entitlement/link integration, but CIRKLER domain logic stays out of this repository.

Do not rebuild the old Tribes product.

## Phase 7 — Tribes archive/retirement

Preserve privately:
- historical Tribes tables and applicant answers
- email logs
- admin-gated export capability until retention/archival policy is settled

Explicitly decide treatment of:
- old Tribes URLs
- still-mounted applicant AI endpoints
- archive page vs redirect vs closed response

Do not let sensitive Tribes data enter public bundles or public logs.

## Phase 8 — staging acceptance

Permanent staging requires Cloudflare credentials stored only as encrypted GitHub secrets.

Acceptance gates:
1. GitHub `main` commit identified
2. frozen install succeeds
3. typecheck passes
4. automated tests pass
5. production build succeeds
6. staging deploy succeeds
7. `/api/health` smoke test passes
8. member/public frontend smoke test passes
9. DB connectivity verified with staging DB only
10. changed user flows exercised end-to-end

Production data is never a casual staging database.

## Phase 9 — production cutover with rollback

Before cutover:
- take fresh DB backup/snapshot
- record old runtime/webhook/job ownership
- verify new runtime against production-like staging
- prepare DNS/routing rollback
- ensure Stripe webhooks/jobs have a single active owner

Cutover order:
1. freeze or quiesce migration-sensitive writes if needed
2. take final data delta/snapshot
3. migrate/apply data
4. activate new runtime without duplicate schedulers
5. switch routing
6. smoke-test identity, membership, calendar, checkout/billing, teacher setup and webhooks
7. monitor errors and payment side effects

Rollback must restore routing and scheduler/webhook ownership consistently, not only frontend DNS.

## Current blockers

The legacy application is now accessible and the read-only migration snapshot is complete. Remaining external blockers are:
- sanitized legacy source still needs to be transferred into GitHub for code-level comparison
- actual production PostgreSQL DDL/data snapshot must be exported read-only
- GitHub repository default branch still points to bootstrap instead of `main`
- permanent Cloudflare staging requires encrypted Cloudflare account/token secrets
