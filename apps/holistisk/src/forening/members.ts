import type { D1Database } from "../db.js";
import { currentMember, newCode, sha256 } from "../flokken/auth.js";
import type { PickRow } from "./store.js";

/** Samfolk's members and their sign-ups, by the rules decided (docs/decisions/0010-samfolk.md): only members with a
 * complete profile take part; the one who creates a tur sets its places and its deadline; places go first come, first
 * served, then an automatic waiting list in the same order; until the deadline a member can cancel, and the place goes
 * to the first on the waiting list; after it the list is locked. Membership is by the month or the year; paying opens
 * later. Columns named flokk_* are from an earlier version. */

export type Plan = "month" | "year";
export const PLANS: Record<Plan, { label: string; price: string }> = {
  month: { label: "Måned", price: "50 kr. om måneden" },
  year: { label: "År", price: "500 kr. om året" }
};

export type SamfolkMember = {
  id: string; first_name: string; email: string | null; flokk_joined_at: number | null; is_admin: number;
  interests: string | null; area: string | null; plan: Plan | null;
};
export type SignupStatus = "registered" | "waitlist" | "cancelled";

const MEMBER_COLUMNS = "id, first_name, email, flokk_joined_at, is_admin, interests, area, plan";

/** Sign-up and cancellation close at the deadline the creator set, else when the tur starts. */
export const closesAt = (p: Pick<PickRow, "starts_at" | "closes_at">) => p.closes_at ?? p.starts_at;
export const isOpen = (p: Pick<PickRow, "starts_at" | "closes_at" | "flokk_cancelled_at" | "status">, now: number) =>
  p.status === "approved" && !p.flokk_cancelled_at && now < closesAt(p);
/** A Samfolk member, or a volunteer (an admin may take part too). Members of the event portal are not. */
export const isSamfolkMember = (m: SamfolkMember | null): m is SamfolkMember => !!m && (!!m.flokk_joined_at || m.is_admin === 1);
/** Using the site – signing up, creating a tur – takes a complete profile: name, mail, interests, area and a membership. */
export const profileComplete = (m: SamfolkMember) => !!(m.first_name && m.email && m.interests && m.area && m.plan);
/** The one who created a tur, or a volunteer, may change and cancel it. */
export const mayManage = (m: SamfolkMember | null, p: Pick<PickRow, "created_by">) => !!m && (m.is_admin === 1 || (!!p.created_by && p.created_by === m.id));

export async function memberById(db: D1Database, id: string): Promise<SamfolkMember | null> {
  return db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`).bind(id).first<SamfolkMember>();
}

export async function currentSamfolkMember(db: D1Database, request: Request, now: number): Promise<SamfolkMember | null> {
  const session = await currentMember(db, request, now);
  return session ? memberById(db, session.id) : null;
}

export type ProfileFields = { first_name: string; email: string; interests: string; area: string; plan: Plan };

const emailTaken = async (db: D1Database, email: string, exceptId = "") =>
  !!(await db.prepare("SELECT 1 AS x FROM members WHERE email = ? AND id != ?").bind(email, exceptId).first());

/** A new member and the personal code they log in with (shown once). Null when the e-mail already has a profile. */
export async function joinSamfolk(db: D1Database, f: ProfileFields, now: number): Promise<{ member: SamfolkMember; code: string } | null> {
  const email = f.email.trim().toLowerCase();
  if (await emailTaken(db, email)) return null;
  const code = newCode();
  const member: SamfolkMember = { id: crypto.randomUUID(), first_name: f.first_name, email, flokk_joined_at: now, is_admin: 0, interests: f.interests, area: f.area, plan: f.plan };
  await db.prepare(`INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, email, flokk_joined_at, interests, area, plan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(member.id, member.first_name, await sha256(code), now, now, email, now, f.interests, f.area, f.plan).run();
  return { member, code };
}

/** Saves a member's profile. False when the e-mail belongs to another member. */
export async function updateProfile(db: D1Database, memberId: string, f: ProfileFields): Promise<boolean> {
  const email = f.email.trim().toLowerCase();
  if (await emailTaken(db, email, memberId)) return false;
  const before = await memberById(db, memberId);
  await db.batch([
    db.prepare("UPDATE members SET first_name = ?, email = ?, interests = ?, area = ?, plan = ? WHERE id = ?").bind(f.first_name, email, f.interests, f.area, f.plan, memberId),
    // A new e-mail keeps the letter going to the member.
    db.prepare("UPDATE newsletter SET email = ? WHERE member_id = ? AND email = ? AND NOT EXISTS (SELECT 1 FROM newsletter WHERE email = ?)").bind(email, memberId, before?.email ?? "", email)
  ]);
  return true;
}

/** A new code for a member who lost theirs (given out by a volunteer); the old code and every login stop working. */
export async function renewCode(db: D1Database, memberId: string): Promise<string> {
  const code = newCode();
  await db.batch([
    db.prepare("UPDATE members SET code_hash = ? WHERE id = ?").bind(await sha256(code), memberId),
    db.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(memberId)
  ]);
  return code;
}

// ————————————————————————————————————————— Sign-ups

export type Counts = { registered: number; waitlist: number };

export async function counts(db: D1Database, pickId: string): Promise<Counts> {
  const r = await db.prepare(`SELECT SUM(status = 'registered') AS registered, SUM(status = 'waitlist') AS waitlist FROM signups WHERE pick_id = ?`)
    .bind(pickId).first<{ registered: number | null; waitlist: number | null }>();
  return { registered: r?.registered ?? 0, waitlist: r?.waitlist ?? 0 };
}

export type MySignup = { status: SignupStatus; queued_at: number; position: number | null };

/** A member's line for a tur; for the waiting list, their place in it (1 = next). */
export async function mySignup(db: D1Database, pickId: string, memberId: string): Promise<MySignup | null> {
  const r = await db.prepare(`SELECT s.status, s.queued_at,
      CASE WHEN s.status = 'waitlist' THEN (SELECT COUNT(*) FROM signups w WHERE w.pick_id = s.pick_id AND w.status = 'waitlist' AND w.queued_at <= s.queued_at) END AS position
    FROM signups s WHERE s.pick_id = ? AND s.member_id = ?`).bind(pickId, memberId).first<{ status: SignupStatus; queued_at: number; position: number | null }>();
  return r ?? null;
}

export type SignupResult = { ok: SignupStatus } | { error: "closed" | "cancelled" | "not_member" | "profile" };

/** Signs a member up: a place if there is one, else the waiting list. Decided in one statement, so two people
 * signing up at once cannot both take the last place. Signing up again after cancelling joins the back of the queue. */
export async function signUp(db: D1Database, pick: PickRow, member: SamfolkMember | null, now: number): Promise<SignupResult> {
  if (!isSamfolkMember(member)) return { error: "not_member" };
  if (!profileComplete(member)) return { error: "profile" };
  if (pick.flokk_cancelled_at) return { error: "cancelled" };
  if (!isOpen(pick, now)) return { error: "closed" };
  const existing = await mySignup(db, pick.id, member.id);
  if (existing && existing.status !== "cancelled") return { ok: existing.status };
  const status = `CASE WHEN (SELECT places FROM picks WHERE id = ?1) IS NULL
      OR (SELECT COUNT(*) FROM signups WHERE pick_id = ?1 AND status = 'registered') < (SELECT places FROM picks WHERE id = ?1)
      THEN 'registered' ELSE 'waitlist' END`;
  await db.prepare(`INSERT INTO signups (id, pick_id, member_id, status, queued_at, updated_at) VALUES (?3, ?1, ?2, ${status}, ?4, ?4)
    ON CONFLICT(pick_id, member_id) DO UPDATE SET status = ${status}, queued_at = ?4, updated_at = ?4`)
    .bind(pick.id, member.id, crypto.randomUUID(), now).run();
  return { ok: (await mySignup(db, pick.id, member.id))!.status };
}

/** Moves people from the waiting list into free places, first come first – only while sign-up is open. */
export async function fillFromWaitlist(db: D1Database, pick: PickRow, now: number): Promise<void> {
  if (!isOpen(pick, now)) return;
  await db.prepare(`UPDATE signups SET status = 'registered', updated_at = ?2 WHERE id IN (
      SELECT id FROM signups WHERE pick_id = ?1 AND status = 'waitlist' ORDER BY queued_at
      LIMIT MAX(0, COALESCE((SELECT places FROM picks WHERE id = ?1), 1000000) - (SELECT COUNT(*) FROM signups WHERE pick_id = ?1 AND status = 'registered')))`)
    .bind(pick.id, now).run();
}

/** A cancellation before the deadline: the place goes to the waiting list. */
export async function cancelSignup(db: D1Database, pick: PickRow, memberId: string, now: number): Promise<{ ok: true } | { error: "closed" }> {
  if (!isOpen(pick, now)) return { error: "closed" };
  await db.prepare("UPDATE signups SET status = 'cancelled', updated_at = ? WHERE pick_id = ? AND member_id = ? AND status != 'cancelled'").bind(now, pick.id, memberId).run();
  await fillFromWaitlist(db, pick, now);
  return { ok: true };
}

export type MemberSignup = PickRow & { signup_status: SignupStatus; position: number | null; registered: number };

/** A member's ture, coming first. */
export async function memberSignups(db: D1Database, memberId: string, now: number): Promise<MemberSignup[]> {
  const { results } = await db.prepare(`SELECT p.*, s.status AS signup_status,
      CASE WHEN s.status = 'waitlist' THEN (SELECT COUNT(*) FROM signups w WHERE w.pick_id = s.pick_id AND w.status = 'waitlist' AND w.queued_at <= s.queued_at) END AS position,
      (SELECT COUNT(*) FROM signups r WHERE r.pick_id = p.id AND r.status = 'registered') AS registered
    FROM signups s JOIN picks p ON p.id = s.pick_id
    WHERE s.member_id = ? AND COALESCE(p.ends_at, p.starts_at + 10800000) >= ?
    ORDER BY p.starts_at`).bind(memberId, now - 86_400_000).all<MemberSignup>();
  return results;
}

/** The first names of those with a place on a tur, in sign-up order. */
export async function flockFirstNames(db: D1Database, pickId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT m.first_name FROM signups s JOIN members m ON m.id = s.member_id
    WHERE s.pick_id = ? AND s.status = 'registered' ORDER BY s.queued_at`).bind(pickId).all<{ first_name: string }>();
  return results.map(r => r.first_name);
}

export type Participant = { member_id: string; first_name: string; email: string | null; status: SignupStatus; queued_at: number; updated_at: number };

export async function participants(db: D1Database, pickId: string): Promise<Participant[]> {
  const { results } = await db.prepare(`SELECT s.member_id, m.first_name, m.email, s.status, s.queued_at, s.updated_at FROM signups s
    JOIN members m ON m.id = s.member_id WHERE s.pick_id = ? ORDER BY CASE s.status WHEN 'registered' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END, s.queued_at`)
    .bind(pickId).all<Participant>();
  return results;
}

/** A tur is cancelled: recorded on it; the sign-ups stay, so members see what happened. */
export async function cancelTur(db: D1Database, pickId: string, now: number): Promise<void> {
  await db.prepare("UPDATE picks SET flokk_cancelled_at = ?, updated_at = ? WHERE id = ? AND flokk_cancelled_at IS NULL").bind(now, now, pickId).run();
}

/** A member leaves Samfolk: their profile, sign-ups and letter are deleted, places they held before a deadline go on,
 * and coming ture they created are cancelled, so those signed up can see it. */
export async function leaveSamfolk(db: D1Database, member: SamfolkMember, now: number): Promise<void> {
  const open = (await memberSignups(db, member.id, now)).filter(s => s.signup_status === "registered" && isOpen(s, now));
  await db.batch([
    db.prepare("UPDATE picks SET flokk_cancelled_at = ?1, updated_at = ?1 WHERE created_by = ?2 AND flokk_cancelled_at IS NULL AND starts_at > ?1").bind(now, member.id),
    db.prepare("DELETE FROM newsletter WHERE member_id = ? OR email = ?").bind(member.id, member.email ?? ""),
    db.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(member.id),
    db.prepare("DELETE FROM signups WHERE member_id = ?").bind(member.id),
    db.prepare("DELETE FROM members WHERE id = ?").bind(member.id)
  ]);
  for (const pick of open) await fillFromWaitlist(db, pick, now);
}

export async function listMembers(db: D1Database): Promise<Array<SamfolkMember & { signups: number; created: number }>> {
  const { results } = await db.prepare(`SELECT ${MEMBER_COLUMNS.split(", ").map(c => `m.${c}`).join(", ")},
      (SELECT COUNT(*) FROM signups s WHERE s.member_id = m.id AND s.status != 'cancelled') AS signups,
      (SELECT COUNT(*) FROM picks p WHERE p.created_by = m.id) AS created
    FROM members m WHERE m.flokk_joined_at IS NOT NULL OR m.is_admin = 1 ORDER BY m.flokk_joined_at DESC LIMIT 2000`).all<SamfolkMember & { signups: number; created: number }>();
  return results;
}

/** Sign-up numbers for several ture at once (the lists and the overviews). */
export async function countsFor(db: D1Database, pickIds: string[]): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>();
  if (!pickIds.length) return map;
  const { results } = await db.prepare(`SELECT pick_id, SUM(status = 'registered') AS registered, SUM(status = 'waitlist') AS waitlist FROM signups
    WHERE pick_id IN (${pickIds.map(() => "?").join(",")}) GROUP BY pick_id`).bind(...pickIds).all<{ pick_id: string; registered: number; waitlist: number }>();
  for (const r of results) map.set(r.pick_id, { registered: r.registered ?? 0, waitlist: r.waitlist ?? 0 });
  return map;
}
