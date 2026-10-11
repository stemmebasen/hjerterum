import type { D1Database } from "./db.js";
import type { ExternalEvent } from "./external-events.js";
import { isPartnerEvent } from "../partner-events.js";
import { completeAs } from "./saga/ai.js";
import { eventIdOf } from "./event-detail.js";
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

/** Requested: "Lad resuméet altid inkludere de kommende tre events - og ændre overskriften så den passer." Saga's words are about
 * the next three events that have not begun, under "Snart i Hjerterum"; they are written again when one of them begins (or the
 * three change), so the words never speak of something that has started. Replaces "I morgen i Hjerterum". */
export const SPEAKER_EVENTS = 3;
export const SPEAKER_HEADING = "Snart i Hjerterum";
export function speakerNext(candidates: Candidate[], nowMs: number): { heading: string; key: string; events: Candidate[] } | null {
  const events = candidates.filter(c => Date.parse(c.startsAt) > nowMs).slice(0, SPEAKER_EVENTS);
  if (!events.length) return null;
  return { heading: SPEAKER_HEADING, key: `intro4:${events.map(c => c.key).join(",")}`, events };
}

export async function program(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Program> {
  const candidates = await programCandidates(db, external, nowMs);
  const day = speakerNext(candidates, nowMs);
  const row = day ? await db.prepare("SELECT text FROM event_blurbs WHERE key = ?").bind(day.key).first<{ text: string }>().catch(() => null) : null;
  return { intro: row?.text ?? null, heading: row ? day!.heading : null, items: candidates.slice(0, PROGRAM_SIZE).map(({ description: _d, ...c }) => c) };
}

const SYSTEM = "Du skriver en kort, varm og uformel indledning til medlemmerne af Hjerterum i Aarhus (et hus for meditation, yoga, personlig udvikling og fællesskab) "
  + "om de næste events i huset - som en speaker på tv (continuity), der fortæller, hvad der er på vej. Teksten står under overskriften \"Snart i Hjerterum\". Eksempel på tonen (godkendt af formanden): \"Søndag formiddag guider Jørgen os gennem en rolig og sanselig breathwork-oplevelse, hvor vi kan mærke åndedrættets dybere lag. "
  + "Søndag eftermiddag er Henriette og Jacob klar til Kropsligt klarsyn, hvor Henriette stiller sig til rådighed for, hvad kroppen vil fortælle, mens Jacob fylder rummet med toner fra klaveret.\" Nævn ALLE de events, du får - én kort sætning om hvert (højst 30 ord), i rækkefølge, så ingen bliver glemt. Begynd direkte med det første event - ingen indledende sætning som \"Der er en smuk oplevelse på programmet\". "
  + "Nævn hvert events titel i »« og hvornår med ugedag, del af dagen og klokkeslæt (fx \"Mandag formiddag kl. 10.30 guider Jørgen os gennem »Din Indre Natur - Breathwork Journey«, ...\"). Skriv aldrig \"i dag\", \"i morgen\" eller \"i aften\" - teksten står, til det første event begynder, og kan blive læst dagen før. "
  + "Brug underviserens fornavn. Find ikke på detaljer, der ikke står i beskrivelsen. Ingen emojis, ingen udråbstegn. Skriv på dansk. Svar kun med teksten.";
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

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
    nu: WHEN.format(deps.now()),
    antal_events: two.length,
    events: two.map(c => ({ titel: c.title, underviser: c.host, starter: WHEN.format(Date.parse(c.startsAt)), beskrivelse: (c.description ?? "").replace(/\s+/g, " ").slice(0, 600) }))
  }) }]).then(t => t.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 1200));
  // Every event named by its title in »« - so none is left out and none can be mistaken for another day's.
  const enough = (t: string) => (t.match(/»/g) ?? []).length >= two.length;
  let text = await ask("mid");
  if (text && !enough(text)) text = await ask(false).catch(() => text);
  if (!text) return false;
  await db.prepare("INSERT INTO event_blurbs (key, text, created_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, created_at_ms = excluded.created_at_ms").bind(key, text, deps.now()).run();
  return true;
}
