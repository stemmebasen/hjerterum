# Legacy public-surface inventory

This is a migration inventory, not a specification. Legacy content must be reviewed before reuse.

## Verified public routes

- `/` — Danish home
- `/welcome/` — English home
- `/events/` — Danish events
- `/events-en/` — English events
- `/vision/` — Hjerterum description/vision
- `/historien-bag-hjerterum/`, `/team/` — story and people
- `/kontakt-os/` — contact information
- `/fordele-ved-medlemskab/` — membership benefits
- `/book-dit-event/` — Danish legacy event-booking guidance
- `/book-your-event/` — English legacy event-booking guidance
- `/price-list/` — room price calculator/pricing
- `/tribes/` — obsolete product surface; do not rebuild

The broader WordPress content inventory also includes the following relevant
surfaces, which must be represented in the public information architecture or
explicitly retired after review:

- `/team/`, `/contact-us/` — contact and people
- `/history-behind-hjerterum/`, `/vision-en/` — story and English vision
- `/benefits-of-membership/`, `/conditions-of-membership/`, `/low-income-membership-low-income-membership/` — membership information
- `/conditions-for-renting-the-room/`, `/betingelser-for-leje-af-sal/`, `/treatment-and-therapy/`, `/himalayan-hermitage/` — room use and practitioners
- `/guidelines-for-teachers/`, `/guidelines-for-undervisere/`, `/marketing-of-your-event/`, `/markedsforing/`, `/managing-your-event/`, `/administrer-dine-events/` — teacher/event guidance
- `/newsletter/`, `/nyhedsbrev/`, `/donations/`, `/donationer/`, `/articles/`, `/artikler/` — secondary content

## URL decisions for the Cloudflare public site

| Legacy URL | Decision | Replacement |
| --- | --- | --- |
| `/` | Preserve as standalone route | Danish public home |
| `/welcome/` | Preserve URL and integrate content | English-language public home |
| `/events/` | Preserve as standalone route | Calendar and event policy page |
| `/events-en/` | Preserve as standalone route | English calendar and event policy page |
| `/vision/` | Preserve URL and integrate content | Hjerterum vision section |
| `/kontakt-os/` | Preserve URL and integrate content | Contact section |
| `/fordele-ved-medlemskab/` | Preserve as standalone route | Membership benefits and sign-up |
| `/bliv-medlem/` | Preserve as standalone route | Membership sign-up entry point |
| `/become-a-member/` | Preserve as standalone route | English membership sign-up entry point |
| `/book-dit-event/` | Preserve URL and integrate content | Danish event-hosting guidance and member booking |
| `/book-your-event/` | Preserve URL and integrate content | English event-hosting guidance and member booking |
| `/brug-centret/` | Preserve as standalone route | Event-hosting guidance |
| `/price-list/` | Preserve URL, replace stale calculator | Current booking entry point; no unauthorised price table |
| `/tribes/` | Retire explicitly | No replacement; Tribes is not part of Hjerterum |
| `/team/`, `/contact-us/` | Preserve URL and integrate content | Contact/people section |
| `/history-behind-hjerterum/` | Preserve URL and integrate content | Story/vision section |
| `/historien-bag-hjerterum/`, `/team/`, `/teamet/` | Preserve URL and integrate content | Story and people destinations |
| `/vision-en/` | Preserve URL and integrate content | English vision section |
| `/benefits-of-membership/`, `/conditions-of-membership/` | Preserve URL and integrate content | Membership destination |
| `/conditions-for-renting-the-room/`, `/betingelser-for-leje-af-sal/` | Preserve URL and integrate content | Booking guidance |
| `/treatment-and-therapy/`, `/himalayan-hermitage/` | Preserve URL and integrate content | Practitioner/room information |
| Teacher/event guidance routes | Preserve URL and integrate content | One coherent host resource |
| Newsletter, donations and article routes | Review individually | Keep only where content remains current |

The inventory was checked against the live `holistisk.org` pages on 2026-09-10.
The public replacement keeps established URLs and purpose while consolidating thin
legacy pages into stronger destination pages. No redirect or retirement should be
shipped until the corresponding route has been reviewed in staging.

## Migration observations

- The legacy site contains time-sensitive instructions embedded in static pages. These must become structured content/configuration where possible so old dates do not linger.
- Danish and English routes currently overlap inconsistently; the replacement should use one explicit localization strategy while preserving redirects for established URLs.
- Event booking currently mixes website forms, email and external/Facebook workflows. The replacement should make event creation, room reservation and payment one coherent flow.
- Membership pages still describe Tribes. Those references must be removed/replaced during content migration.
- Existing public pricing/calculator behavior must be captured as test cases before replacement so agreed pricing logic is not accidentally changed.

## Do not cut over until

- redirects are mapped,
- current SEO-critical URLs are accounted for,
- event and membership content has been reviewed,
- legacy data has a validated export,
- staging passes end-to-end acceptance checks.
