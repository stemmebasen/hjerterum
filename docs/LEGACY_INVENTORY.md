# Legacy public-surface inventory

This is a migration inventory, not a specification. Legacy content must be reviewed before reuse.

## Verified public routes

- `/` — Danish home
- `/welcome/` — English home
- `/events/` — Danish events
- `/events-en/` — English events
- `/vision/` — Hjerterum description/vision
- `/kontakt-os/` — contact information
- `/fordele-ved-medlemskab/` — membership benefits
- `/book-dit-event/` — Danish legacy event-booking guidance
- `/book-your-event/` — English legacy event-booking guidance
- `/price-list/` — room price calculator/pricing
- `/tribes/` — obsolete product surface; do not rebuild

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
