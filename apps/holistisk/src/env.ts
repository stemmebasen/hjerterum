import type { D1Database } from "./db.js";

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB?: D1Database;
  ASSETS?: AssetsBinding;
  ENVIRONMENT?: string;
  /** Comma-separated region slugs shown on the portal (src/geo.ts), e.g. "ostjylland" or "ostjylland,fyn". */
  ACTIVE_REGIONS?: string;
  /** The portal's public address, for canonical links and the sitemap. Falls back to the request's own origin. */
  PUBLIC_BASE_URL?: string;
  /** Secret. When set, POST /api/ingest/run with "Authorization: Bearer <token>" starts a collection by hand. */
  INGEST_TOKEN?: string;
  /** Requests one collection run may send (default 45; Workers Free allows 50 per invocation). */
  INGEST_REQUEST_BUDGET?: string;
  /** Secret. Billetto's publisher API key pair; the Billetto source stays off until it is set. */
  BILLETTO_API_KEYPAIR?: string;
  /** More addresses the portal may be served under through a proxy (comma-separated, e.g. "https://example.dk/flokken",
   * or "https://example.dk/klub=Klubben" to go by another name there). */
  PUBLIC_MOUNTS?: string;
  /** "portal" shows the event portal at the Worker's own address; anything else (the default) Flokken as an association.
   * Under a mount, the mount decides (src/index.ts). */
  EDITION?: string;
  /** Secret. Discount codes for the half-price gift at partner events, "event-slug=CODE,organizer-slug=CODE"
   * (src/flokken/partners.ts). Only the first five members of a flock of five see their event's code. */
  FLOCK_GIFT_CODES?: string;
  /** Optional address shown on the about page for organisers and corrections. */
  CONTACT_EMAIL?: string;
}

export const isProduction = (env: Env): boolean => env.ENVIRONMENT === "production";
