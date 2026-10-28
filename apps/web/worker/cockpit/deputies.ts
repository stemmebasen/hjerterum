import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { telegramClient } from "../saga/telegram.js";
import { LYS_CSS } from "../../lys.js";
import { agendaPoints, meetingOver, meetings, minutesDecisions, type ApprovedMinutes, type Meeting } from "./data.js";
import { comingEvents } from "./events.js";
import { COCKPIT_STYLE, COCKPIT_VERSION, esc, longDay, shortDay } from "./page.js";
import { signedOutAfter, signOutMember } from "./personalLogin.js";

/** Requested: "Hvordan kan vi lave login til vores frivillige og suppleanter. De skal ikke have adgang til bestyrelsens interne diskussioner
 * men må gerne se mere generelle ting." - "Lad os starte med suppleant adgang".
 *
 * A deputy is someone in the deputies' Telegram group (SAGA_DEPUTY_CHAT_ID). They write /login to Saga like the board, and get a login of
 * their own kind (a cookie signed for another purpose than the board's, cockpit/auth.ts). It opens only the pages in this file - everything
 * else in admin is closed to them, because the cockpit's handler sends a deputy here before any of the board's routes:
 * - Overblik: the next meeting (time and place), the minutes shared with them and the coming events;
 * - Møder: the coming meetings and their agendas (read only), and the shared minutes;
 * - Beslutninger: the decisions in the shared minutes;
 * - Events: the coming events.
 * Minutes are internal until a board member shares them (the card on the minutes' page). Saga does not answer deputies - not here and not
 * privately on Telegram - so nothing of the board's discussions can reach them through her. */

export const DEPUTY = "suppleant";
/** The key a deputy is signed out under: never the same as a board member's, even with the same name. */
export const deputyKey = (member: string) => `${DEPUTY}:${member}`;

/** Saga notes who writes in the deputies' group - their Telegram account and name, never the text. */
export async function recordDeputy(db: D1Database, telegramId: string, name: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO cockpit_deputies (telegram_id, name, seen_at_ms) VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, seen_at_ms = excluded.seen_at_ms`).bind(telegramId, name.slice(0, 80), nowMs).run();
}

/** The deputy behind a Telegram account, when the deputies' group is set up and they have written there. */
export async function deputyByTelegram(env: SagaEnv, db: D1Database, telegramId: string): Promise<string | null> {
  if (!env.SAGA_DEPUTY_CHAT_ID) return null;
  const row = await db.prepare("SELECT name FROM cockpit_deputies WHERE telegram_id = ?").bind(telegramId).first<{ name: string }>().catch(() => null);
  return row?.name ?? null;
}

/** Whether the person is in the deputies' group right now: true / false, or null when Telegram could not say. */
export async function stillDeputy(env: SagaEnv, deps: SagaDeps, telegramId: string): Promise<boolean | null> {
  if (!env.SAGA_DEPUTY_CHAT_ID) return false;
  try {
    const member = await telegramClient(env, deps).getChatMember(env.SAGA_DEPUTY_CHAT_ID, telegramId);
    return ["creator", "administrator", "member"].includes(member.status) || (member.status === "restricted" && member.is_member === true);
  } catch { return null; }
}

/** Once an hour: a deputy who has left the deputies' group is signed out on every device. Nothing happens if Telegram cannot say. */
export async function scheduledDeputyAccess(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<void> {
  if (!env.SAGA_DEPUTY_CHAT_ID || !env.SAGA_TELEGRAM_BOT_TOKEN) return;
  if (!(await claim("saga_deputy_access", Math.floor(deps.now() / 3_600_000)))) return;
  const people = await db.prepare("SELECT telegram_id, name FROM cockpit_deputies").all<{ telegram_id: string; name: string }>().then(r => r.results ?? []);
  for (const person of people) {
    if (await stillDeputy(env, deps, person.telegram_id) !== false) continue;
    const key = deputyKey(person.name);
    const last = await db.prepare("SELECT MAX(used_at_ms) AS at FROM cockpit_login_links WHERE member = ? AND role = 'suppleant' AND used_at_ms IS NOT NULL").bind(person.name).first<{ at: number | null }>();
    if ((last?.at ?? 0) > await signedOutAfter(db, key)) await signOutMember(db, key, deps.now());
  }
}

/** A deputy's login is valid while it was given after their last sign-out. */
export async function deputyStillOpen(db: D1Database, member: string, issuedMs: number): Promise<boolean> {
  return issuedMs > await signedOutAfter(db, deputyKey(member));
}

// ---- Sharing minutes with the deputies ----

const SHARED = "id, source, meeting_date, draft_markdown, drive_document_url, created_at_ms, updated_at_ms, locked_at_ms";

/** The approved minutes a board member has shared with the deputies, newest first. */
export async function sharedMinutes(db: D1Database, limit = 100): Promise<ApprovedMinutes[]> {
  return db.prepare(`SELECT ${SHARED} FROM board_minutes WHERE status = 'approved' AND draft_markdown IS NOT NULL AND deputies_at_ms IS NOT NULL
    ORDER BY COALESCE(meeting_date, '') DESC, created_at_ms DESC LIMIT ?`).bind(limit).all<ApprovedMinutes>().then(r => r.results ?? []);
}

export async function sharedMinutesById(db: D1Database, id: number): Promise<ApprovedMinutes | null> {
  return db.prepare(`SELECT ${SHARED} FROM board_minutes WHERE id = ? AND status = 'approved' AND draft_markdown IS NOT NULL AND deputies_at_ms IS NOT NULL`).bind(id).first<ApprovedMinutes>();
}

/** Whether and by whom a set of minutes is shared with the deputies. */
export async function sharing(db: D1Database, id: number): Promise<{ at: number; by: string | null } | null> {
  const row = await db.prepare("SELECT deputies_at_ms, deputies_by FROM board_minutes WHERE id = ?").bind(id).first<{ deputies_at_ms: number | null; deputies_by: string | null }>();
  return row?.deputies_at_ms ? { at: row.deputies_at_ms, by: row.deputies_by } : null;
}

/** A board member shares approved minutes with the deputies, or makes them internal again. */
export async function setSharing(db: D1Database, id: number, share: boolean, by: string, nowMs: number): Promise<boolean> {
  const result = share
    ? await db.prepare("UPDATE board_minutes SET deputies_at_ms = ?, deputies_by = ? WHERE id = ? AND status = 'approved'").bind(nowMs, by.slice(0, 80), id).run()
    : await db.prepare("UPDATE board_minutes SET deputies_at_ms = NULL, deputies_by = NULL WHERE id = ?").bind(id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

const DAY_SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" });

/** The card on the board's minutes page: internal or shared with the deputies, and the button that changes it. */
export function sharingCard(base: string, minutesId: number, shared: { at: number; by: string | null } | null, canChange: boolean): string {
  const state = shared
    ? `Delt med suppleanterne${shared.by ? ` af ${esc(shared.by)}` : ""} ${esc(DAY_SHORT.format(shared.at))}. De kan læse referatet og dets beslutninger.`
    : "Internt for bestyrelsen. Suppleanterne kan ikke se referatet.";
  const button = canChange ? `<form method="post" action="${base}/referat/${minutesId}/suppleanter" style="margin:10px 0 0"><input type="hidden" name="del" value="${shared ? "nej" : "ja"}"><button class="${shared ? "ghost" : ""}">${shared ? "Gør internt igen" : "Del med suppleanterne"}</button></form>` : "";
  return `<section class="panel" style="margin:0 0 16px"><header><h2>Suppleanter</h2></header><p class="small" style="margin:0">${state}</p>${button}</section>`;
}

// ---- The deputies' pages ----

type DeputyContext = { request: Request; env: SagaEnv; db: D1Database; base: string; path: string; now: number; member: string };

const HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'none'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const page = (body: string, status = 200) => new Response(body, { status, headers: HEADERS });

const PLACES = [["/", "Overblik"], ["/moder", "Møder"], ["/beslutninger", "Beslutninger"], ["/arrangementer", "Events"]] as const;
const FONT = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..700&amp;display=swap";
const DEPUTY_STYLE = `
.dep{display:grid;gap:20px}.dep ul.plain{list-style:none;margin:0;padding:0;display:grid}.dep ul.plain li{padding:11px 0;border-top:1px solid var(--line)}.dep ul.plain li:first-child{border-top:0;padding-top:0}
.dep small{display:block;color:var(--faint);font-size:13px}.dep .agenda{margin:8px 0 0;padding-left:20px}.dep .note{font-size:13.5px;color:var(--faint);margin:6px 0 0}
.dep .minutes h1{font-size:24px}.dep .minutes h2{font-size:19px;margin:20px 0 6px}
`;

/** The deputies' own frame: their four places, their name and "Log ud" - no Saga, no board menu, no drawer for new posts. */
export function deputyLayout(base: string, title: string, here: string, member: string, body: string): string {
  const nav = PLACES.map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
  const initials = member.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="${FONT}">
<title>${esc(title)} · Hjerterum suppleanter</title><style>${LYS_CSS}${COCKPIT_STYLE}${DEPUTY_STYLE}</style></head><body>
<header class="bar"><div class="top"><a class="brand" href="${base}/"><span class="brand-mark"><img src="${base}/logo.png?v=${COCKPIT_VERSION}" alt="" width="44" height="44"></span><span class="names"><b>Hjerterum</b><span>Suppleanter</span></span></a><nav class="desk" aria-label="Menu">${nav}</nav>
<div class="me"><span class="who-name">${esc(member)}</span><span class="avatar" title="${esc(member)} · suppleant">${esc(initials)}</span>
<form method="post" action="${base}/logout" class="logout"><button>Log ud</button></form></div></div></header>
<nav class="tabs" aria-label="Menu">${PLACES.map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}><span>${label}</span></a>`).join("")}</nav>
${body}</body></html>`;
}

const TIME = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const today = (nowMs: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nowMs);

const when = (m: Meeting) => `${esc(longDay(m.meeting_date))}${m.start_time ? ` kl. ${esc(m.start_time)}${m.end_time ? `-${esc(m.end_time)}` : ""}` : ""}${m.place ? ` · ${esc(m.place)}` : ""}`;
const minutesLink = (base: string, m: ApprovedMinutes) => `<li><a href="${base}/referat/${m.id}">Referat ${esc(m.meeting_date ? shortDay(m.meeting_date) : "")}</a></li>`;

async function upcoming(db: D1Database, nowMs: number): Promise<Meeting[]> {
  const day = today(nowMs);
  return (await meetings(db)).filter(m => m.meeting_date >= day && !meetingOver(m, nowMs)).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
}

/** Every request from a deputy's login: their pages, or "Siden findes ikke". Only reading - the one form they may send is "Log ud". */
export async function deputyRoute(ctx: DeputyContext): Promise<Response> {
  const { request, db, base, path, now, member } = ctx;
  const first = esc(member.split(/\s+/)[0] ?? member);
  const notFound = () => page(deputyLayout(base, "Ikke fundet", "", member, `<main class="dep"><div class="hero"><h1>Siden findes ikke</h1><p>Som suppleant kan du se overblikket, møderne, de delte referater, beslutningerne og arrangementerne.</p></div></main>`), 404);
  if (request.method !== "GET" && request.method !== "HEAD") return notFound();

  if (path === "/") {
    const [coming, minutes, events] = await Promise.all([upcoming(db, now), sharedMinutes(db, 3), comingEvents(db, now, 30, 5)]);
    const next = coming[0] ?? null;
    return page(deputyLayout(base, "Overblik", "/", member, `<main class="dep"><div class="hero"><h1>Hej ${first}</h1><p>Du er logget ind som suppleant. Her kan du følge med i bestyrelsens møder, de referater, bestyrelsen har delt, og husets arrangementer.</p></div>
<section class="panel"><header><h2>Næste møde</h2></header>${next ? `<p style="margin:0">${when(next)}</p><a class="more" href="${base}/moder">Se dagsordenen →</a>` : `<p class="empty">Der er ikke sat et møde i kalenderen endnu.</p>`}</section>
<section class="panel"><header><h2>Seneste referater</h2><p>Dem, bestyrelsen har delt med suppleanterne.</p></header>${minutes.length ? `<ul class="plain">${minutes.map(m => minutesLink(base, m)).join("")}</ul>` : `<p class="empty">Bestyrelsen har ikke delt et referat endnu.</p>`}</section>
<section class="panel"><header><h2>Kommende arrangementer</h2></header>${events.length ? `<ul class="plain">${events.map(e => `<li>${esc(e.title)}<small>${esc(TIME.format(e.starts_at_ms))}${e.host ? ` · ${esc(e.host)}` : ""}</small></li>`).join("")}</ul><a class="more" href="${base}/arrangementer">Alle arrangementer →</a>` : `<p class="empty">Ingen arrangementer de næste 30 dage.</p>`}</section></main>`));
  }

  if (path === "/moder") {
    const [coming, minutes] = await Promise.all([upcoming(db, now), sharedMinutes(db)]);
    const meetingCard = (m: Meeting) => { const points = agendaPoints(m.agenda); return `<li><b>${when(m)}</b>${points.length ? `<ol class="agenda">${points.map(p => `<li>${esc(p)}</li>`).join("")}</ol>` : `<small>Dagsordenen er ikke skrevet endnu.</small>`}</li>`; };
    return page(deputyLayout(base, "Møder", "/moder", member, `<main class="dep"><div class="hero"><h1>Møder</h1><p>Bestyrelsens kommende møder med dagsorden, og de referater, bestyrelsen har delt med suppleanterne.</p></div>
<section class="panel"><header><h2>Kommende møder</h2></header>${coming.length ? `<ul class="plain">${coming.map(meetingCard).join("")}</ul>` : `<p class="empty">Der er ikke sat et møde i kalenderen endnu.</p>`}</section>
<section class="panel"><header><h2>Referater</h2></header>${minutes.length ? `<ul class="plain">${minutes.map(m => minutesLink(base, m)).join("")}</ul>` : `<p class="empty">Bestyrelsen har ikke delt et referat endnu.</p>`}</section></main>`));
  }

  const minutesPath = /^\/referat\/(\d{1,9})$/.exec(path);
  if (minutesPath) {
    const minutes = await sharedMinutesById(db, Number(minutesPath[1]));
    if (!minutes) return notFound();
    const body = /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(minutes.draft_markdown ?? ""))?.[1] ?? "";
    return page(deputyLayout(base, `Referat ${minutes.meeting_date ? shortDay(minutes.meeting_date) : ""}`.trim(), "/moder", member,
      `<main class="dep"><p class="small muted" style="margin:0"><a href="${base}/moder">← Møder</a></p><article class="panel minutes">${body}</article></main>`));
  }

  if (path === "/beslutninger") {
    const minutes = await sharedMinutes(db);
    const groups = minutes.map(m => ({ m, decisions: minutesDecisions(m) })).filter(g => g.decisions.length);
    return page(deputyLayout(base, "Beslutninger", "/beslutninger", member, `<main class="dep"><div class="hero"><h1>Beslutninger</h1><p>Beslutningerne i de referater, bestyrelsen har delt med suppleanterne.</p></div>
${groups.length ? groups.map(g => `<section class="panel"><header><h2>${esc(g.m.meeting_date ? longDay(g.m.meeting_date) : "Uden dato")}</h2></header><ul class="plain">${g.decisions.map(d => `<li>${esc(d.text)}</li>`).join("")}</ul><a class="more" href="${base}/referat/${g.m.id}">Læs referatet →</a></section>`).join("")
  : `<section class="panel"><p class="empty">Der er ingen delte beslutninger endnu.</p></section>`}</main>`));
  }

  if (path === "/arrangementer") {
    const events = await comingEvents(db, now, 60, 80);
    return page(deputyLayout(base, "Events", "/arrangementer", member, `<main class="dep"><div class="hero"><h1>Arrangementer</h1><p>Husets arrangementer de næste 60 dage.</p></div>
<section class="panel">${events.length ? `<ul class="plain">${events.map(e => `<li>${e.link && /^https:\/\//.test(e.link) ? `<a href="${esc(e.link)}" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}<small>${esc(TIME.format(e.starts_at_ms))}${e.location ? ` · ${esc(e.location)}` : ""}${e.host ? ` · ${esc(e.host)}` : ""}</small></li>`).join("")}</ul>` : `<p class="empty">Ingen arrangementer de næste 60 dage.</p>`}</section></main>`));
  }

  return notFound();
}
