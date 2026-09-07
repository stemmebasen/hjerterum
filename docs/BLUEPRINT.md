# Hjerterum Blueprint

This document is the primary product and migration specification for the new Hjerterum platform. Update it when a product decision changes.

## 1. Non-negotiable platform rules

- GitHub `main` is the code and release source of truth.
- A commit is not a finished release. Typecheck, relevant tests, production build and runtime verification must pass before deployment is accepted.
- Replit is not a development or production dependency.
- Cloudflare is the initial web/API/edge/static-assets backbone; provider-specific code stays behind adapters.
- Staging and production are separate.
- Production data is never used as a casual development environment.
- CIRKLER is a separate product/domain and integrates only through explicit entitlement contracts.
- The old Tribes feature is retired and must not be rebuilt.

## 2. Product scope

### Public site

- Preserve useful Hjerterum content and established URLs where appropriate.
- Replace stale/manual instructions with structured flows rather than copying the old site 1:1.
- Danish and English content must use one explicit localization strategy.
- Existing SEO-relevant URLs must have a preserve-or-redirect decision before cutover.

### Membership

- Existing MemberWorks members remain intact during transition.
- New members are onboarded into the new system according to the agreed introductory-period rule.
- Member profiles can expose practitioner/teacher visit-card information where the member chooses to do so.
- Hjerterum membership may confer CIRKLER eligibility through the separate CIRKLER integration.

### Events and rooms

- Only paying members may create events.
- Creating an event and reserving the relevant room is one coherent flow.
- Fixed teachers do not require the same approval step as ordinary event creators.
- Room conflicts must be prevented by domain rules, not only by UI warnings.
- Event creation, room reservation and payment must not be split across unrelated forms, email and social-media workflows.

### Payments

- Payment happens at signup/booking according to the agreed flow.
- Hjerterum's admin fee is 5% where that event-payout model applies.
- The agreed event policy has no refund flow.
- Payment-provider code must remain behind an adapter.

### Administration

- Admin must be able to manage members, events, room bookings and relevant payment state without direct database work.
- Policies such as fixed-teacher approval exceptions must be explicit data/policy, not hidden hard-coded exceptions.

## 3. Migration constraints

Do not cut over production until all of the following are true:

1. A validated legacy code/data/schema snapshot exists.
2. The exact legacy room-price calculator behavior has been captured as fixtures/tests before replacement.
3. MemberWorks transition behavior has been acceptance-tested.
4. Redirects and public content have been reviewed.
5. Staging passes end-to-end tests for membership, events, room booking and payment.
6. Rollback is documented and production revision is traceable to a verified GitHub commit.

## 4. Known legacy items that must not be guessed

- Exact room price-calculator formula and edge cases.
- Full legacy database schema and migration history.
- Production configuration names and external-service bindings.
- Data mapping between MemberWorks and the replacement member model.

These are extraction tasks. Do not invent replacements from memory when the legacy source can be obtained.

## 5. Current migration blockers

- The connected Replit account does not expose the legacy Hjerterum/holistisk.org application.
- No alternative legacy repository was found in the connected GitHub account.
- Permanent Cloudflare staging requires account-scoped credentials stored as GitHub encrypted secrets.
- The GitHub repository still needs `main` set as its repository default branch.
- Before importing any legacy code/config/data, repository visibility must be reviewed because the Hjerterum repository is currently public.
