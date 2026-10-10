import type { D1Database } from "./db.js";
import type { ExternalEvent } from "./external-events.js";
import { isPartnerEvent } from "../partner-events.js";
import { completeAs } from "./saga/ai.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";

/** Requested: "en programoversigt i fjernsynet på nogle linjer" + "en miniature oversigt med fem eventfotos" + "Måske er teksten bare om
 * de kommende to events. F.eks. Lidt senere i dag kommer *** på besøg ...". The next five events in the house (the calendar's and the
 * members' approved ones) and one short, warm intro by Saga to the next two. The intro is written once for the day and the two events
 * (mid model) and kept, so opening the page costs nothing. */
export type ProgramItem = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };
/** heading: "I morgen i Hjerterum" (or "Lørdag i Hjerterum" when tomorrow is quiet), above Saga's words. */
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
    imageUrl: e.imageUrl, link: e.link, description: e.description
  })));
  const rows = await db.prepare(`SELECT b.id, b.title, b.teacher_name, b.description, b.starts_at_ms, b.ends_at_ms,
      (SELECT f.id FROM room_booking_files f WHERE f.room_booking_id = b.id AND f.kind = 'cover' LIMIT 1) AS cover_id
    FROM room_bookings b WHERE b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved' AND b.ends_at_ms >= ?
    ORDER BY b.starts_at_ms LIMIT 10`).bind(nowMs)
    .all<{ id: number; title: string; teacher_name: string; description: string | null; starts_at_ms: number; ends_at_ms: number; cover_id: number | null }>()
    .then(r => r.results ?? []).catch(() => []);
  const fromMembers = await Promise.all(rows.map(async b => {
    const startsAt = new Date(b.starts_at_ms).toISOString();
    return { key: await keyOf("hr", String(b.id), b.title, startsAt), title: b.title, startsAt, endsAt: new Date(b.ends_at_ms).toISOString(), host: b.teacher_name,
      imageUrl: b.cover_id ? `/api/event-files/${b.cover_id}` : null, link: "/member-portal/kalender", description: b.description };
  }));
  return [...fromCalendar, ...fromMembers].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Requested: "Lav resumeet om, så vi laver det til 'I morgen i Hjerterum' i stedet for." Saga's words are about tomorrow's events
 * (or, when tomorrow is quiet, the next day with something in the house), written once a day - in the first round after midnight -
 * and again only if that day's events change. At most three events. */
const dateOf = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
const WEEKDAY = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long" });
const LONG_DAY = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const MAX_SPEAKER_EVENTS = 3;

export function speakerDay(candidates: Candidate[], nowMs: number): { heading: string; key: string; events: Candidate[] } | null {
  const today = dateOf(nowMs);
  const tomorrow = dateOf(Date.parse(`${today}T12:00:00Z`) + 86_400_000);
  const target = candidates.map(c => dateOf(Date.parse(c.startsAt))).find(d => d > today);
  if (!target) return null;
  const events = candidates.filter(c => dateOf(Date.parse(c.startsAt)) === target).slice(0, MAX_SPEAKER_EVENTS);
  const at = Date.parse(events[0]!.startsAt);
  const inAWeek = Date.parse(`${target}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) < 7 * 86_400_000;
  const heading = target === tomorrow ? "I morgen i Hjerterum" : `${capital(inAWeek ? WEEKDAY.format(at) : LONG_DAY.format(at))} i Hjerterum`;
  return { heading, key: `intro:${today}:${target}:${events.map(c => c.key).join(",")}`, events };
}

export async function program(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Program> {
  const candidates = await programCandidates(db, external, nowMs);
  const day = speakerDay(candidates, nowMs);
  const row = day ? await db.prepare("SELECT text FROM event_blurbs WHERE key = ?").bind(day.key).first<{ text: string }>().catch(() => null) : null;
  return { intro: row?.text ?? null, heading: row ? day!.heading : null, items: candidates.slice(0, PROGRAM_SIZE).map(({ description: _d, ...c }) => c) };
}

const SYSTEM = "Du skriver en kort, varm og uformel indledning til medlemmerne af Hjerterum i Aarhus (et hus for meditation, yoga, personlig udvikling og fællesskab) "
  + "om de events, der er i huset en bestemt dag - som en speaker på tv (continuity), der fortæller, hvad der er på vej. Teksten står under overskriften \"I morgen i Hjerterum\" (eller dagens navn). Eksempel på tonen (godkendt af formanden): \"Søndag formiddag guider Jørgen os gennem en rolig og sanselig breathwork-oplevelse, hvor vi kan mærke åndedrættets dybere lag. "
  + "Søndag eftermiddag er Henriette og Jacob klar til Kropsligt klarsyn, hvor Henriette stiller sig til rådighed for, hvad kroppen vil fortælle, mens Jacob fylder rummet med toner fra klaveret.\" Én sætning pr. event, højst tre. Sig hvornår med del af dagen (fx \"om formiddagen\", \"sidst på eftermiddagen\", \"om aftenen\") - ikke ugedag, \"i dag\", \"i morgen\" eller klokkeslæt, for dagen står i overskriften. "
  + "Brug underviserens fornavn. Find ikke på detaljer, der ikke står i beskrivelsen. Ingen emojis, ingen udråbstegn. Skriv på dansk. Svar kun med teksten.";
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** In Saga's round (every five minutes): when the words for the coming day are missing - a new day, or that day's events changed - they are written, once. */
export async function writeProgramIntro(env: SagaEnv, deps: SagaDeps, db: D1Database, external: ExternalEvent[], claim: (key: string) => Promise<boolean>): Promise<boolean> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return false;
  const day = speakerDay(await programCandidates(db, external, deps.now()), deps.now());
  if (!day) return false;
  const { key, events: two } = day;
  if (await db.prepare("SELECT 1 AS yes FROM event_blurbs WHERE key = ?").bind(key).first().catch(() => null)) return false;
  if (!(await claim(key))) return false;
  const text = (await completeAs("program-intro", "mid")(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify({
    nu: WHEN.format(deps.now()),
    events: two.map(c => ({ titel: c.title, underviser: c.host, starter: WHEN.format(Date.parse(c.startsAt)), beskrivelse: (c.description ?? "").replace(/\s+/g, " ").slice(0, 600) }))
  }) }])).replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 600);
  if (!text) return false;
  await db.prepare("INSERT INTO event_blurbs (key, text, created_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, created_at_ms = excluded.created_at_ms").bind(key, text, deps.now()).run();
  return true;
}
