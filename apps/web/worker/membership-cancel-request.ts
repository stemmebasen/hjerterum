import { authenticateBearer } from "./auth.js";
import { buildMime } from "./beregner/mime.js";
import { TEAM_ADDRESS } from "./enquiries.js";
import { resolveActiveMembership, type ActiveMembership } from "./membership-access.js";
import { membershipName } from "../membership.js";
import { CONTACT_EMAIL } from "../site/pages.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { deliverToTeamInbox, type ImapOpener } from "./saga/teamMail.js";

/** Requested: "Man skal selv kunne opsige når man er logget ind. Har man brug for hjælp kan man skrive team@hjerterum.info".
 * A member who pays by card in the new system cancels with "Afmeld" (Stripe ends it at the period's end). Everyone else still pays
 * through MembershipWorks - or was given the membership by Hjerterum - and the new system cannot end that payment itself. Their
 * "Opsig medlemskab" lays a cancellation in team@'s inbox, where it waits in Posthus to be ended in MembershipWorks; the member is
 * told it is received, and gets the answer by mail. */

type CancelEnv = SagaEnv & { CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", year: "numeric" });

export function cancelRequestLines(membership: ActiveMembership, reason: string, nowMs: number): Array<[string, string]> {
  const level = membership.source === "membershipworks" ? `${membership.membershipLevel ?? "ukendt"} (MembershipWorks, medlem nr. ${membership.externalId})`
    : `${membershipName(membership.member.tier)}${membership.member.paysInMembershipworks ? " - betaler via MembershipWorks" : membership.member.billing === "manual" ? " - givet af Hjerterum, ingen betaling" : ""}`;
  return [["Navn", membership.fullName], ["E-mail", membership.email], ["Medlemskab", level], ["Opsagt", DAY.format(nowMs)], ["Begrundelse", reason || "-"],
    ["Det skal ske", "Afslut medlemskabet og betalingen i MembershipWorks (bindingsperiode: løbende måned + 1 måned), og svar medlemmet med datoen for sidste træk."]];
}

export function cancelRequestMail(membership: ActiveMembership, reason: string, nowMs: number): Uint8Array {
  const lines = cancelRequestLines(membership, reason, nowMs);
  const plain = `Opsigelse af medlemskab fra medlemsområdet\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nSvar direkte på denne mail for at svare ${membership.fullName}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2a2622">
<p><strong>Opsigelse af medlemskab fra medlemsområdet</strong></p><table cellpadding="6" style="border-collapse:collapse">${lines.map(([k, v]) =>
  `<tr><td style="vertical-align:top;color:#766d64;white-space:nowrap">${esc(k)}</td><td style="vertical-align:top;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}</table>
<p style="color:#766d64">Svar direkte på denne mail for at svare ${esc(membership.fullName)}.</p></body></html>`;
  return buildMime({ from: { name: `${membership.fullName} via medlemsområdet`, address: TEAM_ADDRESS }, to: { name: "Hjerterum", address: TEAM_ADDRESS },
    replyTo: { name: membership.fullName, address: membership.email }, subject: `Opsigelse af medlemskab: ${membership.fullName}`, text: plain, html, attachments: [],
    date: new Date(nowMs), messageId: `${crypto.randomUUID()}@medlem.hjerterum.info` });
}

/** POST {reason?}: the logged-in member's cancellation, laid in team@'s inbox. */
export async function memberCancelRequest(request: Request, env: CancelEnv, deps: SagaDeps, opener?: ImapOpener): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "unavailable" }, 503);
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return json({ error: "authentication_required" }, 401); }
  // A Support membership has no benefits, but can be cancelled all the same.
  const membership = await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY, false).catch(() => null);
  if (!membership) return json({ error: "membership_not_found" }, 404);
  if (membership.source === "hjerterum" && membership.member.billing !== "manual") return json({ error: "use_card_cancel" }, 409);
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.replace(/\r\n?/g, "\n").trim().slice(0, 1000) : "";
  try {
    await deliverToTeamInbox(env, env.DB, cancelRequestMail(membership, reason, deps.now()), opener);
  } catch (error) {
    console.warn("cancel_request_not_delivered", error instanceof Error ? error.message : error);
    return json({ error: "not_delivered", contact: CONTACT_EMAIL }, 503);
  }
  return json({ ok: true });
}
