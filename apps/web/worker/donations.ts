import type { D1Database } from "./db.js";
import { TEAM_MAIL } from "../site/mail.js";
import { stripeRequest } from "./stripe.js";

/** Douglas (13 Nov 2026), for the board: "Are we having a donation page or somewhere where people can donate on the website? Plus an email that
 * gets sent as a receipt for their donation." A donation by card to Hjerterum's own Stripe account (MobilePay and the bank stay on the page),
 * and the receipt when Stripe says it is paid. Open once Stripe is connected. */

export const DONATION_MIN_KR = 20, DONATION_MAX_KR = 50_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function readDonation(sent: Record<string, unknown>): { name: string; email: string; amountKr: number; message: string } | { error: string } {
  const name = String(sent.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(sent.email ?? "").trim().toLowerCase().slice(0, 200);
  const amountKr = Math.round(Number(sent.amountKr));
  const message = String(sent.message ?? "").trim().slice(0, 500);
  if (!name || !EMAIL.test(email)) return { error: "missing_fields" };
  if (!Number.isFinite(amountKr) || amountKr < DONATION_MIN_KR || amountKr > DONATION_MAX_KR) return { error: "invalid_amount" };
  return { name, email, amountKr, message };
}

/** POST {name, email, amountKr, message?}: a Stripe payment page for the donation. */
export async function startDonation(request: Request, env: { STRIPE_SECRET_KEY?: string; APP_BASE_URL?: string }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "payments_not_configured" }, 503);
  const sent = await request.json().catch(() => null) as Record<string, unknown> | null;
  const donation = readDonation(sent ?? {});
  if ("error" in donation) return json({ error: donation.error }, 400);
  const site = "https://www.hjerterum.info";
  const session = await stripeRequest<{ url?: string }>(env.STRIPE_SECRET_KEY, "POST", "/checkout/sessions", {
    mode: "payment", customer_email: donation.email, submit_type: "donate",
    success_url: `${site}/stoet?tak=1`, cancel_url: `${site}/stoet`,
    "line_items[0][quantity]": 1, "line_items[0][price_data][currency]": "dkk", "line_items[0][price_data][unit_amount]": donation.amountKr * 100,
    "line_items[0][price_data][product_data][name]": "Donation til Hjerterum",
    "metadata[kind]": "donation", "metadata[name]": donation.name, "metadata[message]": donation.message
  }).catch(error => { console.warn("donation_checkout_failed", error instanceof Error ? error.message : error); return null; });
  return session?.url ? json({ checkoutUrl: session.url }, 201) : json({ error: "checkout_failed" }, 503);
}

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", year: "numeric" });

/** A paid donation from Stripe's checkout.session.completed: kept once, and its receipt sent. */
export async function recordDonation(db: D1Database, env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }, fetcher: typeof fetch,
  session: Record<string, unknown>, nowMs: number): Promise<void> {
  const id = String(session.id ?? ""), meta = (session.metadata ?? {}) as Record<string, unknown>;
  const details = (session.customer_details ?? {}) as Record<string, unknown>;
  const email = String(details.email ?? session.customer_email ?? "").toLowerCase(), name = String(meta.name ?? details.name ?? "");
  const amount = Number(session.amount_total ?? 0);
  if (!id || !email || !amount || session.payment_status !== "paid") return;
  const saved = await db.prepare("INSERT OR IGNORE INTO donations (stripe_session_id, name, email, amount_minor, message, paid_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, email, amount, String(meta.message ?? "") || null, nowMs).run();
  if (!saved.meta?.changes || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const kr = `${(amount / 100).toLocaleString("da-DK")} kr.`;
  const text = `Kære ${name || "ven af Hjerterum"}\n\nTusind tak for din donation på ${kr} til Hjerterum den ${DAY.format(nowMs)}. Den er med til at holde huset åbent for fællesskab, nærvær og fordybelse.\n\nKvittering\nModtager: Hjerterum F.M.B.A., CVR 40827692, Guldsmedgade 26B, 8000 Aarhus C\nBeløb: ${kr}\nBetalt med kort (reference ${id.slice(-12)})\n\nVarme hilsner\nHjerterum\n${TEAM_MAIL}`;
  const html = `<p>Kære ${esc(name || "ven af Hjerterum")}</p><p>Tusind tak for din donation på <b>${kr}</b> til Hjerterum den ${DAY.format(nowMs)}. Den er med til at holde huset åbent for fællesskab, nærvær og fordybelse.</p>`
    + `<p><b>Kvittering</b><br>Modtager: Hjerterum F.M.B.A., CVR 40827692, Guldsmedgade 26B, 8000 Aarhus C<br>Beløb: ${kr}<br>Betalt med kort (reference ${esc(id.slice(-12))})</p><p>Varme hilsner<br>Hjerterum<br><a href="mailto:${TEAM_MAIL}">${TEAM_MAIL}</a></p>`;
  const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `donation/${id}` },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [email], reply_to: TEAM_MAIL, subject: "Tak for din donation til Hjerterum", text, html }) }).catch(() => null);
  if (sent?.ok) await db.prepare("UPDATE donations SET receipt_sent_at_ms = ? WHERE stripe_session_id = ?").bind(nowMs, id).run();
  else console.warn("donation_receipt_failed", sent?.status ?? "network");
}
