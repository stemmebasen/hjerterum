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

### Website statistics and the statistics API (2026-10-04)

- Requested: "Byg en statistikside i jeres admin over besøg på jeres offentlige hjemmeside, og et read-only API, der leverer de samme tal til et eksternt overblik. Formatet ... er fælles for flere sites og skal følges præcist".
- Counting (`apps/web/worker/site-stats.ts`, `src/visits.ts`): each public page sends one signal to `POST /api/besog`. No cookies, nothing kept in the browser, no IP address stored. A visitor is an HMAC of IP + user-agent + host with the day's secret, HMAC(`STATS_API_SECRET`, "site-stats:<YYYY-MM-DD>"), Danish days. Not counted: bots, `Sec-GPC: 1`, login/member/admin pages, API calls (only the website's own pages count). The first page of a visitor's day is the entry page and alone keeps source (referrer domain, never the site itself) and campaign (with utm_source). Device from the user-agent, country from `cf-ipcountry`. Visits are deleted after six months (the five-minute jobs), as `/privatliv` says.
- Admin → Statistik (`/statistik` in the admin) and `GET /api/stats/site?days=7|30|90` (Bearer `STATS_API_SECRET`, else 401; JSON in the shared format, `cache-control: no-store`) read the same `siteStats()`. `STATS_API_SECRET` is set by the owner as a GitHub secret and synced to the Worker on deploy; without it nothing is counted and the API answers 401. Changing it starts a new count for the rest of that day.
- `tracksEnquiries` is true: the website's own enquiry forms are counted (below), and `conversionRate` is enquiries per visitor.

### Enquiry forms on the website (2026-10-04)

- Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk" - "Her skal vi i hvert fald have: Henvendelse vedr. opsætning af event, … deltagelse i et event, … medlemsskab, … samarbejde, … økonomi og fakturering, Generel henvendelse".
- As on stemmebasen.dk, one form (`src/enquiry-form.tsx`, topics in `site/enquiries.ts`) is placed where each question arises, with its topic chosen and changeable: Kontakt (generel), Events (deltagelse), Lej Hjerterum (opsætning), Medlemskab, Vision / om os (samarbejde), Lejevilkår (økonomi og fakturering) and the English page. Fields: name, email, phone (required only for "Ring mig hellere op"), a topic-specific detail where it helps, message.
- `POST /api/henvendelse` (`worker/enquiries.ts`) lays the enquiry in team@holistisk.org's inbox (the connected team mail, as the price calculator does), subject "<emne>: <navn>", Reply-To the sender, so it waits in Posthus. Honeypot + fill time against robots; five an hour from one address. If the team mail is not connected the form says so and points to hjerterum@holistisk.org.
- Only day, topic and page are kept (`site_enquiries`, deleted after six months) for the statistics; nothing about the sender is stored on the website. `/privatliv#henvendelser` says so.

## 2. Product scope


### Medlemmer in admin (2026-10-04)

- Requested: "Hvad med "Medlemmer"-sektion i admin, hvor vi kan se medlemmer, profilinfo, status og historik?" - "Husk den skal lægge sig op ad hvad MembershipWorks gør med medlemmer" - "vi skal kun fokusere på vores eget systems medlemmer".
- Admin → Medlemmer (`worker/cockpit/memberPages.ts`, `worker/member-admin.ts`) lists the platform's own members (`members`) with search, status filter and key figures. A member's page follows MembershipWorks' layout: the membership label with its status ("I restance 35 dage"), then the tabs Medlemskab (billing, since when, member since), Kontakt, Tidslinje (with notes) and Events (created here or as host in the calendar, and sign-ups).
- The timeline (`member_timeline`, migration 0037) is written by Stripe's member webhook (joining, `invoice.paid`, `invoice.payment_failed`, status changes, cancellation; idempotent per event) and by the board's actions. The Stripe webhook endpoint must subscribe to `invoice.paid` for payments to show.
- "Giv medlemskab" gives a membership with no card payment (MembershipWorks' "Manual Billing"): `billing = 'manual'`, tied to the person's Clerk login with a verified email. The member area shows it without Stripe actions, and it is never sent to Stripe. Only manual memberships can be changed, ended or reactivated in admin; Stripe memberships are managed by the member.
- MembershipWorks' account export can be uploaded for reference only ("Det er godt at have dette liggende, når og hvis medlemmet vælger at oprette sig i vores nye system. Indtil da fortsætter de blot i MW"). It gives no one access. When a person in it becomes a member here, member since, phone and teacher are carried over, and the timeline reminds the board to stop the payment in MembershipWorks while it still runs. The export holds personal data: it lives only in D1, never in the repository.
- MembershipWorks' figures from a screenshot moved to Medlemmer → Tal fra MembershipWorks (`/medlemmer/tal`).
- The switch (2026-10-04): "det er meningen at vi ved turnover importerer alle medlemmer og fra den dato begynder at trække kontingent over vores nye system". Medlemmer → Skiftet fra MembershipWorks previews every account of the latest export (card, manual, free, past due, already a member, skipped) and one confirmed button moves them (migration 0038). An imported member is `clerk_user_id = pending:<email>` until their first login with that verified email; card members keep paying in MembershipWorks (`pays_in_membershipworks`) until the platform takes over on `next_charge_on`. Taking over the charging through Stripe is not built yet: "Spørg mig når vi kommer dertil" (which Stripe account, whether MembershipWorks uses subscriptions, the date).
### Board members' responsibilities (2026-10-06)

- Each board member writes what they are responsible for, in their own words (at most 600 characters): asked on their front page until it is written (inline form), editable under Profil (`/profil`, `POST /profil/ansvar`; an empty save changes nothing). Stored in `cockpit_responsibilities`.
- Saga reads them: her knowledge for the admin chat and Matrix has an "ANSVARSOMRÅDER I BESTYRELSEN" section, listing who has not written yet, so she can say who a matter concerns and who should be told.

### Each member's own front page (2026-10-06)

- Saga's overview now has two lists: `forJacob` (what waits on the chair, unchanged, shared with Matrix) and `forMembers` (`to`: first names, or `"alle"`, for what concerns other board members or the whole board). She is given ANSVARSOMRÅDER and what each member has ticked off, and told to write `["alle"]` rather than guess. An overview saved before this field existed is made again once.
- Each member's front page and Opgaver show their own list: the chair's `forJacob` (chair only) plus the `forMembers` items written to them by name or to all, minus what they have ticked off. Ticking is per member (`cockpit_saga_done`); the chair's own list is still ticked through `board_owner_done` so Matrix follows.
- Under "Hej <name>" a line in the member's own numbers ("Der venter 3 ting på dig, og én har frist i dag. Du har 1 referat til godkendelse."), and the responsibilities they wrote, with a link to edit.

### Saga learns from the conversations (2026-10-06)

- While answering in the admin chat (and Matrix), Saga may write `[[HUSK omfang=mig|alle tekst=...]]` when a member tells her something worth keeping or corrects her. `mig` is about that member and used only when answering them; `alle` is about the house or how the board works and used for everyone. Stored in `saga_memories` (at most 60 for the house, 30 per member, the oldest let go; the same text once; 280 characters). Each memory says who taught her.
- They go into her context under "DET, DU HAR LÆRT AF SAMTALERNE", below the real material: minutes, statutes and the rest still win if they disagree.
- "Det Saga har lært" (`/hukommelse`, linked from Profil) shows them to every member (the house's and their own); a member forgets their own, the chair any. The chat window invites members to tell her when she is wrong.

### Login: only people who are in the board's group now (2026-10-06)

- A personal login link from Saga is given only to a Telegram account that has written in the board's group **and is in the group right now** (Saga asks Telegram, `getChatMember`). The chair's own account always counts. If Telegram cannot say, Saga asks them to try again - nothing is given.
- Once an hour Saga checks everyone she knows from the group; whoever has left is signed out of every device (shown as "Adgang lukket" on Administratorer) and cannot get a new link. Nothing happens if Telegram cannot answer.
- The chair's own pages (Administratorer, Samtaler med Saga, forgetting others' memories) need the chair's personal login: with the shared password anyone can pick any name.
- The link opens in Telegram's own browser, whose cookies stay there - so a member was signed in "in Telegram" and had to ask again in Safari/Chrome (reported 2026-10-06). Saga therefore sends an eight-digit **code** with the link (`<code>0000 0000</code>`, tap to copy). It is typed on the login page (`POST /login/kode`) in whichever browser the member uses, and that browser is kept signed in for 180 days. The code sits on the link's row (`cockpit_login_links.code_hash`, keyed hash with the bot token, migration 0045): one use, the same 15 minutes, and using the code uses the link up and the other way round. Guessing is stopped after 10 wrong codes from one address or 20 from anywhere per quarter of an hour.

### The chair's powers - one foundation (2026-10-06)

The chair's powers will grow, so they live in one place: `worker/cockpit/authority.ts`.
- `POWERS` names every power and what it takes: `named` (the person says they are the chair - only for what is harmless to show, since with the shared password anyone can pick any name) or `personal` (logged in with the chair's own link from Saga, given only to her Telegram account).
- The handler decides with `may("power")` and answers `denied("power")`; nothing else asks "is this the chair?" on its own. `actorOf` / `can` / `denial` are unit-tested for member, chair by name and chair with her own login.
- Anything that reads or changes something about other people is written to `chair_audit` with `audit(...)`: reading members' conversations with Saga (and downloading them), closing a member's access, connecting or disconnecting team@, forgetting what others taught Saga. The chair reads the log at `/formand/log` (Profil → Bestyrelsens medlemmer). Her own things (her own memories) are not logged.
- **To add a power:** a line in `POWERS`; `may("...")` where it is used; `audit(...)` if it touches others; a test. The log page lists the powers automatically.
- Open governance choice: who may read the log. Today only the chair; the board could be given a read-only view later.

### The shared admin password is off (2026-10-06)

- "Du må gerne fjerne fælles password": the admin no longer takes the shared password. The login page shows only "Få dit login fra Saga på Telegram"; the way in is Saga's personal link (given to someone who is in the board's group now). A shared login made earlier stops working.
- It is an emergency door only: set `COCKPIT_SHARED_LOGIN=on` (with `COCKPIT_PASSWORD` set) to open it again. Delete the `COCKPIT_PASSWORD` secret in Cloudflare when you are sure it will not be needed.

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

### Members create their own events (2026-10-05)

- Mine events (`/member-portal/events`): the member picks one date in a month picker (an event is never overnight, so it ends by midnight at the latest), then start and end in half hours (2-10 hours). The chosen day is shown as a timeline next to the picker: approved events, the membership calendar's events, and other members' waiting events as "Optaget" (never by title), with the 18.30 evening line. A taken time, a weekday reduced/free rent across 18.30, a past time or a bad length is named and blocks the button; the first free two hours are suggested. `GET /api/room-bookings/day?date=` feeds the day.
- The room's price is shown for each kind of rent (standard, reduced, free) for the chosen time, from the calculator's own rules (`worker/beregner/quote.ts`).
- Photo and files (requested; the photo rules follow the booking form): one cover photo (jpg, png, webp or gif, up to 8 MB) and up to five other files (pdf, Word, Excel, PowerPoint, OpenDocument, text or pictures, up to 10 MB). What a file is comes from its first bytes. The photo is public once the event is approved; a new photo on an approved event is looked at again. The other files are for the organiser, the confirmed attendees and the board (the admin shows them when it approves an event). The bytes are in R2 (`EVENT_MEDIA`), the rows in `room_booking_files`; uploads are off until that binding exists.
- Decided, not built yet: paid events charge the attendee's card at once (the card used for dues) and the organiser's room rent on the day of the event, from the same card. Nobody can book the room or sign up for an event while their membership payment is behind. Stripe is not connected on staging, so a ticket price above 0 kr. is refused with a clear message until it is.

### Administratorer (2026-10-06)

- The chair, as super admin, sees who has admin access and who is active: admin → Medlemmer → Administratorer (`/administratorer`, chair only; others get 403). Two lists: the board in the admin (everyone who has written in the board's group, with when they last used a personal login link, asked Saga or worked a task; "Adgang lukket" after the chair closed it) and the admin e-mails of the member area (`ALLOWED_EMAILS`, each looked up at Clerk for name and last sign-in). Active means seen within 30 days. The shared admin password does not say who is who, so it counts for no one. Read-only.
- The chair can also read what the board's members asked Saga and what she answered: Administratorer → Samtaler med Saga (`/samtaler`, chair only; others get 403). It reads `cockpit_questions` (admin and Matrix, kept 90 days), groups one person's questions less than 30 minutes apart into a conversation, filters by member and word, and downloads as plain text (`?udskrift=1`).

### To-dos: check off from the front page, and no duplicates (2026-10-07)

- "Dine opgaver" on the front page has the same lines as Opgaver, with the checkbox to the left (`openLines` in `cockpit/todosPage.ts`, used by both): press it and the task is done, and you are back at "Dine opgaver" (`back=forside`); × removes it from your list there too.
- "Please also delete duplicates when it comes to to-dos": the same task from the minutes, the minutes document, Saga's list and your own items is one line (word-stem match, `sameTask`) on the front page, Opgaver and in Matrix (the chair's list: checking it takes them all). The shared list "Hvad bevæger sig" shows a person's task once (`uniqueTasks`). A to-do with the same words as one that is already open on the owner's list is not written again ("Den opgave står allerede på listen."). Once a day Saga deletes the open to-dos that stand on a list twice (same owner, same words, oldest stays; `removeDuplicateTodos`) - what is checked off is not touched.

### Proposals: easier to write, and on everyone's front page (2026-10-07)

- "Opret forslag til afstemning" was the first card on Beslutninger (`#nyt`) - now a fold-out tab, see below - then what is up for vote, then the decisions; the decided votes are folded away at the bottom.
- Every open proposal is on **every member's front page**, right under the four boxes, in an accent-tinted card ("Forslag til afstemning", `frontVotes` in `cockpit/votes.ts`): the title (a link to the proposal), who made it, the deadline and the majority needed, the bar and the count so far, and the vote buttons - a pill says "Du mangler at stemme" until the member has voted. A vote from the front page comes back to the card (`back=forside`). The card is gone when no proposal is open. The "Stem om: ..." line stays on the to-do lists.

### A proposal that is voted in looks the part (2026-10-07)

- "Du må gerne få det til at se lidt højtideligt ud, når et forslag er stemt ind. Start et forslag enten med et badge eller en laurbær": an adopted proposal starts with a **gold laurel wreath** around a check mark (`laurel()` in `cockpit/votes.ts`, drawn from leaves along a circle) and the gold **GODKENDT** badge, in a gold-edged card (`--gold`, light and dark; the bar of votes is gold too). The same gold badge sits in the decisions list.
- For a week after the vote it also stands open: in "Vedtaget" on **every member's front page** (above the open proposals) and in "Vedtaget den seneste uge" on Beslutninger; after that it moves to the folded "Afgjorte afstemninger" (and stays in "Besluttet").
- A quick **"+ Stil et forslag"** button in the front page's header (to `/beslutninger#nyt`) for every member.

### A proposal: digital vote or at the next meeting; laurel on old decisions; the form folds out (2026-10-07)

- "Når man stiller et forslag skal man kunne vælge om man ønsker digital afstemning eller afstemning på næste møde": the form asks **how** - *Digital afstemning* (the default; the deadline field shows) or *På næste møde*. `board_proposals.mode` is `digital` or `moede` (migration 0047).
- A proposal for the meeting is **not voted on here**: no vote buttons, no "Stem om:" to-do, no deadline and no auto-settling (`settle`/`settleDue`/`awaitingVote` skip `moede`). It stands under **"Til næste møde"** on Beslutninger and on every member's front page, with the next meeting's date. After the meeting any board member presses *Vedtaget på mødet* or *Ikke vedtaget* (`decideAtMeeting`, `POST /afstemninger/moede`); a vote adopted that way gets the laurel and the gold badge like any other, and is marked "Møde" as its source in Besluttet. The proposer can still withdraw it.
- "Hvis næste møde forslår Saga det som punkt på næste dagsorden": `votesForSaga` marks it `AFSTEMNING PÅ NÆSTE MØDE`, the agenda prompt (`agenda.ts`) says it must be an item, and `withMeetingProposals` adds "Afstemning: ... (stillet af ...)" before *Eventuelt* when the model left it out (the cap of 12 yields to it) - so it is always on her suggestion.
- "Laurbær designet skal også vises på historiske beslutninger": **every decision in Besluttet wears the gold laurel** (`decisionsPage`), a vote also the GODKENDT badge; the text is centred vertically beside it, and the date and source columns do not wrap.
- **Principle - a decision is valid when it is taken** ("bare fordi referatet ikke er godkendt, betyder det jo ikke, at vi ikke har truffet gyldige beslutninger"): the approval of the minutes is bookkeeping and never decides how a decision is shown. A first version tied the laurel to the minutes being approved by every member and left the decisions of the minutes still waiting without it - that was wrong and is gone. Where the minutes were made in the admin and not everyone has approved them yet, the source column only adds its own muted line, "Referatet: 2 af 5 har godkendt" (`approvalCounts`; a correction is not an approval) - about the minutes, not the decision. The minutes document's decisions have no such line.
- "'Opret forslag' fylder for meget nu. Kan den være en fold-ud bjælke i højre side?": the form is a **tab on the right edge** of Beslutninger (`<aside class="drawer" id="nyt">`) that folds the form out over the page - closed by default, `Esc` or the tab closes it, `/beslutninger#nyt` (the front page's "+ Stil et forslag") opens it. On a phone the tab sits lower on the edge and the opened form is a sheet under the header. Without JavaScript the form is simply shown.

### Saga's chat widget has its own colour (2026-10-07)

- "Der er rigtig meget blåt på siden ... en alternativ farve til chatwidgetten, som passer til temaet": the "Spørg Saga" button and her panel are **coral** (from the page's rose glow) - `#c4523a` by day, a soft `#f2a58e` at night - instead of the cobalt. Only the tokens change, scoped to `.saga` and `.saga-fab` (`SAGA_STYLE` in `cockpit/page.ts`), so her buttons, her ideas and the bubbles for what you write follow along; the rest of the admin stays cobalt.

### The front page: proposals further down, smaller buttons on a phone (2026-10-07)

- "Forslag til afstemning skal længere ned på forside - over medlemmer": the proposals (and "Vedtaget" and "Til næste møde") stand in the left column of the front page, **after "Dine opgaver" and the latest minutes and right above "Medlemmer"** - no longer right under the four boxes. The "Stem om: ..." line stays in "Dine opgaver", so a member who still has to vote sees it first.
- "Knapperne er ret store og virker massive på mobil": on a phone every button is a little smaller (42 px, 14.5 px text); the three votes stand in **one row**, "Undlad at stemme" shortened to "Undlad" (`voteLabel` in `cockpit/votes.ts`; the text node pair "Undlad" + "at stemme" is translated); "Jeg ønsker at drøfte dette på et møde" and "Træk forslaget tilbage" are quiet underlined text lines under them.

### Only what the question needs, and a second call when Saga misses something (2026-10-09)

- "Kan der ikke kun sendes det relevante med for det pågældende spørgsmål?" and "en vurdering af det, der kommer tilbage ... et nyt kald, hvis vi mangler mere info, helt automatisk": a question to Saga in admin no longer carries the whole pack. The small parts always follow (date, decisions, agreements, meetings, status, responsibilities, member figures, votes). The **heavy** ones - *vedtaegter, foreningsret, medlemskab, leje, hjemmeside, events, referatdokument, mail, chat* (`HEAVY_SECTIONS` in `cockpit/ask.ts`) - follow only when the words of the question (and of the turns before it, so a follow-up keeps its topic) point to them (`sectionsFor`, plain word lists - no AI). The approved minutes are cut from 140,000 to 40,000 characters (the question's own meetings first), and the group's messages from 400 to 100 when they are wanted.
- **The check:** the first call is told that she has only what looks relevant, and that if she cannot answer properly she must reply with only `[[MANGLER: part, part]]` (or `[[MANGLER]]`). The code then asks **once more** with the named parts added - or the whole pack when she names none - and the member sees only the second answer. A marker in the second answer is removed, never followed. The two calls are told apart in AI-forbrug (`spoergsmaal`, `spoergsmaal-udvidet`), so the share of questions that needed a second call can be seen.
- Not changed: Saga's private chat with the chair on Telegram still gets the whole pack. The word lists are a first guess - when the share of second calls is high, a word is missing from a list.

### A middle model (2026-10-09)

- "Men er der ikke en mellemmodel ...?" - `anthropic/claude-haiku-5-5` (`AI_MID_MODEL`): a third tier between DeepSeek (simple tasks) and Sonnet 5.5 (everything the board reads as Saga's own words). `completeAs("purpose", "mid")` uses it, and the main model answers when it fails or is not set. It does: the agenda suggestion, "Bestyrelsen lige nu", the summaries of the teachers and the review of members' events.
- **The mails of team@ are on it too** ("Alle 3 lyder fint"): the scan and the labelling (`mail-scan`, `mail-maerkater`) use the middle model. `anthropic/...` is Anthropic's own route, not the EU one (`vertex/...@eu`) chosen for the board's data - the chair accepted that for the mails. Two things cut the calls further: **mail from a system** (a no-reply or mailer-daemon sender, a notification or newsletter address, an "unsubscribe" footer - `isAutomatic`) is labelled *Automatisk* without any call (only sender and footer decide, so a real demand for payment from a person is still read), and the text sent per mail is **400 characters** (300 for labelling), not 700.

### Fewer automatic AI calls (2026-10-09)

- "Lad os lave et kald en gang i timen i stedet for hvert kvarter" (the scan of team@: labels, urgency, enquiries) - back to **once an hour** on weekdays, and only when there is something new. A critical mail therefore waits up to an hour for Saga to see it (and none at the weekend).
- "Bestyrelsen lige nu skal være max en gang om dagen" - "hver morgen kl. 7": it is written once a day, by the first round from **07:00 on a weekday** (a missed round is made up for until 10:00), and only when something is new - no more that day. Weekends are still left out (no automatic AI at the weekend); say if it should run on Saturdays and Sundays too. The chair's "force" in the code is unchanged.

### Measuring the AI, and a cheap model for the simple tasks (2026-10-09)

- "We spend around $3 to $4 each day on AI calls ... a suggestion on how we can save money" - "Ja, det må du gerne. Og brug gerne den billige deep seek model hvorend det giver mening": **every AI call now says what it is for** (`completeAs("purpose", cheap)` in `saga/ai.ts`) and leaves a row in `ai_usage` (migration 0056): purpose, model, tokens in and out, whether it failed, whether the cheap model had to be replaced. The chair sees it on **Administratorer → AI-forbrug**: the last day and the last seven days by purpose and model, most tokens first. No price is shown - only tokens - because the provider's prices are not known to the code.
- **The cheap model** (`AI_CHEAP_MODEL = deepseek-v4-flash`, the one Saga ran on before Sonnet 5.5, on the same EU router) does the simple tasks: sorting decisions and agreements, and translating (short texts and whole summaries). When it fails the main model answers in the same request (the row says "fallback"), so a wrong name or an outage costs nothing but the price of the main model. With no `AI_CHEAP_MODEL` set everything stays on the main model.
- **Not on the cheap model, on purpose:** the mails of team@ (labels, urgency, enquiries - names and private messages from outside) stay on the main model on the EU router with the data in the EU; so do the summaries, the answers to the board, the agenda and everything the board reads as Saga's own words. DeepSeek's hosting is not confirmed to be in the EU by Requesty's documentation - widen the list of cheap tasks only after that is checked.
- **Where the money probably goes** (to be confirmed by the first week of numbers): every question to Saga carries up to ~140,000 characters of minutes, the minutes document, the group's last 400 messages, the statutes and the law - the same big package each time. Next steps once the numbers are in: send only what the question needs, and cache the part that never changes.

### Labels in Posthus (2026-10-09)

- "I Posthus kan du lave forskellige mærkater, for eksempel medlem, event, generel og økonomi, og gøre det muligt at sortere under de forskellige mærkater": every mail in team@ has **one label** - *Medlem, Event, Økonomi, Generel* or *Automatisk* (newsletters, notifications and other automatic mail) (`board_mail.label`, migration 0055, `LABELS` in `cockpit/enquiries.ts`). Saga gives it in the same AI call as the sorting and the urgency (no extra call), and in the next scans she labels the mails from before labels, newest first, up to 90 days back (`labelUnlabelled`).
- **Sorting:** the chips at the top of Posthus - *Alle, Medlem, Event, Økonomi, Generel, Automatisk* - each with how many it has; a chip shows only that label (`?maerkat=`) in the important mails, the critical ones and the inbox. **A member can change the label** of any mail (a small choice under the mail when it is opened); the choice stays - Saga only labels what has none.
- **Overview:** a search box over sender and subject (it opens the folded lists), the "Kritisk" and label tags on each mail, and the critical mails first.
- Ideas not built yet: an owner on a mail ("Lisbeth tager den"), a note on a mail, snoozing a mail until a day, hiding "Automatisk" by default, and a weekly list of the mails nobody answered.

### The members card in the top row (2026-10-08)

- "Lad os droppe medlems-count vinduet for nu, og i stedet have et card i toppen - et femte kort": the front page's "Medlemmer" panel is gone; the key figures on top have a fifth card, **Medlemmer** - the paying members, the change since the figures before (+2), "betalende medlemmer", "opdateret 6. okt. 2026. Læs mere" - the whole card leads to `/medlemmer/tal` (`membersTile` in `cockpit/members.ts`). The panel with the four figures is still the content of the page of the figures.
- "Til godkendelse-kortet skal forsvinde, når man ikke har noget til godkendelse": that card is only there while a summary waits for the member; the row has four cards without it (they share the width: `grid-auto-flow:column`).

### Critical mail (2026-10-08)

- "Holder hun også øje med mails om der er nogen der er kritiske og vi skal forholde os til hurtigst muligt" - "Bare mig nu": the scan of team@ (`cockpit/enquiries.ts`, the same AI call that sorts the enquiries) also judges **every** new mail for urgency - a complaint, a threat, a legal or official letter, a demand for payment, a warning about security or fraud, something acute in the house, a near deadline - with one line on why (`board_mail.urgent_why`, migration 0054). Newsletters, receipts, invoices and ordinary enquiries are not critical.
- **The chair is told on Telegram, privately** (never in the group), once per mail (`urgent_notified_ms`): who, subject, why and the link to Posthus. Only mails from the last three days (an old mail is not announced), a failed send is tried again in the next scan. Nobody else is told - widening it to the board is one change in `tellChairAboutUrgentMail`.
- **Posthus** shows "Kritiske mails" first (the last week, with why Saga thinks so), and a "Kritisk" tag in the inbox. The scan now runs every **quarter of an hour** on weekdays when there is something new (it was every hour); at the weekend it still waits until Monday (no automatic AI at weekends), so a critical mail on a Saturday is seen on Monday morning.

### Saga suggests only when asked (2026-10-08)

- "I do not want Sagas suggestions here in the overview. The suggestions can be called forth when you are editing the meeting, but I don't want them to take up so much space and to be implemented automatically.": **nothing is put on an agenda by itself any more** - not in Saga's morning round (`scheduledAgendaSuggestion` is gone), not when a meeting is planned or ticked as a team meeting. On a meeting's page ("Rediger møde") the two buttons are there: "Bed Saga om forslag til dagsorden" (`suggestForTeamMeeting`: the AI chooses up to five, the document's first points stand in if it fails) and "Tilføj Sagas forslag fra dokumentet". The limit of five, the English made with the Danish, the cross and the pencil are unchanged.
- **The overview of the meetings** (and the front page's meeting box) shows only the board's own points; Saga's are left out. A meeting that has only hers says "Kun Sagas forslag endnu - du finder dem under Rediger møde." The morning message to the group still lists the whole agenda.

### Tidier front page, and folded cards on Møder (2026-10-07)

- "On the front page, we don't show any items for the coming meeting, but simply just tell about the meeting": the front page's "Næste teammøde" card says **when and where** (date, time, place, how many days, leader and moderator) and has one link, "Åbn mødet og dagsordenen →". The points of the agenda are on the meeting's page only.
- "And we don't give these figures" (the list of membership kinds with their price and share): the front page's "Medlemmer" panel has the **four figures** (paying, yearly revenue, free, in arrears) and "Alle tal og opdatering →"; the share of each kind of membership is on the page of the figures (`/medlemmer/tal`) only (`membersPanel(base, rows, front)` in `cockpit/members.ts`).
- "Record a meeting and Plan a meeting should be quite folded when you enter the page, and bring them up right next to each other vertically": on Møder "Planlæg et møde" and "Optag et møde" (the recorder and the upload; it was "Upload mødeoptagelse") are **cards that stay folded** (`foldCard` in `cockpit/page.ts`; the title is the button), one right under the other at the top of the right column, with the note about Saga's morning message under them and "Holdte møder" below. A link to `#nyt` or `#upload` (the front page's "Planlæg et møde", the recorder) opens the card, and a date or kind in the link (from "Sæt i kalenderen") opens "Planlæg et møde" at once.

### "Summary", not "minutes" - and Danish and English together (2026-10-07)

- "Let's not call it Minutes - call it summary all around": in English the board's *referat* is a **summary** everywhere a person reads it - the English admin (`cockpit/i18n.ts`: "Summary", "Approve the summary", "Summaries from Saga", "Latest summary", the counts "1 summary / 3 summaries" ...), the English summary page and its title, the notes, and Saga's own English (her translation prompts and her English answers are told never to say "minutes"). Danish stays *referat*. What is **not** renamed, because renaming it would break things: the code (`board_minutes`, `minutesDoc.ts`, `approvedMinutes`, ...), the database and the design notes in this file, which still say "minutes" for the technical thing. A text Saga translated before this change and has kept (`cockpit_translations`) may still say "minutes" until its Danish text changes.
- "She might as well make both a Danish and English summary": the English summary is **made with the Danish one** - in Saga's round (`scheduledEnglishSummaries` in `cockpit/translate.ts`: the three newest drafts or approved summaries that have no English yet, one per round, a failed one tried again in the next hour), whether or not anyone reads in English now. It is kept by the hash of the Danish text, so a change in the Danish summary (a correction) has it made again. A member who reads in English opens the English summary at once ("Saga's English version of the Danish summary - the Danish original is the valid version", with a way back to the original); "Read in English" is only there for a summary that has none yet.
- "Saga should come with suggestions in either Danish AND English depending on what language was picked": her points for the agenda are made in English **with** the Danish ones (`englishAgenda` in `cockpit/agenda.ts`, one request, kept in the same translations the pages use) - in her morning round, and in the background after "Bed Saga om forslag", the document's points and the Teammøde tick (the round catches up within five minutes where there is no background). The meetings page and a meeting's page are translated for a member who reads in English (`autoTranslated`: `/moder`, `/moder/<id>`), so they see her points in English and a Danish reader the Danish. The stored points stay Danish (they are what the cross, the pencil and the order work on).

### Folded sections across admin (2026-10-07)

- "Vi skal også benytte samfoldede afsnit på siden generelt, ellers bliver det for voldsomt": long lists show **five lines and fold the rest under a button** (`fold(...)` and `SHOWN = 5` in `cockpit/page.ts`: a `details.fold` whose summary is a round button with the number that is hidden, and a "Skjul ..." text while it is open). A fold is closed from the start; it holds the rest in the same order, so nothing is cut away.
- **Opgaver**: "Dine to-do's" and "Skriv en opgave" stand side by side (`.todo-row`, the list wider; one under the other on a phone). What is done - in "Dine to-do's" and in "Hvad bevæger sig" - is folded ("Klaret de sidste 7 dage (n)"), "Hvad bevæger sig" shows only the open tasks, and the archive is folded as before.
- **Møder**: the points of an agenda stand in a frame of their own (`.agenda-box`), clearly apart from the meeting's date and the roles line; five points, then "Klik her for detaljer" with the rest numbered on from six. "Holdte møder" shows the five latest, then "Klik her for at se alle møder" with the older ones (each table keeps its header row: the phone layout hides the first row of a table).
- **Beslutninger**: the five latest of "Besluttet" and of "Uformelle aftaler", then "Klik her for at se alle beslutninger / aftaler". A search opens the folds, so it finds among all of them. (The "Uformelle aftaler" heading no longer overlaps its note.)
- **The rest**: Posthus' inbox (five mails, "Klik her for at se flere mails"), Arkiv (minutes and earlier days), Samtaler med Saga (five latest conversations), Arrangementer (coming events, latest held, hosts, categories) and a member's events. Search results on Arrangementer are not folded - they are what was asked for.

### Saga brings five points to the agenda, not eighteen (2026-10-07)

- "Det er alt for voldsomt med så mange forslag. Hun bør prioritere de fem vigtigste.": on a meeting's agenda **Saga has at most five points at a time** (`SAGA_POINTS`, `sagaRoom` in `cockpit/data.ts`; enforced in `addAgendaPoints`, so every way in - the tick box, "Tilføj Sagas forslag fra dokumentet", "Bed Saga om forslag", her morning round - stops at five). The count is her points that are still on the agenda: one deleted with the cross, or rewritten by a member, frees a place; the board's own points never count.
- The cause of the eighteen: the minutes document's list was put on the agenda **and** the AI's own list was put on top, in other words, every morning. Now the AI is given the document's list as material and **chooses** the points that are missing up to five, most important first, merging points that are about the same thing and leaving out the routine ones (approval of agenda and minutes, any other business) - one call. If the AI fails, the document's first points stand in. With five on the agenda she makes no AI call at all; the button answers "Saga har allerede fem forslag på dagsordenen ... Slet et med krydset, så finder hun et nyt."
- A proposal to be voted on at the next meeting is still always on the agenda (it pushes out the model's last point, and is not added twice when it is already there).

### Saga's chat does not pop up on a phone (2026-10-07)

- "Chat skal ikke poppe op på mobiler": the chat still opens by itself a minute after the page opens, once per browser session ("Lad Saga poppe op efter et minut") - but **only on a wide screen**. Below 760 px (a phone) the chat fills the whole screen, so there it opens only when someone presses "Spørg Saga" (`matchMedia("(max-width:760px)")` in `sagaChat`, `cockpit/page.ts`).

### The meeting page: roles, order, who made a point, the morning message (2026-10-07)

- "På denne side bør det fremgå tydeligt, at man er ved at redigere mødet.": a banner **"Rediger møde"** (pencil, accent pill) above the date, and the page title says it too (`.editing-banner`).
- "Der skal i øvrigt kunne vælges en Mødeleder og Ordstyrer.": two choices among the board in the meeting's form and in "Planlæg et møde" (`board_meetings.leader`, `moderator`, migration 0052). Only a name on the board can be picked (a name that has left stays until changed); a form without the fields leaves them, "Ikke valgt" clears them. Shown as "Mødeleder: Frederik · Ordstyrer: Lisbeth" on the meeting, in the overview, on the front page's "Næste teammøde", in Saga's morning message and in her knowledge of the meetings.
- "man skal i øvrigt også kunne flytte punkterne op og ned. Helst drag and drop.": every point has a **grip** (six dots) - drag it with the mouse or a finger, or focus it and press the arrow keys; the new order is sent at once (`POST /moder/:id/punkt/raekkefolge`, `reorderAgendaPoints`: the points given come first in the given order, the ones not given follow, an unknown one is ignored). The script listens on the document, not on the grip: moving the row in the page lets the grip lose its pointer, and the drop would never arrive. The page's scripts are syntax-checked in the tests (`new Function`) - a `\n` lost in a template once made the whole script fail, which only a real browser showed.
- "kan vi skrive et bestyrelsesmedlems navn, hvis det er ham, der har oprettet punktet, og bruge samme farvekode som under opgaver?": each point carries a chip with the first name of the one who made it, **in the colour the member has under Opgaver** (`personChip`/`WHO_CHIP_STYLE` in `todosPage.ts`; the colours go by the board's sorted names); Saga's points keep "Sagas forslag". `board_meetings.agenda_authors` (migration 0053, JSON point -> name): the maker stays when a point is edited; a point of Saga's that a member rewrites is the member's; an old point has no chip.
- "Om morgenen for teammødet skal Saga sende en besked til gruppen ...": in her round, **on the day of a team meeting from 08:00 until it begins (12:00 without a time), once, when the agenda has points** (`scheduledAgendaReminder`): "God morgen 🙂 Dagsordenen til dagens teammøde er klar (n punkter), og vi ses kl. 13:30 - <sted>", the roles, the points (twelve at most), and "Se dagsordenen her: <link>" - straight to `/moder/<id>#dagsorden`. Fixed words, no AI. She writes only when she may in the group (`SAGA_BOARD_POSTING`); a send that fails is tried again in her next round. "Planlæg et møde" says so in an info note under the box.
- Task lines whose "hvem" is a topic ("Fast fremtidig rengøringsordning - tages op igen") are tasks for everyone with the topic in the text, not a person in the filter (`looksLikeWho`/`sensibleWho` in `data.ts`; the minutes and Saga's reading of the document); the templates tell Saga that "hvem" is first names or "Alle", never a topic.

### The agenda is a list of points (2026-10-07)

- "I forhold til oplæg til dagsorden skal vi bare have det i punktform, så man kan oprette et punkt. Der skal altså ikke være fri tekst. Jeg forestiller mig, at Sagas forslag allerede er præsenteret i punktform i bunden, og at man let skal kunne slette hver med et kryds." The agenda on a meeting's page is **a list of points, one row each, with a cross** - there is no text field for the whole agenda any more. A point is added one at a time in a single-line field ("Tilføj punkt"; one line, at most 200 characters, numbering and bullets stripped, the same point is not added twice); date, time and place are saved apart ("Gem dato, tid og sted") and never touch the agenda. `addAgendaPoints` / `removeAgendaPoint` in `cockpit/data.ts`, `POST /moder/:id/punkt` and `/punkt/slet`.
- **Saga's suggestions are points at the bottom of the agenda**, each with a small "Sagas forslag" mark and its cross: "Bed Saga om forslag til dagsorden" (the AI) and "Tilføj Sagas forslag fra dokumentet" (her suggestion from the minutes document) put her points on the agenda at once - the board deletes what it does not want. The mark lives in `board_meetings.agenda_saga` (migration 0050) and goes when the point is deleted. When a meeting is planned, a tick box "Tag Sagas forslag med som punkter" does the same (the front page's "Sæt det i kalenderen" has it ticked). Saga's open proposals for the meeting ("AFSTEMNING PÅ NÆSTE MØDE") still end up on the list (`withMeetingProposals`).
- **The pencil**: "en let måde at redigere et punkt på. Måske en lille blå blyant til venstre for krydset" - a small blue pencil stands before the cross on every point and opens the point for editing in place (a field with Gem / Annullér); `editAgendaPoint`, `POST /moder/:id/punkt/ret`. The new text keeps the point's place; a point of Saga's that a member rewrote is theirs now (no mark); empty text, a missing point or a duplicate change nothing.
- A form that still sends a whole `agenda` field (old links, tests) is read as before, one point per line.

### Team meetings: Saga only suggests for a team meeting, once a day (2026-10-07)

- "Saga skal ikke foreslå noget til et møde, før hun ved, om det er et teammøde." / "Der bør bare være en rediger møde-knap. Og her først, når man har afkrydset teammøde, kommer Sagas forslag." A meeting is a **team meeting when "Teammøde" is ticked** - one tick box among date, time and place on "Planlæg et møde" and on the meeting's page (`board_meetings.kind`: `team`, or `andet` when saved unticked, NULL for the old ones and the ones Saga made in the chat; migration 0051). A meeting Saga found is pre-ticked from its own words (`guessKind`: *team-/bestyrelsesmøde* = team, *generalforsamling/infomøde/workshop ...* = not). The tick box is a round pill (`label.pick`) - the "grå kasse" was the page's wide input style on a bare tick box.
- **The overview of the meetings has one button per meeting: "Rediger møde"** (no row of small links, nothing about kinds; only a small "Teammøde" tag on those that are). Without a ticked team meeting there is **no** "Bed Saga om forslag" and no document suggestion - and the server refuses them too (`?forslag=ikketeam`), so an old link cannot make her. Ticking and saving on the next team meeting puts her suggestion from the minutes document on the agenda at once (no AI).
- "Sagas forslag til næste teammøde skal fremgå, når man kommer ind på siden. Disse forslag skal genereres én gang i døgnet": in her round, **once a day from 05:00 Danish time, for the next meeting that is a team meeting** (`scheduledAgendaSuggestion` in `cockpit/agenda.ts`, claim per meeting and day): the document's suggestion (no AI) and one AI call (`suggestAgenda`), put on the agenda as her points - so they are there when someone opens Møder or the meeting. Deleting a point with the cross takes **no AI call**; a point of hers that was deleted may come again in a later suggestion - she makes a fresh one every day ("de må gerne dukke op igen").
- The front page's **"Næste teammøde"** is the next meeting that is not `andet`; the box "Næste møde" is still the next of any kind.

### The agenda is a list of points (2026-10-07)

- "I forhold til oplæg til dagsorden skal vi bare have det i punktform, så man kan oprette et punkt. Der skal altså ikke være fri tekst. Jeg forestiller mig, at Sagas forslag allerede er præsenteret i punktform i bunden, og at man let skal kunne slette hver med et kryds." The agenda on a meeting's page is **a list of points, one row each, with a cross** - there is no text field for the whole agenda any more. A point is added one at a time in a single-line field ("Tilføj punkt"; one line, at most 200 characters, numbering and bullets stripped, the same point is not added twice); date, time and place are saved apart ("Gem dato, tid og sted") and never touch the agenda. `addAgendaPoints` / `removeAgendaPoint` in `cockpit/data.ts`, `POST /moder/:id/punkt` and `/punkt/slet`.
- **Saga's suggestions are points at the bottom of the agenda**, each with a small "Sagas forslag" mark and its cross: "Bed Saga om forslag til dagsorden" (the AI) and "Tilføj Sagas forslag fra dokumentet" (her suggestion from the minutes document) put her points on the agenda at once - the board deletes what it does not want. The mark lives in `board_meetings.agenda_saga` (migration 0050) and goes when the point is deleted. When a meeting is planned, a tick box "Tag Sagas forslag med som punkter" does the same (the front page's "Sæt det i kalenderen" has it ticked). Saga's open proposals for the meeting ("AFSTEMNING PÅ NÆSTE MØDE") still end up on the list (`withMeetingProposals`).
- A form that still sends a whole `agenda` field (old links, tests) is read as before, one point per line.

### Team meetings: Saga only suggests for a team meeting, once a day (2026-10-07)

- "Saga skal ikke foreslå noget til et møde, før hun ved, om det er et teammøde." A meeting has a **kind**: *Teammøde* or *Andet møde* (a general assembly, an info meeting ...) - `board_meetings.kind`, NULL until someone says (migration 0051). "Planlæg et møde" asks (two round choices, required; a meeting Saga found is pre-filled from its own words by `guessKind`: *team-/bestyrelsesmøde* = team, *generalforsamling/infomøde/workshop ...* = other); on a meeting with no kind the page asks "Hvilken slags møde er det?" with two buttons, and "Møder" has a link. Without a team kind there is **no** "Bed Saga om forslag" and no document suggestion - and the server refuses them too (`?forslag=ikketeam`), so an old link cannot make her.
- The "grå kasse" on Planlæg et møde was the page's wide input style on a tick box; the choice is round radios in pills now (`label.pick`).
- "Sagas forslag til næste teammøde skal fremgå, når man kommer ind på siden. Disse forslag skal genereres én gang i døgnet": in her round, **once a day from 05:00 Danish time, for the next meeting that is a team meeting** (`scheduledAgendaSuggestion` in `cockpit/agenda.ts`, claim per meeting and day): her suggestion from the minutes document (no AI) and one AI call (`suggestAgenda`), put on the agenda as her points - so they are there when someone opens Møder or the meeting. A team meeting that becomes the next one gets the document's suggestion at once (no AI). Deleting a point with the cross takes **no AI call**; a point of hers that was deleted may come again in a later suggestion - she makes a fresh one every day.
- The front page's **"Næste teammøde"** is the next meeting that is not "Andet møde"; the box "Næste møde" is still the next of any kind.

### Decisions and agreements (2026-10-07)

- "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling." A point from the minutes is either a **decision** of the board - or it is not (yet) one: an informal agreement between a few people, a recommendation, a proposal, a backing, something to look into. Decisions keep the gold laurel under *Besluttet*; the rest stands in its own card, **"Uformelle aftaler"**, with a quiet handshake and **never the laurel** (`decisionsPage`; `kind: "aftale"` in the data). The page's H1 is **"Beslutninger og aftaler"** ("Måske kan H1'eren hedde ..."); the menu still says Beslutninger.
- "Lige nu står en linje som 'Der anbefales op til fire suppleanter på generalforsamlingen.' sådan beslutning med laurbær": the first sorting was too generous - Saga left 86 of 100 points as decisions, because the instruction said that doubt means decision. **A recommendation is not a decision** (it is not settled - the general assembly, for instance, settles it). The instruction (`SYSTEM` in `cockpit/decisionKinds.ts`) now sorts by **what the point says**: decided / adopted / approved / set to / introduced = decision; an agreement between persons, a recommendation, a proposal, "there was support for", something to investigate, something to be settled later = not a decision; with this very sentence and the "holder møde" one as examples, and with both mistakes named as wrong. Migration 0049 deletes what Saga had called a decision, so it is sorted again - what she called an agreement and everything a member moved stays.
- Examples from the board of lines that are **not** decisions: "Der anbefales op til fire suppleanter på generalforsamlingen." (a recommendation), "Gitta genopstiller til bestyrelsen." (a notice from one person), "Der blev ikke truffet beslutning om at udsætte fundraisingfestivalen." (nothing was decided). All three are in Saga's instruction, and what says *itself* that nothing was decided is sorted at once, without asking her (`undecided` in `decisionKinds.ts`: "ingen beslutning", "ikke truffet/taget/besluttet/vedtaget/afgjort", "anbefales/anbefaler/anbefalet") - over her own guess, but never over a board member's choice. "Ikke-medlemmer ... sættes til 50 kr." is not caught: only the negation of the deciding word is.
- **New minutes** keep them apart: the template (`MINUTES_SYSTEM`, `IMPORT_SYSTEM`) has `## Aftaler` after `## Beslutninger` (agreements and recommendations), tells Saga to write something under *Beslutninger* only when the board has settled it - and that "Beslutning:" at a point is a settlement, else "Ingen beslutning". Read by `minutesAgreements` (only a real `## Aftaler` heading - `strictSection`, never a point called "### 4. Aftaler med ..."), shown as its own box on the minutes (`parseMinutes`).
- **Everything older** is sorted by Saga (table `cockpit_decision_kinds`, migrations 0048-0049): at most 100 points in one request. When Beslutninger is opened and something is unsorted she sorts it in the background (once per ten minutes; the page says "Saga sorterer ... genindlæs"), and in her round once an hour. The row says "Sorteret af Saga". What she does not answer for, or an answer she cannot read, stays where it stood in the minutes until she can.
- Any board member can move a point (`POST /beslutninger/art`) - but the buttons ("Flyt til aftaler" / "Flyt til beslutninger") stay hidden until **"Ret sortering"** is pressed (`main.sortable`, remembered for the tab): next to every laurel a button reading "Ikke en beslutning" looked like a verdict on the decision; a member's choice is kept ("Sorteret af Gitta") and Saga's sorting never writes over it. A vote that was adopted is always a decision. The validity principle stands: a decision is valid when it is taken, whatever the state of the minutes - the sorting is about what the point *says*, never about the minutes' approval.
- The front page ("Vigtigste punkter fra sidste møde"), Møder and **Saga's own knowledge** list only the decisions; Saga has the rest under "UFORMELLE AFTALER" and is told never to call them decisions (`IDENTITY` in `saga/prompts.ts`).

### Naming: admin, not cockpit (2026-10-07)

- "Let's just call it admin instead of cockpit from now on": the board's site is called **admin** (admin.hjerterum.info) in everything people read - the pages, Saga's messages and answers, the English version, these docs. What is not renamed, because renaming it would break things: the code (`worker/cockpit/`, `handleCockpitRequest`), the database tables (`cockpit_*`), the secrets and settings (`COCKPIT_PASSWORD`, `COCKPIT_URL`, `COCKPIT_SHARED_LOGIN`), the cookies (`hjerterum_cockpit_*`), the old addresses (`cockpit.<domain>`, `/cockpit`, which still work) and the targets Matrix is sent (`cockpit:posthus` ...).

### Undervisere (2026-10-06)

- Admin → Arrangementer → Undervisere (`/arrangementer/undervisere`) collects the teachers by itself: every host name in Hjerterum's calendar (MembershipWorks, since 2019), every booking in the new system, the fixed teachers and what the board has added. Active (a fixed teacher, something coming, or something within a year) first, the rest under "Tidligere".
- Order inside each group: by number of events (default) or alphabetical (`?sorter=navn`, "A–Å"); the choice follows the search.
- The calendar carries only the host's name, so mails and phone numbers come from elsewhere, looked up by the exact name (not case): the website's teacher register, bookings, the fixed teachers, mails to team@ (sender), members and the MembershipWorks import (`contactsByName`). The list says "Mangler kontakt" only when none of them knows anything - the same places the teacher's own page looks. The board's saved contact always wins over what is found.
- Forslag til kontakt (`/arrangementer/undervisere/forslag`, linked from the list when someone lacks contact): for each teacher, the mail or phone number they lack is looked for in the senders of mails to team@ (a phone number only from the text of mails the teacher wrote), the website's teacher register, members and the MembershipWorks import - by first and last name, ignoring capitals, accents, æ/ø and middle initials (`looseKey`). Two teachers with the same first and last name are left out. Nothing is saved by itself: each suggestion shows where it was found and is accepted (**Brug**, fills only what is empty) or declined (**Nej tak**, kept in `cockpit_teacher_declined` so it does not return). No AI is involved - every value is one that stands in the data.

### Recording the meetings (2026-10-06)

- Upload, transcription (ElevenLabs, speakers told apart), minutes along the agenda, approval and the ping to the board already existed for an uploaded file. New: **Optag mødet her** on a meeting's page (when it is held or today) and on Møder, which records with the device's microphone in the browser (`cockpit/recorder.ts`, MediaRecorder) and sends the file to the same `POST /upload`.
- Consent first: the start button is off until the member has ticked that everyone taking part knows the meeting is recorded.
- 32 kbit/s voice (Opus in Chrome/Firefox, AAC in Safari): about 14 MB an hour; the recorder stops and sends at 55 MB (Saga's limit is 60 MB). Pause/resume, a timer, and the screen is kept awake (Wake Lock).
- Nothing is lost with the page: the recording is also written to the browser's IndexedDB every 10 seconds. A closed page, a crash, no network or a logged-out session leaves it there; the page then offers *Send nu*, *Hent filen* and *Slet*. If the microphone is cut off (a phone that locks its screen), what exists is kept and not sent by itself.
- Only the device's microphone is recorded. A meeting on Meet/Zoom is heard only through a speaker the microphone can pick up.
- Stability (asked 2026-10-06): a browser can lose the microphone without saying so (a call, a locked screen, a page in the background; iPhone Safari is the weakest, a laptop on a charger the best). The recorder therefore shows the level of the sound it hears, warns at once when the microphone is silent for 25 seconds, is taken by the phone (`mute`) or stops delivering sound (no data for 35 seconds), notes the holes (about N min. missing at hh:mm), and "Tjek mikrofonen" tries the microphone for six seconds before the meeting. The copy in IndexedDB is not forever: Safari may clear a site's storage after 7 days without use, so a recording that was not sent should be sent the same day. For the first meetings keep a second recorder (the phone's own) running as a backup - an uploaded file goes the same way.
- The audio is deleted (`saga/recordingRetention.ts`, once a day, migration 0046) 14 days after the minutes were last touched - and only when the minutes are made (approved, with a text and a transcript; "Det er fint - så længe referatet er lavet"). A recording that failed, was rejected or is still waiting is the only copy of the meeting and is never deleted. Only audio uploaded or recorded in the admin (R2, `source = 'upload'`); Google Drive files and Telegram voice messages are not touched. Minutes and transcript stay; `board_minutes.audio_deleted_at_ms` marks that the audio is gone.

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

## Natlig kopi, mærkatfarver, flueben og ren mailtekst

- `worker/saga/backup.ts`: hver nat fra 03:00 (dansk tid) lægges én JSON-fil `hjerterum-kopi-ÅÅÅÅ-MM-DD.json` i Google Drive (`GOOGLE_DRIVE_BACKUP_FOLDER_ID`, ellers referatmappen); de seneste 30 gemmes. Login-links, kodeord og AI-forbrug er ikke med. Fejl vises på Status og giver én Telegram-besked i døgnet til formanden.
- Posthus: hvert mærkat har sin farve (`LABEL_CLASS`) og vises som lille mærkat ved hver mail; "Besvaret" er erstattet af et rundt flueben.
- `worker/saga/mailText.ts`: `cleanMailText` fjerner links, sporingsadresser og signaturer (fx avast) fra mailteksten, når den gemmes, vises og sendes til AI. Adresser (e-mail) bevares.

## Mails til bestyrelsesmedlemmer

- Posthus: "Giv til …" på hver mail (`assignMail`, migration 0057). Medlemmet får et kort punkt "Svar på mail fra <afsender>" på sin liste; fluebenet på punktet eller på mailen krydser begge af. Skifter man medlem, eller vælger "Ingen", fjernes det åbne punkt.
- Saga lægger kun opgaver fra Telegram og mail på lister, når hun er helt sikker (`sure`); opgaver kommer primært fra referatet.

## Facebook-omslag på events

- Ét fælles omslag-regelsæt (`event-files.ts`): kun jpg/png, præcis 1920 × 1005 px (Facebooks event-omslag), højst 8 MB. Serveren læser målene fra billedets header og afviser alt andet (`cover_size`).
- Medlemmernes eventformular (`src/cover-crop.ts`) og Saga-udkastet i admin beskærer et større billede fra midten i browseren; et mindre billede afvises (aldrig forstørret).
- Udkastets omslag (`cockpit_event_drafts.cover_*`, migration 0058) bliver eventets omslag, når udkastet oprettes. Udkast slettes med × på listen.

## Undervisere og medlemstal (Gittas kommentarer)

- Undervisere uden kontaktoplysninger, faste eller kommende events kan fjernes fra listen med × (`cockpit_teachers_hidden`, migration 0059). De skjules kun - kalenderens historik røres ikke - og kan sættes tilbage under "Fjernet fra listen".
- Medlemstallene har en kort forklaring: de er skrevet af fra MembershipWorks' dashboard, og gratis, restance og opsagte er hver deres tal.

## CIRKLER-kort på medlemssiden

- Medlemssiden viser et CIRKLER-kort: "Du er med i cirklen <navn> - Gå til CIRKLER", "Du har en profil og venter på en cirkel" eller "Du er endnu ikke med i en cirkel - Opret profil her" (samme signerede billet som før).
- `GET /api/integrations/cirkler/status` (medlemmets Clerk-login) spørger CIRKLER live (`POST /api/hjerterum/circle-status` på cirkler.net) med medlemsreferencen og den nøgle, de to systemer allerede deler. Kun `{profile, circle}` sendes videre; Hjerterum gemmer intet. Svarer CIRKLER ikke, vises kortet ikke.

## Medlemskabets detaljer (2026-10-10)

- Besluttet: Fra første dag i det nye system er MembershipWorks ude af brug; alle medlemmer flyttes ved launch. Medlemskabssiden bygges derfor til Stripe.
- Medlemskab ligger under Min profil (`/member-portal/profil#medlemskab`; den gamle adresse viser det samme), og der er et "Medlemskab"-link i kontomenuen og under "Administrer konto" (Clerk). Siden viser pris, sidst trukket (seneste betalte faktura) og næste træk - eller "Ophører d. X" efter afmelding - og en lille "Afmeld" (opsiger ved periodens udløb). `GET /api/members/me/subscription` læser abonnementet hos Stripe (`subscriptionSummary`).

## Programoversigt på medlemmernes Overblik (2026-10-10)

- "Det sker i huset" øverst på Overblik: "ikke en programoversigt, men en continuity speaker der fortæller hvad der er på vej" - Sagas ord om de to næste events stort til venstre og en fotomosaik af de næste fem (det næste stort, fire små med dag og tid; på mobil en vandret stribe) til højre. Et foto åbner eventet. Før Saga har skrevet dagens ord, står en enkel linje om det næste event. `GET /api/events/program` (`worker/program.ts`).
- Saga skriver én kort, varm indledning om de to næste events ("Lidt senere i dag kommer ... Og i morgen ..."), uden klokkeslæt og uden opdigtede detaljer. Den skrives én gang pr. dag og pr. de to events (mellemmodellen, højst én gang i timen og kun når den mangler) og gemmes i `event_blurbs` (migration 0060).
- CIRKLER-kortet har CIRKLERs logo i deres guld (#D9B35A) i hjørnet. Menupunktet "Mine events" hedder "Opret event".

## Fødselsdag i stedet for adresse (2026-10-10)

- Besluttet: "Vi skal ikke bruge folks adresser. Men gerne fødselsdag, så vi kan lave noget omkring deres stjernetegn på et tidspunkt." Min profil spørger om fødselsdag (`members.birthday`, YYYY-MM-DD, migration 0061) i stedet for adresse; adressen sendes ikke længere til Stripe og vises ikke i admin. Allerede gemte adresser er ikke slettet endnu (afventer svar).

## Om Hjerterum (2026-10-10)

- Én side, skrevet ét sted (`site/pages.ts`, `/om-hjerterum`): kontakt, bestyrelsen (gruppebilledet og et kort pr. person fra `BOARD`) og foreningen. Hjemmesiden viser den på `/om-hjerterum` (med henvisning fra `/kontakt`); medlemsområdet viser samme side under "Om Hjerterum" (`/member-portal/kontakt`, `SitePageInner`). Teamet-siden bruger samme bestyrelsesliste.

## Opret event: bredere dagsvisning og træk (2026-10-10)

- Formularen får mere plads (kommende events smallere ved siden af / under), timerne er højere, og dagsvisningen lægger sig under kalenderen, når der ikke er plads ved siden af.
- "Dit event" kan trækkes op og ned, og den nederste kant trækkes for at ændre sluttiden (halve timer, 2-10 timer, senest kl. 24). Den er stiplet, mens den trækkes, og når tiden ikke er ledig; fuldt optrukket, når den ligger på en ledig tid.

- Speakerens tekst skrives kun, når et event begynder ("bare én generering hver gang et event starter, ikke mere"): den handler altid om de to næste events, der ikke er gået i gang, og bruger ugedag og del af dagen ("søndag formiddag") i stedet for "i dag"/"i morgen", fordi den kan stå i flere dage. Samme tekst står diskret på admins forside og over kalenderen på hjemmesidens forside.

## Ens layout på medlemssiderne (2026-10-10)

- "Det er min profil, der har sandheden": alle medlemssider (Overblik, Opret event, Kalender, Min profil med Medlemskab, Om Hjerterum og adgangssiderne) har klassen `member-page` med Min profils bredde (848 px), topmargin, typografi og kickers. Opret events to kolonner står under hinanden inden for den bredde.
- Speakerens tekst skrives kun, når et event begynder ("bare én generering hver gang et event starter, ikke mere"): den handler altid om de to næste events, der ikke er gået i gang, og bruger ugedag og del af dagen ("søndag formiddag") i stedet for "i dag"/"i morgen", fordi den kan stå i flere dage. Samme tekst står diskret over kalenderen på hjemmesidens forside (ikke i admin, efter ønske).

- Admin kalder "Arrangementer" for "Events" (menu, mobilmenu, overskrift, flise og tilbagelinks); adressen er stadig `/arrangementer`.

## Medlemsfordele i tekst (2026-10-10)

- Formandens tekst om fordelene og tre varianter (`BENEFITS` i site/pages.ts): den fulde på hjemmesidens Medlemskab, "mere end et sted at komme" på forsidens medlemsafsnit, "Dit medlemskab giver dig ..." på medlemmernes Overblik og "Med et betalende medlemskab ..." til støttemedlemmer.

## Foto på visitkortet (2026-10-10)

- Visitkortet kan have et rundt foto: medlemmet vælger et billede, trækker det på plads i en cirkel og zoomer; browseren skærer det til en 480 × 480 jpg. `POST /api/members/me/public-profile/photo` (aktivt medlemskab) gemmer kun en jpg i præcis den størrelse (højst 1 MB) i R2 under et tilfældigt navn, og `GET /api/profile-photos/<id>.jpg` viser den. Visitkortet peger på billedet (`photoUrl`, kun egne adresser).
- holistisk.orgs egne formuleringer (`ABOUT_WORDS`): sloganet som beskrivelse af forsiden og Om Hjerterum, "et åbent og inkluderende rum" og "Uanset om du søger fordybelse ..." i forsidens vision og på Om Hjerterum, listen "Fællesskab, film, sang ..." under forsidens kategorier, prislinjen (fra medlemskabets pris) i forsidens medlemsafsnit og underviserteksten i et nyt "Vil du selv bruge Hjerterum?"-afsnit.
