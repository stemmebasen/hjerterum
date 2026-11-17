import type { D1Database } from "./db.js";
import { categoryBySlug } from "./categories.js";
import { isAlternativeEvent } from "./mainstream.js";
import { localDate, startOfLocalDay, wallClock, weekdayIndex } from "./time.js";
import { curationPool, type EventRow } from "./web/queries.js";

/** "Dagens fem" (Jake 2026-11-17): fewer arrangements, chosen for quality. Every arrangement gets points for how well it
 * suits going out with others (an evening concert, a quiz, a talk) and loses points for what doesn't (weekday daytime,
 * all day, very long or very short, spiritual or alternative); some are left out altogether (sold out, for children,
 * a notice rather than an arrangement). Each day then shows at most DAILY of the best, with variety: one per
 * organiser or venue, rarely more than two of the same kind, at most one spiritual or alternative, no duplicates from two
 * sources, and preferably one free or cheap. A quiet day shows fewer rather than fill up with weak ones (MIN_SCORE).
 *
 * The pick is stored in event_picks (migration 0015) and made again after each collector run and whenever the admin
 * pins or hides an arrangement (/admin/udvalg). The calendar, I dag, Weekend, the front page, the interest list, Til dig
 * and the map show only the pick; a search (free text, a category, an organiser's page) shows everything except what
 * the admin has hidden. Arrangements where a flock has members are always shown. */

export const DAILY = 5;
/** Below this an arrangement is not picked, even on a quiet day. */
export const MIN_SCORE = 1;
/** How far ahead the pick is made. */
export const PICK_DAYS = 90;
/** What a second, third … arrangement of the same kind on a day costs in points. */
const SAME_KIND = [0, 0.5, 3];

export type Candidate = Pick<EventRow,
  "id" | "slug" | "title" | "starts_at" | "ends_at" | "all_day" | "categories" | "primary_source_id" | "organizer_id" |
  "venue_name" | "image_url" | "is_free" | "price_min_minor" | "price_text" | "flock_count"> & {
  /** People who said "Jeg vil gerne med!" (waiting, invited or confirmed). */
  interest?: number;
  /** The admin's choice (event_curation). */
  curation?: "pin" | "hide" | null;
};

export type Scored = { score: number; reasons: string[] } | { excluded: string };

/** Points for the arrangement's main kind (its first category). Children and family are left out (below). */
const KIND: Record<string, number> = {
  "quiz-fest": 3, "koncerter-musik": 2.5, "scenekunst": 2.5, "foredrag-debat": 2, "sociale-faellesskaber": 2,
  "samtale-faellesskab": 1.5, "dans-bevaegelse": 1.5, "natur": 1.5, "workshops-kurser": 1, "kunst-udstillinger": 1,
  "yoga": 0.5
};

const SOLD_OUT = /udsolgt|sold[ -]?out|fully booked|closed for booking|venteliste/i;
const NOTICE = /har fået besked|\bhusk (at|tag|billet)|^\s*(info|obs|aflyst)\b|\baflyst\b/i;
const CHILDREN = /\b(for børn|børn og familie|børnefamilie|børneteater|børnekoncert|baby|babyer|babymassage|småbørn|legestue|kids|efterskoler?|0-\d+ år|\d-\d+ år)\b/i;
/** Organisers and venues with a large, mostly daytime programme (Jake 2026-11-10: Dokk1 drowned the rest). */
const BUSY = ["dokk1"];

const categoriesOf = (e: Pick<Candidate, "categories">) => (e.categories ?? "").split(",").filter(Boolean);

/** Why an arrangement can't be among the picks, or null. */
export function exclusion(e: Candidate): string | null {
  if (e.curation === "hide") return "skjult";
  if (SOLD_OUT.test(e.title) || SOLD_OUT.test(e.price_text ?? "")) return "udsolgt";
  if (NOTICE.test(e.title) || e.title.trim().length < 3) return "ligner en besked";
  if (categoriesOf(e).includes("boern-familie") || CHILDREN.test(e.title)) return "for børn";
  return null;
}

/** How well an arrangement suits going out with others. */
export function scoreEvent(e: Candidate): Scored {
  const out = exclusion(e);
  if (out) return { excluded: out };
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, why: string) => { score += points; reasons.push(`${points > 0 ? "+" : ""}${points} ${why}`); };

  // When: evenings and weekends are when people go out together.
  const day = weekdayIndex(localDate(e.starts_at));
  const weekend = day >= 5;
  const { hour } = wallClock(e.starts_at);
  if (e.all_day) add(-3, "hele dagen");
  else if (hour >= 17 && hour <= 21) add(3, "aften");
  else if (weekend && hour >= 10 && hour < 17) add(2, "weekend");
  else if (hour === 16) add(1, "sidst på eftermiddagen");
  else add(-1, weekend ? "tidligt eller sent" : "hverdag i dagtimerne");

  // What: the broad offer first (src/mainstream.ts).
  const kinds = categoriesOf(e);
  const main = kinds[0];
  if (main && KIND[main] !== undefined) add(KIND[main]!, (categoryBySlug(main)?.short ?? main).toLowerCase());
  if (isAlternativeEvent(e)) add(-2, "spirituelt/alternativt");

  // How long: a short taster or a whole-day programme is hard to go to together.
  if (!e.all_day && e.ends_at) {
    const minutes = (e.ends_at - e.starts_at) / 60_000;
    if (minutes < 45) add(-1, "under 45 minutter");
    else if (minutes > 6 * 60) add(-1.5, "over 6 timer");
  }

  // What we know: a picture and a price make it easy to say yes.
  if (e.image_url) add(1, "billede");
  if (e.is_free === 1) add(1, "gratis");
  else if (e.price_min_minor !== null) {
    add(0.5, "kendt pris");
    if (e.price_min_minor > 80_000) add(-3, "over 800 kr.");
    else if (e.price_min_minor > 40_000) add(-1.5, "over 400 kr.");
  }

  if (BUSY.includes(e.organizer_id ?? "")) add(-1, "stort dagprogram");
  if (e.interest) add(Math.min(3, e.interest), "vil gerne med");
  return { score: Math.round(score * 10) / 10, reasons };
}

/** The same arrangement from two sources ("KRØYER" at Radar and "KRØYER [SUPPORT: …]" at Godsbanen): the title
 * without what is in brackets, in plain letters. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^a-z0-9æøåäöüé]+/g, " ").trim();
}
export const sameArrangement = (a: Pick<Candidate, "title" | "starts_at">, b: Pick<Candidate, "title" | "starts_at">): boolean => {
  const ka = titleKey(a.title), kb = titleKey(b.title);
  if (ka === kb) return true;
  return a.starts_at === b.starts_at && ka.length >= 5 && kb.length >= 5 && (ka.startsWith(kb) || kb.startsWith(ka));
};

const ownerOf = (e: Candidate) => e.organizer_id ?? (e.venue_name ? `venue:${e.venue_name.toLowerCase()}` : `event:${e.id}`);
const kindOf = (e: Candidate) => categoriesOf(e)[0] ?? "andet";
const cheap = (e: Candidate) => e.is_free === 1 || (e.price_min_minor !== null && e.price_min_minor <= 10_000);
const hasFlock = (e: Candidate) => (e.flock_count ?? 0) > 0;

export type DayPick = { event: Candidate; score: number; reasons: string[]; why: "fastgjort" | "flok" | "udvalgt" };

/** One day's arrangements in, the day's picks out (best first, then by time). */
export function pickDay(events: Candidate[], daily = DAILY): DayPick[] {
  const scored = events.map(e => ({ e, s: scoreEvent(e) }));
  const picked: DayPick[] = [];
  const has = (e: Candidate) => picked.some(p => p.event.id === e.id);
  const dup = (e: Candidate) => picked.some(p => sameArrangement(p.event, e));
  const score = (s: Scored) => "score" in s ? s.score : -99;
  const take = (e: Candidate, s: Scored, why: DayPick["why"]) => picked.push({ event: e, score: score(s), reasons: "reasons" in s ? s.reasons : [s.excluded], why });

  // Pinned by the admin, and arrangements where a flock has members: always (also beyond five).
  for (const { e, s } of scored) if (e.curation === "pin" && !has(e)) take(e, s, "fastgjort");
  for (const { e, s } of scored) if (hasFlock(e) && e.curation !== "hide" && !has(e) && !dup(e)) take(e, s, "flok");

  // The best first; between equals the fuller title (a duplicate from the source that tells more).
  const ranked = scored
    .filter((x): x is { e: Candidate; s: { score: number; reasons: string[] } } => "score" in x.s && x.s.score >= MIN_SCORE)
    .sort((a, b) => b.s.score - a.s.score || b.e.title.length - a.e.title.length || a.e.starts_at - b.e.starts_at || a.e.id.localeCompare(b.e.id));
  const allowed = (e: Candidate, among: DayPick[]) =>
    !among.some(p => p.event.id === e.id || sameArrangement(p.event, e) || ownerOf(p.event) === ownerOf(e))
    && !(isAlternativeEvent(e) && among.some(p => isAlternativeEvent(p.event)));
  // Variety: a second of the same kind costs a little, a third a lot (SAME_KIND), so a strong third concert can still
  // beat a weak workshop, but a day is rarely all concerts.
  const effective = (e: Candidate, score: number) => {
    const same = picked.filter(p => kindOf(p.event) === kindOf(e)).length;
    return score - (SAME_KIND[Math.min(same, SAME_KIND.length - 1)] ?? 0);
  };
  while (picked.length < daily) {
    let best: (typeof ranked)[number] | null = null, bestScore = -Infinity;
    for (const x of ranked) {
      if (!allowed(x.e, picked)) continue;
      const v = effective(x.e, x.s.score);
      if (v > bestScore) { best = x; bestScore = v; }
    }
    if (!best || bestScore < MIN_SCORE) break;
    take(best.e, best.s, "udvalgt");
  }

  // Preferably one free or cheap arrangement: it takes the place of the lowest picked one.
  if (!picked.some(p => cheap(p.event))) {
    const swap = [...picked].reverse().find(p => p.why === "udvalgt");
    const others = picked.filter(p => p !== swap);
    const option = ranked.find(({ e }) => cheap(e) && allowed(e, others));
    if (option && (picked.length < daily || swap)) {
      if (picked.length >= daily && swap) picked.splice(picked.indexOf(swap), 1);
      take(option.e, option.s, "udvalgt");
    }
  }
  return picked.sort((a, b) => b.score - a.score || a.event.starts_at - b.event.starts_at);
}

/** Every day's picks, by local date. */
export function pickDays(events: Candidate[], daily = DAILY): Map<string, DayPick[]> {
  const byDay = new Map<string, Candidate[]>();
  for (const e of events) {
    const d = localDate(e.starts_at);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  return new Map([...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => [d, pickDay(list, daily)]));
}

/** Makes the pick again for today and PICK_DAYS ahead, and stores it (replacing the last one). */
export async function refreshPicks(db: D1Database, now: number): Promise<{ days: number; picked: number; considered: number }> {
  const today = startOfLocalDay(localDate(now)) ?? now;
  const pool = await curationPool(db, today, today + PICK_DAYS * 86_400_000);
  const days = pickDays(pool);
  const rows = [...days].flatMap(([day, picks]) => picks.map((p, rank) => ({ id: p.event.id, day, rank, score: p.score })));
  // Twenty rows to a statement (D1 takes at most 100 parameters), all in one transaction.
  const inserts = [];
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    inserts.push(db.prepare(`INSERT INTO event_picks (event_id, day, rank, score, picked_at) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?)").join(", ")}`)
      .bind(...chunk.flatMap(r => [r.id, r.day, r.rank, r.score, now])));
  }
  await db.batch([db.prepare("DELETE FROM event_picks"), ...inserts]);
  return { days: days.size, picked: rows.length, considered: pool.length };
}

/** Sets or clears the admin's choice for an arrangement, and makes the pick again. */
export async function setCuration(db: D1Database, eventId: string, mode: "pin" | "hide" | null, now: number): Promise<void> {
  if (mode) await db.prepare("INSERT INTO event_curation (event_id, mode, updated_at) VALUES (?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at").bind(eventId, mode, now).run();
  else await db.prepare("DELETE FROM event_curation WHERE event_id = ?").bind(eventId).run();
  await refreshPicks(db, now);
}

/** SQL (events aliased `e`): only the picks, and arrangements where a flock has members. Until the first pick has
 * been made (a new database), everything. */
export const PICKED_SQL = `(NOT EXISTS (SELECT 1 FROM event_picks)
  OR e.id IN (SELECT event_id FROM event_picks)
  OR (EXISTS (SELECT 1 FROM flocks pf WHERE pf.event_id = e.id AND pf.status = 'open' AND EXISTS (SELECT 1 FROM flock_members pm WHERE pm.flock_id = pf.id AND pm.left_at IS NULL))
      AND e.id NOT IN (SELECT event_id FROM event_curation WHERE mode = 'hide')))`;

/** SQL (events aliased `e`): not hidden by the admin. */
export const NOT_HIDDEN_SQL = "e.id NOT IN (SELECT event_id FROM event_curation WHERE mode = 'hide')";
