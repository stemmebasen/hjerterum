import type { D1Database } from "./db.js";
import { mailchimp, MAILCHIMP_LIST_ID, type NewsletterEnv } from "./newsletter-send.js";
import type { SagaDeps } from "./saga/env.js";

/** Requested: "Jeg vil gerne have at alle modtagere gemmes samlet i vores Mailchimp konto" - "Alt med samtykke i én liste". Everyone who said yes
 * to the newsletter goes into the one Mailchimp audience (MAILCHIMP_LIST_ID) with "Månedens events", and members get the tag "Medlem":
 * - members from MembershipWorks who ticked "Receive newsletter" (read from the chair's upload, membershipworks_accounts),
 * - members who turn it on in Min profil (subscribed at once - their e-mail is their login),
 * - guests who tick it when they sign up for an event (Mailchimp asks them to confirm first).
 * Someone who unsubscribed in Mailchimp is never subscribed again from here. Mailchimp is the list; mailchimp_contacts only carries them there. */

export type ContactSource = "membershipworks" | "member" | "event";
const PER_RUN = 40;
const MAX_ATTEMPTS = 5;

export async function queueContact(db: D1Database, contact: { email: string; name: string; source: ContactSource; member: boolean; doubleOptIn: boolean }, nowMs: number): Promise<void> {
  const email = contact.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  await db.prepare(`INSERT INTO mailchimp_contacts (email, name, source, member, double_opt_in, queued_at_ms) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE mailchimp_contacts.name END,
      member = MAX(mailchimp_contacts.member, excluded.member), double_opt_in = MIN(mailchimp_contacts.double_opt_in, excluded.double_opt_in),
      queued_at_ms = excluded.queued_at_ms, synced_at_ms = NULL, attempts = 0, error = NULL`)
    .bind(email, contact.name.trim().slice(0, 120), contact.source, contact.member ? 1 : 0, contact.doubleOptIn ? 1 : 0, nowMs).run();
}

/** The MembershipWorks members who ticked "Receive newsletter" and are not on their way yet. */
async function queueMembershipWorks(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO mailchimp_contacts (email, name, source, member, double_opt_in, queued_at_ms)
    SELECT email, full_name, 'membershipworks', CASE WHEN json_extract(row_json, '$.cancelled') = 1 THEN 0 ELSE 1 END, 0, ?
    FROM membershipworks_accounts WHERE json_extract(row_json, '$.newsletter') = 1`).bind(nowMs).run();
}

/** Every run (when Mailchimp is connected): up to forty contacts into the audience. */
export async function runMailchimpSync(env: NewsletterEnv, deps: SagaDeps): Promise<number> {
  const db = env.DB;
  if (!db || !env.MAILCHIMP_API_KEY) return 0;
  const now = deps.now();
  await queueMembershipWorks(db, now);
  const rows = (await db.prepare(`SELECT email, name, member, double_opt_in FROM mailchimp_contacts WHERE synced_at_ms IS NULL AND attempts < ? ORDER BY queued_at_ms LIMIT ?`)
    .bind(MAX_ATTEMPTS, PER_RUN).all<{ email: string; name: string; member: number; double_opt_in: number }>()).results ?? [];
  if (!rows.length) return 0;
  const mc = mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher);
  const group = await mc.monthlyInterest(MAILCHIMP_LIST_ID);
  let sent = 0;
  for (const row of rows) {
    try {
      await mc.upsert(MAILCHIMP_LIST_ID, { email: row.email, name: row.name, interest: group.interest, doubleOptIn: row.double_opt_in === 1, member: row.member === 1 });
      await db.prepare("UPDATE mailchimp_contacts SET synced_at_ms = ?, error = NULL WHERE email = ?").bind(now, row.email).run();
      sent++;
    } catch (error) {
      await db.prepare("UPDATE mailchimp_contacts SET attempts = attempts + 1, error = ? WHERE email = ?").bind((error instanceof Error ? error.message : String(error)).slice(0, 300), row.email).run();
    }
  }
  return sent;
}

/** Min profil's switch: is this member getting the newsletter, and turning it on or off. On goes through the queue (and at once, when it can);
 * off goes straight to Mailchimp, so it holds from this moment. */
export async function memberNewsletter(env: NewsletterEnv, deps: SagaDeps, member: { email: string; name: string }, want?: boolean): Promise<{ subscribed: boolean }> {
  const db = env.DB!;
  const email = member.email.trim().toLowerCase();
  if (want === true) {
    await queueContact(db, { email, name: member.name, source: "member", member: true, doubleOptIn: false }, deps.now());
    await runMailchimpSync(env, deps).catch(() => 0);
    // One who turned it off before is not subscribed again by the queue (it never overrides an unsubscribe): asked here by the member
    // themself, Mailchimp sends them a confirmation mail.
    if (env.MAILCHIMP_API_KEY) {
      const mc = mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher);
      if (await mc.status(MAILCHIMP_LIST_ID, email).catch(() => null) === "unsubscribed") await mc.resubscribe(MAILCHIMP_LIST_ID, email).catch(() => undefined);
    }
    return { subscribed: true };
  }
  if (want === false) {
    if (!env.MAILCHIMP_API_KEY) throw new Error("mailchimp_not_configured");
    await mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher).unsubscribe(MAILCHIMP_LIST_ID, email).catch(error => { if (!(error instanceof Error && error.message.startsWith("mailchimp_404"))) throw error; });
    await db.prepare("DELETE FROM mailchimp_contacts WHERE email = ?").bind(email).run();
    return { subscribed: false };
  }
  if (env.MAILCHIMP_API_KEY) {
    const status = await mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher).status(MAILCHIMP_LIST_ID, email).catch(() => undefined);
    if (status !== undefined) return { subscribed: status === "subscribed" || status === "pending" };
  }
  const queued = await db.prepare("SELECT 1 AS yes FROM mailchimp_contacts WHERE email = ?").bind(email).first<{ yes: number }>();
  return { subscribed: Boolean(queued) };
}

/** GET: is the signed-in member getting the newsletter? POST {subscribe: boolean}: turn it on or off. Members only (any membership, Support too). */
export async function memberNewsletterRoute(request: Request, env: NewsletterEnv & { CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string }, deps: SagaDeps): Promise<Response> {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "unavailable" }, 503);
  const { authenticateBearer } = await import("./auth.js");
  const { resolveActiveMembership } = await import("./membership-access.js");
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return json({ error: "authentication_required" }, 401); }
  const membership = await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY, false).catch(() => null);
  if (!membership) return json({ error: "membership_not_found" }, 404);
  const who = { email: membership.email, name: membership.fullName };
  try {
    if (request.method === "GET") return json({ ...(await memberNewsletter(env, deps, who)), connected: Boolean(env.MAILCHIMP_API_KEY) });
    const body = await request.json().catch(() => null) as { subscribe?: unknown } | null;
    if (typeof body?.subscribe !== "boolean") return json({ error: "invalid_body" }, 400);
    return json(await memberNewsletter(env, deps, who, body.subscribe));
  } catch (error) {
    const code = error instanceof Error ? error.message : "newsletter_failed";
    return json({ error: code === "mailchimp_not_configured" ? code : "newsletter_failed" }, 503);
  }
}
