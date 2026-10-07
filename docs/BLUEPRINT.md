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
