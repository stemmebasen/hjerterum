import type { D1Database } from "./db.js";
import type { ExternalEvent } from "./external-events.js";
import { completeAs } from "./saga/ai.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";

/** Requested: "en programoversigt i fjernsynet på nogle linjer" + "en miniature oversigt med fem eventfotos" + "Måske er teksten bare om
 * de kommende to events. F.eks. Lidt senere i dag kommer *** på besøg ...". The next five events in the house (the calendar's and the
 * members' approved ones) and one short, warm intro by Saga to the next two. The intro is written once for the day and the two events
 * (mid model) and kept, so opening the page costs nothing. */
export type ProgramItem = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };
export type Program = { intro: string | null; items: ProgramItem[] };
type Candidate = ProgramItem & { description: string | null };

export const PROGRAM_SIZE = 5;
const TZ = "Europe/Copenhagen";

async function keyOf(source: string, id: string, title: string, startsAt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${title}|${startsAt}`));
  return `${source}:${id}:${[...new Uint8Array(digest).slice(0, 6)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function programCandidates(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Candidate[]> {
  const fromCalendar = await Promise.all(external.filter(e => Date.parse(e.endsAt ?? e.startsAt) >= nowMs).map(async e => ({
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
  return [...fromCalendar, ...fromMembers].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, PROGRAM_SIZE);
}

const today = (nowMs: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
/** The intro is the day's and the two events': "senere i dag" is only true today. */
const introKey = (nowMs: number, two: Candidate[]) => `intro:${today(nowMs)}:${two.map(c => c.key).join(",")}`;

export async function program(db: D1Database, external: ExternalEvent[], nowMs: number): Promise<Program> {
  const candidates = await programCandidates(db, external, nowMs);
  const row = candidates.length ? await db.prepare("SELECT text FROM event_blurbs WHERE key = ?").bind(introKey(nowMs, candidates.slice(0, 2))).first<{ text: string }>().catch(() => null) : null;
  return { intro: row?.text ?? null, items: candidates.map(({ description: _d, ...c }) => c) };
}

const SYSTEM = "Du skriver en kort, varm og uformel indledning til medlemmerne af Hjerterum i Aarhus (et hus for meditation, yoga, personlig udvikling og fællesskab) "
  + "om de næste to events i huset - som en speaker på tv mellem to programmer (continuity), der fortæller, hvad der er på vej. Eksempel på tonen: \"Lidt senere i dag kommer Anna på besøg og deler ud af sin viden om forskning. "
  + "Og sidst på dagen er Kasper tilbage og underviser i blid yoga med en blid afspænding, inden I går ud i de sene aftentimer.\" "
  + "Højst to sætninger, ét event i hver. Sig hvornår med ord ud fra tidspunktet nu (fx \"senere i dag\", \"i aften\", \"i morgen formiddag\", \"på søndag\") - ikke klokkeslæt. "
  + "Brug underviserens fornavn. Find ikke på detaljer, der ikke står i beskrivelsen. Ingen emojis, ingen udråbstegn. Skriv på dansk. Svar kun med teksten.";
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** In Saga's round: when today's intro for the next two events is missing, it is written - at most once an hour. */
export async function writeProgramIntro(env: SagaEnv, deps: SagaDeps, db: D1Database, external: ExternalEvent[], claim: () => Promise<boolean>): Promise<boolean> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return false;
  const two = (await programCandidates(db, external, deps.now())).slice(0, 2);
  if (!two.length) return false;
  const key = introKey(deps.now(), two);
  if (await db.prepare("SELECT 1 AS yes FROM event_blurbs WHERE key = ?").bind(key).first().catch(() => null)) return false;
  if (!(await claim())) return false;
  const text = (await completeAs("program-intro", "mid")(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify({
    nu: WHEN.format(deps.now()),
    events: two.map(c => ({ titel: c.title, underviser: c.host, starter: WHEN.format(Date.parse(c.startsAt)), beskrivelse: (c.description ?? "").replace(/\s+/g, " ").slice(0, 600) }))
  }) }])).replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 600);
  if (!text) return false;
  await db.prepare("INSERT INTO event_blurbs (key, text, created_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text, created_at_ms = excluded.created_at_ms").bind(key, text, deps.now()).run();
  return true;
}
