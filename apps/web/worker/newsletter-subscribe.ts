import { tooMany } from "./beregner/handler.js";
import { mailchimp, MAILCHIMP_LIST_ID, type NewsletterEnv } from "./newsletter-send.js";
import type { SagaDeps } from "./saga/env.js";
import { NEWSLETTER_HONEYPOT } from "../site/pages.js";

/** Douglas' notes: "Does newsletter addresses go to Mailchimp?" They did - straight into the audience, but without the "Månedens events" group,
 * and the monthly mail goes only to that group (newsletter-send.ts). The website's form now signs people up here: into the same audience, with the
 * group ticked, and as "pending" for a new address, so Mailchimp asks them to confirm first. Someone already on the list just gets the group. */
export const NEWSLETTER_PATH = "/api/nyhedsbrev";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handleNewsletterSignup(request: Request, env: NewsletterEnv, deps: SagaDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "forbidden" }, 403);
  // Security review (3 Nov 2026): the public form could be used to send confirmation mails to anyone - at most five an hour from one connection.
  if (env.DB && await tooMany(env.DB, request, deps.now(), "nyhedsbrev")) return json({ error: "too_many" }, 429);
  const body = await request.text().catch(() => "");
  if (!body || body.length > 4_000) return json({ error: "invalid_form" }, 400);
  let sent: Record<string, unknown>;
  try { sent = JSON.parse(body) as Record<string, unknown>; } catch { return json({ error: "invalid_form" }, 400); }
  // A robot fills the hidden field: it is told all went well.
  if (String(sent[NEWSLETTER_HONEYPOT] ?? "").trim()) return json({ ok: true });
  const email = String(sent.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(sent.name ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  // Not connected yet: the page sends the form to Mailchimp's own sign-up instead.
  if (!env.MAILCHIMP_API_KEY) return json({ error: "mailchimp_not_configured" }, 503);
  try {
    const mc = mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher);
    const group = await mc.monthlyInterest(MAILCHIMP_LIST_ID);
    await mc.subscribe(MAILCHIMP_LIST_ID, email, name, group.interest);
    return json({ ok: true });
  } catch (error) {
    console.warn("newsletter_signup_failed", error instanceof Error ? error.message : error);
    return json({ error: "mailchimp_failed" }, 502);
  }
}
