import type { D1Database } from "./db.js";
import type { EmailBinding } from "./mail.js";

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
  /** Optional address shown on the about page for organisers and corrections. */
  CONTACT_EMAIL?: string;
  /** Secret. Resend's API key (resend.com); with it the portal sends e-mail (src/mail.ts). */
  RESEND_API_KEY?: string;
  /** Cloudflare Email Service's send_email binding; used instead of Resend when present (needs Workers Paid). */
  EMAIL?: EmailBinding;
  /** The sender address (default besked@socialklubben.dk). Its domain must be verified with the mail service. */
  MAIL_FROM?: string;
  /** The address used in links in mails from the cron (default https://socialklubben.dk). */
  MAIL_SITE_URL?: string;
}

export const isProduction = (env: Env): boolean => env.ENVIRONMENT === "production";
