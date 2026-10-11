# Event sources

Only sources with a documented basis are enabled. Public availability alone is not permission: descriptions and pictures are the organisers' work. Researched 2026-10-11.

## Enabled

| Source | Feed | Basis | Text / pictures |
| --- | --- | --- | --- |
| **Brahma Kumaris Aarhus** (Ålborggade 22, 3. tv., Aarhus C) | Brahma Kumaris Danmark's Events Manager RSS (`brahmakumaris.dk/events/feed/`, allowed by robots.txt; the site's HTML and REST API refuse automated requests). The national feed is filtered to Aarhus; the daily "Aftenmeditation" is shown as a standing offering, not 4 events a week. Adapter `eventsmanager`. | Project owner's request; **organiser's written OK pending** | Facts and link only (the feed has no text), no pictures |
| **Buddhistisk Center Aarhus** (Diamantvejen, Peder Skrams Gade 52B, Aarhus N) | schema.org Event JSON-LD on buddha.dk (robots.txt allows all), filtered to postcode 8200. The dates are midnight UTC; the evenings and times are read from the text ("Onsdag: … fra kl 19:00 - 21:00"), one event per evening. Adapter `diamondway`. | Project owner's request; **organiser's written OK pending** | Excerpt, no pictures |
| **Dansk Center for Mindfulness** (Aarhus University) | AU's TYPO3 event RSS with structured start, end and place. AU's terms forbid copying text without permission, so only facts and a link are stored (`descriptionPolicy: "none"`). Courses placed only as "Østjylland" are listed for the region, not a town. Adapter `typo3events`. | Public list; facts only per AU's terms | No text, no pictures |
| **Vækstcenteret** (Rørbækvej 10, Nørre Snede) | The course list at vaekstcenteret.dk/kurser/ (start date, price, teachers) and each course page (times, place). robots.txt asks for 10 s between requests, which the HTTP client honours; at most 8 course pages are read per run. Online courses are left out; retreats held elsewhere keep their place name. Adapter `vaekstcenteret`. | Project owner's request; **organiser's written OK pending** | Excerpt, no pictures |
| **Lysets Hus** (Foreningen Lyset, Posthussmøgen 11C, Aarhus) | The programme on the front page of lysetshus.dk (WordPress; robots.txt allows it). Dated evenings (speaker, title, description, entry price, Billetto ticket link) and the free early evenings that follow them ("Ulige/Lige uge"). Adapter `src/sources/lysetshus.ts`. | Added at the project owner's request. **To confirm:** Foreningen Lyset's written OK. Until then only an excerpt of the text is shown and no pictures (`descriptionPolicy: "excerpt"`, `imagePolicy: "none"`); switch both in `registry.ts` when they agree. | Excerpt, no pictures; sign-up via their Billetto link |
| **Favn Aarhus** (Jægergårdsgade 14, 2., Aarhus C) | The workshop calendar at favnaarhus.dk/workshop-kalender-aarhus/ (WordPress; robots.txt allows all). One entry per date: title, teaser, "Fredag d. 9. oktober kl. 16:30-18" and price. The dates have no year; the weekday decides it, as for Lysets Hus. A workshop held on several dates becomes one event per date. Past workshops in the page's "expired" column are skipped. The teaser is Favn's own one-line summary, so it counts as strongly as the title when choosing categories (`descriptionIsSummary`). Weekly classes are booked in Favn's ezme booking system and are shown as standing offerings on the profile, not as events. Adapter `favn`. | Project owner's request; **organiser's written OK pending** | Teaser only, no pictures |
| **Hjerterum** (Aarhus) | MembershipWorks RSS `api.membershipworks.com/v2/events?_op=rss&org=22308` and `/v2/event?eid=` | Hjerterum's own public calendar; the project is run for Hjerterum. MembershipWorks' robots.txt allows `/v2/*`. **To confirm:** the board's written OK to show its texts and pictures on holistisk.org. | Full text, pictures shown with credit |

## Ready, switched off until access is in place

| Source | What is needed | Notes |
| --- | --- | --- |
| **Billetto** Public Event API (`billetto.dk/api/v3/public/events`) | An API key pair (apply via support@billetto.com) and acceptance of Billetto's publisher terms. Set it as the GitHub secret `HOLISTISK_BILLETTO_API_KEYPAIR`. | The terms require the full event URL with UTM tags and our event page to name Billetto's page as canonical; the adapter does both. Picture reuse is not stated, so pictures are off and only an excerpt of the text is shown. The category queries (`meditation`, `mindfulness`, `yoga`, `health_wellness`, `mental_health`, `personal_health`, `religious_spiritual` in region `Midtjylland`) must be checked against the first real responses. |

Lysets Hus' page has no feed: the adapter reads its text layout. The year is chosen so the weekday matches, and a free evening is only taken when the week's parity agrees; anything else is counted as unreadable in the run log, never guessed. If the collector reports `lysetshus_no_programme_found`, the page layout has changed and the adapter needs a look.

## Organiser profiles without automatic events

| Organiser | Why no events | What the portal shows |
| --- | --- | --- |
| Center for Selvudvikling (Frederiksgade 74E, Aarhus C – not Marselisborg) | Groups by application after an intake talk; dates on the site have no times. | Profile with focus and how to join. |
| Yoga & Meditation Horsens (Sundvej 35 per the studio's site; the booking system says Clarasvej 2 – confirm with the studio) | The timetable lives in the YOGO booking API, whose robots.txt disallows all automated access. Ask the studio/YOGO for permission. | Profile with classes, monthly Sangha evening and MBSR. |
| Skandinavisk Yoga og Meditationsskole Aarhus – Yogaskolen i Aarhus (Vestergade 45, Aarhus C) | yogaskolen.dk allows crawling, but the timetable, events and retreats are a YOGO widget fed by `api.yogo.dk`, whose robots.txt disallows all automated access. | Profile with the free Thursday intro class, class types, events and retreats on Mors. |
| YO Studios (Scandinavian Center, Margrethepladsen 4, 1. sal, Aarhus C; also Oddervej 157, Højbjerg) | Timetable and events are YOGO widgets (`api.yogo.dk`, disallowed as above). Mostly pilates, barre, dance and fitness; only the yoga is in scope. | Profile with yoga (yin to vinyasa) and the events page. |
| Gomde (Smedehalden 3, Knebel) | Its Google Calendar mixes temple practice with internal and private entries, so it is not published; programmes sit in Retreat Guru behind a login API. | Profile with the daily temple practice. |

**YOGO** (yogo.dk) runs the booking for three of these studios (Yoga & Meditation Horsens, Yogaskolen i Aarhus, YO Studios). One agreement with YOGO, or each studio's written OK plus YOGO's, would let one adapter collect all three; the studios' public calendars are `<studio>.yogo.dk`.

## Not included

- **Center for Levende Visdom** – closed at the end of 2012 (AarhusWiki; AU's "Religion i Aarhus 2013"); levendevisdom.dk is now an empty site.
- **Heartfulness Meditation Aarhus** – the venue (Folkestedet) could not be confirmed: Folkestedet's calendar does not list it and Heartfulness' public API has no venue. Add when the organiser confirms place and time.

## Candidates – need the organiser's consent

| Organiser | What exists | Next step |
| --- | --- | --- |
| Yogierne Randers, May Terapi & Yoga, Ananda Yoga Silkeborg, Vivi Færch Yoga, Ecstatic Dance Aarhus | No machine-readable event feed | Ask for a shared calendar (iCal link) or that they publish on Billetto |

## Considered and not used

- **Eventbrite** – event search API closed since 2020; only an organisation's own events.
- **Meetup** – API needs a Pro subscription and approval.
- **Facebook, allevents.in and other aggregators** – no permission; scraping breaches their terms.
- **VisitAarhus** – robots.txt disallows `/api/*`; its data comes from GuideDanmark.
- **GuideDanmark (VisitDenmark)** – API for tourism actors, one-time fee DKK 5,000, licence/picture terms not published; holistic events are likely sparse. Possible later for wider coverage.
- **KultuNaut** – paid agreement, widget delivery.
- **Momoyoga, bsport, Bookwhen, Mindbody** – no public aggregation API; only usable as a feed an organiser hands over.
