# holistisk.org – the event portal

`apps/holistisk` is a public portal for holistic events in Denmark (first Østjylland). It collects events from permitted sources every night, removes duplicates, keeps them up to date and shows them with search and filters. Sign-up always happens with the organiser. Why it lives here and how it is kept apart from Hjerterum: [ADR 0006](../decisions/0006-holistisk-event-portal.md).

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
| `src/geo.ts`, `src/categories.ts` | Regions/areas by postcode and town; the 14 categories and the keyword classifier |
| `migrations/` | The portal's own D1 schema |
| `public/` | Stylesheet, script, icon |

## Pages

`/` front page · `/kalender` the calendar with filters (`q`, `periode`, `fra`, `til`, `kategori` (repeatable), `omraade`, `by`, `pris`, `emne`, `side`) · `/i-dag` · `/weekend` · `/<activity>` (e.g. `/meditation`, `/klarsyn`) · `/<activity>/<city>` (e.g. `/meditation/aarhus`) · `/<city>` (e.g. `/aarhus`) · `/kategorier` · `/arrangoerer` · `/arrangoerer/<slug>` · `/events/<slug>` (+ `.ics`) · `/om` · `/sitemap.xml` · `/robots.txt` · `/api/health` · `/api/status` · `POST /api/ingest/run` (bearer `INGEST_TOKEN`). Earlier addresses answer 301: `/events` → `/kalender`, `/kategori/<x>` → `/<activity>`, `/omraade/<city>` and `/<city>/<activity>` → the new form.

Outside production every response carries `X-Robots-Tag: noindex` and robots.txt disallows everything.

## Design

A calm, clinical newspaper look, after Kristeligt Dagblad: a grey masthead with the centred wordmark and a blue rule, a section line with today's date, white paper, black serif headlines (Source Serif 4, OFL, served from `public/assets/fonts`), small blue section labels, hairline rules, square pictures and no shadows. The calendar is a list by day, as a newspaper's listings. The footer is dark.

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
| `CONTACT_EMAIL` | var | Shown on the about page for organisers (GitHub variable `HOLISTISK_CONTACT_EMAIL`). |

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
