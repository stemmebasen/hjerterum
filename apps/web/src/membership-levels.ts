import { applyMembershipLevels, type MembershipLevel } from "../membership";

/** The membership levels as saved in admin (worker/membership-levels.ts), laid over the ones written in membership.ts. The page draws with
 * those first and again when these have come, if anything differs. */
export async function loadMembershipLevels(): Promise<boolean> {
  try {
    const response = await fetch("/api/membership-levels", { headers: { accept: "application/json" } });
    if (!response.ok) return false;
    const levels = await response.json() as MembershipLevel[];
    return Array.isArray(levels) && applyMembershipLevels(levels);
  } catch {
    return false;
  }
}
