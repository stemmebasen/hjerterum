import { CATEGORIES, categoryBySlug } from "../categories.js";
import type { D1Database } from "../db.js";
import { GROUPS, groupBySlug, groupsOf } from "../groups.js";
import { isAlternativeEvent } from "../mainstream.js";
import { localDate } from "../time.js";
import type { Filters } from "./filters.js";
import { html, type SafeHtml } from "./html.js";
import { forYouPool, type EventRow } from "./queries.js";

/**
 * "Til dig" (Jake 2026-11-10): a short row of coming events picked from the person's own choices, with one small grey
 * line saying why ("Fordi du kan lide Krea og musik") and a way to start over.
 *
 * Only what people choose counts, never what they merely look at: the four tiles and the category filters they pick in
 * the calendar, the activity pages they open from the menu, and – for members – the events they tick in "Lad os komme
 * godt i gang" (a guest's ticks too, while they wait for a profile) and the flocks they join. A member's age group (given when joining a flock) is not used to guess
 * tastes; it only lifts events where people of the same age group are already going. Children's and family events
 * stay out unless the person has chosen them.
 *
 * For guests the choices live in one cookie on their own device (`sk_smag`, half a year, nothing else in it); a choice
 * the person makes to tailor the site to themselves, which "Nulstil" (/til-dig/nulstil) deletes again.
 */

export const TASTE_COOKIE = "sk_smag";
const TASTE_DAYS = 180;
/** No single choice can outweigh the rest by being repeated (a reload, paging through the calendar). */
const MAX_WEIGHT = 6;
const MAX_KEYS = 12;
export const FOR_YOU_SIZE = 6;
export const RESET_PATH = "/til-dig/nulstil";

/** Weights per group slug and category slug. */
export type Taste = Map<string, number>;

const KNOWN = new Set<string>([...GROUPS.map(g => g.slug), ...CATEGORIES.map(c => c.slug)]);

export function readTaste(request: Request): Taste {
  const raw = new RegExp(`(?:^|;\\s*)${TASTE_COOKIE}=([a-z0-9:~-]{1,400})`).exec(request.headers.get("cookie") ?? "")?.[1] ?? "";
  const taste: Taste = new Map();
  for (const pair of raw.split("~")) {
    const [key, n] = pair.split(":");
    const w = Number(n);
    if (key && KNOWN.has(key) && Number.isInteger(w) && w > 0) taste.set(key, Math.min(MAX_WEIGHT, w));
  }
  return taste;
}

export function tasteCookie(taste: Taste): string {
  const value = [...taste].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYS).map(([k, w]) => `${k}:${w}`).join("~");
  return `${TASTE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TASTE_DAYS * 86_400}`;
}

export const clearTasteCookie = (): string => `${TASTE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** The choices a calendar or activity page's filters show: a tile counts twice, a category once. Null when there is
 * nothing to remember (no choice, a search, a later page). */
export function tasteFromFilters(taste: Taste, f: Pick<Filters, "group" | "categories" | "page" | "q">): Taste | null {
  if (f.page > 1 || f.q || (!f.group && !f.categories.length)) return null;
  const next: Taste = new Map(taste);
  const bump = (key: string, by: number) => { if (KNOWN.has(key)) next.set(key, Math.min(MAX_WEIGHT, (next.get(key) ?? 0) + by)); };
  if (f.group) bump(f.group, 2);
  for (const c of f.categories) bump(c, 1);
  const same = next.size === taste.size && [...next].every(([k, w]) => taste.get(k) === w);
  return same ? null : next;
}

/** What a member has shown us by acting: the categories of the events they ticked or joined a flock for, their
 * age group, and those events (not suggested again). */
export type MemberSignals = { categories: Map<string, number>; ageGroup: string | null; own: Set<string> };

export async function memberSignals(db: D1Database, memberId: string): Promise<MemberSignals> {
  const mine = `SELECT event_id FROM event_interests WHERE member_id = ?1
    UNION SELECT f.event_id FROM flock_members m JOIN flocks f ON f.id = m.flock_id WHERE m.member_id = ?1 AND m.left_at IS NULL`;
  const [cats, own, me] = await Promise.all([
    db.prepare(`SELECT c.category, COUNT(*) AS n FROM event_categories c WHERE c.event_id IN (${mine}) GROUP BY c.category`).bind(memberId).all<{ category: string; n: number }>(),
    db.prepare(mine).bind(memberId).all<{ event_id: string }>(),
    db.prepare("SELECT age_group FROM members WHERE id = ?").bind(memberId).first<{ age_group: string | null }>()
  ]);
  return {
    categories: new Map(cats.results.map(r => [r.category, r.n])),
    ageGroup: me?.age_group ?? null,
    own: new Set(own.results.map(r => r.event_id))
  };
}

/** A guest who ticked events in the welcome pop-up but has not made a profile yet (the ticks wait in a cookie for an
 * hour, src/flokken/kickoff.ts): those events count as a member's would. */
async function guestSignals(db: D1Database, slugs: string[]): Promise<MemberSignals> {
  const marks = slugs.map(() => "?").join(",");
  const [cats, own] = await Promise.all([
    db.prepare(`SELECT c.category, COUNT(*) AS n FROM event_categories c JOIN events e ON e.id = c.event_id WHERE e.slug IN (${marks}) GROUP BY c.category`).bind(...slugs).all<{ category: string; n: number }>(),
    db.prepare(`SELECT id FROM events WHERE slug IN (${marks})`).bind(...slugs).all<{ id: string }>()
  ]);
  return { categories: new Map(cats.results.map(r => [r.category, r.n])), ageGroup: null, own: new Set(own.results.map(r => r.id)) };
}

/** Coming events where people of this age group are already in an open flock or waiting in the interest list. */
async function sameAgeEvents(db: D1Database, ageGroup: string, memberId: string, now: number): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT f.event_id AS id FROM flocks f JOIN flock_members fm ON fm.flock_id = f.id AND fm.left_at IS NULL
      JOIN members m ON m.id = fm.member_id JOIN events e ON e.id = f.event_id
      WHERE f.status = 'open' AND m.age_group = ?1 AND m.id <> ?2 AND e.starts_at > ?3
    UNION SELECT i.event_id FROM event_interests i JOIN members m ON m.id = i.member_id JOIN events e ON e.id = i.event_id
      WHERE i.status = 'waiting' AND m.age_group = ?1 AND m.id <> ?2 AND e.starts_at > ?3`).bind(ageGroup, memberId, now).all<{ id: string }>();
  return new Set(results.map(r => r.id));
}

/** The person's choices and a member's actions as one set of weights: a ticked or joined event's categories count
 * twice each (they are the strongest sign), up to the same ceiling. */
export function combinedTaste(taste: Taste, member: MemberSignals | null): Taste {
  const all: Taste = new Map(taste);
  for (const [c, n] of member?.categories ?? []) all.set(c, Math.min(MAX_WEIGHT, (all.get(c) ?? 0) + 2 * n));
  return all;
}

export type ForYou = { events: EventRow[]; why: string; sameAge: boolean };

const label = (key: string) => groupBySlug(key)?.name ?? categoryBySlug(key)?.short.toLowerCase() ?? key;

/** "Krea og musik": the two strongest choices, in the person's words (the tile's name, the category's short name). */
export function whyLine(taste: Taste): string {
  const top = [...taste].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => label(k));
  return top.join(" og ");
}

/** Score one event against the weights: its tiles and its categories; a children's event needs the person to have
 * chosen it; a spiritual or alternative one sits a little lower unless Fordybelse or its category was chosen. */
export function scoreEvent(e: EventRow, taste: Taste): number {
  const cats = (e.categories ?? "").split(",").filter(Boolean);
  let score = 0;
  for (const g of groupsOf(e.categories)) score += taste.get(g) ?? 0;
  for (const c of cats) score += 1.5 * (taste.get(c) ?? 0);
  if (cats.includes("boern-familie") && !taste.get("boern-familie")) return 0;
  if (score > 0 && isAlternativeEvent(e) && !taste.get("fordybelse") && !cats.some(c => taste.get(c))) score -= 1;
  return score;
}

/** Up to six coming events for the person, or null when we know nothing of their choices yet. At most one per
 * organiser and one per title, so one house's weekly workshops can't take the row. */
export async function forYou(db: D1Database, regions: string[], now: number, taste: Taste, member: { id: string } | null, ticked: string[] = []): Promise<ForYou | null> {
  const signals = member ? await memberSignals(db, member.id) : ticked.length ? await guestSignals(db, ticked) : null;
  const weights = combinedTaste(taste, signals);
  if (![...weights.values()].some(w => w > 0)) return null;
  const [pool, sameAge] = await Promise.all([
    forYouPool(db, regions, now),
    signals?.ageGroup && member ? sameAgeEvents(db, signals.ageGroup, member.id, now) : Promise.resolve(new Set<string>())
  ]);
  const scored = pool
    .filter(e => !signals?.own.has(e.id))
    .map(e => ({ e, score: scoreEvent(e, weights) + (sameAge.has(e.id) ? 5 : 0) + (e.image_url ? 0.3 : 0) }))
    .filter(x => x.score > 0.5)
    // Sooner first among equals; the score is rounded so the next few days aren't skipped for a slightly better match.
    .sort((a, b) => Math.round(b.score) - Math.round(a.score) || a.e.starts_at - b.e.starts_at);
  const picked: EventRow[] = [];
  const owners = new Set<string>(), titles = new Set<string>(), days = new Map<string, number>();
  for (const { e } of scored) {
    if (picked.length >= FOR_YOU_SIZE) break;
    const owner = e.organizer_id ?? e.venue_name ?? e.id;
    const title = e.title.trim().toLowerCase();
    const day = localDate(e.starts_at);
    if (owners.has(owner) || titles.has(title) || (days.get(day) ?? 0) >= 2) continue;
    owners.add(owner); titles.add(title); days.set(day, (days.get(day) ?? 0) + 1);
    picked.push(e);
  }
  if (!picked.length) return null;
  return { events: picked.sort((a, b) => a.starts_at - b.starts_at), why: whyLine(weights), sameAge: picked.some(e => sameAge.has(e.id)) };
}

/** The one grey line under "Til dig": why, and how to start over. */
export function whyNote(fy: ForYou, returnTo: string): SafeHtml {
  return html`<p class="for-you-why">Fordi du kan lide ${fy.why}${fy.sameAge ? " – og folk på din alder skal med" : ""} · ud fra dine egne valg · <a href="${RESET_PATH}?tilbage=${encodeURIComponent(returnTo)}" rel="nofollow">Nulstil</a></p>`;
}
