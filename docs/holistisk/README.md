# Flokken – the event portal with flocks

`apps/holistisk` is Flokken: a public event portal for Aarhus and Østjylland where people find local events – and others to go with. It collects events from permitted sources every night, removes duplicates, keeps them up to date and shows them with search and filters. On top of that, members create and join flocks (flokke): small groups going to one event together, meeting at a public place before it. Tickets and sign-up always happen with the organiser. Why it lives here and how it is kept apart from Hjerterum: [ADR 0006](../decisions/0006-holistisk-event-portal.md); the move to Flokken: [ADR 0007](../decisions/0007-flokken.md). The code and the Cloudflare names still say "holistisk" (`apps/holistisk`, `holistisk-portal-staging`); only what visitors see is Flokken.

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

## Flokken

- **Members** are a first name and a personal code (12 characters, shown once at sign-up, stored only as SHA-256). No e-mail, phone, age or picture. The code logs in on another device; a lost code cannot be recovered. A login is a random token in an HttpOnly, Secure, SameSite=Lax cookie (`flok_session`, 90 days), stored hashed in `member_sessions`. Hjerterum's login (Clerk) is not used: Flokken's members are kept apart from Hjerterum's.
- **Flocks** belong to one event. The person who creates one sets a public meeting place (confirmed by a tick box; the event's entrance is suggested), a time (from 6 hours before the event until it ends), a size (2–10, default 6) and an optional note. Anyone logged in can join a flock with room; a member is in at most one flock per event and can leave at any time; an empty flock closes. Names are visible only to the flock's members; others see how many are in it. Nobody is ever put in a flock automatically. Limit: 5 new flocks per member per day.
- **Eftermødet**: each member answers whether they want to find something to do together again (any time, highlighted after the event). Someone who said yes can start a new flock for another event "from" that flock; the others who said yes then see it under Mine flokke and choose themselves whether to join.
- **Not built yet**: blocking, reporting, verified profiles, messages between members, e-mail notifications. The safety page says so.
- **Partners** (`/samarbejde`): the planned model (a ticket benefit for members in return for visibility and possible radio mention) and an inquiry form stored in `partner_inquiries`. Member offers live in `PARTNER_OFFERS` in `src/flokken/partners.ts` and are shown on an event only with `confirmedBy` and `confirmedOn` filled in; the list is empty.
- **Under another site**: a proxy can show the portal under a path (www.jacobhauge.com/flokken, see the jacobhauge repo's `functions/flokken`) by stripping the prefix and sending `x-flokken-mount: https://www.jacobhauge.com/flokken`. The Worker accepts only addresses in `MOUNTS` (`src/index.ts`) or `PUBLIC_MOUNTS`, then prefixes every link, form, redirect and the cookie path, uses that address for canonical links, and checks forms against its origin.

## Spar på billetten

`/spar-paa-billetten` lists free and cheap events (up to 100 kr.) from the events' own prices, and member benefits from `PARTNER_OFFERS` – only confirmed ones; until there are any it says they are being agreed. Cards and calendar rows carry a "Gratis" chip and, when a confirmed offer applies, "Medlemsfordel". The front page has a "Gratis de næste 7 dage" section. The calendar's price filter has Gratis, up to 100, 200 and 500 kr.

## Everyday events

Besides the holistic organisers, Flokken collects concert venues, culture houses, the main library and a café (SOURCES.md). Six categories cover them: Koncerter og musik (`/koncerter`), Foredrag og debat (`/foredrag`), Kunst og udstillinger (`/kunst`), Teater, comedy og scenekunst (`/scenekunst`), Børn og familie (`/boern-og-familie`) and Quiz, fest og spilaftener (`/quiz-og-fest`). A source can give all its events a category (`alwaysCategories`, e.g. a concert venue) or map its own genres to categories (`hintCategories`, e.g. Musikhuset's "comedy" → scenekunst).

## Design

Warm, round and social, in the same family as Oluna (jacobhauge.com/oluna): cream paper, deep ink, coral for actions, with sun, plum, pink, leaf and sky; very large, tight headings with a coral second line; pill buttons with an arrow; a flat drawing of three friends on their way to a concert; a sliding strip of the kinds of events there are right now; round drops instead of bullets. Headings in Bricolage Grotesque, text in Figtree (both SIL OFL, `public/assets/fonts`). Every event card and calendar row says how many flocks are going ("2 flokke · Find en flok") or invites "Opret en flok"; the event page has a "Find en flok" panel right under the details. The front page explains Flokken in three steps, shows open flocks, a few events with pictures and then every event of the coming 7 days.

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

- **Schedule.** Cron `17 3 * * *` collects every night (05:17 Danish summer time). Cron `47 */6 * * *` collects only if no run has succeeded in the last 20 hours (the nightly run failed), and otherwise only retires ended events. No visitor, browser or person is needed.
- **Per source.** Each enabled source is fetched with a timeout and up to three attempts with backoff for network errors, 429 and 5xx (Retry-After honoured). robots.txt is honoured for open web sources. A failing source does not stop the others.
- **Writing.** A source record is known by `(source, source id)`. Unchanged records only get "last checked". Changed ones are updated, and the change is logged in `event_changes` (`rescheduled`, `cancelled`, `reinstated`, `updated`). A new record that matches an event already stored (start within 30 minutes, nearly the same title, same area) is linked to it as a duplicate (`merged_duplicate`): the higher-priority source supplies the details, the other fills gaps. An event that disappears from a complete listing for two runs is `withdrawn` (hidden), and comes back if it reappears. Ended events become `past`.
- **Details lookups.** MembershipWorks' per-event endpoint (address, coordinates) is called for new or changed events, at most 25 per run; the rest are looked up in the next runs.
- **Log.** `ingest_runs` and `ingest_source_runs` (kept 120 days), JSON lines in Workers Logs (`ingest_source`, `ingest_run`, `cron`, `cron_failed`). `/api/status` shows the last run per source; `/api/health` reports `ingest.healthy: false` when nothing has succeeded for 36 hours.
- **Re-processing.** Raising `NORMALIZE_VERSION` (src/ingest/normalize.ts) re-reads every stored event once in the next run (for example after changing categories).

## Configuration

| Name | Kind | Meaning |
| --- | --- | --- |
| `ENVIRONMENT` | var | `local`, `staging` or `production`. Only `production` may be indexed. |
| `ACTIVE_REGIONS` | var | Regions shown, e.g. `ostjylland` or `ostjylland,fyn` (slugs in `src/geo.ts`). Events elsewhere are stored but not listed. |
| `PUBLIC_BASE_URL` | secret/var | The portal's address for canonical links and the sitemap. |
| `INGEST_TOKEN` | secret | Enables `POST /api/ingest/run` (at least 24 characters). The staging workflow sets a fresh one per deploy. |
| `BILLETTO_API_KEYPAIR` | secret | Turns the Billetto source on (GitHub secret `HOLISTISK_BILLETTO_API_KEYPAIR`). |
| `CONTACT_EMAIL` | var | Shown on the safety page for concerns (GitHub variable `HOLISTISK_CONTACT_EMAIL`). |
| `PUBLIC_MOUNTS` | var | More addresses the portal may be shown under through a proxy, comma-separated (www.jacobhauge.com/flokken is built in). |

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
