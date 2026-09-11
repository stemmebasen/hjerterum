import { authenticateBearer } from "./auth.js";

export type AdminIdentity = {
  userId: string;
  email: string;
};

export type ClerkUser = {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{
    id?: string;
    email_address?: string;
    verification?: { status?: string };
  }>;
};

function allowedEmailSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function verifiedPrimaryEmail(user: ClerkUser): string {
  const addresses = user.email_addresses ?? [];
  const primary = addresses.find(
    (item) => item.id && item.id === user.primary_email_address_id
  );
  const candidate = primary ?? addresses.find(
    (item) => item.verification?.status === "verified"
  );

  if (!candidate?.email_address) throw new Error("admin_email_missing");
  if (candidate.verification?.status !== "verified") {
    throw new Error("identity_email_unverified");
  }
  return candidate.email_address.trim().toLowerCase();
}

export async function clerkPrimaryEmail(userId: string, secretKey: string): Promise<string> {
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      authorization: `Bearer ${secretKey}`,
      accept: "application/json"
    }
  });
  if (!response.ok) throw new Error("admin_identity_lookup_failed");

  return verifiedPrimaryEmail((await response.json()) as ClerkUser);
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
