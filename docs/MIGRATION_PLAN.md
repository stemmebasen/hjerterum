# Hjerterum migration plan

## Phase 0 — establish source of truth

- Create and populate `main`.
- Add architecture, migration history and CI gates.
- Inventory the legacy website, member flows, event flows, booking flows and data sources.
- Acquire a read-only snapshot/export of the existing application and production data model before changing providers.

## Phase 1 — portable platform foundation

- Public web application.
- Cloudflare Worker API with health endpoint and environment separation.
- Provider-neutral core package.
- Adapter boundaries for database, storage, payment, mail and identity.
- Staging deployment before production cutover.

## Phase 2 — migrate public website

Preserve relevant existing URLs where possible to avoid breaking links and search visibility. Verified legacy routes include `/events/`, `/vision/`, `/kontakt-os/`, `/book-dit-event/` and `/book-your-event/`.

Content migration is selective: preserve useful Hjerterum content, remove obsolete instructions and rebuild confusing booking flows rather than reproducing them.

`/tribes/` must not recreate the old Tribes product. It should eventually redirect to the appropriate current community/CIRKLER explanation once that destination is settled.

## Phase 3 — member platform

- Member authentication and profile.
- Existing MemberWorks members remain intact during transition.
- New-member onboarding must support the agreed introductory/free period rules.
- Member profile/visit-card functionality for practitioners and teachers.
- Hjerterum members can receive CIRKLER eligibility through an integration, without merging the two systems.

## Phase 4 — events, rooms and money

- Paying members can create events according to current governance rules.
- Room reservation is integrated with event creation.
- Existing fixed-teacher exceptions are represented as explicit policy, not hidden special cases.
- Price calculation is implemented as a testable domain rule.
- Payment and payout logic is isolated behind payment adapters.
- Admin fee/refund policy is explicit and covered by tests.

## Phase 5 — cutover

- Import validated data.
- Run staging acceptance checks.
- Compare key legacy and new flows.
- Switch production routing only after verification.
- Keep rollback path and legacy data snapshot until migration acceptance.

## Current blocker

The currently connected Replit account does not expose a Hjerterum/holistisk.org app or code snapshot. OMS was checked and contains no Hjerterum code or configuration. This blocks legacy-code import, but it does not block building the new GitHub/Cloudflare foundation.
