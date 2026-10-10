import type { D1Database } from "./db.js";
import { stripeRequest, type StripeEvent } from "./stripe.js";

import { membershipPlan, membershipPlans, type MembershipTier } from "../membership.js";
import { linkMembershipWorks, recordTimeline } from "./member-admin.js";
export type { MembershipTier } from "../membership.js";
export type BillingInterval = "month" | "year";

const membershipAmounts = membershipPlans;

export type MemberView = {
  id: number;
  clerkUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  tier: string;
  interval: string;
  status: string;
  fullName: string;
  email: string;
  phone: string | null;
  streetAddress: string | null;
  birthday: string | null;
  isTeacher: boolean;
  accessBlocked: boolean;
  /** "manual": given by the board in admin → Medlemmer, with no payment through Stripe (worker/member-admin.ts). */
  billing: "stripe" | "manual";
  /** Moved from MembershipWorks on the day of the switch; their payment still runs there. */
  paysInMembershipworks: boolean;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid_${field}`);
  }
  return value.trim();
}

export function parseCheckoutInput(value: unknown): {
  tier: MembershipTier;
  interval: BillingInterval;
  email: string;
  fullName: string;
} {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  const tier = requireString(body.tier, "tier") as MembershipTier;
  const interval = requireString(body.interval, "interval") as BillingInterval;
  const email = requireString(body.email, "email");
  const fullName = requireString(body.fullName, "full_name");

  if (!Object.prototype.hasOwnProperty.call(membershipAmounts, tier)) throw new Error("invalid_tier");
  if (interval !== "month" && interval !== "year") throw new Error("invalid_interval");
  return { tier, interval, email, fullName };
}

export async function getMemberByClerkUserId(
  db: D1Database,
  clerkUserId: string
): Promise<MemberView | null> {
  const row = await db
    .prepare(
      `SELECT id, clerk_user_id, stripe_customer_id, stripe_subscription_id,
              tier, interval, status, full_name, email, phone, street_address, birthday, is_teacher, access_blocked, billing, pays_in_membershipworks
       FROM members WHERE clerk_user_id = ? LIMIT 1`
    )
    .bind(clerkUserId)
    .first<{
      id: number;
      clerk_user_id: string;
      stripe_customer_id: string;
      stripe_subscription_id: string | null;
      tier: string;
      interval: string;
      status: string;
      full_name: string;
      email: string;
      phone: string | null;
      street_address: string | null;
      birthday: string | null;
      is_teacher: number;
      access_blocked: number;
      billing: string;
      pays_in_membershipworks: number;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    tier: row.tier,
    interval: row.interval,
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    streetAddress: row.street_address,
    birthday: row.birthday ?? null,
    isTeacher: row.is_teacher === 1,
    accessBlocked: row.access_blocked === 1,
    billing: row.billing === "manual" ? "manual" : "stripe",
    paysInMembershipworks: row.pays_in_membershipworks === 1
  };
}

export async function createMembershipCheckout(
  db: D1Database,
  stripeSecretKey: string,
  appBaseUrl: string,
  clerkUserId: string,
  input: ReturnType<typeof parseCheckoutInput>
): Promise<{ checkoutUrl: string }> {
  const existing = await getMemberByClerkUserId(db, clerkUserId);
  const amountMinor = membershipAmounts[input.tier][input.interval];
  const params: Record<string, string | number | boolean> = {
    mode: "subscription",
    success_url: `${appBaseUrl.replace(/\/$/, "")}/member-portal/success`,
    cancel_url: `${appBaseUrl.replace(/\/$/, "")}/member-portal/`,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": amountMinor,
    "line_items[0][price_data][product_data][name]": `Hjerterum ${input.tier}`,
    "line_items[0][price_data][recurring][interval]": input.interval,
    "metadata[clerk_user_id]": clerkUserId,
    "metadata[tier]": input.tier,
    "metadata[interval]": input.interval,
    "metadata[full_name]": input.fullName
  };

  // A membership the board gave has no Stripe customer: only a real one is reused.
  if (existing?.stripeCustomerId?.startsWith("cus_")) {
    params.customer = existing.stripeCustomerId;
  } else {
    params.customer_email = input.email;
    params["subscription_data[trial_period_days]"] = 30;
  }

  const session = await stripeRequest<{ url?: string }>(
    stripeSecretKey,
    "POST",
    "/checkout/sessions",
    params
  );
  if (!session.url) throw new Error("stripe_checkout_url_missing");
  return { checkoutUrl: session.url };
}

export async function cancelMembership(
  db: D1Database,
  stripeSecretKey: string,
  clerkUserId: string
): Promise<void> {
  const member = await getMemberByClerkUserId(db, clerkUserId);
  if (!member?.stripeSubscriptionId) throw new Error("membership_subscription_missing");

  await stripeRequest<Record<string, unknown>>(
    stripeSecretKey,
    "POST",
    `/subscriptions/${encodeURIComponent(member.stripeSubscriptionId)}`,
    { cancel_at_period_end: true }
  );
}

export async function createBillingPortalUrl(
  db: D1Database,
  stripeSecretKey: string,
  appBaseUrl: string,
  clerkUserId: string
): Promise<{ portalUrl: string }> {
  const member = await getMemberByClerkUserId(db, clerkUserId);
  if (member?.billing === "manual") throw new Error("membership_manual");
  if (!member?.stripeCustomerId) throw new Error("membership_customer_missing");

  const session = await stripeRequest<{ url?: string }>(
    stripeSecretKey,
    "POST",
    "/billing_portal/sessions",
    {
      customer: member.stripeCustomerId,
      return_url: `${appBaseUrl.replace(/\/$/, "")}/member-portal/dashboard`
    }
  );
  if (!session.url) throw new Error("stripe_portal_url_missing");
  return { portalUrl: session.url };
}

function stripeStatusToLocal(status: unknown): string {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  return "incomplete";
}

async function markWebhook(
  db: D1Database,
  eventId: string,
  eventType: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_events
       (provider, event_id, event_type, first_seen_at_ms)
       VALUES ('stripe', ?, ?, ?)`
    )
    .bind(eventId, eventType, Date.now())
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function finishWebhook(db: D1Database, eventId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE webhook_events
       SET status = 'processed', processed_at_ms = ?, last_error = NULL
       WHERE provider = 'stripe' AND event_id = ?`
    )
    .bind(Date.now(), eventId)
    .run();
}

async function failWebhook(db: D1Database, eventId: string, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE webhook_events
       SET status = 'failed', last_error = ?
       WHERE provider = 'stripe' AND event_id = ?`
    )
    .bind(error.slice(0, 1000), eventId)
    .run();
}

function objectString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

const STATUS_DA: Record<string, string> = { active: "Aktiv", past_due: "I restance", canceled: "Opsagt", incomplete: "Ikke gennemført" };
const objectNumber = (object: Record<string, unknown>, key: string) => typeof object[key] === "number" ? object[key] as number : null;
/** When Stripe says it happened, else now. */
const eventTime = (event: StripeEvent) => { const created = (event as { created?: unknown }).created; return typeof created === "number" ? created * 1000 : Date.now(); };

async function memberIdBy(db: D1Database, column: "stripe_customer_id" | "stripe_subscription_id" | "clerk_user_id", value: string): Promise<{ id: number; status: string } | null> {
  return db.prepare(`SELECT id, status FROM members WHERE ${column} = ? LIMIT 1`).bind(value).first<{ id: number; status: string }>();
}

/** A status change, with when it began ("I restance 35 dage") and a line on the timeline. */
async function changeStatus(db: D1Database, member: { id: number; status: string }, status: string, at: number, eventId: string): Promise<void> {
  if (member.status === status) return;
  await db.prepare("UPDATE members SET status = ?, status_since_ms = ?, updated_at_ms = ? WHERE id = ?").bind(status, at, Date.now(), member.id).run();
  await recordTimeline(db, member.id, { atMs: at, kind: status === "canceled" ? "cancelled" : "status",
    title: status === "canceled" ? "Medlemskab opsagt" : `Status: ${STATUS_DA[member.status] ?? member.status} → ${STATUS_DA[status] ?? status}`, by: "Stripe" }, eventId);
}

export async function processMemberStripeEvent(
  db: D1Database,
  event: StripeEvent
): Promise<{ duplicate: boolean }> {
  const claimed = await markWebhook(db, event.id, event.type);
  if (!claimed) return { duplicate: true };

  try {
    const object = event.data?.object ?? {};

    if (event.type === "checkout.session.completed") {
      const customerId = objectString(object, "customer");
      const subscriptionId = objectString(object, "subscription");
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const customerDetails = (object.customer_details ?? {}) as Record<string, unknown>;
      const clerkUserId = objectString(metadata, "clerk_user_id");
      const tier = objectString(metadata, "tier") ?? "standard";
      const interval = objectString(metadata, "interval") ?? "month";
      const fullName =
        objectString(metadata, "full_name") ?? objectString(customerDetails, "name") ?? "Hjerterum medlem";
      const email = objectString(customerDetails, "email") ?? objectString(object, "customer_email");

      if (!customerId || !clerkUserId || !email) throw new Error("stripe_checkout_metadata_incomplete");
      const now = Date.now();
      await db
        .prepare(
          `INSERT INTO members (
             clerk_user_id, stripe_customer_id, stripe_subscription_id,
             tier, interval, status, full_name, email, created_at_ms, updated_at_ms, billing, status_since_ms
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'stripe', ?)
           ON CONFLICT(clerk_user_id) DO UPDATE SET
             stripe_customer_id = excluded.stripe_customer_id,
             stripe_subscription_id = excluded.stripe_subscription_id,
             tier = excluded.tier,
             interval = excluded.interval,
             status = 'active',
             full_name = excluded.full_name,
             email = excluded.email,
             updated_at_ms = excluded.updated_at_ms,
             billing = 'stripe',
             status_since_ms = excluded.status_since_ms`
        )
        .bind(
          clerkUserId,
          customerId,
          subscriptionId ?? null,
          tier,
          interval,
          fullName,
          email,
          now,
          now,
          now
        )
        .run();
      const joined = await memberIdBy(db, "clerk_user_id", clerkUserId);
      if (joined) {
        await recordTimeline(db, joined.id, { atMs: eventTime(event), kind: "joined", title: `Blev medlem: ${membershipPlan(tier)?.name ?? tier}`,
          amountMinor: objectNumber(object, "amount_total"), detail: interval === "year" ? "Årlig betaling med kort" : "Månedlig betaling med kort", by: "Stripe" }, event.id);
        await linkMembershipWorks(db, joined.id, now);
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscriptionId = objectString(object, "id");
      const member = subscriptionId ? await memberIdBy(db, "stripe_subscription_id", subscriptionId) : null;
      if (member) await changeStatus(db, member, stripeStatusToLocal(object.status), eventTime(event), event.id);
    } else if (event.type === "customer.subscription.deleted") {
      const subscriptionId = objectString(object, "id");
      const member = subscriptionId ? await memberIdBy(db, "stripe_subscription_id", subscriptionId) : null;
      if (member) await changeStatus(db, member, "canceled", eventTime(event), event.id);
    } else if (event.type === "invoice.payment_failed") {
      const customerId = objectString(object, "customer");
      const member = customerId ? await memberIdBy(db, "stripe_customer_id", customerId) : null;
      if (member) {
        const attempt = objectNumber(object, "attempt_count");
        await recordTimeline(db, member.id, { atMs: eventTime(event), kind: "payment_failed", title: "Betaling mislykkedes",
          amountMinor: objectNumber(object, "amount_due"), detail: attempt ? `Forsøg ${attempt}` : null, by: "Stripe" }, `${event.id}:failed`);
        await changeStatus(db, member, "past_due", eventTime(event), event.id);
      }
    } else if (event.type === "invoice.paid") {
      // Requested: the member's payments on their timeline, as MembershipWorks shows them.
      const customerId = objectString(object, "customer");
      const member = customerId ? await memberIdBy(db, "stripe_customer_id", customerId) : null;
      const amount = objectNumber(object, "amount_paid");
      if (member && amount) {
        const reason = objectString(object, "billing_reason");
        await recordTimeline(db, member.id, { atMs: eventTime(event), kind: "payment", title: "Betaling", amountMinor: amount,
          detail: reason === "subscription_create" ? "Første betaling" : reason === "subscription_cycle" ? "Fornyelse" : null, by: "Stripe" }, event.id);
      }
    }

    await finishWebhook(db, event.id);
    return { duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe_webhook_failed";
    await failWebhook(db, event.id, message);
    throw error;
  }
}
