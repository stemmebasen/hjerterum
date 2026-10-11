# Holistisk.org event portal — Version 1

## Product and domain decision

Holistisk.org will become the public-facing event portal after Hjerterum has moved its own public website to hjerterum.info. Until that cutover is explicitly approved and verified, do not change production DNS, domain bindings, or the current public website.

Develop the portal inside this monorepo, but as a separate application/workspace from the Hjerterum platform. Do not replace Hjerterum routes or combine the portal with Hjerterum's member, billing, identity, or booking flows.

## Geographic rollout

- Architecture, database, URL model, and filters must support all of Denmark from the beginning.
- Initial collection and public launch focus on East Jutland.
- Geographic coverage must be configuration-driven, not hard-coded throughout the app.

## Version 1 scope

- Responsive Danish-language public event discovery site.
- Upcoming event list and individual event detail pages.
- Filters for date, category, city/area, and price where available.
- Source/organizer attribution and outbound registration links.
- Daily scheduled event ingestion, starting with approved and technically suitable sources.
- Normalization, deduplication, expiry handling, source-change tracking, basic quality checks, and run logs.
- A simple review path for uncertain or incomplete records.
- SEO-friendly routes and metadata.

No ticketing, payment processing, member administration, partner discounts, or cross-organization membership in Version 1.

## Data and source policy

Inspect available source formats and terms before implementing each connector. Prefer official APIs, feeds, and sources whose terms permit the intended collection and reuse. Public visibility alone is not permission to republish descriptions or images. Preserve source URLs and attribution. Do not invent missing event details.

Keep source-specific fetching behind adapters so additional sources and regions can be added without rewriting the portal.

## Architecture and safety boundaries

- Keep the new app separate from `apps/web`, which currently contains the Hjerterum platform and its Worker/API.
- Reuse repository conventions and shared tooling where appropriate, but do not reuse Hjerterum member identity, billing, or production data for the portal.
- Give the portal its own deployment configuration and runtime bindings.
- Use a separate portal database/schema or an explicitly isolated namespace. Never run portal migrations against Hjerterum production tables.
- Do not deploy the portal to `holistisk.org` until the Hjerterum move to `hjerterum.info` is complete and verified.
- Do not change production DNS, secrets, payment flows, or existing Hjerterum routes as part of portal development.

## Delivery sequence

1. Inspect the existing monorepo and deployment conventions.
2. Create a separate portal app/workspace with isolated configuration.
3. Build the public event discovery experience with clearly marked sample data only where live data is not yet available.
4. Implement and test the event data model and geographic/category filters.
5. Add one compliant source connector and a daily scheduled ingestion path.
6. Test duplicate detection, updates, cancellations/expiry, failures, and mobile UX.
7. Add further sources only after the first connector and data-quality process are reliable.
8. Deploy to an isolated preview/staging URL and verify end-to-end.
9. Prepare domain cutover documentation, but leave production DNS untouched until explicitly approved.

## Acceptance criteria

Version 1 is accepted only when the isolated portal builds and runs independently, supports nationwide data structures while showing East Jutland as the initial region, displays real verified event records from an approved source, runs ingestion on a daily schedule without requiring a browser session, avoids duplicate records, hides expired events appropriately, provides working source/registration links, and passes typecheck, tests, production build, and staging smoke checks.
