import type { D1Database } from "../db.js";

/** Indmeldelse: a name and an e-mail from people who sign up as members. No profile needed. */
export type SignupForm = { name: string; email: string };
export type SignupErrors = Partial<Record<keyof SignupForm, string>>;

export function readSignup(data: FormData): SignupForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return { name: s("navn"), email: s("email") };
}

export function validateSignup(f: SignupForm): SignupErrors {
  const e: SignupErrors = {};
  if (f.name.length < 2 || f.name.length > 80) e.name = "Skriv dit navn.";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(f.email) || f.email.length > 160) e.email = "Skriv en gyldig e-mail.";
  return e;
}

/** Saves the sign-up; signing up twice with the same e-mail is fine and keeps the first. */
export async function saveSignup(db: D1Database, f: SignupForm, now: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO membership_signups (id, name, email, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), f.name, f.email, now).run();
}

export async function listSignups(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare("SELECT name, email, created_at FROM membership_signups ORDER BY created_at DESC LIMIT 2000").all();
  return results;
}
