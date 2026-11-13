import type { D1Database } from "./db.js";
import { attendRoomBooking } from "./room-bookings.js";

/** Douglas' notes: "Do they have to be a member to book an event?" - "Som gæst uden login". An event in the house's own system has a page of its
 * own on the website (/events/h<id>), and anyone can sign up there with a name and an e-mail, without logging in. A guest is kept as an attendee
 * with the id "guest:<e-mail>" - one place per e-mail per event, counted against the seats like everyone else. A ticket with a price for
 * non-members waits for the payment, as it does for a signed-in non-member (non_member_payment_unavailable). */

export type PublicEventRow = { id: number; title: string; description: string | null; teacher_name: string; starts_at_ms: number; ends_at_ms: number;
  max_attendees: number | null; ticket_price_minor: number; non_member_price_minor: number | null; taken: number;
  /** The organiser's own words to those who sign up (event-signup-mail.ts). */
  confirmation_note?: string | null };

export async function publicEvent(db: D1Database, id: number): Promise<PublicEventRow | null> {
  return db.prepare(`SELECT b.id, b.title, b.description, b.teacher_name, b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.ticket_price_minor, b.non_member_price_minor, b.confirmation_note,
      (SELECT COUNT(*) FROM room_booking_attendees a WHERE a.room_booking_id = b.id AND a.registration_status IN ('pending', 'confirmed')) AS taken
    FROM room_bookings b WHERE b.id = ? AND b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved'`).bind(id).first<PublicEventRow>();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GUEST_HONEYPOT = "website";
const MIN_FILL_MS = 2_500;

export type GuestResult = { ok: true; confirmed: true } | { ok: true; ignored: true } | { error: string; status: number };

export async function signUpGuest(db: D1Database, id: number, sent: Record<string, unknown>, nowMs: number): Promise<GuestResult> {
  const name = String(sent.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(sent.email ?? "").trim().toLowerCase().slice(0, 200);
  // A robot: the hidden field filled, or the form sent at once. It is told all went well.
  const started = Number(sent.started);
  if (String(sent[GUEST_HONEYPOT] ?? "").trim() || !Number.isFinite(started) || nowMs - started < MIN_FILL_MS) return { ok: true, ignored: true };
  if (!name || !EMAIL.test(email)) return { error: "missing_fields", status: 400 };
  // At most five sign-ups an hour from one address.
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM room_booking_attendees WHERE clerk_user_id = ? AND created_at_ms > ?").bind(`guest:${email}`, nowMs - 3_600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) return { error: "too_many", status: 429 };
  try {
    await attendRoomBooking(db, `guest:${email}`, id, { memberName: name, memberEmail: email }, true);
    return { ok: true, confirmed: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : "signup_failed";
    const status = code === "booking_not_found" ? 404 : ["already_attending", "booking_full", "booking_full_or_pending", "booking_started", "non_member_payment_unavailable", "event_payment_required"].includes(code) ? 409 : 503;
    return { error: code, status };
  }
}

/** The guest's receipt, through the same sender as the login mails (Resend). Nothing is sent when it is not set up; the page has said it already. */
export async function guestReceipt(env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }, fetcher: typeof fetch, event: PublicEventRow, guest: { name: string; email: string }, pageUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const note = event.confirmation_note?.trim() || null;
  const when = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(event.starts_at_ms);
  const text = `Kære ${guest.name}\n\nDu er tilmeldt "${event.title}" ${when.replace(/(\d{2})[.:](\d{2})$/, "kl. $1.$2")} i Hjerterum, Guldsmedgade 26B, 8000 Aarhus C.\n\n${note ? `Besked fra ${event.teacher_name}:\n${note}\n\n` : ""}Læs om eventet: ${pageUrl}\n\nKan du ikke komme alligevel, så skriv til team@hjerterum.info, så en anden kan få pladsen.\n\nVarme hilsner\nHjerterum`;
  const html = `<p>Kære ${escapeHtml(guest.name)}</p><p>Du er tilmeldt <b>${escapeHtml(event.title)}</b> ${escapeHtml(when.replace(/(\d{2})[.:](\d{2})$/, "kl. $1.$2"))} i Hjerterum, Guldsmedgade 26B, 8000 Aarhus C.</p>`
    + (note ? `<p><b>Besked fra ${escapeHtml(event.teacher_name)}:</b><br>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : "")
    + `<p><a href="${escapeHtml(pageUrl)}">Læs om eventet</a></p><p>Kan du ikke komme alligevel, så skriv til <a href="mailto:team@hjerterum.info">team@hjerterum.info</a>, så en anden kan få pladsen.</p><p>Varme hilsner<br>Hjerterum</p>`;
  const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json",
    "idempotency-key": `guest-signup/${event.id}/${guest.email}` }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [guest.email], reply_to: "team@hjerterum.info", subject: `Du er tilmeldt: ${event.title}`, text, html }) }).catch(() => null);
  if (!sent?.ok) console.warn("guest_receipt_failed", sent?.status ?? "network");
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
