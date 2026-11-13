import type { D1Database } from "./db.js";
import { isMemberAttendee } from "./membership-access.js";

/** Douglas (13 Nov 2026): "a box for the teacher's email address so they can be notified when people book for their event" and "Will there be
 * opportunity for teachers to write a confirmation email for when people sign up for their workshops?" - the chair: "Ja".
 * The organiser chooses, with the event, whether they get a mail at each sign-up (on unless turned off) and what they want to say to those who
 * sign up; their words go into the confirmation the participant gets (guest-signup.ts guestReceipt). */

export type SignupSettings = { notifySignups: boolean; confirmationNote: string | null };
const NOTE_MAX = 1500;

/** From the event form's body; missing fields keep the defaults (mail on, no words). */
export function readSignupSettings(body: unknown): SignupSettings {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const note = typeof b.confirmationNote === "string" ? b.confirmationNote.replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX) : "";
  return { notifySignups: b.notifySignups !== false, confirmationNote: note || null };
}

/** Only the event's own organiser changes them. */
export async function saveSignupSettings(db: D1Database, bookingId: number, ownerId: string, settings: SignupSettings): Promise<void> {
  await db.prepare("UPDATE room_bookings SET notify_signups = ?, confirmation_note = ? WHERE id = ? AND clerk_user_id = ?")
    .bind(settings.notifySignups ? 1 : 0, settings.confirmationNote, bookingId, ownerId).run();
}

export async function signupSettingsByBooking(db: D1Database, ids: number[]): Promise<Map<number, SignupSettings>> {
  const map = new Map<number, SignupSettings>();
  if (!ids.length) return map;
  const rows = await db.prepare(`SELECT id, notify_signups, confirmation_note FROM room_bookings WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids)
    .all<{ id: number; notify_signups: number; confirmation_note: string | null }>().catch(() => ({ results: [] as Array<{ id: number; notify_signups: number; confirmation_note: string | null }> }));
  for (const r of rows.results ?? []) map.set(r.id, { notifySignups: r.notify_signups !== 0, confirmationNote: r.confirmation_note });
  return map;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** A mail to the organiser that someone signed up: who, their e-mail, member or not, and how many are signed up now. Never stops the sign-up. */
export async function notifyOrganiser(env: { DB?: D1Database; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }, fetcher: typeof fetch, bookingId: number,
  person: { name: string; email: string; clerkUserId: string }, siteOrigin: string): Promise<void> {
  if (!env.DB || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  try {
    const db = env.DB;
    const event = await db.prepare(`SELECT b.title, b.teacher_name, b.teacher_email, b.starts_at_ms, b.max_attendees, b.notify_signups, b.clerk_user_id,
        (SELECT COUNT(*) FROM room_booking_attendees a WHERE a.room_booking_id = b.id AND a.registration_status = 'confirmed') AS taken
      FROM room_bookings b WHERE b.id = ?`).bind(bookingId)
      .first<{ title: string; teacher_name: string; teacher_email: string; starts_at_ms: number; max_attendees: number | null; notify_signups: number; clerk_user_id: string; taken: number }>();
    // Not about the organiser's own sign-up.
    if (!event || !event.notify_signups || event.clerk_user_id === person.clerkUserId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.teacher_email ?? "")) return;
    const member = await isMemberAttendee(db, person.clerkUserId, person.email).catch(() => false);
    const when = WHEN.format(event.starts_at_ms).replace(/(\d{2})[.:](\d{2})$/, "kl. $1.$2");
    const count = `${event.taken}${event.max_attendees ? ` af ${event.max_attendees}` : ""} tilmeldt`;
    const mine = `${siteOrigin.replace(/\/$/, "")}/member-portal/events/mine`;
    const first = event.teacher_name.split(/\s+/)[0] ?? "";
    const text = `Kære ${first}\n\n${person.name} (${person.email}) har tilmeldt sig "${event.title}" ${when}. ${member ? "Medlem" : "Ikke-medlem"}.\n\nNu: ${count}.\n\n`
      + `Se alle tilmeldte under Mine events: ${mine}\nVil du ikke have en mail ved hver tilmelding, kan du slå det fra, når du redigerer eventet.\n\nVarme hilsner\nHjerterum`;
    const html = `<p>Kære ${escapeHtml(first)}</p><p><b>${escapeHtml(person.name)}</b> (<a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a>) har tilmeldt sig `
      + `<b>${escapeHtml(event.title)}</b> ${escapeHtml(when)}. ${member ? "Medlem" : "Ikke-medlem"}.</p><p>Nu: ${escapeHtml(count)}.</p>`
      + `<p><a href="${escapeHtml(mine)}">Se alle tilmeldte under Mine events</a></p><p style="color:#777">Vil du ikke have en mail ved hver tilmelding, kan du slå det fra, når du redigerer eventet.</p><p>Varme hilsner<br>Hjerterum</p>`;
    const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json",
      "idempotency-key": `signup-organiser/${bookingId}/${person.email.toLowerCase()}` },
      body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [event.teacher_email], reply_to: person.email, subject: `Ny tilmelding: ${event.title}`, text, html }) }).catch(() => null);
    if (!sent?.ok) console.warn("organiser_signup_mail_failed", sent?.status ?? "network");
  } catch (error) {
    console.warn("organiser_signup_mail_failed", error instanceof Error ? error.message : error);
  }
}
