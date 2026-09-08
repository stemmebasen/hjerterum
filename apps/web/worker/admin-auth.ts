import { authenticateBearer } from "./auth.js";

export type AdminIdentity = {
  userId: string;
  email: string;
};

type ClerkUser = {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id?: string; email_address?: string }>;
};

function allowedEmailSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function clerkPrimaryEmail(userId: string, secretKey: string): Promise<string> {
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      authorization: `Bearer ${secretKey}`,
      accept: "application/json"
    }
  });
  if (!response.ok) throw new Error("admin_identity_lookup_failed");

  const user = (await response.json()) as ClerkUser;
  const primary = user.email_addresses?.find(
    (item) => item.id && item.id === user.primary_email_address_id
  );
  const email = primary?.email_address ?? user.email_addresses?.[0]?.email_address;
  if (!email) throw new Error("admin_email_missing");
  return email.toLowerCase();
}

export async function authenticateAdmin(
  request: Request,
  config: {
    issuer?: string;
    clerkSecretKey?: string;
    allowedEmails?: string;
  }
): Promise<AdminIdentity> {
  if (!config.clerkSecretKey || !config.allowedEmails) throw new Error("admin_auth_not_configured");
  const user = await authenticateBearer(request, config.issuer);
  const email = await clerkPrimaryEmail(user.userId, config.clerkSecretKey);
  if (!allowedEmailSet(config.allowedEmails).has(email)) throw new Error("admin_forbidden");
  return { userId: user.userId, email };
}
