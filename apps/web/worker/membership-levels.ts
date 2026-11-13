import { applyMembershipLevels, MEMBERSHIP_TIERS, membershipPlans, type MembershipLevel, type MembershipPlan, type MembershipTier } from "../membership.js";
import type { D1Database } from "./db.js";

/** Asked (the chair, 12 Nov 2026), on Douglas' "The membership levels must be in the 'Membership Overview' page and editable": "Af mig og Douglas".
 * The levels saved in admin, laid over membership.ts for everything that reads the plans - the website and the member pages (through
 * /api/membership-levels), Saga, and the price of a new membership paid here. A membership already running keeps the price it was started with. */

const FRESH_MS = 60_000;
let loadedAt = -Infinity;

type Row = { tier: string; name: string; description: string; month_minor: number; year_minor: number };

/** Reads the saved levels into membershipPlans; at most once a minute in one worker, at once after a save. */
export async function refreshMembershipLevels(db: D1Database | undefined, nowMs = Date.now(), force = false): Promise<void> {
  if (!db || (!force && nowMs - loadedAt < FRESH_MS)) return;
  loadedAt = nowMs;
  try {
    const rows = (await db.prepare("SELECT tier, name, description, month_minor, year_minor FROM membership_levels").all<Row>()).results ?? [];
    applyMembershipLevels(rows.map(r => ({ tier: r.tier, name: r.name, description: r.description, month: r.month_minor, year: r.year_minor })));
  } catch (error) {
    // Before the table exists, or the database is away: the levels as written.
    console.warn("membership_levels_unread", error instanceof Error ? error.message : error);
  }
}

/** The levels as the pages need them. */
export function currentLevels(): MembershipLevel[] {
  return MEMBERSHIP_TIERS.map(tier => ({ tier, name: membershipPlans[tier].name, description: membershipPlans[tier].description, month: membershipPlans[tier].month, year: membershipPlans[tier].year }));
}

const isTier = (tier: string): tier is MembershipTier => (MEMBERSHIP_TIERS as string[]).includes(tier);

/** "222" or "222,50" kr. to øre. */
export function kroner(value: string): number | null {
  const text = value.trim().replace(/\s|kr\.?/gi, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export type LevelInput = { name: string; description: string; month: string; year: string };

export async function saveMembershipLevel(db: D1Database, tier: string, input: LevelInput, by: string, nowMs: number): Promise<{ changed: string[] } | { error: string }> {
  if (!isTier(tier)) return { error: "Medlemskabet findes ikke." };
  const name = input.name.trim().slice(0, 80), description = input.description.trim().slice(0, 1000);
  const month = kroner(input.month), year = kroner(input.year);
  if (!name) return { error: "Navnet skal udfyldes." };
  if (month === null || year === null) return { error: "Priserne skal være beløb i kroner, fx 222 eller 2.310." };
  if (month === 0 || year === 0) return { error: "Et medlemskab her koster noget. Et gratis medlemskab gives under Medlemmer." };
  await refreshMembershipLevels(db, nowMs, true);
  const before: MembershipPlan = { ...membershipPlans[tier] };
  const changed = [name !== before.name && "navn", description !== before.description && "beskrivelse", month !== before.month && "pris pr. måned", year !== before.year && "pris pr. år"]
    .filter((x): x is string => Boolean(x));
  if (!changed.length) return { changed };
  const after = { name, description, month, year };
  await db.prepare(`INSERT INTO membership_levels (tier, name, description, month_minor, year_minor, updated_at_ms, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tier) DO UPDATE SET name = excluded.name, description = excluded.description, month_minor = excluded.month_minor, year_minor = excluded.year_minor,
        updated_at_ms = excluded.updated_at_ms, updated_by = excluded.updated_by`).bind(tier, name, description, month, year, nowMs, by).run();
  await db.prepare("INSERT INTO membership_level_changes (tier, before_json, after_json, by_name, at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(tier, JSON.stringify({ name: before.name, description: before.description, month: before.month, year: before.year }), JSON.stringify(after), by, nowMs).run();
  await refreshMembershipLevels(db, nowMs, true);
  return { changed };
}

export type LevelChange = { tier: string; before: MembershipLevel; after: MembershipLevel; by: string; atMs: number };

export async function membershipLevelChanges(db: D1Database, limit = 30): Promise<LevelChange[]> {
  const rows = (await db.prepare("SELECT tier, before_json, after_json, by_name, at_ms FROM membership_level_changes ORDER BY at_ms DESC, id DESC LIMIT ?").bind(limit)
    .all<{ tier: string; before_json: string; after_json: string; by_name: string; at_ms: number }>()).results ?? [];
  return rows.map(r => ({ tier: r.tier, before: { tier: r.tier, ...JSON.parse(r.before_json) }, after: { tier: r.tier, ...JSON.parse(r.after_json) }, by: r.by_name, atMs: r.at_ms }));
}

/** For tests: forget when the levels were read. */
export function forgetMembershipLevels(): void { loadedAt = -Infinity; applyMembershipLevels([]); }
