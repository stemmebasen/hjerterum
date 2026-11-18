import { authenticateBearer } from "./auth.js";
import { buildMime } from "./beregner/mime.js";
import type { D1Database } from "./db.js";
import { TEAM_ADDRESS } from "./enquiries.js";
import { recordTimeline } from "./member-admin.js";
import { resolveActiveMembership, type ActiveMembership } from "./membership-access.js";
import { MEMBERSHIP_TIERS, membershipName, membershipPlans, membershipPrice, type MembershipTier } from "../membership.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { deliverToTeamInbox, type ImapOpener } from "./saga/teamMail.js";
import { stripeRequest } from "./stripe.js";

/** Douglas (13 and 17 Nov 2026), for the board: "In the membership levels, when a member wants to change levels, we must only give them certain
 * options. For example we don't want to offer the free membership level to a paying member" - and "it is simplest if the change happens at the
 * next renewal date rather than calculating it from today's date". A member chooses among the paid levels (never the free one); one who pays by
 * card here gets the new price from the next renewal in Stripe, and the level then; for everyone else the wish goes to team@ to be done there. */

type ChangeEnv = SagaEnv & { CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string; STRIPE_SECRET_KEY?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** The levels a member may change to: the paid ones but their own. One with the free membership is given none (they write to the team). */
export function changeOptions(current: string | null): MembershipTier[] {
  if (!current || !(MEMBERSHIP_TIERS as string[]).includes(current)) return [];
  return MEMBERSHIP_TIERS.filter(t => t !== current);
}

function wishMail(m: ActiveMembership, tier: MembershipTier, nowMs: number): Uint8Array {
  const from = m.source === "hjerterum" ? membershipName(m.member.tier) : m.membershipLevel ?? "ukendt";
  const lines: Array<[string, string]> = [["Navn", m.fullName], ["E-mail", m.email], ["Nu", from], ["Ønsker", membershipName(tier)],
    ["Det skal ske", "Skift medlemskabet fra næste fornyelse (ikke fra i dag), og svar medlemmet med datoen."]];
  const plain = `Ønske om at skifte medlemskab fra medlemsområdet\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nSvar direkte på denne mail for at svare ${m.fullName}.`;
  return buildMime({ from: { name: `${m.fullName} via medlemsområdet`, address: TEAM_ADDRESS }, to: { name: "Hjerterum", address: TEAM_ADDRESS },
    replyTo: { name: m.fullName, address: m.email }, subject: `Skift af medlemskab: ${m.fullName}`, text: plain, html: `<pre style="font:15px/1.5 Arial">${plain.replace(/[<&]/g, c => c === "<" ? "&lt;" : "&amp;")}</pre>`,
    attachments: [], date: new Date(nowMs), messageId: `${crypto.randomUUID()}@medlem.hjerterum.info` });
}

/** For a card member: the subscription's price from the next renewal (no proration) and the level waiting until then. */
export async function changeByCard(db: D1Database, secret: string, memberId: number, subscriptionId: string, tier: MembershipTier, by: string, nowMs: number): Promise<void> {
  const sub = await stripeRequest<{ items?: { data?: Array<{ id: string; price?: { product?: string; recurring?: { interval?: string } } }> } }>(secret, "GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const item = sub.items?.data?.[0];
  if (!item?.price?.product) throw new Error("subscription_item_missing");
  const interval = item.price.recurring?.interval === "year" ? "year" : "month";
  await stripeRequest(secret, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    "items[0][id]": item.id, "items[0][price_data][currency]": "dkk", "items[0][price_data][product]": item.price.product,
    "items[0][price_data][unit_amount]": membershipPlans[tier][interval], "items[0][price_data][recurring][interval]": interval,
    proration_behavior: "none", "metadata[tier]": tier, "metadata[pending_tier]": tier
  });
  await db.prepare("UPDATE members SET pending_tier = ?, updated_at_ms = ? WHERE id = ?").bind(tier, nowMs, memberId).run();
  await recordTimeline(db, memberId, { atMs: nowMs, kind: "plan", title: `Skifter til ${membershipName(tier)} fra næste fornyelse`, detail: `${membershipPrice(membershipPlans[tier][interval])} ${interval === "year" ? "pr. år" : "pr. måned"}`, by });
}

/** GET: the levels the member may change to (and any change waiting). POST {tier}: change from the next renewal. */
export async function memberPlanChange(request: Request, env: ChangeEnv, deps: SagaDeps, opener?: ImapOpener): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "unavailable" }, 503);
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return json({ error: "authentication_required" }, 401); }
  const m = await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY, false).catch(() => null);
  if (!m) return json({ error: "membership_not_found" }, 404);
  const current = m.source === "hjerterum" ? m.member.tier : (MEMBERSHIP_TIERS.find(t => membershipName(t).toLowerCase() === (m.membershipLevel ?? "").toLowerCase().trim()) ?? null);
  const pending = m.source === "hjerterum" ? (await env.DB.prepare("SELECT pending_tier FROM members WHERE id = ?").bind(m.member.id).first<{ pending_tier: string | null }>())?.pending_tier ?? null : null;
  const options = changeOptions(current);
  if (request.method === "GET") return json({ current, pending, options });
  const body = await request.json().catch(() => null) as { tier?: unknown } | null;
  const tier = String(body?.tier ?? "") as MembershipTier;
  if (!options.includes(tier)) return json({ error: "tier_not_offered" }, 400);
  const byCard = m.source === "hjerterum" && m.member.billing !== "manual" && !m.member.paysInMembershipworks && m.member.stripeSubscriptionId;
  if (byCard) {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "payments_not_configured" }, 503);
    try { await changeByCard(env.DB, env.STRIPE_SECRET_KEY, m.member.id, m.member.stripeSubscriptionId!, tier, m.fullName, deps.now()); }
    catch (error) { console.warn("plan_change_failed", error instanceof Error ? error.message : error); return json({ error: "change_failed" }, 503); }
    return json({ ok: true, via: "card", pending: tier });
  }
  try { await deliverToTeamInbox(env, env.DB, wishMail(m, tier, deps.now()), opener); }
  catch (error) { console.warn("plan_change_not_delivered", error instanceof Error ? error.message : error); return json({ error: "not_delivered" }, 503); }
  if (m.source === "hjerterum") await recordTimeline(env.DB, m.member.id, { atMs: deps.now(), kind: "note", title: `Ønsker at skifte til ${membershipName(tier)}`, detail: "Sendt til teamet - skiftet sker fra næste fornyelse", by: m.fullName });
  return json({ ok: true, via: "team", pending: tier });
}
