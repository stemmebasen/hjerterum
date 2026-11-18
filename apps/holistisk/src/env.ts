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
  /** Optional public contact address (default kontakt@socialklubben.dk); only a @socialklubben.dk address is used. */
  CONTACT_EMAIL?: string;
  /** Secret. Where the contact form's messages are delivered (default: the public contact address). */
  CONTACT_INBOX?: string;
  /** Secret. Resend's API key (resend.com); with it the portal sends e-mail (src/mail.ts). */
  RESEND_API_KEY?: string;
  /** Cloudflare Email Service's send_email binding; used instead of Resend when present (needs Workers Paid). */
  EMAIL?: EmailBinding;
  /** The sender address (default besked@socialklubben.dk). Its domain must be verified with the mail service. */
  MAIL_FROM?: string;
  /** The only address Socialklubben's admin overview (/admin) sends its login link to (default: the organisers' address). */
  ADMIN_EMAIL?: string;
  /** The address used in links in mails from the cron (default https://socialklubben.dk). */
  MAIL_SITE_URL?: string;
  /** Cloudflare Workers AI; translates arrangements' own Danish text for the English pages (src/i18n/machine.ts). */
  AI?: AiBinding;
  /** The Workers AI model for that (default in src/i18n/machine.ts). */
  TRANSLATE_MODEL?: string;
}

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const isProduction = (env: Env): boolean => env.ENVIRONMENT === "production";
