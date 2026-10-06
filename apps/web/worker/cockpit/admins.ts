import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { boardMembers } from "./data.js";
import { MEMBER_PAGES_STYLE } from "./memberPages.js";
import { esc, layout } from "./page.js";

/** Requested by the chair, as super admin: "what active admin members are there". Two doors lead into the admin: the board's
 * cockpit (everyone who has written in the board's group; a personal login link from Saga, or the shared password) and the
 * admin pages of the member area (the e-mails in ALLOWED_EMAILS, who log in through Clerk). This page puts both in one place
 * with when each was last seen - for the chair only. Nothing here changes anything. */

const DAY = 86_400_000;
export const ACTIVE_DAYS = 30;

export type CockpitAdmin = { name: string; chair: boolean; lastSeenMs: number | null; closedMs: number | null; state: AdminState };
export type AdminState = "active" | "quiet" | "never" | "closed";
export type MemberAreaAdmin = { email: string; name: string | null; lastSeenMs: number | null; state: AdminState | "unknown"; note: string | null };

export function stateOf(lastSeenMs: number | null, closedMs: number | null, nowMs: number): AdminState {
  if (closedMs !== null) return "closed";
  if (lastSeenMs === null) return "never";
  return nowMs - lastSeenMs <= ACTIVE_DAYS * DAY ? "active" : "quiet";
}

/** The board as the cockpit knows it, with when each member last did something in the cockpit and whether their personal
 * access has been closed. The shared password does not say who is who, so only what a person did counts: using a personal
 * link, asking Saga, writing or ticking off a to-do or a task. */
export async function cockpitAdmins(env: SagaEnv, db: D1Database, nowMs: number): Promise<CockpitAdmin[]> {
  const { names, chair } = await boardMembers(env, db);
  const [seen, closed, lastLink] = await Promise.all([
    db.prepare(`SELECT member, MAX(at) AS at FROM (
        SELECT member, used_at_ms AS at FROM cockpit_login_links WHERE used_at_ms IS NOT NULL
        UNION ALL SELECT asked_by, created_at_ms FROM cockpit_questions WHERE asked_by IS NOT NULL
        UNION ALL SELECT created_by, created_at_ms FROM cockpit_todos
        UNION ALL SELECT owner, done_at_ms FROM cockpit_todos WHERE done_at_ms IS NOT NULL
        UNION ALL SELECT owner, done_at_ms FROM cockpit_task_checks
      ) GROUP BY member`).all<{ member: string; at: number }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT member, after_ms FROM cockpit_signouts").all<{ member: string; after_ms: number }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT member, MAX(used_at_ms) AS at FROM cockpit_login_links WHERE used_at_ms IS NOT NULL GROUP BY member").all<{ member: string; at: number }>().then(r => r.results ?? []).catch(() => [])
  ]);
  const seenBy = new Map(seen.map(r => [r.member, Number(r.at)]));
  const linkBy = new Map(lastLink.map(r => [r.member, Number(r.at)]));
  const closedBy = new Map(closed.map(r => [r.member, Number(r.after_ms)]));
  const list = names.map(name => {
    const lastSeenMs = seenBy.get(name) ?? null;
    const after = closedBy.get(name);
    // Closing a member's access ends every personal login from before then; a link used afterwards opens it again.
    const closedMs = after !== undefined && (linkBy.get(name) ?? 0) <= after ? after : null;
    return { name, chair: name === chair, lastSeenMs, closedMs, state: stateOf(lastSeenMs, closedMs, nowMs) };
  });
  return list.sort((a, b) => Number(b.chair) - Number(a.chair) || (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0) || a.name.localeCompare(b.name, "da"));
}

type ClerkUser = { id?: unknown; first_name?: unknown; last_name?: unknown; last_sign_in_at?: unknown; last_active_at?: unknown;
  email_addresses?: Array<{ email_address?: unknown; verification?: { status?: unknown } | null }> };

export const allowedEmails = (value: string | undefined): string[] =>
  [...new Set((value ?? "").split(",").map(e => e.trim().toLowerCase()).filter(e => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e)))];

/** The e-mails allowed into the member area's admin pages, each looked up at Clerk for a name and the last sign-in. */
export async function memberAreaAdmins(env: SagaEnv & { ALLOWED_EMAILS?: string }, deps: SagaDeps, nowMs: number): Promise<MemberAreaAdmin[]> {
  return Promise.all(allowedEmails(env.ALLOWED_EMAILS).map(async (email): Promise<MemberAreaAdmin> => {
    if (!env.CLERK_SECRET_KEY) return { email, name: null, lastSeenMs: null, state: "unknown", note: "Clerk er ikke koblet til, så login kan ikke slås op." };
    try {
      const response = await deps.fetcher(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=1`, {
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, accept: "application/json" } });
      if (!response.ok) throw new Error(`clerk_${response.status}`);
      const users = await response.json().catch(() => []) as ClerkUser[];
      const user = (Array.isArray(users) ? users : []).find(u => (u.email_addresses ?? []).some(a => typeof a.email_address === "string" && a.email_address.toLowerCase() === email && a.verification?.status === "verified"));
      if (!user) return { email, name: null, lastSeenMs: null, state: "never", note: "Har ikke oprettet sig i det nye login endnu." };
      const at = [user.last_active_at, user.last_sign_in_at].filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => b - a)[0] ?? null;
      const name = [user.first_name, user.last_name].filter(v => typeof v === "string" && v.trim()).join(" ").trim() || null;
      return { email, name, lastSeenMs: at, state: stateOf(at, null, nowMs), note: null };
    } catch {
      return { email, name: null, lastSeenMs: null, state: "unknown", note: "Kunne ikke slås op hos Clerk lige nu." };
    }
  }));
}

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const DAY_ONLY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" });
const BADGE: Record<AdminState | "unknown", [string, string]> = {
  active: ["ok", "Aktiv"], quiet: ["off", "Ikke set i 30 dage"], never: ["off", "Ikke set endnu"], closed: ["due", "Adgang lukket"], unknown: ["off", "Ukendt"]
};
const badge = (state: AdminState | "unknown") => `<span class="badge ${BADGE[state][0]}">${BADGE[state][1]}</span>`;

export const ADMINS_STYLE = `${MEMBER_PAGES_STYLE}
.adm{display:grid;gap:20px}.adm table{width:100%}.adm td small{display:block;color:var(--faint);font-size:12.5px}.adm .when{color:var(--muted);font-size:14px;white-space:nowrap}
.adm .count{font-size:14px;color:var(--faint);font-family:var(--font);font-weight:400;margin-left:6px}.adm .chair{font-size:12.5px;color:var(--muted);margin-left:6px}
`;

export function adminsPage(base: string, who: string | null, d: { cockpit: CockpitAdmin[]; area: MemberAreaAdmin[]; nowMs: number }): string {
  const active = (list: Array<{ state: AdminState | "unknown" }>) => list.filter(a => a.state === "active").length;
  const cockpit = d.cockpit.length ? `<table class="rows m-list"><tr><th>Navn</th><th>Status</th><th>Sidst set</th></tr>${d.cockpit.map(a => `<tr><td data-label="Navn">${esc(a.name)}${a.chair ? '<span class="chair">formand</span>' : ""}</td>
<td data-label="Status">${badge(a.state)}</td><td data-label="Sidst set" class="when">${a.closedMs !== null ? `Lukket ${esc(DAY_ONLY.format(a.closedMs))}` : a.lastSeenMs !== null ? esc(WHEN.format(a.lastSeenMs)) : "-"}</td></tr>`).join("")}</table>`
    : `<p class="empty">Cockpittet kender endnu ingen i bestyrelsen. De kommer til, når de skriver i bestyrelsens gruppe.</p>`;
  const area = d.area.length ? `<table class="rows m-list"><tr><th>E-mail</th><th>Status</th><th>Sidst logget ind</th></tr>${d.area.map(a => `<tr><td data-label="E-mail">${esc(a.email)}${a.name ? `<small>${esc(a.name)}</small>` : ""}${a.note ? `<small>${esc(a.note)}</small>` : ""}</td>
<td data-label="Status">${badge(a.state)}</td><td data-label="Sidst logget ind" class="when">${a.lastSeenMs !== null ? esc(WHEN.format(a.lastSeenMs)) : "-"}</td></tr>`).join("")}</table>`
    : `<p class="empty">Ingen e-mails har adgang til admin i medlemsområdet. Listen sættes som <code>ALLOWED_EMAILS</code>.</p>`;
  return layout(base, "Administratorer", `<main class="adm"><div class="hero"><p class="small muted" style="margin:0 0 6px"><a href="${base}/medlemmer">← Medlemmer</a></p><h1>Administratorer</h1>
<p>Hvem der har adgang til admin, og hvem der har været aktive de seneste ${ACTIVE_DAYS} dage. Kun for formanden.</p></div>
<section class="panel"><header><h2>Bestyrelsen i cockpittet<span class="count">${active(d.cockpit)} aktive af ${d.cockpit.length}</span></h2><p>Alle, der har skrevet i bestyrelsens gruppe. "Sidst set" er sidste gang, de brugte et personligt link, spurgte Saga eller arbejdede med en opgave. Det fælles password viser ikke, hvem der er inde.</p></header>${cockpit}</section>
<section class="panel"><header><h2>Admin i medlemsområdet<span class="count">${active(d.area)} aktive af ${d.area.length}</span></h2><p>E-mails, der må åbne admin-siderne på medlem.hjerterum.info. Login og sidste login hentes hos Clerk.</p></header>${area}</section></main>`,
    { section: "/medlemmer", who, style: ADMINS_STYLE });
}
