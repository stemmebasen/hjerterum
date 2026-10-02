import type { D1Database } from "../db.js";

/** Saga, Hjerterum's board assistant. Every value is configured per environment; a missing one
 * switches the matching part off instead of failing the whole Worker. */
export interface SagaEnv {
  DB?: D1Database;
  SAGA_TELEGRAM_BOT_TOKEN?: string;
  SAGA_TELEGRAM_WEBHOOK_SECRET?: string;
  SAGA_TELEGRAM_BOT_USERNAME?: string;
  /** The board's Telegram group - the only group Saga reads or posts in. */
  SAGA_BOARD_CHAT_ID?: string;
  /** The chair's Telegram user id - the only person who can approve, send recordings or ask privately. */
  SAGA_OWNER_TELEGRAM_ID?: string;
  /** Bearer secret for Liva (Matrix) reading Saga's overview. */
  SAGA_LIVA_SECRET?: string;
  /** Seals the team@ mailbox password (teamMail.ts); without it the Telegram webhook secret is the key material. */
  MAIL_ENCRYPTION_KEY?: string;
  /** "on" lets Saga post in the board group (always after the chair's approval). Anything else:
   * she only reads along, and everything she makes goes to the chair privately. */
  SAGA_BOARD_POSTING?: string;
  /** OpenAI-compatible chat completions provider. */
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_DRIVE_RECORDINGS_FOLDER_ID?: string;
  GOOGLE_DRIVE_MINUTES_FOLDER_ID?: string;
  /** Requested: "the doc we use for all referater and decisions" - Saga reads it for context and
   * appends approved minutes to it (shared with the service account as editor). */
  GOOGLE_MINUTES_DOC_ID?: string;
  /** Requested: "upload referat (mp3/m4a) knap" - recordings uploaded in the board cockpit wait
   * here (R2) until Saga has transcribed them. */
  BOARD_RECORDINGS?: RecordingBucket;
  /** The board's one shared cockpit password ("Til start laver vi bare ét samlet login"). Set by
   * the chair as a secret; without it the cockpit says it is not set up and lets no one in. */
  COCKPIT_PASSWORD?: string;
  /** "off" closes the shared password login: only Saga's personal links let members in. */
  COCKPIT_SHARED_LOGIN?: string;
  /** The cockpit's address, for links in Telegram (e.g. https://cockpit.hjerterum.info). */
  COCKPIT_URL?: string;
  /** "on": Saga writes one short message in the board's group when new minutes are up, asking
   * everyone to read and approve them. Otherwise she stays silent there. */
  SAGA_MINUTES_PING?: string;
}

/** The part of an R2 bucket the cockpit and Saga use. */
export interface RecordingBucket {
  put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface SagaDeps {
  fetcher: typeof fetch;
  now: () => number;
  waitUntil?: (work: Promise<unknown>) => void;
}

export const SAGA_NAME = "Saga";

export function requireDb(env: SagaEnv): D1Database {
  if (!env.DB) throw new Error("database_not_configured");
  return env.DB;
}

/** Requested: "Jeg vil ikke have hun interagerer i gruppen." Off unless explicitly turned on. */
export const postsToBoard = (env: SagaEnv) => env.SAGA_BOARD_POSTING === "on";
