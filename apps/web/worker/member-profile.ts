import type { D1Database } from "./db.js";
import { getMemberByClerkUserId, type MemberView } from "./members.js";
import { stripeRequest } from "./stripe.js";

export type MemberProfileUpdate = {
  fullName?: string;
  email?: string;
  phone?: string | null;
  streetAddress?: string | null;
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

export function parseMemberProfileUpdate(value: unknown): MemberProfileUpdate {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;

  const fullName = optionalRequiredText(body.fullName, "full_name");
  const email = optionalRequiredText(body.email, "email");
  const phone = optionalNullableText(body.phone, "phone");
  const streetAddress = optionalNullableText(body.streetAddress, "street_address");

  if (fullName === undefined && email === undefined && phone === undefined && streetAddress === undefined) {
    throw new Error("invalid_empty_update");
  }

  return {
    ...(fullName !== undefined ? { fullName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(streetAddress !== undefined ? { streetAddress } : {})
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
    streetAddress: input.streetAddress === undefined ? current.streetAddress : input.streetAddress
  };

  await db
    .prepare(
      `UPDATE members
       SET full_name = ?, email = ?, phone = ?, street_address = ?, updated_at_ms = ?
       WHERE clerk_user_id = ?`
    )
    .bind(next.fullName, next.email, next.phone, next.streetAddress, Date.now(), clerkUserId)
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
          phone: next.phone,
          "address[line1]": next.streetAddress
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
