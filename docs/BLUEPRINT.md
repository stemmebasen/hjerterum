# Hjerterum Blueprint

This document is the primary product and migration specification for the new Hjerterum platform. Update it whenever a product or migration decision changes.

## 1. Non-negotiable platform rules

- GitHub `main` is the code and release source of truth.
- A commit is not a finished release. Typecheck, relevant tests, production build and runtime verification must pass before deployment is accepted.
- GitHub remains the development and release source of truth. Replit may be used for the agreed later UI/UX polish on a separate branch of this repository, preserving the existing layout and design direction. It must not introduce a parallel platform or change backend, database or hosting without a separate decision. The legacy Replit runtime remains a migration/rollback reference.
- Cloudflare is the initial web/API/edge/static-assets backbone; provider-specific code stays behind adapters.
- The target business/domain layer must remain portable even where Cloudflare is used as the first runtime.
- Staging and production are separate.
- Production data is never used as a casual development environment.
- CIRKLER is a separate product/domain and integrates only through explicit entitlement contracts.
- The old Tribes product is retired and must not be rebuilt. Historical Tribes data may be preserved under restricted access where retention requires it.

### Current implementation checkpoint (2026-09-10)

- The active Cloudflare Worker and React/Vite application are implemented on `main`.
- Clerk JWT verification, member profile/member billing routes, room booking and attendee
  protection, teacher setup/payment flows, Stripe webhooks/idempotency, teacher
  auto-charge scheduling and the MembershipWorks event bridge are present in the Worker.
- The public home, sign-in/sign-up entry points and member portal are live in the
  frontend. Public legacy URL parity is the next implementation block.
- Permanent staging remains the acceptance environment:
  `https://hjerterum-platform-staging.speak-e18.workers.dev`.
- No newer binding board decision was found in the repository that authorises changing
  the legacy room-price formula. Existing room-price fixtures therefore remain
  reference behaviour and are not a licence to change booking prices.
- The admin/member foundation is implemented on the `codex/admin-member-foundation`
  delivery branch: protected admin overview/member/event/teacher views and distinct
  member overview, event creation, calendar, profile and contact surfaces.
- Event creation is enforced server-side for active paying members. A frontend-only
  membership check is not considered sufficient authorization.
- The MembershipWorks transition layer is implemented with idempotent CSV mirroring,
  e-mail deduplication, import/change history, combined admin counts and legacy-member
  recognition. It preserves existing MembershipWorks payments while new members remain
  native to Hjerterum.
- Member event self-service now uses one shared active-membership rule across calendar,
  registrations and owned-event actions. The signed-in identity supplies member name/e-mail;
  client-provided identity is not trusted.
- Members can register, unregister, create, edit and cancel upcoming events in the portal.
  Cancellation preserves the event and registrations as history. Admin can cancel events and
  reversibly block either native or MembershipWorks member access with an audit record.
- Membership billing routes are connected to the current portal UI. They remain unavailable
  at runtime until the deferred Stripe configuration and acceptance work is completed.

### Staging acceptance checkpoint (2026-09-24)

- The newly created Hjerterum Clerk development instance is connected to staging. The user clarified that the previously assumed Clerk instance belonged to another project; no legacy identity migration has been accepted on that basis.
- Native login and session persistence have been verified in the browser. An explicitly approved staging-only test membership is active without a paid subscription.
- Membership names, descriptions and monthly/yearly prices follow https://holistisk.org/bliv-medlem/: Standard 222/2310 DKK, Generøst 333/3465 DKK, Reduceret pris 111/1155 DKK and Support 50/540 DKK. Support excludes member benefits while retaining own membership management.
- Native profile saving and persistence across navigation/reload have been verified.
- A clearly labelled staging event was created, edited, shown in the calendar and cancelled. An overlapping booking was rejected. The test event no longer appears among upcoming events.
- The profile's self-service teacher checkbox is removed because the backend does not persist it. A future public practitioner/teacher profile requires an explicit opt-in and a working publication flow; the internal teacher flag is not publication consent or an approval bypass.
- The billing view distinguishes loading, unavailable payments, request errors and a genuinely empty invoice list. Payment-management actions are not offered while payment availability is unconfirmed or payments are unconfigured.
- Participant signup/unregistration using a second identity, imported MembershipWorks identity linking, concurrency, payment acceptance, notifications and public profile publication are not yet accepted end-to-end. The browser checks above must not be treated as production-cutover approval.

### Login mail through Resend (2026-10-03)

- Reported: "Jeg får ikke OTP fra login". The Clerk instance on staging is a development instance (`advanced-shad-1373.clerk.accounts.dev`); Clerk itself delivers its emails there, capped at 100 a month.
- Decided: "Ok, så lad os gøre med begge" - Clerk keeps the login; Resend delivers Clerk's emails from `login@hjerterum.info` (`RESEND_FROM_EMAIL`). With "Delivered by Clerk" switched off on a template, Clerk sends the rendered email to `POST /api/clerk/email` (`email.created`, Svix-signed with `CLERK_WEBHOOK_SECRET`); the login code goes out in Hjerterum's Danish wording and design, other templates as Clerk wrote them. Emails Clerk delivered itself are never sent again; a failed send answers 5xx so Clerk retries, and Resend's idempotency key (the Svix id) keeps it to one email.
- Set-up order: verify `hjerterum.info` in Resend (DNS in Cloudflare) → GitHub secrets `RESEND_API_KEY` and, after adding the Clerk webhook for `email.created` at `/api/clerk/email`, `CLERK_WEBHOOK_SECRET` → deploy → test → only then switch off "Delivered by Clerk" on the verification-code template.
- A production Clerk instance on hjerterum.info is still required before real members; the same Resend delivery carries over.

### The website from holistisk.org (2026-10-04)

- Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt"; "Du har tilladelse til at overskrive det nuværende indhold på hjerterum.info hjemmeside".
- The platform's public website now carries all of holistisk.org's content in hjerterum.info's structure (`apps/web/site/`); every old address redirects (301) to its new place; `docs/CONTENT_LEDGER.md` accounts for all 56 pages, and the originals are archived in `docs/legacy/holistisk-org/`.
- Before hjerterum.info is pointed at the platform: the user approves the pages on staging, and membership sign-up keeps working (it links to holistisk.org's membership system until Stripe is configured). hjerterum.info's current app serves `/member-portal/` - the platform serves the member area at the same address.
- holistisk.org's full media library (603 files) is listed but not copied; download it before holistisk.org is closed.

## 2. Product scope

### Public site

- Preserve useful Hjerterum content and established URLs where appropriate.
- Replace stale/manual instructions with structured flows rather than copying the old site 1:1.
- Danish and English content must use one explicit localization strategy.
- Existing SEO-relevant URLs must have a preserve-or-redirect decision before cutover.
- No AI icon is part of the public design language.

### Membership

- Existing MembershipWorks members and payment agreements remain intact during transition and must not be destructively migrated.
- MembershipWorks has no supported member API. Existing members are therefore mirrored read-only through full CSV imports; the platform never writes back to MembershipWorks.
- Re-imports match normalized e-mail addresses, update changed records without duplicates and preserve an auditable batch/change history visible to admin.
- A verified active MembershipWorks mirror record grants member access while its membership and payment remain managed externally.
- The current application identity model is Clerk + local `members` table + Stripe, with the MembershipWorks mirror as a temporary entitlement adapter.
- New members are onboarded into the new system and receive the agreed first 30 days free. Existing records do not receive a new trial merely because they are re-imported.
- Member profiles can expose practitioner/teacher visit-card information where the member chooses to do so.
- Hjerterum membership may confer CIRKLER eligibility through the separate CIRKLER integration.
- CIRKLER sign-up from the member portal (decided 2026-10-03): the "Min CIRKLER-profil" card asks the Worker for a signed, single-use Ed25519 ticket (`POST /api/integrations/cirkler/handoff`) and sends the member to cirkler.net, where they are logged in without a mail link. CIRKLER re-checks eligibility daily through `POST /api/integrations/cirkler/eligibility` with a service key. Members whose tier includes member benefits are eligible; Support is not. Hjerterum's team has no manual steps. Secrets: `CIRKLER_HANDOFF_PRIVATE_KEY`, `CIRKLER_SERVICE_KEY`, optional `CIRKLER_BASE_URL`. Code: `apps/web/worker/cirkler-integration.ts`.
- Email-based fallback linking between Clerk and an existing member record is legacy behaviour that must be acceptance-tested before replacement.

### Events and rooms

- Only paying members may create events.
- Creating an event and reserving the relevant room is one coherent flow.
- Fixed teachers do not require the same approval step as ordinary event creators.
- Room conflicts must be prevented by domain rules and database-safe reservation logic, not only by UI warnings.
- Attendee uniqueness must be enforced at database level for booking + user identity.
- Capacity reservation must be transaction-safe under concurrent signups.
- Event creation, room reservation and payment must not be split across unrelated forms, email and social-media workflows.
- AI moderation must not fail open in the target system.

### CIRKLER meetings, venues and calendar integrations — confirmed 2026-09-25

- Hjerterum is one possible venue for CIRKLER meetings. CIRKLER must also support additional venues with external calendar integrations; it is not restricted to Hjerterum.
- CIRKLER remains a separate product/domain. Meetings held at Hjerterum must use Hjerterum's room reservations and conflict checks. Meetings elsewhere must use the selected venue's calendar integration and availability rules.
- Model the selected venue/resource and calendar connection explicitly behind provider adapters. Creating, moving or cancelling a circle meeting must keep the corresponding venue reservation consistent; retries must not duplicate reservations. Do not block a Hjerterum room for meetings held elsewhere.
- Calendar occupancy must be distinguished from public visibility and access to circle/member details. Do not infer permission to publish circle participant data from this integration requirement.
- The concrete prior agreement on AI event approval is being recovered. The current Worker booking path does not yet apply AI moderation or the fixed-teacher approval exception. Do not describe these as implemented.
- External calendar providers and their read/write capabilities, visibility of circle meetings, booking permissions, recurring-series behaviour, applicable approval exemptions and venue-payment policies must follow recovered/confirmed product rules; this checkpoint does not invent those decisions.

### Payments

- Payment happens at signup/booking according to the agreed flow.
- Hjerterum's admin fee is 5% where that event-payout model applies.
- The agreed event policy has no refund flow.
- Payment-provider code remains behind an adapter.
- Stripe webhooks require explicit event idempotency before production cutover.
- Automatic teacher charging requires single-claim/idempotent execution before the scheduler is moved.
- The two legacy room bookings with positive fees but no Stripe invoice-item reference are explicit reconciliation items. Migration must not silently create invoice items for them.

### Administration

- Admin must be able to manage members, events, room bookings and relevant payment state without direct database work.
- Policies such as fixed-teacher approval exceptions must be explicit data/policy, not hidden hard-coded exceptions.
- Admin authorization must have one server-side source of truth; legacy duplicated frontend/server email allowlists must not be reproduced.
- Historical Tribes applicant data is sensitive restricted data and must not appear in ordinary member/admin flows by default.

## 3. Validated legacy production baseline

The legacy Replit application and production PostgreSQL database were validated read-only on 2026-09-07. The detailed baseline is in `docs/LEGACY_PRODUCTION_BASELINE.md`.

Production contains nine Hjerterum business tables:

- `teachers`
- `bookings`
- `members`
- `room_bookings`
- `room_booking_attendees`
- `tribes`
- `tribe_members`
- `tribe_applicants`
- `tribe_email_logs`

`conversations` and `messages` do not exist in production and must not be recreated merely because old source definitions exist.

Validated row counts at baseline:

- members: 2
- teachers: 28
- legacy bookings: 156
- room bookings: 2
- room-booking attendees: 2
- tribes: 1
- tribe applicants: 13
- tribe members: 0
- tribe email logs: 0

Read-only integrity checks found no orphan relationships, duplicate attendee groups, room-booking overlaps, invalid booking intervals or broken charged-payment references. Two room bookings have a positive fee and no Stripe invoice-item reference.

The active production schema matches the active Drizzle schema on tables, types, nullability, defaults, keys and constraints, but the legacy repository has no proper versioned application migration history. The production baseline therefore becomes the starting migration reference.

## 4. Legacy pricing captured from source

The server-side room fee calculation is the actual legacy persistence rule.

Duration is rounded up to whole hours:

`durationHours = ceil((end - start) / 1 hour)`

### A-time

Weekend or start time at/after 18:30:

`round(200 + max(0, durationHours - 2) * 75)`

Meaning:

- first two hours: 200 kr.
- every additional started hour: 75 kr.

### B-time

Weekdays before 18:30:

`round(75 + max(0, durationHours - 2) * 37.5)`

Meaning:

- first two hours: 75 kr.
- every additional started hour: 37.50 kr.

A legacy source comment says B-time is not yet charged, but the actual server code does charge it. The server behaviour is therefore the legacy fact, while the comment is stale.

### Legacy frontend discrepancy

The member portal displays a different flat price table: 360, 720, 1080, 1380, 1680, 1920, 2160, 2340, 2520, 2700 kr. for 1–10 hours and then +180 kr. per hour.

This does **not** match the server calculation and must not be copied into the target as if it were authoritative.

### Pricing cutover rule

The approved room-price calculator is the public pricing source of truth. The
new `/price-list/` route must use the shared calculator implementation and must
not copy the inconsistent legacy frontend table. Online payment remains
disabled until Stripe is configured, but the estimate must remain visible.

Legacy SoMe package fee: 390 kr.

## 5. Legacy integrations validated

- Clerk: identity and login boundary.
- Stripe: subscriptions, customer portal, webhooks, teacher SetupIntents/PaymentIntents and room-booking invoice items.
- Resend: primary mail provider, with SMTP fallback.
- Google Sheets: CSV source for legacy teacher-booking data.
- MembershipWorks: external event RSS feed (`org=22308`) plus admin-initiated read-only CSV member mirroring. No write-back or payment migration.
- DAWA: address autocomplete.
- OpenAI-compatible integration: moderation/review and retired Tribes-related AI flows.
- CIRKLER: legacy system only links externally to `cirkler.net`; there is no legacy CIRKLER API/data sync to preserve.

TRIBES is hard-disabled in the legacy server. Only the historical applicant export remains actively mounted from the Tribes area. Retired Tribes CRUD/jobs must not be reactivated during migration.

## 6. Migration constraints

Do not cut over production until all of the following are true:

1. The reusable sanitized legacy source snapshot has been preserved outside Replit in the private GitHub migration history or another controlled archive.
2. The validated production baseline is preserved and target schema/data counts can be compared against it.
3. Legacy room-price behaviour exists as fixtures/tests and the future pricing policy is explicitly decided.
4. MembershipWorks transition behaviour has been acceptance-tested without disturbing existing MembershipWorks members.
5. Clerk identity/linking has been tested against imported member references.
6. Stripe customer/subscription/payment references survive data migration unchanged.
7. Stripe webhook idempotency and scheduler/charge idempotency are implemented.
8. The two unresolved room-fee billing rows have an explicit reconciliation decision.
9. Redirects and public content have been reviewed.
10. Staging passes end-to-end tests for membership, events, room booking and payment.
11. Rollback is documented and production revision is traceable to a verified GitHub commit.
12. Only one production scheduler/automatic charge worker is active at cutover.

## 6a. Public URL/content parity checkpoint

The initial URL/content inventory and route decisions are maintained in
`docs/LEGACY_INVENTORY.md`. The migration preserves established public URLs where
they still serve a useful purpose, integrates thin pages into stronger routes, and
retires only the obsolete `/tribes/` product surface. Public parity is accepted only
after Danish/English content, links, mobile layout and SEO metadata have been reviewed
on staging.

### Non-payment migration scope

The current technical/public migration may proceed without activating paid checkout,
Stripe webhooks, Billing Portal or automatic teacher charges. These flows must remain
disabled and must not be presented as available to users until a payment provider is
configured and acceptance-tested. Stripe activation is a separate later milestone.

## 7. Target data safety requirements

Regardless of database provider, the target schema must enforce at least:

- primary keys and legacy ID preservation during import;
- foreign-key integrity;
- unique `members.clerk_user_id`;
- unique `members.stripe_customer_id`;
- unique attendee identity per room booking;
- indexes appropriate for booking time windows, statuses and external reference lookups;
- safe concurrency around room capacity/reservation;
- explicit migration version history;
- webhook event idempotency storage;
- scheduler/charge claim or idempotency storage;
- restricted storage/access for historical Tribes applicant data.

Provider selection must not leak into domain rules. Database-specific implementation belongs behind an adapter/migration layer.

## 8. Current migration blockers

Resolved:

- Legacy Hjerterum Replit application is now accessible read-only.
- Production database schema/count baseline has been validated read-only.
- Hjerterum GitHub repository is now private.
- Legacy room-price code has been extracted and documented.
- GitHub default branch is now `main`.
- Permanent Cloudflare staging has passed post-merge deploy smoke tests with D1 ready.
- Stripe payment integration is intentionally deferred; paid flows remain inactive.

Still open:

- Preserve/import the sanitized legacy source snapshot outside Replit.
- The approved three-mode room-price calculator is implemented; its shared calculation
  rules are now the public pricing authority.
- The two legacy room-fee rows without Stripe invoice-item references require reconciliation before financial cutover.
- Stripe account, test-mode configuration and full end-to-end Clerk/Stripe acceptance are deferred, not blockers for the non-payment migration scope.
- Full public/member visual parity remains open.
- Event signup payments, the 5% payout/admin-fee model, payment-linked cancellation policy,
  notifications and authenticated browser acceptance tests remain open before production cutover.
