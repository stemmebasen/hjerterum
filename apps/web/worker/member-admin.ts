import type { D1Database } from "./db.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { membershipPlan, membershipPlans } from "../membership.js";
import { parseCsv } from "../src/csv.js";

/** Requested: "Hvad med "Medlemmer"-sektion i admin, hvor vi kan se medlemmer, profilinfo, status og historik?" -
 * "Husk den skal lægge sig op ad hvad MembershipWorks gør med medlemmer" (membership and billing, contact, timeline,
 * and the events a member has created) - "vi skal kun fokusere på vores eget systems medlemmer". The data behind
 * admin → Medlemmer (cockpit/memberPages.ts): the platform's own members, their timeline (written by Stripe's webhooks
 * in members.ts and by the board's actions here), and MembershipWorks' account export kept for reference: "Det er godt
 * at have dette liggende, når og hvis medlemmet vælger at oprette sig i vores nye system. Indtil da fortsætter de blot
 * i MW". The export gives no one access. */

export type AdminMember = {
  id: number; clerkUserId: string; fullName: string; email: string; phone: string | null; streetAddress: string | null;
  tier: string; interval: string; status: string; billing: "stripe" | "manual"; statusSinceMs: number | null; joinedOn: string | null;
  createdAtMs: number; isTeacher: boolean; accessBlocked: boolean; membershipworksId: string | null;
  stripeCustomerId: string; stripeSubscriptionId: string | null;
  /** Imported on the day of the switch: still charged by MembershipWorks until the platform takes over, on nextChargeOn. */
  paysInMembershipworks: boolean; nextChargeOn: string | null; awaitingLogin: boolean;
};

type MemberRow = {
  id: number; clerk_user_id: string; full_name: string; email: string; phone: string | null; street_address: string | null; tier: string; interval: string;
  status: string; billing: string; status_since_ms: number | null; joined_on: string | null; created_at_ms: number; is_teacher: number; access_blocked: number;
  membershipworks_id: string | null; stripe_customer_id: string; stripe_subscription_id: string | null; pays_in_membershipworks: number; next_charge_on: string | null;
};

const COLUMNS = `id, clerk_user_id, full_name, email, phone, street_address, tier, interval, status, billing, status_since_ms, joined_on, created_at_ms,
  is_teacher, access_blocked, membershipworks_id, stripe_customer_id, stripe_subscription_id, pays_in_membershipworks, next_charge_on`;

const member = (r: MemberRow): AdminMember => ({
  id: r.id, clerkUserId: r.clerk_user_id, fullName: r.full_name, email: r.email, phone: r.phone, streetAddress: r.street_address, tier: r.tier,
  interval: r.interval, status: r.status, billing: r.billing === "manual" ? "manual" : "stripe", statusSinceMs: r.status_since_ms, joinedOn: r.joined_on,
  createdAtMs: r.created_at_ms, isTeacher: r.is_teacher === 1, accessBlocked: r.access_blocked === 1, membershipworksId: r.membershipworks_id,
  stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id,
  paysInMembershipworks: r.pays_in_membershipworks === 1, nextChargeOn: r.next_charge_on, awaitingLogin: r.clerk_user_id.startsWith("pending:")
});

export const STATUS_FILTERS = ["alle", "aktive", "restance", "opsagt"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
const FILTER_SQL: Record<StatusFilter, string> = { alle: "", aktive: " AND status = 'active'", restance: " AND status = 'past_due'", opsagt: " AND status IN ('canceled', 'incomplete')" };

export async function listMembers(db: D1Database, q: string, filter: StatusFilter): Promise<AdminMember[]> {
  const like = `%${q.trim().toLowerCase().replace(/[%_]/g, "")}%`;
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM members WHERE (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)${FILTER_SQL[filter]}
    ORDER BY full_name COLLATE NOCASE LIMIT 1000`).bind(like, like).all<MemberRow>();
  return (results ?? []).map(member);
}

export async function memberCounts(db: D1Database, now: number): Promise<{ active: number; pastDue: number; ended: number; newLast30: number }> {
  const row = await db.prepare(`SELECT SUM(status = 'active') AS active, SUM(status = 'past_due') AS pastDue, SUM(status IN ('canceled', 'incomplete')) AS ended,
    SUM(created_at_ms >= ?) AS newLast30 FROM members`).bind(now - 30 * 86_400_000).first<Record<string, number | null>>();
  return { active: Number(row?.active ?? 0), pastDue: Number(row?.pastDue ?? 0), ended: Number(row?.ended ?? 0), newLast30: Number(row?.newLast30 ?? 0) };
}

export async function memberById(db: D1Database, id: number): Promise<AdminMember | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM members WHERE id = ?`).bind(id).first<MemberRow>();
  return row ? member(row) : null;
}

export type TimelineKind = "joined" | "granted" | "moved" | "payment" | "payment_failed" | "status" | "plan" | "cancelled" | "ended" | "reactivated" | "note";
export type TimelineEntry = { atMs: number; kind: TimelineKind | "access" | "registered" | "created"; title: string; amountMinor: number | null; detail: string | null; by: string | null };

/** One line on a member's timeline; a Stripe event id keeps a webhook delivered twice to one line. */
export async function recordTimeline(db: D1Database, memberId: number, entry: { atMs: number; kind: TimelineKind; title: string; amountMinor?: number | null; detail?: string | null; by?: string | null }, sourceEventId: string | null = null): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO member_timeline (member_id, at_ms, kind, title, amount_minor, detail, by_name, source_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(memberId, entry.atMs, entry.kind, entry.title.slice(0, 200), entry.amountMinor ?? null, entry.detail?.slice(0, 2000) ?? null, entry.by?.slice(0, 120) ?? null, sourceEventId).run();
}

const TIME = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

/** The member's history, newest first: the timeline, access changes, and the events they signed up for or created here. */
export async function memberTimeline(db: D1Database, m: AdminMember): Promise<TimelineEntry[]> {
  const [own, access, registered, created] = await Promise.all([
    db.prepare("SELECT at_ms, kind, title, amount_minor, detail, by_name FROM member_timeline WHERE member_id = ? ORDER BY at_ms DESC, id DESC LIMIT 500").bind(m.id)
      .all<{ at_ms: number; kind: TimelineKind; title: string; amount_minor: number | null; detail: string | null; by_name: string | null }>(),
    db.prepare("SELECT blocked, changed_by_email, changed_at_ms FROM member_access_changes WHERE source = 'hjerterum' AND source_member_id = ?").bind(m.id)
      .all<{ blocked: number; changed_by_email: string; changed_at_ms: number }>(),
    db.prepare(`SELECT a.created_at_ms, a.registration_status, a.ticket_amount_minor, b.title, b.starts_at_ms FROM room_booking_attendees a JOIN room_bookings b ON b.id = a.room_booking_id
      WHERE a.clerk_user_id = ?`).bind(m.clerkUserId).all<{ created_at_ms: number; registration_status: string; ticket_amount_minor: number; title: string; starts_at_ms: number }>(),
    db.prepare("SELECT created_at_ms, title, starts_at_ms, status FROM room_bookings WHERE clerk_user_id = ?").bind(m.clerkUserId)
      .all<{ created_at_ms: number; title: string; starts_at_ms: number; status: string }>()
  ]);
  const entries: TimelineEntry[] = [
    ...(own.results ?? []).map(r => ({ atMs: r.at_ms, kind: r.kind, title: r.title, amountMinor: r.amount_minor, detail: r.detail, by: r.by_name })),
    ...(access.results ?? []).map(r => ({ atMs: r.changed_at_ms, kind: "access" as const, title: r.blocked ? "Adgang blokeret" : "Adgang genåbnet", amountMinor: null, detail: null, by: r.changed_by_email })),
    ...(registered.results ?? []).map(r => ({ atMs: r.created_at_ms, kind: "registered" as const, title: r.registration_status === "cancelled" ? "Tilmelding annulleret" : "Tilmeldt event",
      amountMinor: r.ticket_amount_minor || null, detail: `${r.title} (${TIME.format(r.starts_at_ms)})`, by: null })),
    ...(created.results ?? []).map(r => ({ atMs: r.created_at_ms, kind: "created" as const, title: r.status === "cancelled" ? "Oprettede event (aflyst)" : "Oprettede event",
      amountMinor: null, detail: `${r.title} (${TIME.format(r.starts_at_ms)})`, by: null }))
  ];
  // A member from before the timeline: when they joined is still a line.
  if (!entries.some(e => e.kind === "joined" || e.kind === "granted")) entries.push({ atMs: m.createdAtMs, kind: "joined", title: "Blev medlem", amountMinor: null, detail: membershipPlan(m.tier)?.name ?? m.tier, by: null });
  return entries.sort((a, b) => b.atMs - a.atMs);
}

export type MemberEvent = { title: string; startsAtMs: number; where: "nyt system" | "kalender"; status: string | null };

/** "Herudover en oversigt over events medlemmet har oprettet": what they created here and what the calendar names them host of,
 * and what they signed up for. */
export async function memberEvents(db: D1Database, m: AdminMember): Promise<{ created: MemberEvent[]; registered: MemberEvent[] }> {
  const [bookings, calendar, registered] = await Promise.all([
    db.prepare("SELECT title, starts_at_ms, status FROM room_bookings WHERE clerk_user_id = ? OR LOWER(teacher_email) = LOWER(?) ORDER BY starts_at_ms DESC LIMIT 200")
      .bind(m.clerkUserId, m.email).all<{ title: string; starts_at_ms: number; status: string }>(),
    db.prepare("SELECT title, starts_at_ms FROM house_events WHERE LOWER(TRIM(host)) = LOWER(?) AND removed_at_ms IS NULL ORDER BY starts_at_ms DESC LIMIT 200")
      .bind(m.fullName.trim()).all<{ title: string; starts_at_ms: number }>(),
    db.prepare(`SELECT b.title, b.starts_at_ms, a.registration_status FROM room_booking_attendees a JOIN room_bookings b ON b.id = a.room_booking_id
      WHERE a.clerk_user_id = ? ORDER BY b.starts_at_ms DESC LIMIT 200`).bind(m.clerkUserId).all<{ title: string; starts_at_ms: number; registration_status: string }>()
  ]);
  return {
    created: [...(bookings.results ?? []).map(r => ({ title: r.title, startsAtMs: r.starts_at_ms, where: "nyt system" as const, status: r.status })),
      ...(calendar.results ?? []).map(r => ({ title: r.title, startsAtMs: r.starts_at_ms, where: "kalender" as const, status: null }))].sort((a, b) => b.startsAtMs - a.startsAtMs),
    registered: (registered.results ?? []).map(r => ({ title: r.title, startsAtMs: r.starts_at_ms, where: "nyt system" as const, status: r.registration_status }))
  };
}

const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const isoDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DAY.format(new Date(`${iso}T12:00:00Z`)) : iso;
export const planName = (tier: string) => tier === FREE_TIER ? "Gratis medlemskab" : membershipPlan(tier)?.name ?? tier;
/** MembershipWorks' "Free Membership", carried over as it is. */
export const FREE_TIER = "gratis";

/** As MembershipWorks says it: "Aktiv", "I restance 35 dage", "Opsagt". */
export function statusText(m: Pick<AdminMember, "status" | "statusSinceMs">, now: number): string {
  if (m.status === "active") return "Aktiv";
  if (m.status === "past_due") return m.statusSinceMs ? `I restance ${Math.max(0, Math.floor((now - m.statusSinceMs) / 86_400_000))} dage` : "I restance";
  if (m.status === "canceled") return "Opsagt";
  if (m.status === "incomplete") return "Ikke gennemført";
  return m.status;
}

// ------------------------------------------------------------------ Giving a membership (MembershipWorks' "Manual Billing")

async function clerkUserByEmail(env: SagaEnv, deps: SagaDeps, email: string): Promise<{ id: string; name: string } | null> {
  if (!env.CLERK_SECRET_KEY) throw new Error("clerk_not_configured");
  const response = await deps.fetcher(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=1`, {
    headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, accept: "application/json" } });
  if (!response.ok) throw new Error("clerk_lookup_failed");
  type ClerkUser = { id?: unknown; first_name?: unknown; last_name?: unknown; email_addresses?: Array<{ email_address?: unknown; verification?: { status?: unknown } | null }> };
  const users = await response.json().catch(() => []) as ClerkUser[];
  // Only a login whose address is verified: an abandoned sign-up with someone else's address never gets their membership.
  const user = (Array.isArray(users) ? users : []).find(u => (u.email_addresses ?? []).some(e => typeof e.email_address === "string" && e.email_address.toLowerCase() === email && e.verification?.status === "verified"));
  if (!user || typeof user.id !== "string") return null;
  return { id: user.id, name: [user.first_name, user.last_name].filter(v => typeof v === "string" && v.trim()).join(" ").trim() };
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The board gives a person a membership with no payment here, as MembershipWorks' manual billing. The person must have
 * logged in at the member area once (their login is what the membership is tied to). */
export async function grantMembership(db: D1Database, env: SagaEnv, deps: SagaDeps, input: { email: string; tier: string; note: string; by: string }): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("invalid_email");
  if (!Object.prototype.hasOwnProperty.call(membershipPlans, input.tier)) throw new Error("invalid_tier");
  const user = await clerkUserByEmail(env, deps, email);
  if (!user) throw new Error("no_account");
  const now = deps.now();
  const existing = await db.prepare(`SELECT ${COLUMNS} FROM members WHERE clerk_user_id = ?`).bind(user.id).first<MemberRow>();
  let id: number;
  if (existing) {
    if (existing.status === "active") throw new Error("already_member");
    await db.prepare("UPDATE members SET tier = ?, interval = 'none', status = 'active', billing = 'manual', status_since_ms = ?, updated_at_ms = ? WHERE id = ?")
      .bind(input.tier, now, now, existing.id).run();
    id = existing.id;
    await recordTimeline(db, id, { atMs: now, kind: "reactivated", title: `Medlemskab givet igen: ${planName(input.tier)}`, detail: input.note || null, by: input.by });
  } else {
    const account = await db.prepare("SELECT full_name FROM membershipworks_accounts WHERE email = ?").bind(email).first<{ full_name: string }>();
    const inserted = await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms, billing, status_since_ms, joined_on)
      VALUES (?, ?, ?, 'none', 'active', ?, ?, ?, ?, 'manual', ?, ?)`)
      .bind(user.id, `manual:${user.id}`, input.tier, user.name || account?.full_name || email.split("@")[0], email, now, now, now, copenhagenDay(now)).run();
    id = Number(inserted.meta?.last_row_id);
    await recordTimeline(db, id, { atMs: now, kind: "granted", title: `Medlemskab givet: ${planName(input.tier)}`, detail: input.note || "Manuel betaling: ingen betaling via kort.", by: input.by });
  }
  await linkMembershipWorks(db, id, now);
  return id;
}

/** Only for a membership the board gave: another kind of membership, ending it, or giving it back. */
export async function changeManualMembership(db: D1Database, id: number, action: { kind: "plan"; tier: string } | { kind: "end" } | { kind: "reactivate" }, by: string, now: number): Promise<void> {
  const m = await memberById(db, id);
  if (!m) throw new Error("member_not_found");
  if (m.billing !== "manual") throw new Error("not_manual");
  if (action.kind === "plan") {
    if (!Object.prototype.hasOwnProperty.call(membershipPlans, action.tier) || action.tier === m.tier) return;
    await db.prepare("UPDATE members SET tier = ?, updated_at_ms = ? WHERE id = ?").bind(action.tier, now, id).run();
    await recordTimeline(db, id, { atMs: now, kind: "plan", title: `Medlemskab ændret: ${planName(m.tier)} → ${planName(action.tier)}`, by });
  } else if (action.kind === "end") {
    if (m.status !== "active") return;
    await db.prepare("UPDATE members SET status = 'canceled', status_since_ms = ?, updated_at_ms = ? WHERE id = ?").bind(now, now, id).run();
    await recordTimeline(db, id, { atMs: now, kind: "ended", title: "Medlemskab afsluttet", by });
  } else {
    if (m.status === "active") return;
    await db.prepare("UPDATE members SET status = 'active', status_since_ms = ?, updated_at_ms = ? WHERE id = ?").bind(now, now, id).run();
    await recordTimeline(db, id, { atMs: now, kind: "reactivated", title: "Medlemskab genaktiveret", by });
  }
}

export async function addNote(db: D1Database, id: number, text: string, by: string, now: number): Promise<void> {
  const note = text.replace(/\r\n?/g, "\n").trim().slice(0, 2000);
  if (!note || !(await memberById(db, id))) return;
  await recordTimeline(db, id, { atMs: now, kind: "note", title: "Note", detail: note, by });
}

// ------------------------------------------------------------------ MembershipWorks' account export, for reference

export type MembershipWorksAccount = {
  email: string; accountId: string | null; fullName: string; phone: string | null; plan: string | null; tier: string | null;
  interval: "month" | "year" | null; billing: "auto" | "manual" | null; joinedOn: string | null; renewsOn: string | null;
  stripeCustomerId: string | null; labels: string[];
};

/** MembershipWorks writes its labels as columns: a member's membership and labels ("Teacher", "Hjerterum Team") are the
 * columns that have a value. The rest are the account's fields. */
const FIELDS = new Set(["Admin note", "Position/relation", "Account Name", "First Name", "Last Name", "Contact Person", "Address (Full)", "Address (Street)", "Address (City)",
  "Address (State/Province)", "Address (Postal Code)", "Address (Country)", "Address (Autocorrect)", "Email", "Telephone", "Join Date", "Renewal Date", "Billing Method",
  "Auto Billing ID", "Account ID", "Parent Account ID"]);
const PEOPLE_LABELS = /teacher|team/i;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Sep 20, 2026" (as MembershipWorks exports dates) or an ISO date. */
export function exportDay(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(v);
  const month = m ? MONTHS[m[1]!.toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

export function tierOf(plan: string): string | null {
  if (/free|gratis/i.test(plan)) return null;
  if (/reduc/i.test(plan)) return "reduceret";
  if (/support/i.test(plan)) return "support";
  if (/gener/i.test(plan)) return "generoest";
  if (/standard|almindelig|regular/i.test(plan)) return "standard";
  return null;
}

export function readMembershipWorksExport(text: string): { accounts: MembershipWorksAccount[]; skipped: number } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const accounts = new Map<string, MembershipWorksAccount>();
  let skipped = 0;
  for (const row of rows) {
    const value = (name: string) => (row[name] ?? "").trim();
    const email = value("Email").toLowerCase();
    if (!EMAIL.test(email) || accounts.has(email)) { skipped += 1; continue; }
    const labels = Object.keys(row).filter(name => !FIELDS.has(name) && value(name));
    const plan = labels.find(label => !PEOPLE_LABELS.test(label)) ?? null;
    const billingMethod = value("Billing Method");
    const autoBillingId = value("Auto Billing ID");
    accounts.set(email, {
      email, accountId: value("Account ID") || null, fullName: (value("Account Name") || [value("First Name"), value("Last Name")].filter(Boolean).join(" ") || email).slice(0, 160),
      phone: value("Telephone").slice(0, 40) || null, plan: plan?.replace(/^-\s*/, "").slice(0, 200) ?? null, tier: plan ? tierOf(plan) : null,
      interval: /årlig|yearly|annual/i.test(billingMethod) ? "year" : /månedlig|monthly/i.test(billingMethod) ? "month" : null,
      billing: /manual/i.test(billingMethod) ? "manual" : billingMethod ? "auto" : null,
      joinedOn: exportDay(value("Join Date")), renewsOn: exportDay(value("Renewal Date")),
      stripeCustomerId: /^cus_[A-Za-z0-9]+$/.test(autoBillingId) ? autoBillingId : null, labels: labels.filter(label => PEOPLE_LABELS.test(label))
    });
  }
  return { accounts: [...accounts.values()], skipped };
}

/** Keeps the export (the newest file wins for each email) and links the platform's members who are in it. */
export async function saveMembershipWorksExport(db: D1Database, filename: string, by: string, text: string, now: number): Promise<{ accounts: number; skipped: number; linked: number }> {
  const { accounts, skipped } = readMembershipWorksExport(text);
  if (!accounts.length) throw new Error("no_accounts");
  const upload = await db.prepare("INSERT INTO membershipworks_uploads (filename, uploaded_by, accounts, uploaded_at_ms) VALUES (?, ?, ?, ?)")
    .bind(filename.slice(0, 200), by, accounts.length, now).run();
  const uploadId = Number(upload.meta?.last_row_id);
  for (const a of accounts) {
    const rowJson = JSON.stringify({ ...a });
    await db.prepare(`INSERT INTO membershipworks_accounts (email, account_id, full_name, phone, plan, tier, interval, billing, joined_on, renews_on, stripe_customer_id, labels, row_json, upload_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET account_id = excluded.account_id, full_name = excluded.full_name, phone = excluded.phone,
      plan = excluded.plan, tier = excluded.tier, interval = excluded.interval, billing = excluded.billing, joined_on = excluded.joined_on, renews_on = excluded.renews_on,
      stripe_customer_id = excluded.stripe_customer_id, labels = excluded.labels, row_json = excluded.row_json, upload_id = excluded.upload_id`)
      .bind(a.email, a.accountId, a.fullName, a.phone, a.plan, a.tier, a.interval, a.billing, a.joinedOn, a.renewsOn, a.stripeCustomerId, JSON.stringify(a.labels), rowJson, uploadId).run();
  }
  const { results } = await db.prepare("SELECT m.id FROM members m JOIN membershipworks_accounts a ON a.email = LOWER(m.email) WHERE m.membershipworks_id IS NULL").all<{ id: number }>();
  for (const r of results ?? []) await linkMembershipWorks(db, r.id, now);
  return { accounts: accounts.length, skipped, linked: (results ?? []).length };
}

type AccountRow = { email: string; account_id: string | null; full_name: string; phone: string | null; plan: string | null; tier: string | null; interval: string | null;
  billing: string | null; joined_on: string | null; renews_on: string | null; stripe_customer_id: string | null; labels: string; upload_id: number };

const account = (r: AccountRow): MembershipWorksAccount => ({ email: r.email, accountId: r.account_id, fullName: r.full_name, phone: r.phone, plan: r.plan, tier: r.tier,
  interval: r.interval === "month" || r.interval === "year" ? r.interval : null, billing: r.billing === "auto" || r.billing === "manual" ? r.billing : null,
  joinedOn: r.joined_on, renewsOn: r.renews_on, stripeCustomerId: r.stripe_customer_id, labels: (() => { try { return JSON.parse(r.labels) as string[]; } catch { return []; } })() });

export async function membershipWorksAccount(db: D1Database, email: string): Promise<MembershipWorksAccount | null> {
  const row = await db.prepare("SELECT * FROM membershipworks_accounts WHERE email = ?").bind(email.trim().toLowerCase()).first<AccountRow>();
  return row ? account(row) : null;
}

export async function membershipWorksSummary(db: D1Database): Promise<{ accounts: number; linked: number; latest: { filename: string; by: string; atMs: number } | null }> {
  const [count, linked, latest] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM membershipworks_accounts").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM members WHERE membershipworks_id IS NOT NULL").first<{ n: number }>(),
    db.prepare("SELECT filename, uploaded_by, uploaded_at_ms FROM membershipworks_uploads ORDER BY id DESC LIMIT 1").first<{ filename: string; uploaded_by: string; uploaded_at_ms: number }>()
  ]);
  return { accounts: Number(count?.n ?? 0), linked: Number(linked?.n ?? 0), latest: latest ? { filename: latest.filename, by: latest.uploaded_by, atMs: latest.uploaded_at_ms } : null };
}

/** When a person in MembershipWorks becomes a member here: member since their first membership, their phone and their
 * teacher label carried over, and the board reminded to stop the payment in MembershipWorks. */
export async function linkMembershipWorks(db: D1Database, memberId: number, now: number): Promise<void> {
  const m = await memberById(db, memberId);
  if (!m || m.membershipworksId) return;
  const a = await membershipWorksAccount(db, m.email);
  if (!a) return;
  const joinedOn = a.joinedOn && (!m.joinedOn || a.joinedOn < m.joinedOn) ? a.joinedOn : m.joinedOn;
  await db.prepare("UPDATE members SET membershipworks_id = ?, joined_on = ?, phone = COALESCE(phone, ?), is_teacher = MAX(is_teacher, ?) WHERE id = ?")
    .bind(a.accountId ?? a.email, joinedOn, a.phone, a.labels.some(l => /teacher/i.test(l)) ? 1 : 0, memberId).run();
  const stillPaying = a.billing === "auto" && a.renewsOn !== null && a.renewsOn >= copenhagenDay(now);
  await recordTimeline(db, memberId, { atMs: now, kind: "moved", title: "Fundet i MembershipWorks",
    detail: [a.plan, a.joinedOn ? `medlem siden ${isoDay(a.joinedOn)}` : "", stillPaying ? `betaler stadig i MembershipWorks (næste træk ${isoDay(a.renewsOn!)}) - stop betalingen dér` : ""].filter(Boolean).join(" · ") || null });
}

// ------------------------------------------------------------------ The switch: MembershipWorks' members become the platform's

/** Requested: "det er meningen at vi ved turnover importerer alle medlemmer og fra den dato begynder at trække kontingent over
 * vores nye system". What happens to each account in the export on the day of the switch. Charging through the platform's
 * Stripe comes later ("Spørg mig når vi kommer dertil"); until then their payment runs on in MembershipWorks. */
export type TurnoverGroup = "kort" | "manuel" | "gratis" | "restance" | "medlem" | "springes";
export type TurnoverRow = MembershipWorksAccount & { group: TurnoverGroup; reason: string | null };

export async function turnoverPlan(db: D1Database, today: string): Promise<TurnoverRow[]> {
  const [{ results: accounts }, { results: members }] = await Promise.all([
    db.prepare("SELECT * FROM membershipworks_accounts ORDER BY full_name COLLATE NOCASE").all<AccountRow>(),
    db.prepare("SELECT LOWER(email) AS email FROM members").all<{ email: string }>()
  ]);
  const already = new Set((members ?? []).map(m => m.email));
  return (accounts ?? []).map(account).map(a => {
    const free = /free|gratis/i.test(a.plan ?? "");
    const group: TurnoverGroup = already.has(a.email) ? "medlem"
      : !a.tier && !free ? "springes"
      : a.renewsOn !== null && a.renewsOn < today && !free ? "restance"
      : free ? "gratis"
      : a.billing === "auto" && a.stripeCustomerId ? "kort" : "manuel";
    const reason = group === "medlem" ? "Er allerede medlem i det nye system" : group === "springes" ? (a.plan ? `Ukendt medlemskab: ${a.plan}` : "Intet medlemskab i MembershipWorks") : null;
    return { ...a, group, reason };
  });
}

/** On the day of the switch: every account that can be carried over becomes a member here, with their membership, interval,
 * member since, phone and teacher label. They log in with their email; nothing is charged here, and a card member's
 * payment runs on in MembershipWorks until the platform takes over on their renewal date. Running it again adds only
 * the new ones. */
export async function importTurnover(db: D1Database, by: string, now: number): Promise<{ imported: number; skipped: number }> {
  const today = copenhagenDay(now);
  const plan = await turnoverPlan(db, today);
  let imported = 0;
  for (const a of plan) {
    if (a.group === "medlem" || a.group === "springes") continue;
    const tier = a.group === "gratis" ? FREE_TIER : a.tier!;
    const pastDue = a.group === "restance";
    const inserted = await db.prepare(`INSERT OR IGNORE INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, phone, is_teacher,
      created_at_ms, updated_at_ms, billing, status_since_ms, joined_on, membershipworks_id, pays_in_membershipworks, next_charge_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`)
      .bind(`pending:${a.email}`, a.stripeCustomerId ?? `pending:${a.email}`, tier, a.interval ?? "none", pastDue ? "past_due" : "active", a.fullName, a.email, a.phone,
        a.labels.some(l => /teacher/i.test(l)) ? 1 : 0, now, now, pastDue && a.renewsOn ? Date.parse(`${a.renewsOn}T12:00:00Z`) : now, a.joinedOn ?? today,
        a.accountId ?? a.email, a.group === "kort" ? 1 : 0, a.group === "kort" ? a.renewsOn : null).run();
    const id = Number(inserted.meta?.last_row_id);
    if (!inserted.meta?.changes || !id) continue;
    imported += 1;
    await recordTimeline(db, id, { atMs: now, kind: "moved", title: "Flyttet fra MembershipWorks", by,
      detail: [a.plan, a.joinedOn ? `medlem siden ${isoDay(a.joinedOn)}` : "", a.group === "kort" && a.renewsOn ? `betaler via MembershipWorks indtil ${isoDay(a.renewsOn)}` : "",
        pastDue && a.renewsOn ? `i restance siden ${isoDay(a.renewsOn)}` : ""].filter(Boolean).join(" · ") || null });
  }
  return { imported, skipped: plan.filter(a => a.group === "springes").length };
}
