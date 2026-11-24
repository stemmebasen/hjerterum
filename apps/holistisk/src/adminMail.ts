import type { D1Database } from "./db.js";
import type { Env } from "./env.js";
import { keepSent } from "./mail.js";
import { html, type SafeHtml } from "./web/html.js";
import type { PageContext } from "./web/layout.js";
import { ago, num, shell, when, type AdminView } from "./admin.js";

/** "Sendt post" at /admin/post (Jake 2026-11-24): every mail the site has sent (sent_mails, written by sendMail in
 * src/mail.ts), newest first, with recipient, subject, time and kind, and each mail opened as it looked. A button
 * fetches older mails from Resend's own log, for those sent before the site kept them itself. src/admin.ts has checked
 * that the request comes from the admin. */

const PER_PAGE = 50;
const ID = /^[0-9a-f-]{36}$/;
/** Resend's list endpoint gives 100 at a time; a Worker on the free plan may make 50 requests in all, so one press
 * fetches at most this many whole mails. Press again for more. */
const IMPORT_MAX = 40;

export const KIND_LABEL: Record<string, string> = {
  login: "Login-link",
  invitation: "Invitation til flok",
  reminder: "Påmindelse",
  status: "Status før arrangement",
  kontakt: "Kontaktformular",
  anden: "Anden"
};
const STATUS: Record<string, string> = { failed: "Fejlede", off: "Ikke sendt (mail slået fra)" };
const kindLabel = (k: string) => KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

type Row = { id: string; kind: string; to_email: string; subject: string; status: string; error: string | null; source: string; created_at: number };

export async function adminMailRoute(request: Request, env: Env, db: D1Database, pc: PageContext, path: string, url: URL, now: number): Promise<AdminView | null> {
  if (path === "/admin/post" && request.method !== "POST") return listView(pc, db, url, now, !!env.RESEND_API_KEY);
  if (path === "/admin/post/hent" && request.method === "POST") {
    const r = await importFromResend(db, env);
    const q = "error" in r ? `fejl=${encodeURIComponent(r.error)}` : `hentet=${r.added}${r.more ? "&mere=1" : ""}`;
    return { status: 303, body: "", redirect: `/admin/post?${q}` };
  }
  const m = /^\/admin\/post\/([^/]+)(\/vis)?$/.exec(path);
  if (!m || !ID.test(m[1]!) || request.method === "POST") return null;
  const row = await db.prepare("SELECT s.*, m.first_name FROM sent_mails s LEFT JOIN members m ON m.id = s.member_id WHERE s.id = ?").bind(m[1]!)
    .first<Row & { html: string | null; text: string | null; reply_to: string | null; member_id: string | null; first_name: string | null; provider_id: string | null }>();
  if (!row) return null;
  return m[2] ? mailBody(row.html, row.text) : mailView(pc, row, now);
}

// ————————————————————————————————————————— The list

async function listView(pc: PageContext, db: D1Database, url: URL, now: number, resend: boolean): Promise<AdminView> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const kind = (url.searchParams.get("type") ?? "").slice(0, 40);
  const pageNo = Math.max(1, Math.min(200, Number(url.searchParams.get("side")) || 1));
  const like = `%${q.toLowerCase().replace(/[%_]/g, "")}%`;
  const where = `(lower(to_email) LIKE ?1 OR lower(subject) LIKE ?1) AND (?2 = '' OR kind = ?2)`;
  const [rows, total, kinds] = await Promise.all([
    db.prepare(`SELECT id, kind, to_email, subject, status, error, source, created_at FROM sent_mails WHERE ${where} ORDER BY created_at DESC LIMIT ?3 OFFSET ?4`)
      .bind(like, kind, PER_PAGE, (pageNo - 1) * PER_PAGE).all<Row>(),
    db.prepare(`SELECT COUNT(*) AS n FROM sent_mails WHERE ${where}`).bind(like, kind).first<{ n: number }>(),
    db.prepare("SELECT kind, COUNT(*) AS n FROM sent_mails GROUP BY kind ORDER BY n DESC").all<{ kind: string; n: number }>()
  ]);
  const n = total?.n ?? 0;
  const pages = Math.max(1, Math.ceil(n / PER_PAGE));
  const link = (p: number) => `/admin/post?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { type: kind } : {}), ...(p > 1 ? { side: String(p) } : {}) })}`;
  const fetched = url.searchParams.get("hentet");
  const error = url.searchParams.get("fejl");

  return shell(pc, "Sendt post", html`
  <nav class="sk-crumbs" aria-label="Brødkrumme"><a href="/admin">Overblik</a> / Sendt post</nav>
  <h1>Sendt post</h1>
  <p class="sk-lead">Alle mails, siden har sendt: login-links, invitationer, påmindelser, statusmails og beskeder fra kontaktformularen. Tryk på en mail for at se den, som modtageren fik den.</p>
  ${fetched !== null ? html`<p class="sk-ok">${fetched === "0" ? "Der var ikke flere mails at hente fra Resend." : `Hentede ${fetched} ${fetched === "1" ? "mail" : "mails"} fra Resend.`}${url.searchParams.get("mere") ? " Der er flere: tryk igen." : ""}</p>` : null}
  ${error ? html`<p class="sk-warn">Kunne ikke hente fra Resend: ${error}</p>` : null}
  <form class="sk-search" method="get" action="/admin/post" role="search">
    <label for="q" class="visually-hidden">Søg</label>
    <input id="q" name="q" type="search" value="${q}" placeholder="Søg på modtager eller emne">
    ${kind ? html`<input type="hidden" name="type" value="${kind}">` : null}
    <button type="submit">Søg</button>
  </form>
  ${kinds.results.length > 1 ? html`<nav class="sk-filter" aria-label="Type">
    <a href="/admin/post${q ? `?q=${encodeURIComponent(q)}` : ""}"${kind ? null : html` aria-current="page"`}>Alle</a>
    ${kinds.results.map(k => html`<a href="/admin/post?${String(new URLSearchParams({ ...(q ? { q } : {}), type: k.kind }))}"${k.kind === kind ? html` aria-current="page"` : null}>${kindLabel(k.kind)} <small>${num(k.n)}</small></a>`)}
  </nav>` : null}

  <section class="sk-card" aria-labelledby="post">
    <h2 id="post">${num(n)} ${n === 1 ? "mail" : "mails"}${q || kind ? " fundet" : ""}</h2>
    ${rows.results.length ? html`<ul class="sk-rows">${rows.results.map(r => html`<li><div>
      <a href="/admin/post/${r.id}"><strong>${r.subject || "(uden emne)"}</strong></a><br>
      <span class="sk-muted">Til ${r.to_email}</span><br>
      <span class="sk-tag">${kindLabel(r.kind)}</span>${r.status === "sent" ? null : html` <span class="sk-tag sk-tag-berry">${STATUS[r.status] ?? r.status}</span>`}${r.source === "resend" ? html` <span class="sk-muted">fra Resend</span>` : null}
    </div><time title="${when(r.created_at, now)}">${ago(r.created_at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">${q || kind ? "Ingen mails passer på søgningen." : "Ingen mails endnu."}</p>`}
    ${pages > 1 ? html`<nav class="sk-pager" aria-label="Sider">${pageNo > 1 ? html`<a href="${link(pageNo - 1)}">← Nyere</a>` : html`<span></span>`}<span class="sk-muted">Side ${pageNo} af ${pages}</span>${pageNo < pages ? html`<a href="${link(pageNo + 1)}">Ældre →</a>` : html`<span></span>`}</nav>` : null}
  </section>

  <section class="sk-card" aria-labelledby="aeldre">
    <h2 id="aeldre">Ældre mails</h2>
    <p class="sk-note">Siden har gemt hver mail siden 24. november 2026. Mails sendt før det kan hentes fra Resend, så længe Resend stadig har dem. Login-links vises aldrig, så ingen kan logge ind herfra. Mails gemmes i et år.</p>
    ${resend ? html`<form method="post" action="/admin/post/hent"><button type="submit" class="button-link">Hent fra Resend</button></form>` : html`<p class="sk-empty">Resend er ikke sat op (RESEND_API_KEY).</p>`}
  </section>`);
}

// ————————————————————————————————————————— One mail

function mailView(pc: PageContext, r: Row & { html: string | null; text: string | null; reply_to: string | null; member_id: string | null; first_name: string | null }, now: number): AdminView {
  const line = (label: string, value: SafeHtml | string | null) => value ? html`<div><dt>${label}</dt><dd>${value}</dd></div>` : null;
  return shell(pc, r.subject || "Mail", html`
  <nav class="sk-crumbs" aria-label="Brødkrumme"><a href="/admin">Overblik</a> / <a href="/admin/post">Sendt post</a> / Mail</nav>
  <h1 class="sk-mail-subject">${r.subject || "(uden emne)"}</h1>
  <section class="sk-card">
    <dl class="sk-meta">
      ${line("Til", r.member_id && r.first_name ? html`${r.to_email} · <a href="/admin/medlemmer/${r.member_id}">${r.first_name}s profil</a>` : r.to_email)}
      ${line("Sendt", `${when(r.created_at, now)} (${ago(r.created_at, now)})`)}
      ${line("Type", kindLabel(r.kind))}
      ${line("Svar går til", r.reply_to)}
      ${line("Status", r.status === "sent" ? (r.source === "resend" ? "Sendt (hentet fra Resend)" : "Sendt") : `${STATUS[r.status] ?? r.status}${r.error ? `: ${r.error}` : ""}`)}
    </dl>
  </section>
  ${r.html ? html`<iframe class="sk-mail-frame" src="/admin/post/${r.id}/vis" title="Mailen, som modtageren så den" sandbox="allow-popups allow-popups-to-escape-sandbox" loading="lazy"></iframe>` : null}
  ${r.text ? html`<details class="sk-card sk-mail-text"${r.html ? null : html` open`}><summary>Tekstudgaven</summary><pre>${r.text}</pre></details>` : null}
  ${!r.html && !r.text ? html`<p class="sk-empty">Selve mailen er ikke gemt.</p>` : null}`);
}

/** The mail's own HTML, shown in a sandboxed frame on the mail's page. It has its own strict policy: inline styles
 * (mails need them) and images, nothing else; links open in a new tab. */
function mailBody(body: string | null, text: string | null): AdminView {
  const doc = body ?? `<pre style="white-space:pre-wrap;font:15px/1.5 Helvetica,Arial,sans-serif">${(text ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
  const withBase = /<head[^>]*>/i.test(doc) ? doc.replace(/<head([^>]*)>/i, `<head$1><base target="_blank">`) : `<base target="_blank">${doc}`;
  return {
    status: 200,
    body: withBase,
    headers: {
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; frame-ancestors 'self'; form-action 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
      "x-frame-options": "SAMEORIGIN"
    }
  };
}

// ————————————————————————————————————————— Fetching older mails from Resend

type ResendListItem = { id: string; to?: string[] | string; subject?: string; created_at?: string; last_event?: string; reply_to?: string[] | string | null };
type ResendEmail = ResendListItem & { html?: string | null; text?: string | null };

/** Resend writes times like "2026-11-20 18:04:11.123456+00". */
export const resendTime = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isFinite(t) ? t : null;
};

/** Guesses the kind of an older mail from its subject (the site's own subjects). */
export function kindFromSubject(subject: string): string {
  if (/login-link|Log ind på Socialklubbens overblik|^Velkommen til Socialklubben/i.test(subject)) return "login";
  if (/^(Kontakt|Arrangør):/.test(subject)) return "kontakt";
  if (/påmindelse|husk/i.test(subject)) return "reminder";
  if (/plads i en flok|flok/i.test(subject)) return "invitation";
  return "anden";
}

const first = (v: string[] | string | null | undefined): string => Array.isArray(v) ? v[0] ?? "" : v ?? "";

/** Fetches mails from Resend's log that the site has not kept, newest first, at most IMPORT_MAX per call. */
export async function importFromResend(db: D1Database, env: Env, fetcher: typeof fetch = fetch): Promise<{ added: number; more: boolean } | { error: string }> {
  if (!env.RESEND_API_KEY) return { error: "RESEND_API_KEY er ikke sat" };
  const get = async <T>(path: string): Promise<T | { error: string }> => {
    try {
      const r = await fetcher(`https://api.resend.com${path}`, { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } });
      if (r.status === 401 || r.status === 403) return { error: "Resend-nøglen må kun sende mails, ikke læse dem. Lav en nøgle med fuld adgang i Resend, hvis du vil hente de ældre mails." };
      if (!r.ok) return { error: `Resend svarede ${r.status}` };
      return (await r.json()) as T;
    } catch {
      return { error: "Resend svarede ikke" };
    }
  };
  const missing: ResendListItem[] = [];
  let after = "", more = false;
  for (let i = 0; i < 5 && missing.length < IMPORT_MAX; i++) {
    const list = await get<{ data?: ResendListItem[]; has_more?: boolean }>(`/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if ("error" in list) return list;
    const data = (list.data ?? []).filter(e => typeof e.id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(e.id));
    if (!data.length) break;
    const ids = data.map(e => e.id);
    const known = await db.prepare(`SELECT provider_id FROM sent_mails WHERE provider_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ provider_id: string }>();
    const have = new Set(known.results.map(k => k.provider_id));
    missing.push(...data.filter(e => !have.has(e.id)));
    after = data[data.length - 1]!.id;
    more = !!list.has_more;
    if (!more) break;
  }
  const take = missing.slice(0, IMPORT_MAX);
  let added = 0;
  for (const item of take) {
    const full = await get<ResendEmail>(`/emails/${item.id}`);
    const e: ResendEmail = "error" in full ? item : { ...item, ...full };
    const at = resendTime(e.created_at) ?? Date.now();
    const bad = /bounced|failed|complained/.test(e.last_event ?? "");
    const subject = e.subject ?? "";
    const replyTo = first(e.reply_to);
    await keepSent(db, {
      to: first(e.to), subject, html: e.html ?? "", text: e.text ?? "", kind: kindFromSubject(subject), ...(replyTo ? { replyTo } : {})
    }, bad ? { ok: false, error: `Resend: ${e.last_event}` } : { ok: true }, at, { source: "resend", providerId: e.id });
    added++;
  }
  return { added, more: more || missing.length > take.length };
}
