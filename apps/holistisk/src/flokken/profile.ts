import type { D1Database } from "../db.js";
import { cleanFirstName } from "./auth.js";
import { maskContacts } from "./chat.js";

/** What the others in a flock see about a member: first name, age group, one line about themselves, an optional photo,
 * and how many flocks they have been with before. Signing up needs only a first name; the rest is asked for the first
 * time the member starts or joins a flock. */

export const AGE_GROUPS = ["18-29", "30-39", "40-49", "50-59", "60-69", "70+"] as const;
export const AGE_LABELS: Record<string, string> = { "18-29": "18–29 år", "30-39": "30–39 år", "40-49": "40–49 år", "50-59": "50–59 år", "60-69": "60–69 år", "70+": "70+ år" };
export const INTRO_MIN = 3;
export const INTRO_MAX = 120;
/** A photo as stored: the browser makes it small (at most 600 px) before upload, so this is plenty. */
export const PHOTO_MAX_BYTES = 250_000;
/** The largest /profil form the Worker reads: the photo plus the text fields. */
export const PROFILE_MAX_BODY = PHOTO_MAX_BYTES + 50_000;

export type Profile = { first_name: string; age_group: string | null; intro: string | null; photo_id: string | null; email: string | null };

export const profileComplete = (p: Pick<Profile, "age_group" | "intro"> | null): boolean => !!p?.age_group && !!p.intro;

export async function profileFor(db: D1Database, memberId: string): Promise<Profile | null> {
  return db.prepare(`SELECT m.first_name, m.age_group, m.intro, m.email, p.id AS photo_id FROM members m LEFT JOIN member_photos p ON p.member_id = m.id
    WHERE m.id = ?`).bind(memberId).first<Profile>();
}

// ————————————————————————————————————————— The form

export type ProfileValues = { firstName: string; ageGroup: string; intro: string; email: string | null };
const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}$/i;

export type ProfileForm = { firstName: string; ageGroup: string; intro: string; email: string; removePhoto: boolean };
export type ProfileErrors = Partial<Record<"firstName" | "ageGroup" | "intro" | "email" | "photo", string>>;
export type Photo = { type: "image/jpeg" | "image/png" | "image/webp"; data: Uint8Array<ArrayBuffer> };

export function readProfileForm(data: FormData): ProfileForm {
  const s = (k: string) => String(data.get(k) ?? "");
  return { firstName: s("fornavn"), ageGroup: s("alder"), intro: s("om_mig"), email: s("email"), removePhoto: data.get("fjern_foto") === "ja" };
}

export const cleanIntro = (raw: string): string => maskContacts(raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim());

/** The picture's real type from its first bytes; the browser's word for it is not trusted. */
export function photoType(bytes: Uint8Array): Photo["type"] | null {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** The uploaded photo, if the form has one: null when none was chosen, an error when it cannot be used. */
export async function readPhoto(data: FormData): Promise<Photo | { error: string } | null> {
  const file = data.get("foto");
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > PHOTO_MAX_BYTES) return { error: "Billedet er for stort. Vælg et mindre billede (højst 250 KB)." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = photoType(bytes);
  if (!type) return { error: "Billedet skal være JPG, PNG eller WebP." };
  return { type, data: bytes };
}

export function validateProfile(form: ProfileForm, options: { requireEmail?: boolean } = {}): { values: ProfileValues } | { errors: ProfileErrors } {
  const errors: ProfileErrors = {};
  const firstName = cleanFirstName(form.firstName);
  if (!firstName) errors.firstName = "Skriv dit fornavn (højst 30 bogstaver).";
  if (!(AGE_GROUPS as readonly string[]).includes(form.ageGroup)) errors.ageGroup = "Vælg din aldersgruppe.";
  const intro = cleanIntro(form.intro);
  if (intro.length < INTRO_MIN || intro.length > INTRO_MAX) errors.intro = `Skriv en linje om dig selv på ${INTRO_MIN}–${INTRO_MAX} tegn.`;
  const email = form.email.trim().toLowerCase();
  if (email && (email.length > 160 || !EMAIL.test(email))) errors.email = "Skriv en gyldig e-mail, fx navn@eksempel.dk.";
  else if (!email && options.requireEmail) errors.email = "Skriv din e-mail, så vi kan give besked, når din flok er klar.";
  if (Object.keys(errors).length) return { errors };
  return { values: { firstName: firstName!, ageGroup: form.ageGroup, intro, email: email || null } };
}

/** D1 stores an ArrayBuffer as a BLOB. */
const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Saves the profile. An e-mail left empty keeps the one the member has; one another member already uses is refused. */
export async function saveProfile(db: D1Database, memberId: string, values: ProfileValues, photo: Photo | null, removePhoto: boolean, now: number): Promise<{ ok: true } | { error: "email_taken" }> {
  if (values.email) {
    const taken = await db.prepare("SELECT 1 AS x FROM members WHERE email = ? AND id != ?").bind(values.email, memberId).first<{ x: number }>();
    if (taken) return { error: "email_taken" };
  }
  const statements = [db.prepare("UPDATE members SET first_name = ?, age_group = ?, intro = ?, email = COALESCE(?, email) WHERE id = ?").bind(values.firstName, values.ageGroup, values.intro, values.email, memberId)];
  if (photo) {
    statements.push(db.prepare(`INSERT INTO member_photos (member_id, id, type, data, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (member_id) DO UPDATE SET id = excluded.id, type = excluded.type, data = excluded.data, updated_at = excluded.updated_at`)
      .bind(memberId, crypto.randomUUID(), photo.type, toArrayBuffer(photo.data), now));
  } else if (removePhoto) {
    statements.push(db.prepare("DELETE FROM member_photos WHERE member_id = ?").bind(memberId));
  }
  await db.batch(statements);
  return { ok: true };
}

// ————————————————————————————————————————— In a flock

export type FlockMember = { id: string; first_name: string; again: number | null; age_group: string | null; intro: string | null; photo_id: string | null; times: number };

/** How many earlier flocks a member has been with: flocks whose event is over, and which they had not left before it
 * ended. Cancelled events do not count. */
const TIMES = `(SELECT COUNT(*) FROM flock_members x JOIN flocks y ON y.id = x.flock_id JOIN events z ON z.id = y.event_id
  WHERE x.member_id = m.id AND z.status <> 'cancelled' AND COALESCE(z.ends_at, z.starts_at + 10800000) < ?2
  AND (x.left_at IS NULL OR x.left_at >= COALESCE(z.ends_at, z.starts_at + 10800000)))`;

/** The first outings (flocks whose event has been held) are free; later this many lead to a paid membership. */
export const FREE_OUTINGS = 3;

/** How many outings the member has been on: flocks whose event is over and not cancelled, which they had not left
 * before it ended (the same count as "Har været med X gange"). */
export async function outingsUsed(db: D1Database, memberId: string, now: number): Promise<number> {
  const row = await db.prepare(`SELECT ${TIMES} AS times FROM members m WHERE m.id = ?1`).bind(memberId, now).first<{ times: number }>();
  return row?.times ?? 0;
}

/** The current members, in the order they joined, with what the others see about them. Only shown to members of the
 * flock. */
export async function flockMembers(db: D1Database, flockId: string, now: number): Promise<FlockMember[]> {
  const { results } = await db.prepare(`SELECT m.id, m.first_name, fm.again, m.age_group, m.intro, p.id AS photo_id, ${TIMES} AS times
    FROM flock_members fm JOIN members m ON m.id = fm.member_id LEFT JOIN member_photos p ON p.member_id = m.id
    WHERE fm.flock_id = ?1 AND fm.left_at IS NULL ORDER BY fm.joined_at`).bind(flockId, now).all<FlockMember>();
  return results;
}

/** The age groups in a flock, youngest first, without names: what someone deciding whether to join may see. */
export async function flockAgeGroups(db: D1Database, flockId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT DISTINCT m.age_group FROM flock_members fm JOIN members m ON m.id = fm.member_id
    WHERE fm.flock_id = ? AND fm.left_at IS NULL AND m.age_group IS NOT NULL ORDER BY m.age_group`).bind(flockId).all<{ age_group: string }>();
  return results.map(r => r.age_group);
}

/** A photo, for a viewer who is a current member of the flock, of someone who is too. */
export async function flockPhoto(db: D1Database, flockId: string, photoId: string, viewerId: string): Promise<Photo | null> {
  const row = await db.prepare(`SELECT p.type, p.data FROM member_photos p
    JOIN flock_members owner ON owner.member_id = p.member_id AND owner.flock_id = ?1 AND owner.left_at IS NULL
    JOIN flock_members viewer ON viewer.member_id = ?3 AND viewer.flock_id = ?1 AND viewer.left_at IS NULL
    WHERE p.id = ?2`).bind(flockId, photoId, viewerId).first<{ type: Photo["type"]; data: ArrayBuffer | Uint8Array | number[] }>();
  if (!row) return null;
  // D1 hands a BLOB back as an array of numbers; SQLite in the tests as a Uint8Array.
  return { type: row.type, data: new Uint8Array(row.data as ArrayLike<number>) };
}
