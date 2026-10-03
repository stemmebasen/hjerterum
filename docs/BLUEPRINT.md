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
  *Superseded 2026-10-02:* the chair decided that "Det er denne prisberegners data alt skal
  baseres på" (holistisk.org/lejepriser). Room fees for member events now follow Hjerterum's
  price calculator (see the checkpoint of 2026-10-03).
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

### Board cockpit, Saga and calculator checkpoint (2026-10-03)

Most development since 2026-09-24 has gone into the board's own tools. The figures below are from `main` at cockpit v1.9.0, with migrations up to 0034.

**Where it runs.** The board cockpit runs at `admin.hjerterum.info`, and also at `cockpit.<domain>` and `/cockpit`. It is served by the **staging** Worker and staging D1, deploys automatically on every merge to `main`, and is in daily use by the board with real board data. This is an open decision (section 8).

**Login.**
- A board member writes `/login` to Saga in Telegram and gets a personal link. The link works once, within 15 minutes, after a press, so a link preview logs no one in.
- The shared board password (`COCKPIT_PASSWORD`) can be closed with `COCKPIT_SHARED_LOGIN=off`.
- Once a member is chosen for a login, the identity cannot be switched without logging out.
- The chair can close a member's access on every device.

**Pages.**
- **Overblik:**
  - "Bestyrelsen lige nu", written by Saga hourly on weekdays from 07 to 22, and only when something is new;
  - the most important points from the last meeting;
  - key figures with "Vidste du?";
  - member figures;
  - what waits on each member.
- **Opgaver:** tasks from the minutes and the minutes document, and personal to-dos. They are shared with the chair's tasks in Matrix. Duplicates are prevented, any line can be removed, and checked items are archived after 7 days.
- **Møder:**
  - a meeting calendar, with Hjerterum as the default place;
  - an agenda from Saga on request;
  - recording upload per meeting;
  - one page per minutes, with the agenda on top.
- **Beslutninger and Afstemninger** (one page). Proposals have a deadline of 3, 7 or 14 days. A proposal is adopted as soon as more than half of the board, counted as the board's size when it was proposed, votes for it. It is rejected as soon as that can no longer happen. The proposer can withdraw it, and members can ask for it to be discussed at a meeting. An open proposal is shown on Opgaver to every member who has not voted yet.
- **Posthus** (formerly Forespørgsler): important unanswered mails to team@ first, with how long the sender has waited, then the whole inbox.
- **Arrangementer:**
  - every event in Hjerterum's MembershipWorks calendar since 2019, shown and searchable;
  - Undervisere, with contact details and Saga's summary of the cooperation;
  - the event desk (see below).
- **Medlemmer:** totals from MembershipWorks screenshots, read by Saga and saved only after a member checks them. No member names are stored.
- **Also:** Status (Saga's full picture), Arkiv, and Profil with language (Danish or English for members who choose it; Saga's texts are translated and kept).

**Minutes.**
- Sources:
  - a recording sent to Saga in Telegram;
  - an upload in the cockpit (R2, EU);
  - the Drive recordings folder;
  - the last ten minutes imported from the minutes document.
- ElevenLabs transcribes the recording, and Saga drafts the minutes following the agenda.
- Minutes go up at once. Every member signs off in the cockpit or corrects a point. Saga rewrites the point and asks at most once if she is unsure.
- The chair corrects by replying to Saga in Telegram, and the sign-offs then start over.
- The newest approved minutes are the truth about Hjerterum.

**team@holistisk.org (since v1.9.0).**
- Hjerterum reads team@ itself over IMAP (`imap.one.com`), connected by the chair in Posthus. It is no longer relayed from Matrix.
- The password is sealed with AES-GCM (`MAIL_ENCRYPTION_KEY`) and is never shown again.
- Every folder except Sent, Drafts, Trash and Junk is read, each mail once, from the last UID read in each folder.
- Access is read-only: nothing is marked, moved or sent.
- Saga judges each mail (needs attention, FYI or ignore) and scans it for enquiries.
- A mail counts as answered when it is marked answered, filed in "Besvarede", or replied to from Sent. Sent mail is kept as an envelope only.

**Saga's knowledge.** Saga knows:
- the statutes;
- checked summaries of the erhvervsvirksomhedsloven and the årsregnskabsloven, which she cites with source and paragraph and labels as general guidance;
- all minutes and decisions;
- the board's Telegram group;
- team@;
- events since 2019;
- membership;
- the whole of holistisk.org. It is read daily through WordPress' API and archived permanently: page versions, 24 PDFs as text, and media in R2. The raw export of 2026-10-02 is in `docs/legacy/`.

How she answers:
- in the cockpit chat, with a daily question limit;
- to the chair from Matrix (`POST /api/saga/liva/ask`).
She may change the asker's own cockpit list when asked, never anything that concerns others or the whole association.

**Saga in Telegram.** She only listens in the board group: `SAGA_BOARD_POSTING` is off, and `SAGA_MINUTES_PING` is off on staging. Everything she produces goes to the chair privately.

**AI.** Claude Sonnet 5.5 through Requesty's EU router on Vertex AI in the EU, so the board's data stays in the EU. An AI answer that is broken or unreadable is never saved, and never approves anything.

**Event approval (migration 0022).**
- A member's event is `pending` until approved. Only approved events are public and open for registration. The owner still sees their own pending event.
- Fixed teachers are kept by the board as explicit data (`fixed_teachers`), and their events are approved at creation.
- Saga judges pending events on weekdays against explicit criteria: statutes § 1 and § 4, holistisk.org/vision, and the text requirements. She approves only on a clean, complete yes and never fails open. She never rejects; the board decides.
- An edited event is judged again.
- The board can also describe an event in its own words, and Saga drafts it.

**Price calculator.**
- `/beregner` and `/ny-beregner-2026` on every address, and `/` on `beregner.*`. It can be framed by holistisk.org and hjerterum.info.
- It follows prisberegner.replit.app: three booking types (standard, reduced, free), 2 to 10 hours in half hours, and no weekday booking across 18:30 with member discount or free rent.
- The server's room fee for member events is the calculator's quote (migration 0021).
- A booking request from the calculator is laid as an e-mail straight into team@'s inbox. It is rate-limited per sender, and only a hash of the address is kept.

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
- *Updated 2026-10-03:* AI event approval and the fixed-teacher exception are implemented for members' own room bookings (migration 0022, see the checkpoint of 2026-10-03). They are not yet applied to CIRKLER meeting bookings, whose approval exemptions still follow recovered or confirmed rules.
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

### Board cockpit and Saga

- Saga assists the board; the board decides.
  - Nothing is posted in the board's Telegram group unless posting is explicitly switched on, and then only after the chair's approval.
  - Saga never sends mail from team@.
  - She never rejects an event, and never changes what concerns others or the whole association.
- The newest approved minutes are the truth. Saga never invents attendees, decisions, dates or weekdays.
- Access to the cockpit is personal. A login is fixed to one member, and the chair can close it.
- Board data and AI processing stay in the EU (D1 and R2 in the EU, and the EU AI route).
- AI never fails open. An unreadable, broken or failed AI answer approves nothing and replaces nothing that is saved.
- Member figures are kept as totals only.

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

Added for the board's tools (target platform, 2026-09-23 to 2026-10-03):

- Telegram Bot API: Saga in the board group (listening) and in the chair's private chat.
- ElevenLabs Scribe: Danish transcription of meeting recordings.
- Google Drive and Docs (service account): the recordings folder, and the board's minutes document (read, and appended when allowed).
- IMAP (`imap.one.com`): team@holistisk.org, read-only.
- WordPress REST API: holistisk.org, read daily and archived.
- Requesty EU router to Vertex AI EU: Claude Sonnet 5.5 for Saga.
- Cloudflare R2 (`hjerterum-board-recordings-eu`): uploaded recordings and the holistisk.org media archive.
- Matrix (Liva): reads Saga's overview, and asks Saga on the chair's behalf, behind `SAGA_LIVA_SECRET`.

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
- The approved three-mode room-price calculator is implemented; its shared calculation rules
  are the pricing authority for the public calculator and for member event room fees (2026-10-02).
- Member event approval with the fixed-teacher exception is implemented and does not fail open (2026-10-02).
- Stripe payment integration is intentionally deferred; paid flows remain inactive.

Still open:

- Preserve/import the sanitized legacy source snapshot outside Replit. (The public WordPress
  content of holistisk.org is archived since 2026-10-02; the Replit member application is not.)
- **The board cockpit runs on staging.** It holds real board data (minutes, team@ mail, votes) in the
  staging D1 and changes on every merge to `main`. Decide before cutover whether the cockpit gets
  its own production environment, or whether staging is formally its live environment, with
  explicit backup and restore (D1 Time Travel) and a release rule for board-facing changes.
- The two legacy room-fee rows without Stripe invoice-item references require reconciliation before financial cutover.
- Stripe account, test-mode configuration and full end-to-end Clerk/Stripe acceptance are deferred, not blockers for the non-payment migration scope.
- Full public/member visual parity remains open.
- Event signup payments, the 5% payout/admin-fee model, payment-linked cancellation policy,
  notifications and authenticated browser acceptance tests remain open before production cutover.
