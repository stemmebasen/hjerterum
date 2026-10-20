import { includesMemberBenefits } from "../membership.js";
import { clerkPrimaryEmail } from "./admin-auth.js";
import type { D1Database } from "./db.js";
import { getMemberByClerkUserId, type MemberView } from "./members.js";
import { findMembershipWorksMemberByEmail } from "./membership-import.js";

export type ActiveMembership =
  | {
      source: "hjerterum";
      fullName: string;
      email: string;
      member: MemberView;
    }
  | {
      source: "membershipworks";
      fullName: string;
      email: string;
      externalId: number;
      membershipLevel: string | null;
    };

export async function resolveActiveMembership(
  db: D1Database,
  clerkUserId: string,
  clerkSecretKey?: string,
  requireBenefits = true
): Promise<ActiveMembership | null> {
  const local = await getMemberByClerkUserId(db, clerkUserId);
  if (local) {
    if (local.status !== "active" || local.accessBlocked) return null;
    if (requireBenefits && !includesMemberBenefits(local.tier)) return null;
    return {
      source: "hjerterum",
      fullName: local.fullName,
      email: local.email,
      member: local
    };
  }

  if (!clerkSecretKey) throw new Error("membership_lookup_not_configured");
  const email = await clerkPrimaryEmail(clerkUserId, clerkSecretKey);
  // A member imported from MembershipWorks on the day of the switch (member-admin.ts importTurnover) waits for their first
  // login with that (verified) email, and is theirs from then on.
  const claimed = await db.prepare("UPDATE members SET clerk_user_id = ?, updated_at_ms = ? WHERE clerk_user_id = ?")
    .bind(clerkUserId, Date.now(), `pending:${email.trim().toLowerCase()}`).run();
  if (claimed.meta?.changes) return resolveActiveMembership(db, clerkUserId, clerkSecretKey, requireBenefits);
  const external = await findMembershipWorksMemberByEmail(db, email);
  if (!external) return membershipFromUpload(db, email, requireBenefits);
  if (external.status !== "active" || external.accessBlocked === 1) return null;
  if (requireBenefits && !includesMemberBenefits(external.membershipLevel)) return null;

  return {
    source: "membershipworks",
    fullName: external.fullName,
    email: external.email,
    externalId: external.id,
    membershipLevel: external.membershipLevel
  };
}

/** Reported: "Hvorfor kan Frederik ikke oprette en bruger" - "Der er ikke knyttet et aktivt medlemskab til din verificerede e-mail". The members
 * are in the export uploaded under Medlemmer in admin (membershipworks_accounts, member-admin.ts), not in the older import this looked in, which
 * is empty. Someone in the newest export has a membership; its row number (offset, so it never meets an id from the older import) names them. */
const UPLOAD_ID_OFFSET = 1_000_000;
export async function membershipFromUpload(db: D1Database, email: string, requireBenefits = true): Promise<ActiveMembership | null> {
  const row = await db.prepare("SELECT rowid AS n, email, full_name, tier FROM membershipworks_accounts WHERE email = ?")
    .bind(email.trim().toLowerCase()).first<{ n: number; email: string; full_name: string; tier: string | null }>().catch(() => null);
  if (!row) return null;
  if (requireBenefits && !includesMemberBenefits(row.tier)) return null;
  return { source: "membershipworks", fullName: row.full_name, email: row.email, externalId: UPLOAD_ID_OFFSET + row.n, membershipLevel: row.tier };
}
