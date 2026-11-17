import { categoryByPath } from "../src/categories.js";
import type { testDb } from "./d1.js";
import { fixture } from "./helpers.js";

/** Three real days from socialklubben.dk's calendar (18, 21 and 26 November 2026, read 17 November), with their
 * organiser, categories, price and picture, put straight into the events table: the material "Dagens fem" was tuned on. */

type Row = [slug: string, title: string, start: string, end: string | null, venue: string, org: string | null, categories: string, price: string, image: 0 | 1, allDay: 0 | 1];

/** Organisers whose events come from a source of their own (src/sources/registry.ts ids), so src/mainstream.ts knows them. */
const SOURCE_OF: Record<string, string> = { hjerterum: "hjerterum", "lysets-hus": "lysetshus", "favn-aarhus": "favn-aarhus", dokk1: "dokk1" };

function price(text: string): { free: number | null; min: number | null } {
  if (/gratis/i.test(text)) return { free: 1, min: 0 };
  const m = /^([\d.]+)/.exec(text);
  return m ? { free: 0, min: Number(m[1]!.replace(/\./g, "")) * 100 } : { free: null, min: null };
}

const at = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00+01:00` : s);

export function seedCurationDays(db: ReturnType<typeof testDb>, now: number): Array<{ id: string; slug: string; title: string; day: string }> {
  const rows = JSON.parse(fixture("curation-days.json")) as Row[];
  const raw = db.raw;
  const sources = new Set(["fixture", ...Object.values(SOURCE_OF)]);
  for (const s of sources) raw.prepare("INSERT OR IGNORE INTO sources (id, name, adapter, permission_basis, attribution, image_policy, description_policy, updated_at) VALUES (?, ?, 'fixture', 'test', ?, 'allowed', 'full', ?)").run(s, s, s, now);
  const out: Array<{ id: string; slug: string; title: string; day: string }> = [];
  for (const [slug, title, start, end, venue, org, cats, priceText, image, allDay] of rows) {
    if (org) raw.prepare("INSERT OR IGNORE INTO organizers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(org, venue.split(",")[0]!, now, now);
    const id = `fx:${slug}`;
    const p = price(priceText);
    const startsAt = at(start);
    const endsAt = end ? (allDay ? at(end) + 86_400_000 - 1 : at(end)) : null;
    raw.prepare(`INSERT INTO events (id, slug, title, starts_at, ends_at, all_day, organizer_id, venue_name, city, area, region, price_min_minor, price_text, is_free, image_url,
      primary_source_id, status, fingerprint, search_text, content_hash, first_seen_at, last_checked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Aarhus C', 'aarhus', 'ostjylland', ?, ?, ?, ?, ?, 'scheduled', ?, ?, 'x', ?, ?, ?)`)
      .run(id, slug, title, startsAt, endsAt, allDay, org, venue, p.min, priceText || null, p.free, image ? `https://img.example/${slug}.jpg` : null,
        SOURCE_OF[org ?? ""] ?? "fixture", slug, `${title} ${venue}`.toLowerCase(), now, now, now);
    cats.split(",").filter(Boolean).forEach((path, rank) => {
      const c = categoryByPath(path);
      if (c) raw.prepare("INSERT OR IGNORE INTO event_categories (event_id, category, rank) VALUES (?, ?, ?)").run(id, c.slug, rank);
    });
    out.push({ id, slug, title, day: start.slice(0, 10) });
  }
  return out;
}
