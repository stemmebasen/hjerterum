import { authenticateBearer } from "./auth.js";
import { copenhagenMs } from "./cockpit/data.js";
import { reviewEventNow } from "./cockpit/eventDesk.js";
import type { D1Database } from "./db.js";
import { isContactShare, setContactShare } from "./event-contact.js";
import { storeEventFile, type EventMediaBucket } from "./event-files.js";
import { resolveActiveMembership } from "./membership-access.js";
import type { MemberDraft } from "./member-saga.js";
import { createRoomBooking, isFixedTeacher, normalizeCreateRoomBookingInput } from "./room-bookings.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { GUIDE_PREFIX, openConversation, saveConversation } from "./web-saga.js";

/** Requested: "Saga skal kunne hjælpe med opsætning af event i medlem. og også kunne modtage billeder direkte i chatten. Hun skal være
 * yderst hjælpsom og kunne bringe eventet online (hvis hun vurderer det passer til hjerterum)".
 *
 * The member presses "Opret og læg online" under Saga's draft - that press is their yes, as "Opret event" is on the form, because it
 * reserves the hall and costs rent. Then, in one go: the event is created as the member's own (the same rules, prices and conflict check
 * as the form), the photo Saga approved becomes its cover, and Saga judges it at once by Hjerterum's criteria (cockpit/eventDesk.ts):
 * when they all clearly hold, it is online now; otherwise the board looks at it. She never rejects one, and never fails open.
 * A fixed teacher's event is online at once, as from the form. Tickets are not sold yet, so the ticket price is 0. */

const BUFFER_MINUTES = 30;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const str = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

export function readDraft(raw: unknown): MemberDraft | null {
  let d: Record<string, unknown> | null = null;
  try { d = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : null; } catch { d = null; }
  if (!d || typeof d !== "object") return null;
  const draft: MemberDraft = { title: str(d.title, 200), description: str(d.description, 4000), date: str(d.date, 10), start: str(d.start, 5), end: str(d.end, 5),
    booking_type: d.booking_type === "reduced" || d.booking_type === "free" ? d.booking_type : "standard",
    max_attendees: num(d.max_attendees), member_price_kr: num(d.member_price_kr), non_member_price_kr: num(d.non_member_price_kr),
    contact_share: isContactShare(d.contact_share) ? d.contact_share : null };
  return draft.title && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && /^\d{2}:\d{2}$/.test(draft.start) && /^\d{2}:\d{2}$/.test(draft.end) ? draft : null;
}

const PROBLEMS: Record<string, string> = {
  booking_conflict: "Salen er desværre optaget i det tidsrum (klargøring og oprydning medregnet). Skal vi finde en anden tid?",
  invalid_booking_start: "Tidspunktet er allerede passeret. Skal vi finde en ny dato?",
  invalid_booking_interval: "Sluttiden skal ligge efter starttiden.",
  invalid_duration_too_short: "Salen lejes mindst 2 timer med klargøring og oprydning. Skal eventet være lidt længere?",
  invalid_duration_too_long: "Salen lejes højst 10 timer med klargøring og oprydning. Skal vi gøre eventet kortere, eller dele det i to?",
  invalid_duration_not_half_hours: "Bookingen skal gå op i halve timer.",
  invalid_crosses_a_time_boundary: "Med reduceret pris eller gratis leje kan en booking på en hverdag ikke gå hen over kl. 18.30. Skal vi lægge den helt før eller helt efter?"
};

type EventEnv = SagaEnv & { CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string; EVENT_MEDIA?: EventMediaBucket };

export async function memberSagaEvent(request: Request, env: EventEnv, deps: SagaDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "saga_unavailable" }, 503);
  const db: D1Database = env.DB;
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return json({ error: "authentication_required" }, 401); }
  const membership = await resolveActiveMembership(db, userId, env.CLERK_SECRET_KEY).catch(() => null);
  if (!membership) return json({ error: "membership_required" }, 403);
  const form = await request.formData().catch(() => null);
  const draft = readDraft(form?.get("draft"));
  if (!form || !draft) return json({ error: "invalid_draft" }, 400);
  const now = deps.now();
  const asked = String(form.get("conversation") ?? "");
  const conversation = await openConversation(db, asked, userId, now, { guide: asked.startsWith(GUIDE_PREFIX) });
  const answer = async (reply: string, extra: Record<string, unknown> = {}, status = 200) => {
    await saveConversation(db, conversation.id, userId, [...conversation.messages, { role: "user", text: `[Trykkede "Opret og læg online": ${draft.title}, ${draft.date} ${draft.start}-${draft.end}]` },
      { role: "assistant", text: reply }], now).catch(() => undefined);
    return json({ conversation: conversation.id, reply, ...extra }, status);
  };

  let input;
  try {
    input = normalizeCreateRoomBookingInput({ teacherName: membership.fullName, teacherEmail: membership.email, title: draft.title, description: draft.description,
      startsAt: new Date(copenhagenMs(draft.date, draft.start)).toISOString(), endsAt: new Date(copenhagenMs(draft.date, draft.end)).toISOString(),
      maxAttendees: draft.max_attendees, ticketPriceKr: 0, nonMemberPriceKr: draft.non_member_price_kr, bookingType: draft.booking_type,
      setupMinutes: BUFFER_MINUTES, cleanupMinutes: BUFFER_MINUTES, memberName: membership.fullName, memberEmail: membership.email });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return answer(PROBLEMS[code] ?? "Tiderne i udkastet kunne ikke læses. Skal vi prøve igen?", { error: code || "invalid_draft" }, 400);
  }

  const preApproved = await isFixedTeacher(db, membership.email);
  let created;
  try {
    created = await createRoomBooking(db, userId, { ...input, preApproved });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return answer(PROBLEMS[code] ?? "Eventet kunne ikke oprettes lige nu. Prøv igen om lidt, eller brug formularen på Mine events.", { error: code || "booking_failed" }, code === "booking_conflict" ? 409 : 400);
  }

  if (draft.contact_share) await setContactShare(db, created.id, draft.contact_share).catch(() => undefined);

  // The photo Saga approved, cut to 1920 × 1005 in the browser - checked again here like any upload.
  let coverNote = "";
  const cover = form.get("cover");
  if (cover && typeof cover !== "string") {
    const stored = env.EVENT_MEDIA ? await storeEventFile(db, env.EVENT_MEDIA, { bookingId: created.id, userId, kind: "cover", name: (cover as File).name, bytes: await (cover as File).arrayBuffer(), now })
      .catch(() => ({ ok: false as const, error: "failed" })) : { ok: false as const, error: "uploads_not_configured" };
    coverNote = stored.ok ? " Fotoet er sat på som eventfoto." : " Fotoet kom ikke med - du kan sætte det på under Mine events.";
  }

  const fee = `Lejen bliver ${created.feeKr.toLocaleString("da-DK")} kr.`;
  if (preApproved) return answer(`Så er "${draft.title}" oprettet, salen er reserveret, og eventet er online på hjerterum.info.${coverNote} ${fee}`, { id: created.id, feeKr: created.feeKr, status: "approved" });
  const review = await reviewEventNow(env, deps, db, created.id);
  const reply = review.status === "approved"
    ? `Så er "${draft.title}" oprettet, salen er reserveret, og eventet passer fint til Hjerterum - det er online på hjerterum.info nu.${coverNote} ${fee}`
    : review.status === "needs_board"
      ? `Så er "${draft.title}" oprettet, og salen er reserveret.${coverNote} ${fee} Jeg er ikke helt sikker på, at det passer til Hjerterums kriterier${review.note ? ` (${review.note.replace(/\.$/, "")})` : ""}, så bestyrelsen ser på det, før det kommer online.`
      : `Så er "${draft.title}" oprettet, og salen er reserveret.${coverNote} ${fee} Jeg ser på, om det passer til Hjerterum, inden for den næste time på en hverdag - så kommer det online.`;
  return answer(reply, { id: created.id, feeKr: created.feeKr, status: review.status }, 201);
}
