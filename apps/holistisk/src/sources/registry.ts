import type { SourceAdapter, SourceConfig } from "./types.js";
import { membershipWorks } from "./membershipworks.js";
import { ical } from "./ical.js";
import { jsonLd } from "./jsonld.js";
import { billetto } from "./billetto.js";
import { lysetsHus } from "./lysetshus.js";
import { TIMEZONE } from "../time.js";

/** Every source the collector reads. A new source is a new entry here (and, for a new kind of feed, a new adapter).
 * A source is only added with a documented basis for using it: the owner's consent, a licence or an API agreement.
 * See docs/holistisk/SOURCES.md for the candidates and their status. */

export const ADAPTERS: Record<SourceConfig["adapter"], SourceAdapter> = {
  membershipworks: membershipWorks,
  ical,
  jsonld: jsonLd,
  billetto,
  lysetshus: lysetsHus
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
