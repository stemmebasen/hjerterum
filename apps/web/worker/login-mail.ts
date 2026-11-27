/** Requested: "Ok, så lad os gøre med begge" - Clerk keeps the login, Resend delivers its emails from Hjerterum's own
 * address (no development cap of 100 emails a month, less spam). With "Delivered by Clerk" switched off on a template,
 * Clerk hands each rendered email to this webhook (email.created, signed by Svix). A login code goes out in Hjerterum's
 * own words and design; any other template goes out as Clerk wrote it. A failed send answers 5xx, so Clerk retries;
 * the retry carries the same Svix id, which Resend's idempotency key turns into one email. */
import { hjerterumMail } from "./mail-template.js";

export interface LoginMailEnv {
  CLERK_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const LOGIN_MAIL_PATH = "/api/clerk/email";
const MAX_BODY = 256 * 1024;
const TOLERANCE_SECONDS = 5 * 60;

type ClerkEmail = {
  slug?: string | null;
  to_email_address?: string | null;
  subject?: string | null;
  body?: string | null;
  body_plain?: string | null;
  delivered_by_clerk?: boolean | null;
  data?: { otp_code?: string | null } | null;
};

export type OutgoingMail = { subject: string; html: string; text: string };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Svix's scheme: HMAC-SHA256 over "id.timestamp.body" with the base64 key after "whsec_"; the header lists "v1,<base64>". */
export async function svixSignature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return btoa(String.fromCharCode(...digest));
}

async function verified(secret: string, headers: Headers, body: string, nowMs: number): Promise<boolean> {
  const id = headers.get("svix-id"), timestamp = headers.get("svix-timestamp"), signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  let expected: string;
  try { expected = await svixSignature(secret, id, timestamp, body); } catch { return false; }
  return signatures.split(" ").some(part => {
    const [version, value] = part.split(",", 2);
    return version === "v1" && !!value && constantTimeEqual(value, expected);
  });
}

/** The login code in Hjerterum's words, light and plain like the site (Hjerterum Lys); other templates as Clerk wrote them. */
export function composeMail(email: ClerkEmail): OutgoingMail | null {
  const code = email.data?.otp_code?.trim() ?? "";
  if (/^[A-Za-z0-9]{4,12}$/.test(code)) {
    const reset = /reset_password/.test(email.slug ?? "");
    const what = reset ? "nulstille din adgangskode" : "logge ind";
    // Douglas (forslag #5, 27 Nov 2026): the login code in the same mail template as the system's other mails (mail-template.ts).
    const { html, text } = hjerterumMail({ title: "Din kode", preheader: "Koden gælder i 10 minutter.", signoff: null, blocks: [
      { heading: `Her er koden til at ${what}.`, text: `Din kode til at ${what} hos Hjerterum er ${code}.` },
      { code, text: null },
      { p: `Skriv den på siden, hvor du er ved at ${what}. Koden gælder i 10 minutter.` },
      { small: "Har du ikke bedt om koden, kan du se bort fra denne mail." }
    ] });
    return { subject: `${code} er din kode til Hjerterum`, html, text };
  }
  if (!email.subject || !(email.body || email.body_plain)) return null;
  return { subject: email.subject, html: email.body ?? `<pre>${esc(email.body_plain ?? "")}</pre>`, text: email.body_plain ?? "" };
}

export async function handleLoginMail(request: Request, env: LoginMailEnv, deps: { fetcher: Fetcher; now: () => number }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.CLERK_WEBHOOK_SECRET) return json({ error: "login_mail_not_configured" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too_large" }, 413);
  const body = await request.text();
  if (body.length > MAX_BODY) return json({ error: "too_large" }, 413);
  if (!await verified(env.CLERK_WEBHOOK_SECRET, request.headers, body, deps.now())) return json({ error: "signature_invalid" }, 401);

  let event: { type?: string; data?: ClerkEmail };
  try { event = JSON.parse(body); } catch { return json({ error: "payload_invalid" }, 400); }
  // Only emails Clerk left for us; one Clerk delivered itself must not arrive twice.
  if (event.type !== "email.created" || !event.data || event.data.delivered_by_clerk === true) return new Response(null, { status: 204 });
  const to = event.data.to_email_address?.trim() ?? "";
  const mail = composeMail(event.data);
  if (!/^[^\s@]+@[^\s@]+$/.test(to) || !mail) return new Response(null, { status: 204 });
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return json({ error: "login_mail_not_configured" }, 503);

  const sent = await deps.fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `clerk-email/${request.headers.get("svix-id")}` },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject: mail.subject, html: mail.html, text: mail.text })
  }).catch(() => null);
  if (!sent?.ok) {
    console.warn("login_mail_send_failed", sent?.status ?? "network");
    return json({ error: "send_failed" }, 502);
  }
  return json({ sent: true }, 200);
}
