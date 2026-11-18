import type { D1Database } from "./db.js";
import { membershipPlans, type MembershipTier } from "../membership.js";

/** Douglas (13 and 17 Nov 2026), for the board: "I guess there must be a way of calculating the past dues when a membership payment has not gone
 * through for a while and then gets started again" - as MembershipWorks' "Past Due Charges": include the past-due period up to a maximum amount and
 * then restart the membership, or just restart it. The rule is set under Medlemsoverblik → Medlemskaber; it is used when a member whose payment
 * stopped joins again here. */

export type PastDueRule = { mode: "restart" | "include"; maxMinor: number };
const DEFAULT: PastDueRule = { mode: "include", maxMinor: 66_600 };

export async function pastDueRule(db: D1Database): Promise<PastDueRule> {
  const rows = (await db.prepare("SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('past_due_mode', 'past_due_max_minor')")
    .all<{ setting_key: string; setting_value: string }>().catch(() => ({ results: [] }))).results ?? [];
  const get = (k: string) => rows.find(r => r.setting_key === k)?.setting_value;
  const max = Number(get("past_due_max_minor"));
  return { mode: get("past_due_mode") === "restart" ? "restart" : get("past_due_mode") === "include" ? "include" : DEFAULT.mode,
    maxMinor: Number.isInteger(max) && max >= 0 ? max : DEFAULT.maxMinor };
}

export async function savePastDueRule(db: D1Database, rule: PastDueRule, by: string, nowMs: number): Promise<void> {
  for (const [k, v] of [["past_due_mode", rule.mode], ["past_due_max_minor", String(rule.maxMinor)]] as const)
    await db.prepare(`INSERT INTO platform_settings (setting_key, setting_value, updated_by_email, updated_at_ms) VALUES (?, ?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by_email = excluded.updated_by_email, updated_at_ms = excluded.updated_at_ms`).bind(k, v, by, nowMs).run();
}

const MONTH_MS = 30.44 * 86_400_000, YEAR_MS = 365.25 * 86_400_000;

/** What a member coming back owes for the periods since their last payment, by the rule: the periods their last payment did not cover, at their
 * level's price, up to the maximum. Nothing for one who never fell behind (still active, or cancelled in good order), or by the rule "restart". */
export async function arrearsFor(db: D1Database, member: { id: number; status: string; tier: string; interval: string }, nowMs: number): Promise<number> {
  if (!["past_due", "unpaid", "canceled", "incomplete_expired"].includes(member.status)) return 0;
  const rule = await pastDueRule(db);
  if (rule.mode === "restart" || rule.maxMinor === 0) return 0;
  // Only one who fell behind: a failed payment after the last one that went through.
  const last = await db.prepare(`SELECT MAX(CASE WHEN kind = 'payment' THEN at_ms END) AS paid, MAX(CASE WHEN kind = 'payment_failed' THEN at_ms END) AS failed
    FROM member_timeline WHERE member_id = ?`).bind(member.id).first<{ paid: number | null; failed: number | null }>();
  if (!last?.failed || (last.paid !== null && last.paid > last.failed) || last.paid === null) return 0;
  const plan = membershipPlans[member.tier as MembershipTier];
  if (!plan) return 0;
  const year = member.interval === "year";
  const periods = Math.floor((nowMs - last.paid) / (year ? YEAR_MS : MONTH_MS));
  const missed = Math.max(0, periods - 1);
  return Math.min(missed * (year ? plan.year : plan.month), rule.maxMinor);
}
