import type { D1Database } from "./db.js";
import { getMemberByClerkUserId, type MemberView } from "./members.js";
import { stripeRequest } from "./stripe.js";

export type MemberProfileUpdate = {
  fullName?: string;
  email?: string;
  phone?: string | null;
  birthday?: string | null;
};

export type MemberInvoice = {
  id: string;
  status: string | null;
  amountPaidMinor: number;
  amountDueMinor: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

function optionalRequiredText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid_${field}`);
  return value.trim();
}

function optionalNullableText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  return value.trim() || null;
}

/** Requested: "gerne fødselsdag, så vi kan lave noget omkring deres stjernetegn". A real day, YYYY-MM-DD, not in the future. */
function optionalBirthday(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_birthday");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getTime() > Date.now() || date.getUTCFullYear() < 1900) throw new Error("invalid_birthday");
  return value;
}

export function parseMemberProfileUpdate(value: unknown): MemberProfileUpdate {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;

  const fullName = optionalRequiredText(body.fullName, "full_name");
  const email = optionalRequiredText(body.email, "email");
  const phone = optionalNullableText(body.phone, "phone");
  const birthday = optionalBirthday(body.birthday);

  if (fullName === undefined && email === undefined && phone === undefined && birthday === undefined) {
    throw new Error("invalid_empty_update");
  }

  return {
    ...(fullName !== undefined ? { fullName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(birthday !== undefined ? { birthday } : {})
  };
}

export async function updateMemberProfile(
  db: D1Database,
  stripeSecretKey: string | undefined,
  clerkUserId: string,
  input: MemberProfileUpdate
): Promise<{ member: MemberView; stripeSynced: boolean }> {
  const current = await getMemberByClerkUserId(db, clerkUserId);
  if (!current) throw new Error("member_not_found");

  const next = {
    fullName: input.fullName ?? current.fullName,
    email: input.email ?? current.email,
    phone: input.phone === undefined ? current.phone : input.phone,
    birthday: input.birthday === undefined ? current.birthday : input.birthday
  };

  await db
    .prepare(
      `UPDATE members
       SET full_name = ?, email = ?, phone = ?, birthday = ?, updated_at_ms = ?
       WHERE clerk_user_id = ?`
    )
    .bind(next.fullName, next.email, next.phone, next.birthday, Date.now(), clerkUserId)
    .run();

  let stripeSynced = false;
  if (stripeSecretKey && current.stripeCustomerId) {
    try {
      await stripeRequest<Record<string, unknown>>(
        stripeSecretKey,
        "POST",
        `/customers/${encodeURIComponent(current.stripeCustomerId)}`,
        {
          name: next.fullName,
          email: next.email,
          phone: next.phone
        }
      );
      stripeSynced = true;
    } catch {
      stripeSynced = false;
    }
  }

  const member = await getMemberByClerkUserId(db, clerkUserId);
  if (!member) throw new Error("member_not_found");
  return { member, stripeSynced };
}

export async function listMemberInvoices(
  db: D1Database,
  stripeSecretKey: string,
  clerkUserId: string
): Promise<MemberInvoice[]> {
  const member = await getMemberByClerkUserId(db, clerkUserId);
  if (!member) throw new Error("member_not_found");
  if (!member.stripeCustomerId) throw new Error("membership_customer_missing");

  const response = await stripeRequest<{ data?: Record<string, unknown>[] }>(
    stripeSecretKey,
    "GET",
    "/invoices",
    { customer: member.stripeCustomerId, limit: 24 }
  );

  return (response.data ?? []).map((invoice) => ({
    id: typeof invoice.id === "string" ? invoice.id : "",
    status: typeof invoice.status === "string" ? invoice.status : null,
    amountPaidMinor: typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0,
    amountDueMinor: typeof invoice.amount_due === "number" ? invoice.amount_due : 0,
    currency: typeof invoice.currency === "string" ? invoice.currency : "dkk",
    createdAt: new Date((typeof invoice.created === "number" ? invoice.created : 0) * 1000).toISOString(),
    hostedInvoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null,
    invoicePdf: typeof invoice.invoice_pdf === "string" ? invoice.invoice_pdf : null
  }));
}

/** Requested: "Her skal stå flere detaljer om medlemskabet: Pris ..., hvornår der trækkes sidste gang, og en lille Afmeld-knap."
 * What the member's Stripe subscription says: the price, the next charge and whether it is cancelled at the period's end. */
export type SubscriptionSummary = { amountMinor: number | null; interval: string | null; nextChargeAt: string | null; cancelAtPeriodEnd: boolean; endsAt: string | null };

export function subscriptionSummary(raw: Record<string, unknown>): SubscriptionSummary {
  const item = ((raw.items as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])[0] ?? {};
  const price = (item.price ?? {}) as { unit_amount?: unknown; recurring?: { interval?: unknown } };
  // Newer Stripe API versions keep the period on the item, older ones on the subscription.
  const periodEnd = typeof raw.current_period_end === "number" ? raw.current_period_end : typeof item.current_period_end === "number" ? item.current_period_end : null;
  const iso = (seconds: number | null) => seconds ? new Date(seconds * 1000).toISOString() : null;
  const cancelAtPeriodEnd = raw.cancel_at_period_end === true || typeof raw.cancel_at === "number";
  const endsAt = typeof raw.cancel_at === "number" ? raw.cancel_at : cancelAtPeriodEnd ? periodEnd : null;
  return {
    amountMinor: typeof price.unit_amount === "number" ? price.unit_amount : null,
    interval: typeof price.recurring?.interval === "string" ? price.recurring.interval : null,
    nextChargeAt: cancelAtPeriodEnd || raw.status === "canceled" ? null : iso(periodEnd),
    cancelAtPeriodEnd,
    endsAt: iso(endsAt)
  };
}

export async function memberSubscription(db: D1Database, stripeSecretKey: string, clerkUserId: string): Promise<SubscriptionSummary> {
  const member = await getMemberByClerkUserId(db, clerkUserId);
  if (!member) throw new Error("member_not_found");
  if (!member.stripeSubscriptionId) throw new Error("membership_subscription_missing");
  const raw = await stripeRequest<Record<string, unknown>>(stripeSecretKey, "GET", `/subscriptions/${encodeURIComponent(member.stripeSubscriptionId)}`);
  return subscriptionSummary(raw);
}
