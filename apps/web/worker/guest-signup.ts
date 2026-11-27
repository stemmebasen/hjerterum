import type { D1Database } from "./db.js";
import { attendRoomBooking, MAX_SEATS } from "./room-bookings.js";
import { hjerterumMail, type MailRun } from "./mail-template.js";
import { withKl } from "../site/when.js";

/** Douglas' notes: "Do they have to be a member to book an event?" - "Som gæst uden login". An event in the house's own system has a page of its
 * own on the website (/events/h<id>), and anyone can sign up there with a name and an e-mail, without logging in. A guest is kept as an attendee
 * with the id "guest:<e-mail>" - one place per e-mail per event, counted against the seats like everyone else. A ticket with a price for
 * non-members waits for the payment, as it does for a signed-in non-member (non_member_payment_unavailable). */

export type PublicEventRow = { id: number; title: string; description: string | null; teacher_name: string; starts_at_ms: number; ends_at_ms: number;
  max_attendees: number | null; ticket_price_minor: number; non_member_price_minor: number | null; taken: number;
  /** The organiser's own words to those who sign up (event-signup-mail.ts). */
  confirmation_note?: string | null;
  /** Where a participant writes to cancel (Douglas, 19 Nov 2026). */
  teacher_email?: string | null };

export async function publicEvent(db: D1Database, id: number): Promise<PublicEventRow | null> {
  return db.prepare(`SELECT b.id, b.title, b.description, b.teacher_name, b.teacher_email, b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.ticket_price_minor, b.non_member_price_minor, b.confirmation_note,
      (SELECT COALESCE(SUM(a.seats), 0) FROM room_booking_attendees a WHERE a.room_booking_id = b.id AND a.registration_status IN ('pending', 'confirmed')) AS taken
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
    const seats = Math.min(Math.max(Math.trunc(Number(sent.seats ?? 1)) || 1, 1), MAX_SEATS);
    await attendRoomBooking(db, `guest:${email}`, id, { memberName: name, memberEmail: email }, true, seats);
    return { ok: true, confirmed: true };
  } catch (error) {
    // An event that waits for approval is not there for the public.
    const code = error instanceof Error ? (error.message === "booking_not_approved" ? "booking_not_found" : error.message) : "signup_failed";
    const status = code === "booking_not_found" ? 404 : ["already_attending", "booking_full", "booking_full_or_pending", "booking_started", "non_member_payment_unavailable", "event_payment_required"].includes(code) ? 409 : 503;
    return { error: code, status };
  }
}

/** The guest's receipt, through the same sender as the login mails (Resend). Nothing is sent when it is not set up; the page has said it already. */
/** Douglas (19 Nov 2026): "Surely, the participant should only write to the teacher and not Hjerterum if they want to cancel their registration (or cancel
 * online if a member and logged in) ... should the system automatically put in the teachers email address instead of team@hjerterum.info?" The organiser's
 * address (team@ when there is none), and for one who signed up logged in: cancel on the member pages. */
export function cancelLine(event: Pick<PublicEventRow, "teacher_email">, member: boolean): { text: string; runs: MailRun[]; replyTo: string } {
  const to = event.teacher_email && EMAIL.test(event.teacher_email.trim()) ? event.teacher_email.trim() : "team@hjerterum.info";
  const online = member ? "afmeld dig under Kalender på Min side, eller skriv til " : "skriv til ";
  return { replyTo: to, text: `Kan du ikke komme alligevel, så ${online}${to}, så en anden kan få pladsen.`,
    runs: ["Kan du ikke komme alligevel, så ", ...(member ? ["afmeld dig under ", { text: "Kalender på Min side", href: "https://medlem.hjerterum.info/member-portal/kalender" }, ", eller skriv til "] : ["skriv til "]),
      { text: to, href: `mailto:${to}` }, ", så en anden kan få pladsen."] };
}

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Douglas (forslag #5, 27 Nov 2026): "Can it be made to look a bit more attractive and professional, at least with our logo." The confirmation in
 * Hjerterum's mail template (mail-template.ts) - and the time as "kl. 10.00", not "kl. kl. 10.00" (site/when.ts). */
export function guestReceiptMail(event: PublicEventRow, guest: { name: string; seats?: number }, pageUrl: string, member = false): { html: string; text: string } {
  const cancel = cancelLine(event, member);
  const party = guest.seats && guest.seats > 1 ? ` (${guest.seats} personer)` : "";
  const note = event.confirmation_note?.trim() || null;
  const when = withKl(WHEN.format(event.starts_at_ms));
  const where = `${when} i Hjerterum, Guldsmedgade 26B, 8000 Aarhus C.`;
  return hjerterumMail({ title: "Du er tilmeldt", preheader: `${event.title} ${when}`, blocks: [
    { p: `Kære ${guest.name}` },
    { p: [`Du er tilmeldt${party} `, { text: event.title, bold: true }, ` ${where}`], text: `Du er tilmeldt${party} "${event.title}" ${where}` },
    ...(note ? [{ box: [note], title: `Besked fra ${event.teacher_name}:` }] : []),
    { button: "Læs om eventet", url: pageUrl },
    { p: cancel.runs, text: cancel.text }
  ] });
}

export async function guestReceipt(env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }, fetcher: typeof fetch, event: PublicEventRow, guest: { name: string; email: string; seats?: number }, pageUrl: string, member = false): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const cancel = cancelLine(event, member);
  const { text, html } = guestReceiptMail(event, guest, pageUrl, member);
  const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json",
    // Douglas (24 Nov 2026): "I didn't get a confirmation email now when I registered for my Test event." The key was the event and the address, and the
    // mail service keeps a key for a day - signed up, cancelled and signed up again the same day, the second receipt never went. Now per sign-up (minute).
    "idempotency-key": `guest-signup/${event.id}/${guest.email}/${Math.floor(Date.now() / 60_000)}` }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [guest.email], reply_to: cancel.replyTo, subject: `Du er tilmeldt: ${event.title}`, text, html }) }).catch(() => null);
  if (!sent?.ok) console.warn("guest_receipt_failed", sent?.status ?? "network");
}
