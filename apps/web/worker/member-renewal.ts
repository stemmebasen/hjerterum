import type { D1Database } from "./db.js";
import { recordTimeline } from "./member-admin.js";
import { stripeRequest } from "./stripe.js";

/** Douglas (13 and 17 Nov 2026), for the board: "Editable renewal date". A member here whose payment runs by hand or still in MembershipWorks gets the
 * date written; one who pays by card has their subscription's next charge moved in Stripe (a free stretch until the new date, nothing charged for it). */
export async function moveRenewal(db: D1Database, env: { STRIPE_SECRET_KEY?: string }, memberId: number, day: string, by: string, nowMs: number):
  Promise<{ from: string | null; to: string } | { error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return { error: "Vælg en dato." };
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (day <= today) return { error: "Den nye fornyelsesdato skal ligge efter i dag." };
  const m = await db.prepare("SELECT billing, pays_in_membershipworks, stripe_subscription_id, next_charge_on, tier FROM members WHERE id = ?").bind(memberId)
    .first<{ billing: string | null; pays_in_membershipworks: number; stripe_subscription_id: string | null; next_charge_on: string | null; tier: string }>();
  if (!m) return { error: "Medlemmet findes ikke." };
  const byCard = m.billing !== "manual" && m.pays_in_membershipworks !== 1 && Boolean(m.stripe_subscription_id);
  if (byCard) {
    if (!env.STRIPE_SECRET_KEY) return { error: "Kortbetaling er ikke slået til endnu, så datoen kan ikke flyttes i Stripe." };
    // Noon in Denmark on the chosen day, so the charge falls on that date.
    const at = Math.floor(Date.parse(`${day}T11:00:00Z`) / 1000);
    try {
      await stripeRequest(env.STRIPE_SECRET_KEY, "POST", `/subscriptions/${encodeURIComponent(m.stripe_subscription_id!)}`, { trial_end: at, proration_behavior: "none" });
    } catch (error) {
      console.warn("renewal_move_failed", error instanceof Error ? error.message : error);
      return { error: "Stripe tog ikke imod den nye dato. Prøv igen, eller skriv til formanden." };
    }
  }
  await db.prepare("UPDATE members SET next_charge_on = ?, updated_at_ms = ? WHERE id = ?").bind(day, nowMs, memberId).run();
  await recordTimeline(db, memberId, { atMs: nowMs, kind: "note", title: "Fornyelsesdato ændret", detail: `${m.next_charge_on ?? "–"} → ${day}${byCard ? " (i Stripe)" : ""}`, by });
  return { from: m.next_charge_on, to: day };
}
