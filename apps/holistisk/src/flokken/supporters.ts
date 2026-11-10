import type { D1Database } from "../db.js";

/** Støttemedlemmer: a name and an e-mail from people who want to support the association without taking part. */
export type SupporterForm = { name: string; email: string };
export type SupporterErrors = Partial<Record<keyof SupporterForm, string>>;

export function readSupporter(data: FormData): SupporterForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return { name: s("navn"), email: s("email") };
}

export function validateSupporter(f: SupporterForm): SupporterErrors {
  const e: SupporterErrors = {};
  if (f.name.length < 2 || f.name.length > 80) e.name = "Skriv dit navn.";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(f.email) || f.email.length > 160) e.email = "Skriv en gyldig e-mail.";
  return e;
}

/** Saves the wish; signing up twice with the same e-mail is fine and keeps the first. */
export async function saveSupporter(db: D1Database, f: SupporterForm, now: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO supporter_signups (id, name, email, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), f.name, f.email, now).run();
}

export async function listSupporters(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare("SELECT name, email, created_at FROM supporter_signups ORDER BY created_at DESC LIMIT 2000").all();
  return results;
}
