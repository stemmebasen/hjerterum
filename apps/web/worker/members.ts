import type { D1Database } from "./db.js";
import { stripeRequest, type StripeEvent } from "./stripe.js";

export type MembershipTier = "standard" | "reduceret" | "support";
export type BillingInterval = "month" | "year";

const membershipAmounts: Record<MembershipTier, Record<BillingInterval, number>> = {
  standard: { month: 22_200, year: 231_000 },
  reduceret: { month: 11_100, year: 115_500 },
  support: { month: 5_000, year: 54_000 }
};

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
  isTeacher: boolean;
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

  if (!(tier in membershipAmounts)) throw new Error("invalid_tier");
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
              tier, interval, status, full_name, email, phone, street_address, is_teacher
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
      is_teacher: number;
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
    isTeacher: row.is_teacher === 1
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

  if (existing?.stripeCustomerId) {
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
             tier, interval, status, full_name, email, created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
           ON CONFLICT(clerk_user_id) DO UPDATE SET
             stripe_customer_id = excluded.stripe_customer_id,
             stripe_subscription_id = excluded.stripe_subscription_id,
             tier = excluded.tier,
             interval = excluded.interval,
             status = 'active',
             full_name = excluded.full_name,
             email = excluded.email,
             updated_at_ms = excluded.updated_at_ms`
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
          now
        )
        .run();
    } else if (event.type === "customer.subscription.updated") {
      const subscriptionId = objectString(object, "id");
      if (subscriptionId) {
        await db
          .prepare("UPDATE members SET status = ?, updated_at_ms = ? WHERE stripe_subscription_id = ?")
          .bind(stripeStatusToLocal(object.status), Date.now(), subscriptionId)
          .run();
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscriptionId = objectString(object, "id");
      if (subscriptionId) {
        await db
          .prepare("UPDATE members SET status = 'canceled', updated_at_ms = ? WHERE stripe_subscription_id = ?")
          .bind(Date.now(), subscriptionId)
          .run();
      }
    } else if (event.type === "invoice.payment_failed") {
      const customerId = objectString(object, "customer");
      if (customerId) {
        await db
          .prepare("UPDATE members SET status = 'past_due', updated_at_ms = ? WHERE stripe_customer_id = ?")
          .bind(Date.now(), customerId)
          .run();
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
