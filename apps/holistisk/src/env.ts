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
  /** More addresses the portal may be served under through a proxy (comma-separated, e.g. "https://example.dk/flokken"). */
  PUBLIC_MOUNTS?: string;
  /** Optional address shown on the about page for organisers and corrections. */
  CONTACT_EMAIL?: string;
}

export const isProduction = (env: Env): boolean => env.ENVIRONMENT === "production";
