import type { SagaEnv } from "../saga/env.js";

/** Requested (the chair, 5 Nov 2026): "Det skal fungere sådan at jeg kan klikke på sagas link i telegram og på et øjeblik godkende". Saga's link to one
 * post: signed with Saga's own key, for that post only, for three days - and only sent to the chair, privately. Opening it shows the post; nothing
 * happens before the chair presses a button (so Telegram's link preview never approves anything). */
export const QUICK_DAYS = 3;
const encoder = new TextEncoder();
const base64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(secret: string, value: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(`hjerterum-cockpit:pr-ok:${secret}`));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const cockpitBase = (env: Pick<SagaEnv, "COCKPIT_URL">) => (env.COCKPIT_URL ?? "https://admin.hjerterum.info").replace(/\/+$/, "");

/** "/ok/<post>/<expires>.<signature>" - the path below the cockpit's address. */
export async function quickPath(env: Pick<SagaEnv, "SAGA_TELEGRAM_BOT_TOKEN">, postId: number, nowMs: number): Promise<string | null> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN) return null;
  const expires = nowMs + QUICK_DAYS * 86_400_000;
  return `/ok/${postId}/${expires}.${await sign(env.SAGA_TELEGRAM_BOT_TOKEN, `${postId}.${expires}`)}`;
}

export async function quickLink(env: Pick<SagaEnv, "SAGA_TELEGRAM_BOT_TOKEN" | "COCKPIT_URL">, postId: number, nowMs: number): Promise<string | null> {
  const path = await quickPath(env, postId, nowMs);
  return path ? `${cockpitBase(env)}${path}` : null;
}

export const QUICK_PATH = /^\/ok\/(\d{1,9})\/(\d{13})\.([A-Za-z0-9_-]{43})$/;

/** The post the link is for - or null when it is not Saga's, or has run out. */
export async function quickPost(env: Pick<SagaEnv, "SAGA_TELEGRAM_BOT_TOKEN">, path: string, nowMs: number): Promise<number | null> {
  const m = QUICK_PATH.exec(path);
  if (!m || !env.SAGA_TELEGRAM_BOT_TOKEN) return null;
  const [, id, expires, signature] = m;
  if (Number(expires) <= nowMs || Number(expires) > nowMs + (QUICK_DAYS + 1) * 86_400_000) return null;
  return same(signature!, await sign(env.SAGA_TELEGRAM_BOT_TOKEN, `${id}.${expires}`)) ? Number(id) : null;
}
