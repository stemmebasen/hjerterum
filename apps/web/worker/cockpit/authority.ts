import type { D1Database } from "../db.js";
import { esc, layout } from "./page.js";

/** Requested by the chair: "Formandens beføjelser bliver udvidet hen ad vejen, så vi skal have et godt fundament for dette."
 *
 * One place that says what the chair may do and what it takes:
 * - "named": the person says they are the chair (with the shared password anyone can pick any name) - only for what is harmless to show;
 * - "personal": the chair is logged in with their own login link from Saga, which Saga gives only to the chair's Telegram account.
 *
 * A new power is added in three steps: a line in POWERS (what it is called and what it takes), `may(power)` where it is used, and - when it
 * reads or changes something about other people - `audit(...)`, so the chair's log shows it. Nothing else in the cockpit should ask
 * "is this the chair?" on its own. */

export const POWERS = {
  "admins.read": { label: "Se, hvem der er administratorer, og hvordan de bruger admin", needs: "personal" },
  "conversations.read": { label: "Læse medlemmernes samtaler med Saga", needs: "personal" },
  "memory.forget_any": { label: "Se og glemme alt, hvad Saga har lært af andre", needs: "personal" },
  "access.close": { label: "Lukke et medlems adgang på alle enheder", needs: "personal" },
  "mailbox.connect": { label: "Forbinde og afbryde Hjerterums fælles mailboks (team@)", needs: "personal" },
  "mailbox.see": { label: "Se kortet om mailboksen i Posthus", needs: "named" },
  "audit.read": { label: "Læse formandens log", needs: "personal" }
} as const satisfies Record<string, { label: string; needs: "named" | "personal" }>;

export type Power = keyof typeof POWERS;

export type Actor = {
  /** Who they are in the cockpit - a personal login, or the name picked with the shared password; null when not chosen. */
  member: string | null;
  /** Logged in with their own link from Saga, so the name is proven. */
  personal: boolean;
  /** The board's chair by name. */
  chair: boolean;
};

export function actorOf(who: string | null, personal: string | null, chairName: string | null): Actor {
  return { member: who, personal: personal !== null && who === personal, chair: Boolean(who && chairName && who === chairName) };
}

/** Whether the person may use the power. */
export function can(actor: Actor, power: Power): boolean {
  if (!actor.chair) return false;
  return POWERS[power].needs === "named" || actor.personal;
}

/** What to say to someone who may not: the chair is told how to get in, anyone else that it is the chair's. */
export function denial(actor: Actor, power: Power): string {
  return actor.chair && POWERS[power].needs === "personal"
    ? "Siden er kun for formanden og kræver dit personlige login: skriv /login til Saga på Telegram, og åbn linket."
    : "Siden er kun for formanden.";
}

/** Writes down that the chair used a power that concerns other people. */
export async function audit(db: D1Database, actor: Actor, power: Power, detail: string, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO chair_audit (at_ms, member, power, detail) VALUES (?, ?, ?, ?)").bind(nowMs, actor.member ?? "?", power, detail.slice(0, 300)).run().catch(() => undefined);
}

export type AuditRow = { id: number; at_ms: number; member: string; power: string; detail: string };

export async function recentAudit(db: D1Database, limit = 200): Promise<AuditRow[]> {
  return db.prepare("SELECT id, at_ms, member, power, detail FROM chair_audit ORDER BY at_ms DESC, id DESC LIMIT ?").bind(limit).all<AuditRow>().then(r => r.results ?? []).catch(() => []);
}

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

export const AUTHORITY_STYLE = `
.log{display:grid;gap:20px}.log ul{list-style:none;margin:0;padding:0;display:grid}
.log li{display:grid;grid-template-columns:190px 1fr;gap:14px;padding:11px 0;border-top:1px solid var(--line);font-size:14.5px}.log li:first-child{border-top:0;padding-top:0}
.log .at{color:var(--muted);font-size:13.5px}.log small{display:block;color:var(--faint);font-size:12.5px}
@media (max-width:760px){.log li{grid-template-columns:1fr;gap:2px}}
`;

/** "Formandens log": the sensitive things the chair has done, newest first, and what the chair may do. */
export function auditPage(base: string, who: string | null, rows: AuditRow[]): string {
  const label = (power: string) => (POWERS as Record<string, { label: string }>)[power]?.label ?? power;
  return layout(base, "Formandens log", `<main class="log"><div class="hero"><p class="small muted" style="margin:0 0 6px"><a href="${base}/profil">← Profil</a></p><h1>Formandens log</h1>
<p>Det følsomme, formanden har gjort i admin: læst andres samtaler med Saga, lukket adgang, forbundet mailen og glemt det, andre har lært hende. Kun for formanden.</p></div>
<section class="panel"><header><h2>Seneste</h2></header>${rows.length ? `<ul>${rows.map(r => `<li><span class="at">${esc(WHEN.format(r.at_ms))}</span><span>${esc(label(r.power))}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="empty">Intet endnu.</p>`}</section>
<section class="panel"><header><h2>Det formanden må</h2><p>Det, der kræver personligt login, åbner kun for formanden, når hun er logget ind med sit eget link fra Saga.</p></header>
<ul>${Object.values(POWERS).map(p => `<li><span class="at">${p.needs === "personal" ? "Personligt login" : "Navnet er nok"}</span><span>${esc(p.label)}</span></li>`).join("")}</ul></section></main>`,
    { section: "/profil", who, style: AUTHORITY_STYLE });
}
