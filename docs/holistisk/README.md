# Flokk – nye oplevelser, nye mennesker, i trygge rammer

`apps/holistisk` runs two editions from one Worker:

- **Flokk** (www.jacobhauge.com/flokk – /flokken sends on to it – and the Worker's own address): Flokk makes it easier to experience more together with others. It agrees tickets with organisers for selected concerts, talks and other experiences; members sign up for an Udflugt for a symbolic amount and take part with a small flock of other members, with the programme and the exact meeting place sent beforehand. For now: the concept, the coming Udflugter, how it works, an interest list, a page for organisers, and admin pages. [ADR 0009](../decisions/0009-flokk-udflugter.md) (and [0008](../decisions/0008-flokken-forening.md)).
- **The event portal** (www.jacobhauge.com/socialklubben, as Socialklubben): events collected every night from permitted sources, with search, filters, a map and member-made flocks. [ADR 0006](../decisions/0006-holistisk-event-portal.md), [ADR 0007](../decisions/0007-flokken.md).

The collector serves both: the portal shows its events, Flokken's volunteers pick from them. The code and the Cloudflare names still say "holistisk" (`apps/holistisk`, `holistisk-portal-staging`).

## Flokk

- **Pages** (`src/forening/`): `/` (the elevator pitch, the coming Udflugter, an Udflugt step by step, the clear frame, price, organisers), `/udflugter`, `/events/<slug>` (an Udflugt: when, where, the flock, afterwards, price, places, when sign-up closes, "Jeg vil gerne med"), `/saadan-fungerer-det` (every decided rule and what is not decided), `/skriv-dig-op` (interest list), `/for-arrangoerer` (inquiry form), `/om`, `/privatliv` (delete by e-mail). Every other address is a 404; the earlier `/maanedens-events`, `/tryghed`, `/for-foreninger` and `/samarbejde` lead on.
- **Udflugter** (`picks`, migration 0004): copied from a collected event or typed in, then edited; only `approved` ones are shown. Nothing is shown before a volunteer approves it.
- **Interest list** (`interests`): one line per e-mail and Udflugt; signing up again updates it. Consent is required; a hidden field catches robots. No mails are sent yet. Membership and sign-up (first come, waiting list, 7-day close) are not built yet.
- **Admin** (`/log-ind`, `/admin`): suggestions from the collector (search, "Godkend"), a form for an Udflugt typed in, editing and withdrawing, the interest list (and CSV, safe against spreadsheet formulas) and inquiries from organisers. Only members with `is_admin = 1`; create one with `node apps/holistisk/scripts/new-admin.mjs "Fornavn"` and run the printed SQL with `wrangler d1 execute`.
- **Tone**: the experiences, the company and the clear frame; members take part in their own way. `test/forening.test.ts` checks the public pages for host, deficit and undecided wording.
- **Look**: its own, on the portal's colours. The mark is a row of people side by side with one place free – "there is always room for one more"; large on the front page it is a small flock seen from behind on a row of seats in front of a stage, with one empty seat (`src/forening/brand.ts`; `public/assets/flokk-icon.svg` in the tab, `public/assets/og-flokk.jpg` when shared). Fraunces for headings and Atkinson Hyperlegible, drawn to be easy to read, for text (both SIL OFL, `public/assets/fonts`). Thin lines, soft shadows, more air. `data-edition="forening"` on `<html>` switches it on.

## Run it

```sh
pnpm install
pnpm --filter @holistisk/portal test        # unit and page tests on an in-memory SQLite with the real migrations
pnpm --filter @holistisk/portal typecheck
pnpm --filter @holistisk/portal build       # wrangler dry-run bundle
cd apps/holistisk
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=17+3+*+*+*"   # runs the daily collection locally against the real sources
```

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | Worker: routes, security headers, the cron handler |
| `src/sources/` | One adapter per kind of feed (`membershipworks`, `ical`, `jsonld`, `billetto`), the HTTP client (retries, timeouts, robots.txt) and `registry.ts`, the list of sources |
| `src/ingest/` | Normalising, duplicate detection, updates, withdrawal, expiry and the run log |
| `src/web/` | Pages (server-rendered HTML), filters, queries, SEO (schema.org, sitemap, robots, .ics) |
| `src/flokken/` | Flokken: login (`auth.ts`), flocks (`store.ts`, `forms.ts`), their pages and routes, and partners (`partners.ts`: the collaboration page, inquiries and confirmed member offers) |
| `src/geo.ts`, `src/categories.ts` | Regions/areas by postcode and town; the 14 categories and the keyword classifier |
| `migrations/` | The portal's own D1 schema |
| `public/` | Stylesheet, script, icon |

## Pages

`/` front page · `/find-en-flok` open flocks · `/flokke` Mine flokke · `/flokke/<id>` a flock (`POST …/bliv-del-af`, `…/forlad`, `…/eftermoedet`; `…/ret` for the one who looks after it) · `/events/<slug>/opret-flok` · `/log-ind`, `POST /bliv-medlem`, `POST /log-ud` · `/tryghed` · `/samarbejde` (+ `POST`; `GET /api/samarbejde` lists inquiries with bearer `INGEST_TOKEN`) · `/kalender` the calendar with filters (`q`, `periode`, `fra`, `til`, `kategori` (repeatable), `omraade`, `by`, `pris`, `emne`, `side`) · `/i-dag` · `/weekend` · `/<activity>` (e.g. `/meditation`, `/klarsyn`) · `/<activity>/<city>` (e.g. `/meditation/aarhus`) · `/<city>` (e.g. `/aarhus`) · `/kategorier` · `/arrangoerer` · `/arrangoerer/<slug>` · `/events/<slug>` (+ `.ics`) · `/om` · `/sitemap.xml` · `/robots.txt` · `/api/health` · `/api/status` · `POST /api/ingest/run` (bearer `INGEST_TOKEN`). Earlier addresses answer 301: `/events` → `/kalender`, `/kategori/<x>` → `/<activity>`, `/omraade/<city>` and `/<city>/<activity>` → the new form.

Outside production every response carries `X-Robots-Tag: noindex` and robots.txt disallows everything.

## Flocks (the event portal)

- **Members** are a first name and a personal code (12 characters, shown once at sign-up, stored only as SHA-256). No e-mail, phone, age or picture. The code logs in on another device; a lost code cannot be recovered. A login is a random token in an HttpOnly, Secure, SameSite=Lax cookie (`flok_session`, 90 days), stored hashed in `member_sessions`. Hjerterum's login (Clerk) is not used: Flokken's members are kept apart from Hjerterum's.
- **Flocks** belong to one event. The person who creates one sets a public meeting place (confirmed by a tick box; the event's entrance is suggested), a time (from 6 hours before the event until it ends), a size (2–10, default 6) and an optional note. Anyone logged in can join a flock with room; a member is in at most one flock per event and can leave at any time; an empty flock closes. Names are visible only to the flock's members; others see how many are in it. Nobody is ever put in a flock automatically. Limit: 5 new flocks per member per day.
- **Eftermødet**: each member answers whether they want to find something to do together again (any time, highlighted after the event). Someone who said yes can start a new flock for another event "from" that flock; the others who said yes then see it under Mine flokke and choose themselves whether to join.
- **Not built yet**: blocking, reporting, verified profiles, messages between members, e-mail notifications. The safety page says so.
- **Partners** (`/samarbejde`): the planned model (a ticket benefit for members in return for visibility and possible radio mention) and an inquiry form stored in `partner_inquiries`. Member offers live in `PARTNER_OFFERS` in `src/flokken/partners.ts` and are shown on an event only with `confirmedBy` and `confirmedOn` filled in; the list is empty.
- **Under another site**: a proxy can show the portal under a path (www.jacobhauge.com/flokken and www.jacobhauge.com/socialklubben, see the jacobhauge repo's `worker/flokken.js`) by stripping the prefix and sending `x-flokken-mount: https://www.jacobhauge.com/flokken`. The Worker accepts only addresses in `MOUNTS` (`src/index.ts`) or `PUBLIC_MOUNTS`, then prefixes every link, form, redirect and the cookie path, uses that address for canonical links, and checks forms against its origin.
- **Another name**: each address in `MOUNTS` has the name the portal goes by there. Under www.jacobhauge.com/socialklubben it is *Socialklubben*: every "Flokken" in pages and messages is shown as "Socialklubben", with its own share image (`SHARE_IMAGES` in `src/web/layout.ts`). Events, flocks and members are the same; the login is kept per address (the cookie path).

## The map (the event portal)

`/kort` shows the coming 14 days' events with a position as pins (one per place; pins close together are counted), with a panel: the area in view, a bar per day, all / with a flock / free, the activities, and a place's events. The page carries the data as JSON; `public/assets/map.js` draws it with Leaflet (served from `public/assets/vendor/leaflet`, BSD-2) on OpenStreetMap's tiles. Events whose source gives only an address get a position from the source's venue or a known Aarhus address (`src/places.ts`, coordinates from OpenStreetMap).

## Spar på billetten

`/spar-paa-billetten` lists free and cheap events (up to 100 kr.) from the events' own prices, and member benefits from `PARTNER_OFFERS` – only confirmed ones; until there are any it says they are being agreed. Cards and calendar rows carry a "Gratis" chip and, when a confirmed offer applies, "Medlemsfordel". The front page has a "Gratis de næste 7 dage" section. The calendar's price filter has Gratis, up to 100, 200 and 500 kr.

## Everyday events

Besides the holistic organisers, Flokken collects concert venues, culture houses, the main library and a café (SOURCES.md). Six categories cover them: Koncerter og musik (`/koncerter`), Foredrag og debat (`/foredrag`), Kunst og udstillinger (`/kunst`), Teater, comedy og scenekunst (`/scenekunst`), Børn og familie (`/boern-og-familie`) and Quiz, fest og spilaftener (`/quiz-og-fest`). A source can give all its events a category (`alwaysCategories`, e.g. a concert venue) or map its own genres to categories (`hintCategories`, e.g. Musikhuset's "comedy" → scenekunst).

## Design

Flokken's own look: a night out in Aarhus. Every event is a ticket – the picture, then a stub with the day, month and time, a dashed perforation with two round notches, and the details. Free events get a round, tilted "Gratis" stamp. The front page's hero is drawn like the share image: the headline with "flok at følges med." highlighted, and a fanned stack of three real coming events as big tickets – on three different days of the next week, evening ones first, from different organisers, a free one among them when there is one (stamped "Gratis") – each stub showing the weekday and part of the day ("FRE / AFTEN"). Oat-coloured paper with a faint dot grid, deep bottle green for text and dark surfaces, berry for actions, butter yellow for highlights (a highlighter stroke behind key words, the savings section) and mint for flocks. Chunky 2 px outlines with a solid drop shadow, and buttons that press down. Soft, round letterforms: Fredoka for headings, Nunito for text (both SIL OFL, `public/assets/fonts`, ~67 kB together). The mark is two friends side by side on a butter tile. Every text colour pair meets WCAG AA; the layout works from 320 px. Every event card and calendar row says how many flocks are going ("2 flokke · Find en flok") or invites "Opret en flok"; the event page has a "Find en flok" panel right under the details.

## Search engines

People search for an activity in a place ("meditation aarhus", "klarsyn randers", "soundbath aarhus", "spirituel weekend jylland"), so the portal has a landing page for each:

- **Activities** (`src/activities.ts`): the 14 categories (`/meditation`, `/spiritualitet`, `/retreat` …) and 14 narrower topics people search for by name: mindfulness, MBSR, stressreduktion, meditation for begyndere, meditationsgrupper, buddhistisk meditation, stilhedsretreat, klarsyn, spirituelle foredrag, healing, soundbath, kakaoceremoni, trommerejse, yin yoga. Topics are found when events are collected (`event_topics`), scored like the categories, so a page lists events that are about the topic rather than ones that mention a word once.
- **Activity in a city**: `/<activity>/<city>` for every activity and every active city, with the search words in the address, `<title>` ("Klarsynsaftener i Aarhus ✨"), H1, description and a visible introduction; links to the same activity in the other cities and to related topics.
- **Cities** (`/aarhus`): "Hvad sker der i Aarhus?" – today, the weekend, what is coming, the city's activities and organisers.
- **Organisers** (`src/organizers.ts`, `/arrangoerer/<slug>`): who arranges what, where, with their standing offerings (each with the organiser's own page as source) and their coming events. Standing offerings also appear on the activity and city pages they belong to, so a page like "Buddhistisk meditation i Aarhus" has content even in a week without dated events.
- **Intent pages**: `/kalender` ("Spirituel og holistisk kalender for Østjylland"), `/i-dag` ("Hvad sker der i dag?"), `/weekend` ("Spirituel weekend").
- **Every page**: breadcrumb (also as schema.org BreadcrumbList), canonical URL, `hreflang="da-DK"`, Open Graph and Twitter cards (`public/assets/og.jpg` when the event has no picture), footer links to every city, activity and topic. Lists carry a schema.org ItemList, event pages a schema.org Event, organiser pages an Organization.
- **Sitemap**: the landing pages that have events or an organiser, organiser pages and every upcoming event. A combination with neither is shown but `noindex`.

## The collector

- **Schedule.** Cron `17 3 * * *` (05:17 Danish summer time) and cron `47 * * * *` (hourly) each collect the sources that are due: not collected in the last 20 hours, and not failed in the last 3. A trigger with nothing due only retires ended events. No visitor, browser or person is needed.
- **Request budget.** A Worker invocation may send 50 requests on Workers Free; past that every fetch fails, which looks like a broken site. So a run sends at most `INGEST_REQUEST_BUDGET` (default 45) requests, robots.txt and retries included. Sources take turns, the longest without a successful collection first; a source the budget no longer covers is *deferred* (logged as skipped, not failed) and goes first in the next run, so all sources are collected within a few hourly runs. Detail lookups get what is left after a reserve for the next listing; a lookup the budget cuts off is stored as not yet checked and done in a later run. A source that needs more than the whole budget fails with `request_budget_exceeded`. `POST /api/ingest/run` collects what is due like the cron (a source that just failed included); `?alle=1` takes every source, stalest first, as far as the budget goes.
- **Per source.** Each enabled source is fetched with a timeout and up to three attempts with backoff for network errors, 429 and 5xx (Retry-After honoured). robots.txt is honoured for open web sources. A failing source does not stop the others.
- **Writing.** A source record is known by `(source, source id)`. Unchanged records only get "last checked". Changed ones are updated, and the change is logged in `event_changes` (`rescheduled`, `cancelled`, `reinstated`, `updated`). A new record that matches an event already stored (start within 30 minutes, nearly the same title, same area) is linked to it as a duplicate (`merged_duplicate`): the higher-priority source supplies the details, the other fills gaps. An event that disappears from a complete listing for two runs is `withdrawn` (hidden), and comes back if it reappears. Ended events become `past`.
- **Details lookups.** MembershipWorks' per-event endpoint (address, coordinates) is called for new or changed events, at most 25 per run; the rest are looked up in the next runs.
- **Log.** `ingest_runs` and `ingest_source_runs` (kept 120 days), JSON lines in Workers Logs (`ingest_source`, `ingest_run`, `cron`, `cron_failed`). `/api/status` shows each source's latest collection (time, requests, result); `/api/health` reports `ingest.healthy: false` when nothing has succeeded for 36 hours.
- **Re-processing.** Raising `NORMALIZE_VERSION` (src/ingest/normalize.ts) re-reads every stored event once, at each source's next collection (for example after changing categories).

## Configuration

| Name | Kind | Meaning |
| --- | --- | --- |
| `ENVIRONMENT` | var | `local`, `staging` or `production`. Only `production` may be indexed. |
| `ACTIVE_REGIONS` | var | Regions shown, e.g. `ostjylland` or `ostjylland,fyn` (slugs in `src/geo.ts`). Events elsewhere are stored but not listed. |
| `PUBLIC_BASE_URL` | secret/var | The portal's address for canonical links and the sitemap. |
| `INGEST_TOKEN` | secret | Enables `POST /api/ingest/run` (at least 24 characters). The staging workflow sets a fresh one per deploy. |
| `INGEST_REQUEST_BUDGET` | var | Requests one collection run may send (default 45, under Workers Free's 50 per invocation; can be raised on a paid plan). |
| `BILLETTO_API_KEYPAIR` | secret | Turns the Billetto source on (GitHub secret `HOLISTISK_BILLETTO_API_KEYPAIR`). |
| `CONTACT_EMAIL` | var | Shown on the safety page for concerns (GitHub variable `HOLISTISK_CONTACT_EMAIL`). |
| `EDITION` | var | `portal` shows the event portal at the Worker's own address; otherwise Flokken as an association. Under a mount, the mount decides. |
| `PUBLIC_MOUNTS` | var | More addresses the portal may be shown under through a proxy, comma-separated, each optionally with a name (`https://example.dk/klub=Klubben`; www.jacobhauge.com/flokken and /socialklubben are built in). |

## Covering more of Denmark

1. Add the region's slug to `ACTIVE_REGIONS`. Every Danish postcode is already mapped to a region.
2. Optionally split the region into finer areas in `src/geo.ts` (postcode ranges and town names). No schema change is needed; raise `NORMALIZE_VERSION` so stored events are placed again.
3. Add sources for the region (below).

## Adding a source

1. Get and record the basis for using it (owner consent, licence or API agreement), including images and description text. Add it to [SOURCES.md](SOURCES.md).
2. If it is an iCalendar feed, schema.org Event JSON-LD on the organiser's pages, MembershipWorks or Billetto, add an entry to `src/sources/registry.ts` with the adapter, options, `permissionBasis`, `attribution`, `imagePolicy`, `descriptionPolicy`, `priority` and `completeListing`. Otherwise write an adapter in `src/sources/` that returns `SourceEvent`s, and add it to `ADAPTERS`.
3. Add a test with a small fixture of the real feed.

## Known limits

- Categories come from keywords, not judgement; an event may get a category it only touches on. Corrections: adjust the word lists in `src/categories.ts` and raise `NORMALIZE_VERSION`.
- Prices are read from free text where the source has no structured price, and are marked `price_from_text`; the page shows the source's own words next to the parsed price.
- Hjerterum's sign-up links point to `hjerterum.info/events/<id>` (Hjerterum's own event pages). The feed's own links still point to holistisk.org, which becomes this portal.
