import type { SourceAdapter, SourceConfig } from "./types.js";
import { membershipWorks } from "./membershipworks.js";
import { ical } from "./ical.js";
import { jsonLd } from "./jsonld.js";
import { billetto } from "./billetto.js";
import { lysetsHus } from "./lysetshus.js";
import { eventsManager } from "./eventsmanager.js";
import { diamondWay } from "./diamondway.js";
import { typo3Events } from "./typo3events.js";
import { vaekstcenteret } from "./vaekstcenteret.js";
import { favn } from "./favn.js";
import { TIMEZONE } from "../time.js";

/** Every source the collector reads. A new source is a new entry here (and, for a new kind of feed, a new adapter).
 * A source is only added with a documented basis for using it: the owner's consent, a licence or an API agreement.
 * See docs/holistisk/SOURCES.md for the candidates and their status. */

export const ADAPTERS: Record<SourceConfig["adapter"], SourceAdapter> = {
  membershipworks: membershipWorks,
  ical,
  jsonld: jsonLd,
  billetto,
  lysetshus: lysetsHus,
  eventsmanager: eventsManager,
  diamondway: diamondWay,
  typo3events: typo3Events,
  vaekstcenteret,
  favn
};

export const SOURCES: SourceConfig[] = [
  {
    id: "hjerterum",
    name: "Hjerterum",
    adapter: "membershipworks",
    homepageUrl: "https://hjerterum.info",
    permissionBasis: "Hjerterums egen offentlige eventkalender (MembershipWorks RSS og det offentlige event-API). Brugen er aftalt med Hjerterum som projektejer; MembershipWorks' robots.txt tillader /v2/.",
    attribution: "Hjerterum, Guldsmedgade 26B, Aarhus",
    imagePolicy: "allowed",
    descriptionPolicy: "full",
    priority: 60,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Hjerterum",
      organizerUrl: "https://hjerterum.info",
      venues: [
        { match: /^hjerterum$/i, name: "Hjerterum", address: "Guldsmedgade 26B", postalCode: "8000", city: "Aarhus C", lat: 56.159318, lon: 10.207848 },
        { match: /hjerteland/i, name: "Hjerteland", address: null, postalCode: "8200", city: "Lisbjerg", lat: null, lon: null, organizerName: "Hjerteland" }
      ]
    },
    // Hjerterum's texts link to its old address; holistisk.org becomes this portal, and hjerterum.info redirects the old paths.
    options: { org: "22308", rewriteHosts: { "holistisk.org": "hjerterum.info" }, signupUrlTemplate: "https://hjerterum.info/events/{eid}", sourceUrlTemplate: "https://hjerterum.info/events/{eid}" }
  },
  {
    id: "lysetshus",
    name: "Lysets Hus",
    adapter: "lysetshus",
    homepageUrl: "https://lysetshus.dk/",
    permissionBasis: "Lysets Hus' (Foreningen Lyset) offentlige program på lysetshus.dk, medtaget efter aftale med projektejer; robots.txt tillader forsiden. Skriftligt samtykke fra foreningen afventer – indtil da vises kun et uddrag af beskrivelsen og ingen billeder, med link til foreningens egen side og Billetto.",
    attribution: "Lysets Hus, Posthussmøgen 11C, Aarhus",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 55,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Lysets Hus",
      organizerUrl: "https://lysetshus.dk/",
      // Coordinates: OpenStreetMap, Posthussmøgen (street level).
      venues: [{ match: /lysets hus/i, name: "Lysets Hus", address: "Posthussmøgen 11C", postalCode: "8000", city: "Aarhus C", lat: 56.154679, lon: 10.20885 }]
    },
    options: { url: "https://lysetshus.dk/" }
  },
  {
    id: "brahma-kumaris-aarhus",
    name: "Brahma Kumaris Aarhus",
    adapter: "eventsmanager",
    homepageUrl: "https://brahmakumaris.dk/",
    permissionBasis: "Brahma Kumaris Danmarks offentlige event-feed (brahmakumaris.dk/events/feed/, tilladt i robots.txt). Medtaget efter aftale med projektejer; skriftligt samtykke fra arrangøren afventer – indtil da vises kun fakta, et kort uddrag og link til arrangørens egen side, ingen billeder.",
    attribution: "Brahma Kumaris, Ålborggade 22, Aarhus",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 50,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Brahma Kumaris Aarhus",
      organizerUrl: "https://brahmakumaris.dk/",
      // Coordinates: OpenStreetMap.
      venues: [{ match: /ålborggade|aalborggade/i, name: "Brahma Kumaris Aarhus", address: "Ålborggade 22, 3. tv.", postalCode: "8000", city: "Aarhus C", lat: 56.143271, lon: 10.192211 }]
    },
    // The national feed: only the Aarhus centre's events; the daily evening meditation is a standing offering on the profile.
    options: { url: "https://brahmakumaris.dk/events/feed/", place: "århus|aarhus", skipTitles: "^aftenmeditation$", excludeCategories: ["yoga"], defaultCategories: ["meditation-mindfulness"] }
  },
  {
    id: "buddhistisk-center-aarhus",
    name: "Buddhistisk Center Aarhus",
    adapter: "diamondway",
    homepageUrl: "https://buddha.dk/centres/aarhus/",
    permissionBasis: "Diamantvejens offentlige eventdata (schema.org) på buddha.dk; robots.txt tillader alt. Medtaget efter aftale med projektejer; skriftligt samtykke fra arrangøren afventer – indtil da vises kun fakta, et kort uddrag og link til arrangørens egen side, ingen billeder.",
    attribution: "Buddhistisk Center Aarhus (Diamantvejen), Peder Skrams Gade 52B, Aarhus N",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 50,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Buddhistisk Center Aarhus",
      organizerUrl: "https://buddha.dk/centres/aarhus/",
      venues: [{ match: /./, name: "Buddhistisk Center Aarhus", address: "Peder Skrams Gade 52B, kld.", postalCode: "8200", city: "Aarhus N", lat: 56.173836, lon: 10.21666 }]
    },
    options: { url: "https://buddha.dk/", postalCodes: ["8200"], alwaysTopics: ["buddhistisk-meditation"], defaultCategories: ["meditation-mindfulness", "spiritualitet-bevidsthed"] }
  },
  {
    id: "dansk-center-for-mindfulness",
    name: "Dansk Center for Mindfulness",
    adapter: "typo3events",
    homepageUrl: "https://mindfulness.au.dk/",
    permissionBasis: "Aarhus Universitets offentlige arrangementsliste (RSS). AU's vilkår tillader ikke gengivelse af tekst uden tilladelse, så portalen viser kun fakta (titel, tid, sted) og linker til centrets egen side.",
    attribution: "Dansk Center for Mindfulness, Aarhus Universitet",
    imagePolicy: "none",
    descriptionPolicy: "none",
    priority: 50,
    requireRelevance: false,
    completeListing: false,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: { timezone: TIMEZONE, organizerName: "Dansk Center for Mindfulness", organizerUrl: "https://mindfulness.au.dk/", venues: [] },
    options: { url: "https://mindfulness.au.dk/aktuelt/arrangementer/element/123480/rss.xml", alwaysTopics: ["mindfulness"], defaultCategories: ["meditation-mindfulness"] }
  },
  {
    id: "vaekstcenteret",
    name: "Vækstcenteret",
    adapter: "vaekstcenteret",
    homepageUrl: "https://vaekstcenteret.dk/kurser/",
    permissionBasis: "Vækstcenterets offentlige kursusoversigt (vaekstcenteret.dk/kurser/); robots.txt tillader den, og portalen holder 10 sekunder mellem forespørgsler, som siden beder om. Medtaget efter aftale med projektejer; skriftligt samtykke fra arrangøren afventer – indtil da vises kun fakta, et kort uddrag og link til arrangørens egen side, ingen billeder.",
    attribution: "Vækstcenteret, Rørbækvej 10, Nørre Snede",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 50,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Vækstcenteret",
      organizerUrl: "https://vaekstcenteret.dk/",
      venues: [
        // Retreats held elsewhere: the place is named, but its address is not given, so it is not placed on the map.
        { match: /limfjord/i, name: "Retreatstedet ved Limfjorden", address: null, postalCode: null, city: "Louns", lat: null, lon: null },
        { match: /oremandsg/i, name: "Oremandsgaard", address: null, postalCode: null, city: null, lat: null, lon: null },
        { match: /./, name: "Vækstcenteret", address: "Rørbækvej 10", postalCode: "8766", city: "Nørre Snede", lat: 55.963837, lon: 9.390209 }
      ]
    },
    options: { url: "https://vaekstcenteret.dk/kurser/", skipCategories: "online", enrichBudget: 8, defaultCategories: ["meditation-mindfulness"] }
  },
  {
    id: "favn-aarhus",
    name: "Favn Aarhus",
    adapter: "favn",
    homepageUrl: "https://favnaarhus.dk/workshop-kalender-aarhus/",
    permissionBasis: "Favn Aarhus' offentlige workshopkalender (favnaarhus.dk); robots.txt tillader alt. Medtaget efter aftale med projektejer; skriftligt samtykke fra arrangøren afventer – indtil da vises kun fakta, et kort uddrag og link til arrangørens egen side, ingen billeder.",
    attribution: "Favn Aarhus, Jægergårdsgade 14, Aarhus C",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 50,
    requireRelevance: false,
    completeListing: true,
    canonicalToSource: false,
    respectRobots: true,
    enabled: () => true,
    defaults: {
      timezone: TIMEZONE,
      organizerName: "Favn Aarhus",
      organizerUrl: "https://favnaarhus.dk/",
      // Coordinates: OpenStreetMap.
      venues: [{ match: /./, name: "Favn Aarhus", address: "Jægergårdsgade 14, 2.", postalCode: "8000", city: "Aarhus C", lat: 56.147952, lon: 10.197783 }]
    },
    options: { url: "https://favnaarhus.dk/workshop-kalender-aarhus/", defaultCategories: ["workshops-kurser"], descriptionIsSummary: true }
  },
  {
    id: "billetto",
    name: "Billetto",
    adapter: "billetto",
    homepageUrl: "https://billetto.dk",
    permissionBasis: "Billettos Public Event API for publishers (kræver API-nøgle og accept af Billettos vilkår). Eventsider peger på Billettos side som canonical, og links bruges med Billettos UTM-parametre, som vilkårene kræver.",
    attribution: "Billetto",
    imagePolicy: "none",
    descriptionPolicy: "excerpt",
    priority: 40,
    requireRelevance: true,
    completeListing: false,
    canonicalToSource: true,
    respectRobots: false,
    enabled: env => !!env.BILLETTO_API_KEYPAIR,
    defaults: { timezone: TIMEZONE, organizerName: null, organizerUrl: null, venues: [] },
    options: {
      queries: ["meditation", "mindfulness", "yoga", "health_wellness", "mental_health", "personal_health", "religious_spiritual"]
        .map(category => `region=Midtjylland&category=${category}`)
    }
  }
];

export const sourceById = (id: string): SourceConfig | undefined => SOURCES.find(s => s.id === id);
