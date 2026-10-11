# Event sources

Only sources with a documented basis are enabled. Public availability alone is not permission: descriptions and pictures are the organisers' work. Researched 2026-10-11.

## Enabled

| Source | Feed | Basis | Text / pictures |
| --- | --- | --- | --- |
| **Lysets Hus** (Foreningen Lyset, Posthussmøgen 11C, Aarhus) | The programme on the front page of lysetshus.dk (WordPress; robots.txt allows it). Dated evenings (speaker, title, description, entry price, Billetto ticket link) and the free early evenings that follow them ("Ulige/Lige uge"). Adapter `src/sources/lysetshus.ts`. | Added at the project owner's request. **To confirm:** Foreningen Lyset's written OK. Until then only an excerpt of the text is shown and no pictures (`descriptionPolicy: "excerpt"`, `imagePolicy: "none"`); switch both in `registry.ts` when they agree. | Excerpt, no pictures; sign-up via their Billetto link |
| **Hjerterum** (Aarhus) | MembershipWorks RSS `api.membershipworks.com/v2/events?_op=rss&org=22308` and `/v2/event?eid=` | Hjerterum's own public calendar; the project is run for Hjerterum. MembershipWorks' robots.txt allows `/v2/*`. **To confirm:** the board's written OK to show its texts and pictures on holistisk.org. | Full text, pictures shown with credit |

## Ready, switched off until access is in place

| Source | What is needed | Notes |
| --- | --- | --- |
| **Billetto** Public Event API (`billetto.dk/api/v3/public/events`) | An API key pair (apply via support@billetto.com) and acceptance of Billetto's publisher terms. Set it as the GitHub secret `HOLISTISK_BILLETTO_API_KEYPAIR`. | The terms require the full event URL with UTM tags and our event page to name Billetto's page as canonical; the adapter does both. Picture reuse is not stated, so pictures are off and only an excerpt of the text is shown. The category queries (`meditation`, `mindfulness`, `yoga`, `health_wellness`, `mental_health`, `personal_health`, `religious_spiritual` in region `Midtjylland`) must be checked against the first real responses. |

Lysets Hus' page has no feed: the adapter reads its text layout. The year is chosen so the weekday matches, and a free evening is only taken when the week's parity agrees; anything else is counted as unreadable in the run log, never guessed. If the collector reports `lysetshus_no_programme_found`, the page layout has changed and the adapter needs a look.

## Candidates – need the organiser's consent

| Organiser | What exists | Next step |
| --- | --- | --- |
| Diamond Way Buddhism (buddha.dk), Aarhus N | schema.org Event JSON-LD on the front page (robots.txt allows) | Ask for consent; then a `jsonld` source with `urls: ["https://buddha.dk/"]` |
| Vækstcenteret, Nørre Snede | WordPress category RSS (titles; dates only in text) | Ask for consent and preferably an iCal feed |
| Favn Aarhus, Yogierne Randers, May Terapi & Yoga, Ananda Yoga Silkeborg, Vivi Færch Yoga, Ecstatic Dance Aarhus | No machine-readable event feed | Ask for a shared calendar (iCal link) or that they publish on Billetto |

## Considered and not used

- **Eventbrite** – event search API closed since 2020; only an organisation's own events.
- **Meetup** – API needs a Pro subscription and approval.
- **Facebook, allevents.in and other aggregators** – no permission; scraping breaches their terms.
- **VisitAarhus** – robots.txt disallows `/api/*`; its data comes from GuideDanmark.
- **GuideDanmark (VisitDenmark)** – API for tourism actors, one-time fee DKK 5,000, licence/picture terms not published; holistic events are likely sparse. Possible later for wider coverage.
- **KultuNaut** – paid agreement, widget delivery.
- **Momoyoga, bsport, Bookwhen, Mindbody** – no public aggregation API; only usable as a feed an organiser hands over.
