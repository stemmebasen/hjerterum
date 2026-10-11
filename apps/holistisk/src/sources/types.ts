import type { Env } from "../env.js";
import type { ParsedPrice } from "../price.js";
import type { HttpClient } from "./http.js";

/** One event as a source describes it, before it is matched against what the portal already has. */
export type SourceEvent = {
  /** The source's own stable id for the event (an occurrence id for a recurring event). */
  sourceEventId: string;
  title: string;
  paragraphs: string[];
  startsAt: number;
  endsAt: number | null;
  allDay: boolean;
  timezone: string;
  organizerName: string | null;
  organizerUrl: string | null;
  hostName: string | null;
  venueName: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  /** Free text about the place, used to place the event when no postcode or town is given. */
  locationText: string | null;
  categoryHints: string[];
  price: (ParsedPrice & { currency: string }) | null;
  signupUrl: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  cancelled: boolean;
  qualityFlags: string[];
};

export type VenueRule = {
  /** Matched against the source's location text. */
  match: RegExp;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  organizerName?: string;
  organizerUrl?: string;
};

export type SourceConfig = {
  id: string;
  name: string;
  adapter: "membershipworks" | "ical" | "billetto" | "jsonld";
  homepageUrl: string | null;
  /** Why the portal may use this source: the agreement, licence or owner consent. Shown on the about page. */
  permissionBasis: string;
  /** The credit line shown with every event from the source. */
  attribution: string;
  imagePolicy: "allowed" | "none";
  descriptionPolicy: "full" | "excerpt" | "none";
  /** When two sources describe one event, the higher priority supplies the details. */
  priority: number;
  /** Only events that read as holistic are kept (for sources that also carry other events). */
  requireRelevance: boolean;
  /** The source lists every upcoming event it has, so one that disappears was withdrawn. */
  completeListing: boolean;
  /** Event pages must name the source's own page as canonical (a source's terms may require it). */
  canonicalToSource: boolean;
  /** robots.txt is honoured for open web sources; an API used under an agreement is reached as agreed. */
  respectRobots: boolean;
  /** The source's own events are enabled only when this returns true (e.g. its API key is configured). */
  enabled: (env: Env) => boolean;
  defaults: {
    timezone: string;
    organizerName: string | null;
    organizerUrl: string | null;
    venues: VenueRule[];
  };
  options: Record<string, unknown>;
};

export type FetchResult = {
  events: SourceEvent[];
  /** The latest start the listing covers; a missing event later than this is not counted as withdrawn. */
  windowEnd: number | null;
  /** Items the adapter could not read (no title or date), counted in the run log. */
  unreadable: number;
};

export type AdapterContext = { http: HttpClient; env: Env; now: number };

export interface SourceAdapter {
  fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult>;
  /** Optional second look at a new or changed event (e.g. its own detail endpoint for address and coordinates). */
  enrich?(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent>;
}
