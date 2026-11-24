import type { D1Database } from "./db.js";
import type { Env } from "./env.js";
import { letter, mailConfigured, sendLogged } from "./mail.js";
import { sha256 } from "./flokken/auth.js";
import { ADMIN_COOKIE, funnelSummary, visitSummary, type FunnelRow, type VisitSummary } from "./stats.js";
import { capitalize, dayLabel, hhmm, localDate, addDays } from "./time.js";
import { html, raw, type SafeHtml } from "./web/html.js";
import { ORGANISER_EMAIL, page, type PageContext } from "./web/layout.js";
import { TOPICS, type Topic } from "./flokken/contact.js";
import { INFO_MEETING } from "./flokken/infoMeeting.js";
import { adminInfoMeetingRoute } from "./adminInfoMeeting.js";
import { adminMembersRoute } from "./adminMembers.js";
import { adminPicksRoute } from "./adminPicks.js";

/** Socialklubben's admin overview at /admin: visits, members, interest per arrangement, flocks, recent activity and
 * mails, on one page that reads well on a phone. Only the admin gets in: a login link is sent to the admin address
 * (ADMIN_EMAIL, else the organisers' address) and nowhere else, and the session it starts is an HttpOnly cookie
 * kept apart from the members' login. */

export type AdminView = { status: number; body: string; headers?: Record<string, string>; cookie?: string; redirect?: string; image?: { type: string; body: Uint8Array<ArrayBuffer> } };

const LINK_MINUTES = 60;
const SESSION_DAYS = 30;
const LINKS_PER_HOUR = 3;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
export const NO_STORE = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };

export const adminEmail = (env: Env): string => env.ADMIN_EMAIL && EMAIL.test(env.ADMIN_EMAIL.trim()) ? env.ADMIN_EMAIL.trim().toLowerCase() : ORGANISER_EMAIL;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const validToken = (t: string | null | undefined): t is string => !!t && /^[A-Za-z0-9_-]{40,60}$/.test(t);

function cookieToken(request: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([A-Za-z0-9_-]{40,60})`).exec(request.headers.get("cookie") ?? "");
  return m?.[1] ?? null;
}

export async function isAdmin(db: D1Database, request: Request, now: number): Promise<boolean> {
  const token = cookieToken(request);
  if (!token) return false;
  const row = await db.prepare("SELECT 1 AS ok FROM admin_tokens WHERE token_hash = ? AND kind = 'session' AND expires_at > ?").bind(await sha256(token), now).first<{ ok: number }>();
  return !!row;
}

/** Sends a login link to the admin address. */
export async function sendAdminLink(db: D1Database, env: Env, origin: string, now: number): Promise<"sent" | "off" | "failed" | "wait"> {
  if (!mailConfigured(env)) return "off";
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM admin_tokens WHERE kind = 'link' AND created_at > ?").bind(now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LINKS_PER_HOUR) return "wait";
  const token = newToken();
  await db.prepare("INSERT INTO admin_tokens (token_hash, kind, created_at, expires_at) VALUES (?, 'link', ?, ?)").bind(await sha256(token), now, now + LINK_MINUTES * 60_000).run();
  const mail = letter({
    to: adminEmail(env),
    subject: "Log ind på Socialklubbens overblik",
    greeting: "Hej",
    paragraphs: ["Tryk på knappen for at se Socialklubbens overblik: besøg, medlemmer, flokke og mails. Linket virker i en time, og kun én gang."],
    button: { label: "Åbn overblikket", url: `${origin}/admin/link?t=${token}` },
    after: ["Har du ikke bedt om det, kan du se bort fra mailen. Ingen andre end denne adresse kan få et link."]
  });
  const result = await sendLogged(db, env, "login", null, mail, now);
  return result.ok ? "sent" : "failed";
}

async function useAdminLink(db: D1Database, token: string, now: number): Promise<string | null> {
  const taken = await db.prepare("UPDATE admin_tokens SET used_at = ? WHERE token_hash = ? AND kind = 'link' AND used_at IS NULL AND expires_at >= ?").bind(now, await sha256(token), now).run();
  if ((taken.meta?.changes ?? 0) !== 1) return null;
  const session = newToken();
  await db.batch([
    db.prepare("DELETE FROM admin_tokens WHERE expires_at < ?").bind(now - 86_400_000),
    db.prepare("INSERT INTO admin_tokens (token_hash, kind, created_at, expires_at) VALUES (?, 'session', ?, ?)").bind(await sha256(session), now, now + SESSION_DAYS * 86_400_000)
  ]);
  return `${ADMIN_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

async function endAdminSession(db: D1Database, request: Request): Promise<string> {
  const token = cookieToken(request);
  if (token) await db.prepare("DELETE FROM admin_tokens WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ————————————————————————————————————————— Routes

/** /admin, /admin/link, /admin/log-ind and /admin/log-ud. POSTs have passed the same-origin check in src/index.ts. */
export async function adminRoute(request: Request, env: Env, db: D1Database, pc: PageContext, path: string, url: URL, now: number): Promise<AdminView | null> {
  const post = request.method === "POST";
  if (path === "/admin/log-ind" && post) {
    const outcome = await sendAdminLink(db, env, pc.origin, now);
    return loginView(pc, env, outcome);
  }
  if (path === "/admin/link") {
    const token = post ? String((await request.formData().catch(() => null))?.get("t") ?? "") : url.searchParams.get("t");
    if (!validToken(token)) return loginView(pc, env, "bad");
    if (!post) return linkView(pc, token);
    const cookie = await useAdminLink(db, token, now);
    if (!cookie) return loginView(pc, env, "bad");
    return { status: 303, body: "", redirect: "/admin", cookie };
  }
  if (path === "/admin/log-ud" && post) return { status: 303, body: "", redirect: "/", cookie: await endAdminSession(db, request) };
  if (path === "/admin") {
    if (!(await isAdmin(db, request, now))) return loginView(pc, env, null);
    return overviewView(pc, await overview(db, now, mailConfigured(env)), now);
  }
  // Everything else under /admin is for the admin only.
  if (!(await isAdmin(db, request, now))) return { status: 303, body: "", redirect: "/admin" };
  if (path === "/admin/udvalg" || path.startsWith("/admin/udvalg/")) return adminPicksRoute(request, db, pc, path, url, now);
  if (path === "/admin/informationsmoede" || path.startsWith("/admin/informationsmoede/")) return adminInfoMeetingRoute(request, db, pc, path, url, now);
  return adminMembersRoute(request, db, pc, path, url, now);
}

// ————————————————————————————————————————— Data

export type Overview = {
  visits: VisitSummary;
  funnel: FunnelRow[];
  members: { profiles: number; profilesWeek: number; withEmail: number; signups: number; signupsWeek: number; activeWeek: number };
  newestPeople: Array<{ id: string; name: string; email: string | null; kind: "profil" | "indmelding"; at: number; age_group: string | null }>;
  interests: Array<{ slug: string; title: string; starts_at: number; waiting: number; invited: number; confirmed: number }>;
  interestTotals: { people: number; ticks: number; events: number };
  flocks: Array<{ id: string; slug: string; title: string; starts_at: number; meeting_at: number; meeting_place: string; members: number; pending: number; max_size: number; gathered: boolean }>;
  activity: Array<{ at: number; text: string; href: string | null }>;
  mail: { configured: boolean; byKind: Array<{ kind: string; sent: number; failed: number }>; recent: Array<{ kind: string; status: string; error: string | null; created_at: number }> };
  inquiries: Array<{ organisation: string; contact_name: string; email: string; created_at: number }>;
  /** The contact form's newest messages (src/flokken/contact.ts). */
  contacts: Array<{ topic: string; name: string; email: string; organisation: string | null; message: string; mail: string; created_at: number }>;
  reports: number;
  /** Sign-ups for the information meeting (src/flokken/infoMeeting.ts). */
  infoMeeting: { total: number; steering: number; newest: Array<{ name: string; email: string; steering: number; created_at: number }> };
};

/** Profiles made on Socialklubben (Samfolk's members share the table: they have joined Samfolk or help run it). */
const SK_MEMBER = "m.flokk_joined_at IS NULL AND COALESCE(m.is_admin, 0) = 0";
const first = async <T>(p: Promise<T | null>, fallback: T): Promise<T> => (await p) ?? fallback;

export async function overview(db: D1Database, now: number, mailOn = true): Promise<Overview> {
  const week = now - 7 * 86_400_000;
  const n = (sql: string, ...binds: unknown[]) => first(db.prepare(sql).bind(...binds).first<{ n: number }>(), { n: 0 }).then(r => r.n ?? 0);
  const [visits, funnel, profiles, profilesWeek, withEmail, signups, signupsWeek, activeWeek] = await Promise.all([
    visitSummary(db, now),
    funnelSummary(db, now).catch(() => [] as FunnelRow[]),
    n(`SELECT COUNT(*) AS n FROM members m WHERE ${SK_MEMBER}`),
    n(`SELECT COUNT(*) AS n FROM members m WHERE ${SK_MEMBER} AND m.created_at > ?`, week),
    n(`SELECT COUNT(*) AS n FROM members m WHERE ${SK_MEMBER} AND m.email IS NOT NULL`),
    n("SELECT COUNT(*) AS n FROM membership_signups"),
    n("SELECT COUNT(*) AS n FROM membership_signups WHERE created_at > ?", week),
    n(`SELECT COUNT(DISTINCT s.member_id) AS n FROM member_sessions s JOIN members m ON m.id = s.member_id WHERE ${SK_MEMBER} AND s.created_at > ?`, week)
  ]);
  const [people, signupRows, interestRows, interestTotals, flockRows, ticks, joins, inquiries, mailKinds, mailRecent, reports, contacts] = await Promise.all([
    db.prepare(`SELECT m.id, m.first_name AS name, m.email, m.created_at AS at, m.age_group FROM members m WHERE ${SK_MEMBER} ORDER BY m.created_at DESC LIMIT 12`).all<{ id: string; name: string; email: string | null; at: number; age_group: string | null }>(),
    db.prepare("SELECT id, name, email, created_at AS at FROM membership_signups ORDER BY created_at DESC LIMIT 12").all<{ id: string; name: string; email: string; at: number }>(),
    db.prepare(`SELECT e.slug, e.title, e.starts_at,
        SUM(i.status = 'waiting') AS waiting, SUM(i.status = 'invited') AS invited, SUM(i.status = 'confirmed') AS confirmed
      FROM event_interests i JOIN events e ON e.id = i.event_id
      WHERE e.starts_at > ? AND e.status = 'scheduled' AND i.status IN ('waiting', 'invited', 'confirmed')
      GROUP BY e.id ORDER BY (waiting + invited + confirmed) DESC, e.starts_at LIMIT 25`).bind(now).all<Overview["interests"][number]>(),
    db.prepare(`SELECT COUNT(DISTINCT i.member_id) AS people, COUNT(*) AS ticks, COUNT(DISTINCT i.event_id) AS events
      FROM event_interests i JOIN events e ON e.id = i.event_id WHERE e.starts_at > ? AND i.status IN ('waiting', 'invited', 'confirmed')`).bind(now).first<Overview["interestTotals"]>(),
    db.prepare(`SELECT f.id, e.slug, e.title, e.starts_at, f.meeting_at, f.meeting_place, f.max_size, f.note LIKE 'Samlet af Socialklubben%' AS gathered,
        (SELECT COUNT(*) FROM flock_members fm WHERE fm.flock_id = f.id AND fm.left_at IS NULL) AS members,
        (SELECT COUNT(*) FROM event_interests i WHERE i.flock_id = f.id AND i.status = 'invited') AS pending
      FROM flocks f JOIN events e ON e.id = f.event_id
      WHERE f.status = 'open' AND e.status = 'scheduled' AND e.starts_at > ? ORDER BY f.meeting_at LIMIT 30`).bind(now).all<Omit<Overview["flocks"][number], "gathered"> & { gathered: number }>(),
    db.prepare(`SELECT m.first_name AS who, e.title, e.slug, i.created_at AS at FROM event_interests i JOIN members m ON m.id = i.member_id JOIN events e ON e.id = i.event_id
      ORDER BY i.created_at DESC LIMIT 15`).all<{ who: string; title: string; slug: string; at: number }>(),
    db.prepare(`SELECT m.first_name AS who, e.title, f.id, fm.joined_at AS at FROM flock_members fm JOIN members m ON m.id = fm.member_id JOIN flocks f ON f.id = fm.flock_id JOIN events e ON e.id = f.event_id
      ORDER BY fm.joined_at DESC LIMIT 15`).all<{ who: string; title: string; id: string; at: number }>(),
    db.prepare("SELECT organisation, contact_name, email, created_at FROM partner_inquiries ORDER BY created_at DESC LIMIT 5").all<Overview["inquiries"][number]>(),
    db.prepare(`SELECT kind, SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed FROM mail_log WHERE created_at > ? GROUP BY kind ORDER BY kind`).bind(week).all<{ kind: string; sent: number; failed: number }>(),
    db.prepare("SELECT kind, status, error, created_at FROM mail_log ORDER BY created_at DESC LIMIT 8").all<Overview["mail"]["recent"][number]>(),
    n("SELECT COUNT(DISTINCT r.message_id) AS n FROM flock_message_reports r JOIN flock_messages c ON c.id = r.message_id WHERE c.hidden_at IS NULL OR r.created_at > ?", week),
    db.prepare("SELECT topic, name, email, organisation, message, mail, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 10").all<Overview["contacts"][number]>()
  ]);
  const [infoTotal, infoSteering, infoNewest] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM info_meeting_signups"),
    n("SELECT COUNT(*) AS n FROM info_meeting_signups WHERE steering = 1"),
    db.prepare("SELECT name, email, steering, created_at FROM info_meeting_signups ORDER BY created_at DESC LIMIT 6").all<Overview["infoMeeting"]["newest"][number]>()
  ]);
  const newestPeople = [
    ...people.results.map(p => ({ ...p, kind: "profil" as const })),
    ...signupRows.results.map(s => ({ ...s, kind: "indmelding" as const, age_group: null }))
  ].sort((a, b) => b.at - a.at).slice(0, 12);
  const activity = [
    ...people.results.map(p => ({ at: p.at, text: `${p.name} oprettede en profil`, href: null })),
    ...signupRows.results.map(s => ({ at: s.at, text: `${s.name} meldte sig ind`, href: null })),
    ...ticks.results.map(t => ({ at: t.at, text: `${t.who} vil gerne med til ${t.title}`, href: `/events/${t.slug}` })),
    ...joins.results.map(j => ({ at: j.at, text: `${j.who} kom med i en flok til ${j.title}`, href: `/flokke/${j.id}` })),
    ...inquiries.results.map(q => ({ at: q.created_at, text: `${q.organisation} skrev om samarbejde`, href: null })),
    ...contacts.results.map(c => ({ at: c.created_at, text: `${c.organisation ?? c.name} skrev via kontaktformularen`, href: null })),
    ...infoNewest.results.map(i => ({ at: i.created_at, text: `${i.name} tilmeldte sig informationsmødet`, href: "/admin/informationsmoede" }))
  ].sort((a, b) => b.at - a.at).slice(0, 20);
  return {
    visits,
    funnel,
    members: { profiles, profilesWeek, withEmail, signups, signupsWeek, activeWeek },
    newestPeople,
    interests: interestRows.results,
    interestTotals: interestTotals ?? { people: 0, ticks: 0, events: 0 },
    flocks: flockRows.results.map(f => ({ ...f, gathered: !!f.gathered })),
    activity,
    mail: { configured: mailOn, byKind: mailKinds.results, recent: mailRecent.results },
    inquiries: inquiries.results,
    contacts: contacts.results,
    reports,
    infoMeeting: { total: infoTotal, steering: infoSteering, newest: infoNewest.results }
  };
}

// ————————————————————————————————————————— Pages

const STYLE = ["/assets/admin.css?v=5"];
export const when = (at: number, now: number) => `${dayLabel(at, now)} kl. ${hhmm(at)}`;
/** "for 5 min. siden", "i går kl. 14.05" – how long ago, as a person would say it. */
export function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "lige nu";
  if (min < 60) return `for ${min} min. siden`;
  if (min < 6 * 60) return `for ${Math.floor(min / 60)} t. siden`;
  const today = localDate(now), day = localDate(at);
  if (day === today) return `i dag kl. ${hhmm(at)}`;
  if (day === addDays(today, -1)) return `i går kl. ${hhmm(at)}`;
  return capitalize(when(at, now));
}
export const num = (n: number) => n.toLocaleString("da-DK");

export function shell(pc: PageContext, title: string, body: SafeHtml, status = 200, extra: Partial<AdminView> = {}): AdminView {
  return { status, headers: NO_STORE, ...extra, body: page(pc, { title, description: "Socialklubbens overblik.", canonical: "/admin", noindex: true, styles: STYLE }, html`<div class="wrap sk-admin">${body}</div>`) };
}

function maskEmail(e: string): string {
  const [user = "", domain = ""] = e.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(4, user.length - 2)))}@${domain}`;
}

function loginView(pc: PageContext, env: Env, state: "sent" | "off" | "failed" | "wait" | "bad" | null): AdminView {
  const to = maskEmail(adminEmail(env));
  const message = state === "sent" ? html`<p class="sk-ok">Linket er sendt til ${to}. Det virker i en time.</p>`
    : state === "off" ? html`<p class="sk-warn">Siden kan ikke sende mails lige nu (RESEND_API_KEY mangler).</p>`
    : state === "failed" ? html`<p class="sk-warn">Mailen kunne ikke sendes. Prøv igen om lidt.</p>`
    : state === "wait" ? html`<p class="sk-warn">Der er sendt flere links den seneste time. Brug det nyeste i din indbakke, eller prøv igen senere.</p>`
    : state === "bad" ? html`<p class="sk-warn">Linket er brugt eller udløbet. Få et nyt herunder.</p>`
    : null;
  return shell(pc, "Overblik – log ind", html`
  <h1>Overblik</h1>
  ${message}
  <form class="form-card sk-login" method="post" action="/admin/log-ind">
    <p>Overblikket er kun for Socialklubben. Tryk på knappen, så sender vi et login-link til ${to}.</p>
    <div class="form-actions"><button type="submit">Send mig et login-link</button></div>
  </form>`, state === "bad" ? 400 : 200);
}

function linkView(pc: PageContext, token: string): AdminView {
  return shell(pc, "Overblik – log ind", html`
  <h1>Overblik</h1>
  <form class="form-card sk-login" method="post" action="/admin/link">
    <input type="hidden" name="t" value="${token}">
    <p>Tryk på knappen for at åbne overblikket på denne enhed. Du forbliver logget ind i ${SESSION_DAYS} dage.</p>
    <div class="form-actions"><button type="submit">Åbn overblikket</button></div>
  </form>`);
}

/** Visitors per day as bars (SVG: the site's content policy allows no inline styles). */
function visitChart(days: VisitSummary["days"]): SafeHtml {
  const w = 600, h = 140, gap = 4, top = 16;
  const max = Math.max(1, ...days.map(d => d.visitors));
  const bw = (w - gap * (days.length - 1)) / days.length;
  const bars = days.map((d, i) => {
    const bh = d.visitors ? Math.max(3, Math.round((d.visitors / max) * (h - top))) : 0;
    const x = (i * (bw + gap)).toFixed(1);
    const [, mm, dd] = d.day.split("-");
    return `<rect class="${i === days.length - 1 ? "today" : ""}" x="${x}" y="${h - bh}" width="${bw.toFixed(1)}" height="${bh}" rx="2"><title>${Number(dd)}/${Number(mm)}: ${d.visitors} besøgende, ${d.views} sidevisninger</title></rect>`;
  }).join("");
  const label = (i: number, anchor: string) => { const [, mm, dd] = days[i]!.day.split("-"); return `<text x="${i === 0 ? 0 : w}" y="${h + 16}" text-anchor="${anchor}">${Number(dd)}/${Number(mm)}</text>`; };
  return raw(`<svg class="sk-chart" viewBox="0 -4 ${w} ${h + 24}" role="img" aria-label="Besøgende pr. dag de seneste ${days.length} dage"><line x1="0" x2="${w}" y1="${h}" y2="${h}"/>${bars}${label(0, "start")}${label(days.length - 1, "end")}<text x="0" y="8" class="max">${max}</text></svg>`);
}

const tile = (value: number, label: string, sub?: string) => html`<div class="sk-tile"><strong>${num(value)}</strong><span>${label}</span>${sub ? html`<small>${sub}</small>` : null}</div>`;
const sum = (days: VisitSummary["days"], key: "views" | "visitors") => days.reduce((s, d) => s + d[key], 0);
const CONTACT_MAIL: Record<string, string> = { failed: "Mail fejlede", off: "Ikke mailet", held: "Ikke mailet (dagens grænse)" };
const MAIL_KIND: Record<string, string> = { login: "Login-links", invitation: "Invitationer til flokke", reminder: "Påmindelser", status: "Status før arrangementet" };

/** "Vejen til medlem": how many people reached each step, beside the visitors, so it shows where people stop. */
function funnelView(o: Overview, d: VisitSummary["days"]) {
  if (!o.funnel.length) return null;
  const today = d[d.length - 1]!, yesterday = d[d.length - 2] ?? { views: 0, visitors: 0 };
  const visitors = { today: today.visitors, yesterday: yesterday.visitors, week: sum(d.slice(-7), "visitors"), month: sum(d, "visitors") };
  const share = (n: number) => visitors.week ? `${(Math.round(n / visitors.week * 1000) / 10).toLocaleString("da-DK")} %` : "–";
  return html`
  <section class="sk-card" aria-labelledby="vejen">
    <h2 id="vejen">Vejen til medlem</h2>
    <p class="sk-note">Hvor mange personer der nåede hvert trin. Ingen cookies: tælles som besøgende, én gang pr. person pr. dag. Talt fra 19. november 2026.</p>
    <div class="sk-scroll">
      <table class="sk-table">
        <thead><tr><th scope="col">Trin</th><th scope="col">I dag</th><th scope="col">I går</th><th scope="col">7 dage</th><th scope="col">af besøgende</th><th scope="col">30 dage</th></tr></thead>
        <tbody>
          <tr><th scope="row">Besøgende<small>alle, der så en side</small></th><td>${num(visitors.today)}</td><td>${num(visitors.yesterday)}</td><td>${num(visitors.week)}</td><td>100 %</td><td>${num(visitors.month)}</td></tr>
          ${o.funnel.map(r => html`<tr><th scope="row">${r.label}<small>${r.hint}</small></th><td>${num(r.today)}</td><td>${num(r.yesterday)}</td><td>${num(r.week)}</td><td>${share(r.week)}</td><td>${num(r.month)}</td></tr>`)}
        </tbody>
      </table>
    </div>
    <p class="sk-note">De sidste trin (indmelding og login med mail) er andre veje ind end „Jeg vil gerne med!“. Kommer-fra-listen ovenfor bruger nu også links med utm_source eller Facebooks klik-id, når appen ikke fortæller, hvor folk kom fra.</p>
  </section>`;
}

function overviewView(pc: PageContext, o: Overview, now: number): AdminView {
  const d = o.visits.days;
  const today = d[d.length - 1]!, yesterday = d[d.length - 2] ?? { views: 0, visitors: 0 };
  const week = d.slice(-7);
  const flockState = (f: Overview["flocks"][number]) => {
    const parts = [`${f.members} med`];
    if (f.pending) parts.push(`${f.pending} venter på svar`);
    parts.push(`plads til ${f.max_size}`);
    return parts.join(" · ");
  };
  return shell(pc, "Overblik", html`
  <div class="sk-head">
    <h1>Overblik</h1>
    <form method="post" action="/admin/log-ud"><button type="submit" class="button-link">Log ud</button></form>
  </div>
  <p class="sk-updated">Opdateret ${when(now, now)}. Genindlæs siden for de nyeste tal. <a class="sk-more" href="/admin/udvalg">Dagens fem i kalenderen</a></p>

  <section class="sk-card" aria-labelledby="besog">
    <h2 id="besog">Besøg</h2>
    <div class="sk-tiles">
      ${tile(today.visitors, "besøgende i dag", `${num(today.views)} sidevisninger`)}
      ${tile(yesterday.visitors, "i går", `${num(yesterday.views)} sidevisninger`)}
      ${tile(sum(week, "visitors"), "seneste 7 dage", `${num(sum(week, "views"))} sidevisninger`)}
      ${tile(sum(d, "visitors"), "seneste 30 dage", `${num(sum(d, "views"))} sidevisninger`)}
    </div>
    ${visitChart(d)}
    <p class="sk-note">Besøgende tælles pr. dag: den samme person to dage i træk tæller to gange. Robotter og dine egne besøg tælles ikke med. Ingen cookies.${o.visits.robots.week ? ` Sorteret fra som robotter: ${num(o.visits.robots.today)} sidevisninger i dag, ${num(o.visits.robots.week)} på 7 dage (fra 19. november 2026: også programmer, der udgiver sig for at være en browser, og besøg fra serverhoteller).` : ""}</p>
    <div class="sk-two">
      <div>
        <h3>Mest sete sider, 7 dage</h3>
        ${o.visits.topPages.length ? html`<ol class="sk-list">${o.visits.topPages.map(p => html`<li><a href="${p.path}">${p.path === "/" ? "Forsiden" : p.path}</a><span>${num(p.views)}</span></li>`)}</ol>` : html`<p class="sk-empty">Ingen besøg endnu.</p>`}
      </div>
      <div>
        <h3>Kommer fra, 7 dage</h3>
        ${o.visits.topSources.length ? html`<ol class="sk-list">${o.visits.topSources.map(s => html`<li><span>${s.source}</span><span>${num(s.views)}</span></li>`)}</ol>` : html`<p class="sk-empty">Ingen fra andre sider endnu (direkte besøg tælles ikke her).</p>`}
      </div>
    </div>
  </section>

  ${funnelView(o, d)}

  <section class="sk-card" aria-labelledby="medlemmer">
    <div class="sk-head"><h2 id="medlemmer">Medlemmer</h2><a class="sk-more" href="/admin/medlemmer">Alle medlemmer</a></div>
    <div class="sk-tiles">
      ${tile(o.members.profiles, "profiler", `${num(o.members.profilesWeek)} nye på 7 dage`)}
      ${tile(o.members.signups, "indmeldelser", `${num(o.members.signupsWeek)} nye på 7 dage`)}
      ${tile(o.members.withEmail, "med e-mail")}
      ${tile(o.members.activeWeek, "loggede ind", "seneste 7 dage")}
    </div>
    <h3>Nyeste</h3>
    ${o.newestPeople.length ? html`<ul class="sk-rows">${o.newestPeople.map(p => html`<li><div><a href="${p.kind === "profil" ? `/admin/medlemmer/${p.id}` : "/admin/medlemmer#indmeldelser"}"><strong>${p.name}</strong></a> ${p.kind === "indmelding" ? html`<span class="sk-tag">indmeldt</span>` : html`<span class="sk-tag sk-tag-green">profil</span>`}${p.age_group ? html` <span class="sk-muted">${p.age_group} år</span>` : null}${p.email ? html`<br><a class="sk-muted" href="mailto:${p.email}">${p.email}</a>` : null}</div><time>${ago(p.at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">Ingen endnu.</p>`}
  </section>

  <section class="sk-card" aria-labelledby="infomoede">
    <div class="sk-head"><h2 id="infomoede">Informationsmøde ${INFO_MEETING.shortDate}</h2><a class="sk-more" href="/admin/informationsmoede">Alle tilmeldte</a></div>
    <div class="sk-tiles">
      ${tile(o.infoMeeting.total, "tilmeldte")}
      ${tile(o.infoMeeting.steering, "måske styregruppe")}
    </div>
    ${o.infoMeeting.newest.length ? html`<ul class="sk-rows">${o.infoMeeting.newest.map(i => html`<li><div><strong>${i.name}</strong>${i.steering ? html` <span class="sk-tag sk-tag-green">styregruppe?</span>` : null}<br><a class="sk-muted" href="mailto:${i.email}">${i.email}</a></div><time>${ago(i.created_at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">Ingen tilmeldte endnu.</p>`}
  </section>

  <section class="sk-card" aria-labelledby="interesse">
    <h2 id="interesse">“Jeg vil gerne med!”</h2>
    <p class="sk-lead">${num(o.interestTotals.people)} personer har sagt ja til ${num(o.interestTotals.events)} kommende arrangementer (${num(o.interestTotals.ticks)} i alt). Tryk på et arrangement for at se, hvem der vil med.</p>
    ${o.interests.length ? html`<ul class="sk-rows">${o.interests.map(i => html`<li><div><a href="/admin/interesse/${i.slug}">${i.title}</a><br><span class="sk-muted">${capitalize(dayLabel(i.starts_at, now))} kl. ${hhmm(i.starts_at)}</span></div><div class="sk-counts">${i.waiting ? html`<span class="sk-tag">${i.waiting} venter</span>` : null}${i.invited ? html`<span class="sk-tag sk-tag-butter">${i.invited} inviteret</span>` : null}${i.confirmed ? html`<span class="sk-tag sk-tag-green">${i.confirmed} bekræftet</span>` : null}</div></li>`)}</ul>` : html`<p class="sk-empty">Ingen har trykket “Jeg vil gerne med!” til kommende arrangementer endnu.</p>`}
  </section>

  <section class="sk-card" aria-labelledby="flokke">
    <h2 id="flokke">Kommende flokke</h2>
    ${o.flocks.length ? html`<ul class="sk-rows">${o.flocks.map(f => html`<li><div><a href="/flokke/${f.id}">${f.title}</a><br><span class="sk-muted">Mødes ${when(f.meeting_at, now)} · ${f.meeting_place}</span><br><span class="sk-muted">${f.gathered ? "Samlet af Socialklubben" : "Startet af et medlem"}</span></div><div class="sk-counts"><span class="sk-tag ${f.members >= 3 ? "sk-tag-green" : ""}">${flockState(f)}</span></div></li>`)}</ul>` : html`<p class="sk-empty">Ingen kommende flokke endnu.</p>`}
  </section>

  <section class="sk-card" aria-labelledby="aktivitet">
    <h2 id="aktivitet">Seneste aktivitet</h2>
    ${o.activity.length ? html`<ul class="sk-rows sk-feed">${o.activity.map(a => html`<li><div>${a.href ? html`<a href="${a.href}">${a.text}</a>` : a.text}</div><time>${ago(a.at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">Intet endnu.</p>`}
    ${o.reports ? html`<p class="sk-warn">${o.reports} ${o.reports === 1 ? "chatbesked er" : "chatbeskeder er"} meldt af medlemmer.</p>` : null}
  </section>

  <section class="sk-card" aria-labelledby="mails">
    <h2 id="mails">Mails</h2>
    ${o.mail.configured ? null : html`<p class="sk-warn">Siden sender ikke mails: RESEND_API_KEY er ikke sat.</p>`}
    ${o.mail.byKind.length ? html`<ul class="sk-rows">${o.mail.byKind.map(k => html`<li><div>${MAIL_KIND[k.kind] ?? k.kind}</div><div class="sk-counts"><span class="sk-tag sk-tag-green">${k.sent} sendt</span>${k.failed ? html`<span class="sk-tag sk-tag-berry">${k.failed} fejlede</span>` : null}</div></li>`)}</ul><p class="sk-note">Seneste 7 dage.</p>` : html`<p class="sk-empty">Ingen mails de seneste 7 dage.</p>`}
    ${o.mail.recent.some(m => m.status === "failed") ? html`<h3>Seneste fejl</h3><ul class="sk-rows">${o.mail.recent.filter(m => m.status === "failed").map(m => html`<li><div>${MAIL_KIND[m.kind] ?? m.kind}<br><span class="sk-muted">${m.error ?? ""}</span></div><time>${ago(m.created_at, now)}</time></li>`)}</ul>` : null}
  </section>

  <section class="sk-card" aria-labelledby="kontakt">
    <h2 id="kontakt">Beskeder fra kontaktformularen</h2>
    ${o.contacts.length ? html`<ul class="sk-rows">${o.contacts.map(c => html`<li><div><strong>${c.organisation ? `${c.name}, ${c.organisation}` : c.name}</strong> <span class="sk-tag">${TOPICS[c.topic as Topic] ?? c.topic}</span>${c.mail === "sent" ? null : html` <span class="sk-tag sk-tag-berry">${CONTACT_MAIL[c.mail] ?? c.mail}</span>`}<br><a class="sk-muted" href="mailto:${c.email}">${c.email}</a><br><span class="sk-muted">${c.message.length > 240 ? c.message.slice(0, 240) + "…" : c.message}</span></div><time>${ago(c.created_at, now)}</time></li>`)}</ul><p class="sk-note">Beskederne sendes også til jeres indbakke. Svar på mailen, så går svaret direkte til afsenderen.</p>` : html`<p class="sk-empty">Ingen beskeder endnu.</p>`}
  </section>

  ${o.inquiries.length ? html`<section class="sk-card" aria-labelledby="henvendelser">
    <h2 id="henvendelser">Ældre henvendelser fra arrangører</h2>
    <ul class="sk-rows">${o.inquiries.map(q => html`<li><div><strong>${q.organisation}</strong><br><span class="sk-muted">${q.contact_name} · </span><a class="sk-muted" href="mailto:${q.email}">${q.email}</a></div><time>${ago(q.created_at, now)}</time></li>`)}</ul>
  </section>` : null}`);
}
