import type { D1Database } from "./db.js";

/** Douglas (13 Nov 2026), for the board: "How can we assign a label to a member?" Labels the board gives in Medlemsoverblik, kept by e-mail. */
export async function labelsByEmail(db: D1Database): Promise<Map<string, string[]>> {
  const rows = (await db.prepare("SELECT email, label FROM member_labels ORDER BY label").all<{ email: string; label: string }>().catch(() => ({ results: [] }))).results ?? [];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.email, [...(map.get(r.email) ?? []), r.label]);
  return map;
}

/** The labels written in the card's field ("Underviser, Frivillig"), as they now stand; returns what was added and taken away. */
export async function saveLabels(db: D1Database, email: string, written: string, by: string, nowMs: number): Promise<{ added: string[]; removed: string[] }> {
  const key = email.trim().toLowerCase();
  const wanted = [...new Set(written.split(/[,;\n]/).map(l => l.trim().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean))].slice(0, 20);
  const now = ((await db.prepare("SELECT label FROM member_labels WHERE email = ?").bind(key).all<{ label: string }>()).results ?? []).map(r => r.label);
  const added = wanted.filter(l => !now.includes(l)), removed = now.filter(l => !wanted.includes(l));
  for (const l of added) await db.prepare("INSERT OR IGNORE INTO member_labels (email, label, added_by, added_at_ms) VALUES (?, ?, ?, ?)").bind(key, l, by, nowMs).run();
  for (const l of removed) await db.prepare("DELETE FROM member_labels WHERE email = ? AND label = ?").bind(key, l).run();
  return { added, removed };
}
