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
