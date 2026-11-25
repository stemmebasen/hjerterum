import type { D1Database } from "./db.js";

/** Asked by Mari-Anne (25 Nov 2026), through the chair: "Måske kan I ændre de fremtidige posts til 'Yin Yoga med Yin Yogi'?" A teacher may be named in
 * Hjerterum's posts, films, posters and newsletter by a name of their own (teacher_pr_names, set on the teacher's card in admin → Events →
 * Undervisere). The calendar keeps the teacher's real name; only what is shown to the public changes. */

export type PrNames = Array<{ full: string; first: string; prName: string }>;
const norm = (name: string) => name.normalize("NFC").toLocaleLowerCase("da-DK").replace(/\s+/g, " ").trim();

export async function prNames(db: D1Database): Promise<PrNames> {
  const rows = await Promise.resolve().then(() => db.prepare("SELECT key, name, pr_name FROM teacher_pr_names WHERE TRIM(pr_name) <> ''")
    .all<{ key: string; name: string; pr_name: string }>()).then(r => r.results ?? []).catch(() => []);
  return rows.map(r => ({ full: norm(r.name || r.key), first: norm(r.name || r.key).split(" ")[0]!, prName: r.pr_name.trim() }));
}

/** The teacher's own name for one named in the calendar by their full name or only their first name. */
export function prNameOf(names: PrNames, host: string | null): string | null {
  if (!host) return null;
  const h = norm(host);
  return names.find(n => n.full === h)?.prName ?? (h.includes(" ") ? null : names.find(n => n.first === h)?.prName ?? null);
}

/** The event's teacher and title as the public sees them: "Yin yoga med Mari-Anne" → "Yin yoga med Yin Yogi". */
export function shownAs(names: PrNames, host: string | null, title: string): { host: string | null; title: string } {
  const prName = prNameOf(names, host);
  if (!prName || !host) return { host, title };
  const first = host.trim().split(/\s+/)[0]!;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(\\bmed\\s+)${escape(host.trim())}|(\\bmed\\s+)${escape(first)}(?![\\p{L}-])`, "iu");
  return { host: prName, title: title.replace(named, (_m, a: string | undefined, b: string | undefined) => `${a ?? b}${prName}`) };
}
