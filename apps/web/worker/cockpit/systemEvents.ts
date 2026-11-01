import type { D1Database } from "../db.js";
import { copenhagenMs } from "./data.js";
import { esc, layout } from "./page.js";

/** Requested by the chair: "Som admin skal man kunne redigere og slette events oprettet i systemet." Under Events: the coming events the
 * members have created on the platform (room_bookings), each with Ret and Slet. Ret changes the words and the time
 * (room-bookings.ts updateRoomBookingAsAdmin); Slet cancels the event - it leaves the website and the calendar, and the hall is free again.
 * Events in the old calendar (MembershipWorks) are still changed there; CIRKLER's meetings are changed in CIRKLER. */

export type SystemEvent = { id: number; title: string; description: string | null; teacher_name: string; teacher_email: string; starts_at_ms: number; ends_at_ms: number;
  max_attendees: number | null; review_status: string | null; cirkler_meeting_id: string | null; attendees: number };

export async function comingSystemEvents(db: D1Database, nowMs: number): Promise<SystemEvent[]> {
  return db.prepare(`SELECT b.id, b.title, b.description, b.teacher_name, b.teacher_email, b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.review_status, b.cirkler_meeting_id,
      (SELECT COUNT(*) FROM room_booking_attendees a WHERE a.room_booking_id = b.id AND a.registration_status IN ('pending', 'confirmed')) AS attendees
    FROM room_bookings b WHERE b.status = 'scheduled' AND b.ends_at_ms >= ? AND COALESCE(b.review_status, 'approved') <> 'rejected' ORDER BY b.starts_at_ms LIMIT 200`)
    .bind(nowMs).all<SystemEvent>().then(r => r.results ?? []).catch(() => []);
}

export async function systemEvent(db: D1Database, id: number): Promise<SystemEvent | null> {
  return db.prepare(`SELECT b.id, b.title, b.description, b.teacher_name, b.teacher_email, b.starts_at_ms, b.ends_at_ms, b.max_attendees, b.review_status, b.cirkler_meeting_id,
      (SELECT COUNT(*) FROM room_booking_attendees a WHERE a.room_booking_id = b.id AND a.registration_status IN ('pending', 'confirmed')) AS attendees
    FROM room_bookings b WHERE b.id = ? AND b.status = 'scheduled'`).bind(id).first<SystemEvent>().catch(() => null);
}

const TZ = "Europe/Copenhagen";
const dayOf = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(ms);
const timeOf = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const when = (e: SystemEvent) => `${WHEN.format(e.starts_at_ms)} kl. ${timeOf(e.starts_at_ms).replace(":", ".")}-${timeOf(e.ends_at_ms).replace(":", ".")}`;

const deleteForm = (base: string, e: SystemEvent, label = "Slet") => {
  const ask = `Slet "${e.title}"?\n\nEventet forsvinder fra hjemmesiden og kalenderen, og salen bliver ledig.${e.attendees ? ` ${e.attendees} er tilmeldt - giv dem og underviseren besked, og refundér betalinger.` : " Giv underviseren besked."}`;
  return `<form method="post" action="${base}/arrangementer/system/${e.id}/slet" class="se-del" onsubmit="return confirm(${esc(JSON.stringify(ask))})"><button class="ghost danger">${label}</button></form>`;
};

/** The list on the Events page. */
export function systemEventsSection(base: string, events: SystemEvent[], notice: string): string {
  const row = (e: SystemEvent) => `<li><div><b>${esc(e.title)}</b><span class="small muted">${esc(when(e))} · ${esc(e.teacher_name)}${e.review_status === "pending" ? " · afventer godkendelse" : ""}${e.attendees ? ` · ${e.attendees} tilmeldt` : ""}</span></div>
${e.cirkler_meeting_id ? `<span class="small muted">CIRKLER-møde - rettes i CIRKLER</span>` : `<div class="se-acts"><a class="button ghost" href="${base}/arrangementer/system/${e.id}">Ret</a>${deleteForm(base, e)}</div>`}</li>`;
  return `<section class="card" id="system-events"><h2>Events oprettet i systemet</h2>
<p class="small muted">Events, medlemmerne har oprettet i medlemsområdet. Events i den gamle kalender rettes stadig i MembershipWorks.</p>
${notice ? `<p class="notice">${esc(notice)}</p>` : ""}${events.length ? `<ul class="plain se-list">${events.map(row).join("")}</ul>` : `<p class="muted">Ingen kommende events.</p>`}</section>`;
}

/** The edit page for one event. */
export function systemEventPage(base: string, who: string | null, e: SystemEvent, error = ""): string {
  const field = (label: string, input: string) => `<label class="se-field"><span>${label}</span>${input}</label>`;
  return layout(base, `Ret ${e.title}`, `<main class="se-edit"><p class="small"><a href="${base}/arrangementer#system-events">← Events</a></p><h1>Ret event</h1>
${error ? `<p class="notice bad">${esc(error)}</p>` : ""}
<form method="post" action="${base}/arrangementer/system/${e.id}" class="card">
${field("Titel", `<input name="title" required maxlength="160" value="${esc(e.title)}">`)}
${field("Underviser", `<input name="teacher" required maxlength="120" value="${esc(e.teacher_name)}">`)}
<div class="se-row">${field("Dato", `<input type="date" name="date" required value="${dayOf(e.starts_at_ms)}">`)}${field("Starter", `<input type="time" name="start" required step="1800" value="${timeOf(e.starts_at_ms)}">`)}${field("Slutter", `<input type="time" name="end" required step="1800" value="${timeOf(e.ends_at_ms)}">`)}${field("Max. deltagere", `<input type="number" name="max" min="1" max="500" value="${e.max_attendees ?? ""}">`)}</div>
${field("Beskrivelse", `<textarea name="description" rows="12" maxlength="8000">${esc(e.description ?? "")}</textarea>`)}
<p class="small muted">Priserne ændres ikke her - der kan være tilmeldte, der har betalt. Ændres tiden, tjekkes det, at salen er ledig, og lejen regnes ud igen.${e.attendees ? ` ${e.attendees} er tilmeldt: giv dem besked om ændringer.` : ""}</p>
<p class="se-acts"><button>Gem ændringer</button><a class="button ghost" href="${base}/arrangementer#system-events">Annullér</a></p></form>
${deleteForm(base, e, "Slet eventet")}</main>`, { section: "/arrangementer", who, style: SYSTEM_EVENTS_STYLE });
}

/** The form's change, or what is wrong with it. */
export function readEventChange(form: FormData | null): { change: { title: string; description: string | null; teacherName: string; startsAt: number; endsAt: number; maxAttendees: number | null } } | { error: string } {
  const text = (name: string, max: number) => String(form?.get(name) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
  const title = text("title", 160), teacherName = text("teacher", 120), date = text("date", 10), start = text("start", 5), end = text("end", 5);
  if (!title || !teacherName) return { error: "Titel og underviser skal udfyldes." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { error: "Dato og tidspunkter skal udfyldes." };
  const startsAt = copenhagenMs(date, start), endsAt = copenhagenMs(date, end);
  if (!(endsAt > startsAt)) return { error: "Eventet skal slutte efter, det starter." };
  const max = Number(text("max", 4));
  return { change: { title, teacherName, description: text("description", 8000) || null, startsAt, endsAt, maxAttendees: Number.isInteger(max) && max > 0 ? max : null } };
}

export const SYSTEM_EVENTS_STYLE = `.se-list li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.se-list li:first-child{border-top:0}
.se-list li>div:first-child{display:grid;gap:2px;min-width:0}.se-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.se-del{margin:0}.se-del button.danger{color:var(--danger,#b3261e);border-color:currentColor}
.se-edit form.card{display:grid;gap:12px;max-width:760px}.se-field{display:grid;gap:4px}.se-field span{font-size:13px;color:var(--muted)}
.se-field input,.se-field textarea{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit;width:100%;box-sizing:border-box}
.se-row{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:10px}@media(max-width:700px){.se-row{grid-template-columns:1fr 1fr}.se-list li{flex-direction:column;align-items:flex-start}}
.se-edit>.se-del{margin-top:18px}.notice.bad{color:#b3261e}`;
