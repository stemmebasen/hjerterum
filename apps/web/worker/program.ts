import type { D1Database } from "./db.js";
import type { ExternalEvent } from "./external-events.js";
import { isPartnerEvent } from "../partner-events.js";
import { completeAs } from "./saga/ai.js";
import { eventIdOf } from "./event-detail.js";
import { designUrl } from "./event-designs.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";

/** Requested: "en programoversigt i fjernsynet på nogle linjer" + "en miniature oversigt med fem eventfotos" + "Måske er teksten bare om
 * de kommende to events. F.eks. Lidt senere i dag kommer *** på besøg ...". The next five events in the house (the calendar's and the
 * members' approved ones) and one short, warm intro by Saga to the next two. The intro is written once for the day and the two events
 * (mid model) and kept, so opening the page costs nothing. */
export type ProgramItem = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };
/** heading: "Snart i Hjerterum", above Saga's words about the next three events. */
export type Program = { intro: string | null; heading: string | null; items: ProgramItem[] };
type Candidate = ProgramItem & { description: string | null };

export const PROGRAM_SIZE = 5;
const TZ = "Europe/Copenhagen";

async function keyOf(source: string, id: string, title: string, startsAt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${title}|${startsAt}`));
  return `${source}:${id}:${[...new Uint8Array(digest).slice(0, 6)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function programCandidates(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Candidate[]> {
  // Partner houses' events (Hjerteland) are not "i huset" - they stand under "Fra samarbejdspartnere" in the calendars.
  const fromCalendar = await Promise.all(external.filter(e => Date.parse(e.endsAt ?? e.startsAt) >= nowMs && !isPartnerEvent(e)).map(async e => ({
    key: await keyOf("mw", e.id, e.title, e.startsAt), title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, host: e.host,
    imageUrl: e.imageUrl, link: eventIdOf(e) ? `/events/${eventIdOf(e)}` : e.link, description: e.description
  })));
  const rows = await db.prepare(`SELECT b.id, b.title, b.teacher_name, b.description, b.starts_at_ms, b.ends_at_ms,
      (SELECT f.id FROM room_booking_files f WHERE f.room_booking_id = b.id AND f.kind = 'cover' LIMIT 1) AS cover_id,
      (SELECT d.created_at_ms FROM room_booking_designs d WHERE d.room_booking_id = b.id) AS design_at
    FROM room_bookings b WHERE b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved' AND b.ends_at_ms >= ?
    ORDER BY b.starts_at_ms LIMIT 10`).bind(nowMs)
    .all<{ id: number; title: string; teacher_name: string; description: string | null; starts_at_ms: number; ends_at_ms: number; cover_id: number | null; design_at: number | null }>()
    .then(r => r.results ?? []).catch(() => []);
  const fromMembers = await Promise.all(rows.map(async b => {
    const startsAt = new Date(b.starts_at_ms).toISOString();
    return { key: await keyOf("hr", String(b.id), b.title, startsAt), title: b.title, startsAt, endsAt: new Date(b.ends_at_ms).toISOString(), host: b.teacher_name,
      // The chosen design drawn wide (event-designs.ts), else the photo.
      imageUrl: b.design_at ? designUrl(b.id, b.design_at) : b.cover_id ? `/api/event-files/${b.cover_id}` : null, link: "/member-portal/kalender", description: b.description };
  }));
  return [...fromCalendar, ...fromMembers].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Requested: "Lad resuméet altid inkludere de kommende tre events - og ændre overskriften så den passer." Saga's words are about
 * the next three events that have not begun, under "Snart i Hjerterum"; they are written again when one of them begins (or the
 * three change), so the words never speak of something that has started. Replaces "I morgen i Hjerterum". */
export const SPEAKER_EVENTS = 3;
export const SPEAKER_HEADING = "Snart i Hjerterum";
/** Requested: "aldrig skrive 'tirsdag d. 13. oktober', men 'I morgen'" - so the words belong to the day they are read on: written again
 * after midnight (the day is in the key) as well as when one of the three begins. */
const dateOf = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
const WEEKDAY = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long" });
export function dayWord(startMs: number, nowMs: number): string {
  const today = dateOf(nowMs);
  const tomorrow = dateOf(Date.parse(`${today}T12:00:00Z`) + 86_400_000);
  const day = dateOf(startMs);
  return day === today ? "i dag" : day === tomorrow ? "i morgen" : WEEKDAY.format(new Date(startMs));
}
export function speakerNext(candidates: Candidate[], nowMs: number): { heading: string; key: string; events: Candidate[] } | null {
  const events = candidates.filter(c => Date.parse(c.startsAt) > nowMs).slice(0, SPEAKER_EVENTS);
  if (!events.length) return null;
  return { heading: SPEAKER_HEADING, key: `intro5:${dateOf(nowMs)}:${events.map(c => c.key).join(",")}`, events };
}

export async function program(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Program> {
  const candidates = await programCandidates(db, external, nowMs);
  const day = speakerNext(candidates, nowMs);
  const row = day ? await db.prepare("SELECT text FROM event_blurbs WHERE key = ?").bind(day.key).first<{ text: string }>().catch(() => null) : null;
  return { intro: row?.text ?? null, heading: row ? day!.heading : null, items: candidates.slice(0, PROGRAM_SIZE).map(({ description: _d, ...c }) => c) };
}

// Requested: "langt mere kortfattet og aldrig skrive 'tirsdag d. 13. oktober', men 'I morgen'. Og siden alle tre events her er i morgen
// skal der selvfølgelig ikke stå 'I morgen' 3 gange." - with the chair's own example as the model.
const SYSTEM = "Du skriver en kort, varm og uformel tekst til medlemmerne af Hjerterum i Aarhus om de næste events i huset - som en speaker, der fortæller, hvad der er på vej. "
  + "Eksempel (godkendt af formanden): \"I morgen byder på tre forskellige oplevelser: Kl. 10.30 guider Kasper os gennem Dhyana Yoga, en time med indre stilhed, bevidst vejrtrækning og rolige yogaasanas. "
  + "Kl. 15.00 inviterer Steven til Det magiske indre barn som vejviser i livet, en varm workshop om intuition, livsglæde og kropslig udfoldelse. "
  + "Kl. 19.00 leder Douglas Source Breathwork (Rebirthing), en tryg og støttende rebirthing-session, hvor alle er velkomne, også begyndere.\" "
  + "Regler: Nævn ALLE de events, du får, i rækkefølge, med \"Kl. TT.MM\" foran hvert. Brug dagen, som den står i feltet \"dag\" (i dag, i morgen eller en ugedag) - aldrig en dato - og nævn hver dag kun én gang, hvor dens første event kommer; "
  + "de næste events samme dag får kun klokkeslæt. Højst 20 ord pr. event. Brug underviserens fornavn og en kort form af titlen (ingen »«, ingen \"med Navn\" i titlen). "
  + "Find ikke på detaljer, der ikke står i beskrivelsen. Ingen emojis, ingen udråbstegn. Skriv på dansk. Svar kun med teksten.";
const CLOCK = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** In Saga's round (every five minutes): when the words for the coming day are missing - a new day, or that day's events changed - they are written, once. */
export async function writeProgramIntro(env: SagaEnv, deps: SagaDeps, db: D1Database, external: ExternalEvent[], claim: (key: string) => Promise<boolean>): Promise<boolean> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return false;
  const day = speakerNext(await programCandidates(db, external, deps.now()), deps.now());
  if (!day) return false;
  const { key, events: two } = day;
  if (await db.prepare("SELECT 1 AS yes FROM event_blurbs WHERE key = ?").bind(key).first().catch(() => null)) return false;
  if (!(await claim(key))) return false;
  // Requested: "der er kun ét event, du omtaler her, ikke alle events i morgen" - every event gets its sentence; a text that
  // leaves one out is written again by the main model.
  const ask = (model: "mid" | false) => completeAs("program-intro", model)(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify({
    antal_events: two.length,
    events: two.map(c => ({ titel: c.title, underviser: c.host, dag: dayWord(Date.parse(c.startsAt), deps.now()), klokken: CLOCK.format(new Date(Date.parse(c.startsAt))).replace(":", "."), beskrivelse: (c.description ?? "").replace(/\s+/g, " ").slice(0, 400) }))
  }) }]).then(t => t.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 1200));
  // Every event with its "Kl." - so none is left out.
  const enough = (t: string) => (t.match(/\bkl\.?\s*\d/gi) ?? []).length >= two.length;
  let text = await ask("mid");
  if (text && !enough(text)) text = await ask(false).catch(() => text);
  if (!text) return false;
  await db.prepare("INSERT INTO event_blurbs (key, text, created_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, created_at_ms = excluded.created_at_ms").bind(key, text, deps.now()).run();
  return true;
}

/** Requested (Audiofolk, 13/10): Hjerterum's coming events as a plain public feed, so Audiofolk's agent can order a day-current radio
 * spot from them ("morgendagens program for hjerterum der automatisk bliver lavet til et radiospot"). The house's events - the
 * calendar's and the members' approved ones, never the partner houses' - for the next two weeks, with their own words. Nothing
 * here that the public site does not already show. */
export type UpcomingEvent = { title: string; startsAt: string; endsAt: string | null; host: string | null; description: string | null; link: string | null };
export const UPCOMING_DAYS = 14;
export function upcomingFeed(candidates: Candidate[], nowMs: number, origin = "https://hjerterum.info"): UpcomingEvent[] {
  const until = nowMs + UPCOMING_DAYS * 86_400_000;
  return candidates.filter(c => Date.parse(c.startsAt) >= nowMs && Date.parse(c.startsAt) <= until).map(c => ({
    title: c.title, startsAt: c.startsAt, endsAt: c.endsAt, host: c.host,
    description: c.description ? c.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) || null : null,
    link: c.link ? (c.link.startsWith("/") ? origin + c.link : c.link) : null,
  }));
}
