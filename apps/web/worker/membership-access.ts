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
  clerkSecretKey?: string
): Promise<ActiveMembership | null> {
  const local = await getMemberByClerkUserId(db, clerkUserId);
  if (local) {
    if (local.status !== "active" || local.accessBlocked) return null;
    return {
      source: "hjerterum",
      fullName: local.fullName,
      email: local.email,
      member: local
    };
  }

  if (!clerkSecretKey) throw new Error("membership_lookup_not_configured");
  const email = await clerkPrimaryEmail(clerkUserId, clerkSecretKey);
  const external = await findMembershipWorksMemberByEmail(db, email);
  if (!external || external.status !== "active" || external.accessBlocked === 1) return null;

  return {
    source: "membershipworks",
    fullName: external.fullName,
    email: external.email,
    externalId: external.id,
    membershipLevel: external.membershipLevel
  };
}
