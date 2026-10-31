import { authenticateBearer } from "./auth.js";
import { getExternalEvents } from "./external-events.js";
import { busyWindows, freeTimes } from "./free-times.js";
import { resolveActiveMembership } from "./membership-access.js";
import { copenhagenWeek } from "./room-bookings.js";
import type { D1Database } from "./db.js";
import { eventType, isMornings, typeLabel, VARIETY, type EventType } from "../site/event-types.js";

/** Requested: "Saga løbende vurderer, at der ikke kommer for mange af samme type events i kalenderen" (site/event-types.ts). The hall's
 * calendar - the house's events and the members' (not rejected or cancelled) - read by type around a new event. */

export type HallEvent = { startMs: number; type: EventType; title: string };
const DAY = 86_400_000;
const dayKey = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);

export async function hallEvents(db: D1Database, fromMs: number, toMs: number, exceptBookingId: number | null = null): Promise<HallEvent[]> {
  const house = await db.prepare(`SELECT title, description, category, location, starts_at_ms FROM house_events WHERE removed_at_ms IS NULL AND starts_at_ms >= ? AND starts_at_ms < ?`)
    .bind(fromMs, toMs).all<{ title: string; description: string | null; category: string | null; location: string | null; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => []);
  const members = await db.prepare(`SELECT id, title, description, starts_at_ms FROM room_bookings WHERE status = 'scheduled' AND COALESCE(review_status, 'approved') <> 'rejected'
    AND starts_at_ms >= ? AND starts_at_ms < ? AND id <> ?`).bind(fromMs, toMs, exceptBookingId ?? -1)
    .all<{ id: number; title: string; description: string | null; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => []);
  return [
    // A partner's event elsewhere (e.g. Hjerteland) is not in the hall.
    ...house.filter(e => (e.location ?? "").toLowerCase().includes("hjerterum") || (!e.location && !/hjerteland|\d{4}\s/i.test(e.category ?? "")))
      .filter(e => !isMornings(e.title, e.description))
      .map(e => ({ startMs: e.starts_at_ms, type: eventType(e.title, e.description, e.category), title: e.title })),
    ...members.filter(e => !isMornings(e.title, e.description)).map(e => ({ startMs: e.starts_at_ms, type: eventType(e.title, e.description), title: e.title }))
  ];
}

/** What would be too much of one type, said plainly; empty when the event fits. "andet" is never limited. */
export function varietyProblems(type: EventType, startMs: number, around: HallEvent[]): string[] {
  if (type === "andet") return [];
  const same = around.filter(e => e.type === type);
  const day = dayKey(startMs), before = dayKey(startMs - DAY), after = dayKey(startMs + DAY);
  const week = copenhagenWeek(startMs);
  const label = typeLabel(type);
  const out: string[] = [];
  const sameDay = same.filter(e => dayKey(e.startMs) === day);
  if (sameDay.length >= VARIETY.perDay) out.push(`Der er allerede ${label} samme dag (${sameDay.map(e => e.title).slice(0, 2).join(", ")}).`);
  const inWeek = same.filter(e => e.startMs >= week.fromMs && e.startMs < week.toMs);
  if (inWeek.length >= VARIETY.perWeek) out.push(`Der er allerede ${inWeek.length} events med ${label} den uge - højst ${VARIETY.perWeek}.`);
  const nextTo = same.filter(e => [before, after].includes(dayKey(e.startMs)));
  if (!sameDay.length && nextTo.length) out.push(`Der er ${label} dagen før eller efter (${nextTo[0]!.title}) - to dage i træk er for tæt.`);
  return out;
}

/** The check for one event: its type and what is too much around it (the week before and after are read). */
export async function checkVariety(db: D1Database, input: { title: string; description?: string | null; startMs: number; exceptBookingId?: number | null }) {
  const type = eventType(input.title, input.description);
  if (type === "andet" || isMornings(input.title, input.description)) return { type, label: typeLabel(type), problems: [] as string[] };
  const around = await hallEvents(db, input.startMs - 8 * DAY, input.startMs + 8 * DAY, input.exceptBookingId ?? null);
  return { type, label: typeLabel(type), problems: varietyProblems(type, input.startMs, around) };
}

/** Free times (as free-times.ts finds them) where this type is not too much - the better days to offer. */
export async function betterTimes(db: D1Database, busy: Parameters<typeof freeTimes>[0], type: EventType, nowMs: number, minutes = 120, count = 5) {
  if (type === "andet") return freeTimes(busy, nowMs, minutes, count);
  const around = await hallEvents(db, nowMs, nowMs + 36 * DAY);
  const { copenhagenMs } = await import("./cockpit/data.js");
  return freeTimes(busy, nowMs, minutes, 20, 34).filter(t => !varietyProblems(type, copenhagenMs(t.date, t.start), around).length).slice(0, count);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** The form asks while the member fills it in: the event's type, what is too much, and better free days. */
export async function memberEventVariety(request: Request, env: { DB?: D1Database; CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "unavailable" }, 503);
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return json({ error: "authentication_required" }, 401); }
  if (!(await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY).catch(() => null))) return json({ error: "membership_required" }, 403);
  const body = await request.json().catch(() => null) as { title?: unknown; description?: unknown; startsAt?: unknown; endsAt?: unknown; bookingId?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";
  const startMs = typeof body?.startsAt === "string" ? Date.parse(body.startsAt) : NaN;
  if (!title.trim() || !Number.isFinite(startMs)) return json({ type: "andet", label: "andet", problems: [], alternatives: [] });
  const endMs = typeof body?.endsAt === "string" ? Date.parse(body.endsAt) : NaN;
  const check = await checkVariety(env.DB, { title, description: typeof body?.description === "string" ? body.description.slice(0, 4000) : "", startMs,
    exceptBookingId: typeof body?.bookingId === "number" ? body.bookingId : null });
  let alternatives: string[] = [];
  if (check.problems.length) {
    const now = Date.now();
    const busy = await busyWindows(env.DB, await getExternalEvents(false).catch(() => []), now, now + 40 * DAY);
    const minutes = Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60_000) : 120;
    alternatives = (await betterTimes(env.DB, busy, check.type, now, minutes, 4)).map(t => t.label);
  }
  return json({ ...check, alternatives });
}
