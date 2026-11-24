import type { D1Database } from "./db.js";
import { capitalize, dayLabel, hhmm } from "./time.js";
import { html, type SafeHtml } from "./web/html.js";
import type { PageContext } from "./web/layout.js";
import { badges } from "./flokken/pages.js";
import { outingsUsed } from "./flokken/profile.js";
import { ago, num, shell, when, type AdminView } from "./admin.js";

/** The admin's member pages (Jake 2026-11-16): every Socialklubben profile and member sign-up, one member's whole
 * profile (photo, marks, flocks, interests), who wants to go to an arrangement, and deleting a member with everything
 * kept about them. Samfolk's members share the table but are run from Samfolk's own admin and are left alone here.
 * src/admin.ts has checked that the request comes from the admin. */

const ID = /^[0-9a-f-]{36}$|^[A-Za-z0-9_-]{1,40}$/;
const SLUG = /^[a-z0-9-]{1,90}$/;
const SK_MEMBER = "m.flokk_joined_at IS NULL AND COALESCE(m.is_admin, 0) = 0";
const STATUS: Record<string, string> = { waiting: "venter", invited: "inviteret", confirmed: "bekræftet", declined: "sagde nej tak", expired: "svarede ikke" };
const STATUS_TAG: Record<string, string> = { waiting: "", invited: "sk-tag-butter", confirmed: "sk-tag-green", declined: "", expired: "" };
const go = (to: string): AdminView => ({ status: 303, body: "", redirect: to });
const day = (at: number, now: number) => capitalize(dayLabel(at, now));
const crumbs = (items: Array<[string, string | null]>): SafeHtml => html`<nav class="sk-crumbs" aria-label="Brødkrumme">${items.map(([label, href], i) => html`${i ? " / " : ""}${href ? html`<a href="${href}">${label}</a>` : label}`)}</nav>`;

export async function adminMembersRoute(request: Request, db: D1Database, pc: PageContext, path: string, url: URL, now: number): Promise<AdminView | null> {
  const post = request.method === "POST";
  if (path === "/admin/medlemmer" && !post) return listView(pc, db, url, now);
  const member = /^\/admin\/medlemmer\/([^/]+)(?:\/(foto|slet))?$/.exec(path);
  if (member && ID.test(member[1]!)) {
    const id = member[1]!;
    if (member[2] === "foto" && !post) {
      const row = await db.prepare("SELECT type, data FROM member_photos WHERE member_id = ?").bind(id).first<{ type: string; data: ArrayLike<number> }>();
      return row ? { status: 200, body: "", image: { type: row.type, body: new Uint8Array(row.data) } } : null;
    }
    if (member[2] === "slet" && post) {
      const form = await request.formData().catch(() => null);
      if (form?.get("bekraeft") !== "ja") return profileView(pc, db, id, now, "Sæt flueben for at bekræfte, at medlemmet skal slettes.");
      const name = await deleteMember(db, id);
      return name ? go(`/admin/medlemmer?slettet=${encodeURIComponent(name)}`) : null;
    }
    if (!member[2] && !post) return profileView(pc, db, id, now, null);
  }
  const signup = /^\/admin\/indmeldelser\/([^/]+)\/slet$/.exec(path);
  if (signup && post && ID.test(signup[1]!)) {
    const form = await request.formData().catch(() => null);
    if (form?.get("bekraeft") !== "ja") return go("/admin/medlemmer?fejl=bekraeft#indmeldelser");
    const name = await deleteSignup(db, signup[1]!);
    return name ? go(`/admin/medlemmer?slettet=${encodeURIComponent(name)}#indmeldelser`) : null;
  }
  const interest = /^\/admin\/interesse\/([a-z0-9-]+)$/.exec(path)?.[1];
  if (interest && SLUG.test(interest) && !post) return interestView(pc, db, interest, now);
  return null;
}

// ————————————————————————————————————————— Deleting

/** Deletes a Socialklubben profile and everything kept about it: photo, interests, flock places, chat messages and
 * reports, sessions, login links and a member sign-up with the same e-mail. A flock the member started passes to the
 * next member in it; a flock with no one else is deleted. The mail log keeps its lines without the member. Returns
 * the first name, or null when there is no such profile (or it belongs to Samfolk). */
export async function deleteMember(db: D1Database, id: string): Promise<string | null> {
  const m = await db.prepare(`SELECT m.first_name, lower(m.email) AS email FROM members m WHERE m.id = ? AND ${SK_MEMBER}`).bind(id).first<{ first_name: string; email: string | null }>();
  if (!m) return null;
  const nextInFlock = "SELECT fm.member_id FROM flock_members fm WHERE fm.flock_id = flocks.id AND fm.member_id <> ?1 AND fm.left_at IS NULL ORDER BY fm.joined_at LIMIT 1";
  await db.batch([
    db.prepare(`UPDATE flocks SET created_by = (${nextInFlock}) WHERE created_by = ?1 AND EXISTS (${nextInFlock})`).bind(id),
    db.prepare("UPDATE flocks SET follows_flock_id = NULL WHERE follows_flock_id IN (SELECT id FROM flocks WHERE created_by = ?1)").bind(id),
    db.prepare("UPDATE event_interests SET flock_id = NULL WHERE flock_id IN (SELECT id FROM flocks WHERE created_by = ?1)").bind(id),
    db.prepare("DELETE FROM flock_message_reports WHERE member_id = ?1 OR message_id IN (SELECT id FROM flock_messages WHERE member_id = ?1 OR flock_id IN (SELECT id FROM flocks WHERE created_by = ?1))").bind(id),
    db.prepare("DELETE FROM flock_messages WHERE member_id = ?1 OR flock_id IN (SELECT id FROM flocks WHERE created_by = ?1)").bind(id),
    db.prepare("DELETE FROM flock_members WHERE member_id = ?1 OR flock_id IN (SELECT id FROM flocks WHERE created_by = ?1)").bind(id),
    db.prepare("DELETE FROM flocks WHERE created_by = ?1").bind(id),
    db.prepare("DELETE FROM event_interests WHERE member_id = ?1").bind(id),
    db.prepare("DELETE FROM member_photos WHERE member_id = ?1").bind(id),
    db.prepare("DELETE FROM member_sessions WHERE member_id = ?1").bind(id),
    db.prepare("DELETE FROM login_links WHERE member_id = ?1 OR lower(email) = ?2").bind(id, m.email ?? ""),
    db.prepare("UPDATE mail_log SET member_id = NULL WHERE member_id = ?1").bind(id),
    db.prepare("DELETE FROM sent_mails WHERE member_id = ?1 OR lower(to_email) = ?2").bind(id, m.email ?? ""),
    db.prepare("DELETE FROM membership_signups WHERE lower(email) = ?1").bind(m.email ?? ""),
    db.prepare("DELETE FROM members WHERE id = ?1").bind(id)
  ]);
  return m.first_name;
}

/** Deletes a member sign-up (name and e-mail from /bliv-medlem) and its login links. */
export async function deleteSignup(db: D1Database, id: string): Promise<string | null> {
  const s = await db.prepare("SELECT name, lower(email) AS email FROM membership_signups WHERE id = ?").bind(id).first<{ name: string; email: string }>();
  if (!s) return null;
  await db.batch([
    db.prepare("DELETE FROM login_links WHERE member_id IS NULL AND lower(email) = ?").bind(s.email),
    db.prepare("DELETE FROM sent_mails WHERE member_id IS NULL AND lower(to_email) = ?").bind(s.email),
    db.prepare("DELETE FROM membership_signups WHERE id = ?").bind(id)
  ]);
  return s.name;
}

// ————————————————————————————————————————— Pages

type ListRow = { id: string; first_name: string; email: string | null; email_verified_at: number | null; age_group: string | null; created_at: number; last_seen_at: number; photo: number; interests: number; flocks: number };

async function listView(pc: PageContext, db: D1Database, url: URL, now: number): Promise<AdminView> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const like = `%${q.toLowerCase().replace(/[%_]/g, "")}%`;
  const [people, signups] = await Promise.all([
    db.prepare(`SELECT m.id, m.first_name, m.email, m.email_verified_at, m.age_group, m.created_at, m.last_seen_at,
        EXISTS (SELECT 1 FROM member_photos p WHERE p.member_id = m.id) AS photo,
        (SELECT COUNT(*) FROM event_interests i WHERE i.member_id = m.id) AS interests,
        (SELECT COUNT(*) FROM flock_members f WHERE f.member_id = m.id AND f.left_at IS NULL) AS flocks
      FROM members m WHERE ${SK_MEMBER} AND (lower(m.first_name) LIKE ?1 OR lower(COALESCE(m.email, '')) LIKE ?1)
      ORDER BY m.created_at DESC LIMIT 500`).bind(like).all<ListRow>(),
    db.prepare(`SELECT s.id, s.name, s.email, s.created_at FROM membership_signups s
      WHERE NOT EXISTS (SELECT 1 FROM members m WHERE lower(m.email) = lower(s.email)) AND (lower(s.name) LIKE ?1 OR lower(s.email) LIKE ?1)
      ORDER BY s.created_at DESC LIMIT 500`).bind(like).all<{ id: string; name: string; email: string; created_at: number }>()
  ]);
  const deleted = url.searchParams.get("slettet");
  const error = url.searchParams.get("fejl") === "bekraeft";
  return shell(pc, "Medlemmer", html`
  ${crumbs([["Overblik", "/admin"], ["Medlemmer", null]])}
  <h1>Medlemmer</h1>
  ${deleted ? html`<p class="sk-ok">${deleted} er slettet, med alt hvad vi havde gemt om dem.</p>` : null}
  ${error ? html`<p class="sk-warn">Sæt flueben for at bekræfte, før du sletter.</p>` : null}
  <form class="sk-search" method="get" action="/admin/medlemmer" role="search">
    <label for="q" class="visually-hidden">Søg</label>
    <input id="q" name="q" type="search" value="${q}" placeholder="Søg på navn eller e-mail">
    <button type="submit">Søg</button>
  </form>

  <section class="sk-card" aria-labelledby="profiler">
    <h2 id="profiler">Profiler (${num(people.results.length)})</h2>
    ${people.results.length ? html`<ul class="sk-rows">${people.results.map(p => html`<li><div><a href="/admin/medlemmer/${p.id}"><strong>${p.first_name}</strong></a>${p.age_group ? html` <span class="sk-muted">${p.age_group} år</span>` : null}${p.email ? html`<br><span class="sk-muted">${p.email}${p.email_verified_at ? " ✓" : ""}</span>` : null}<br><span class="sk-muted">${[p.interests ? `${p.interests} ${p.interests === 1 ? "interesse" : "interesser"}` : "", p.flocks ? `${p.flocks} ${p.flocks === 1 ? "flok" : "flokke"}` : "", p.photo ? "billede" : ""].filter(Boolean).join(" · ") || "Intet valgt endnu"}</span></div><time>Oprettet ${ago(p.created_at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">${q ? "Ingen profiler passer på søgningen." : "Ingen profiler endnu."}</p>`}
  </section>

  <section class="sk-card" aria-labelledby="indmeldelser">
    <h2 id="indmeldelser">Indmeldt uden profil (${num(signups.results.length)})</h2>
    <p class="sk-note">Har meldt sig ind med navn og e-mail, men har ikke logget ind endnu.</p>
    ${signups.results.length ? html`<ul class="sk-rows">${signups.results.map(s => html`<li><div><strong>${s.name}</strong><br><a class="sk-muted" href="mailto:${s.email}">${s.email}</a>
      <details class="sk-delete-small"><summary>Slet</summary><form method="post" action="/admin/indmeldelser/${s.id}/slet"><label><input type="checkbox" name="bekraeft" value="ja" required> Ja, slet ${s.name}</label><button type="submit" class="button-quiet">Slet for altid</button></form></details></div><time>${ago(s.created_at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">Ingen.</p>`}
  </section>`);
}

async function profileView(pc: PageContext, db: D1Database, id: string, now: number, error: string | null): Promise<AdminView | null> {
  const p = await db.prepare(`SELECT m.id, m.first_name, m.email, m.email_verified_at, m.age_group, m.intro, m.created_at, m.last_seen_at, ph.id AS photo_id, ph.consent_at
    FROM members m LEFT JOIN member_photos ph ON ph.member_id = m.id WHERE m.id = ? AND ${SK_MEMBER}`).bind(id)
    .first<{ id: string; first_name: string; email: string | null; email_verified_at: number | null; age_group: string | null; intro: string | null; created_at: number; last_seen_at: number; photo_id: string | null; consent_at: number | null }>();
  if (!p) return null;
  const [times, interests, flocks, messages, mails, lastLogin] = await Promise.all([
    outingsUsed(db, id, now),
    db.prepare(`SELECT e.slug, e.title, e.starts_at, i.status, i.created_at FROM event_interests i JOIN events e ON e.id = i.event_id
      WHERE i.member_id = ? ORDER BY e.starts_at DESC LIMIT 60`).bind(id).all<{ slug: string; title: string; starts_at: number; status: string; created_at: number }>(),
    db.prepare(`SELECT f.id, e.title, e.starts_at, f.meeting_place, f.meeting_at, fm.joined_at, fm.left_at, f.created_by = fm.member_id AS host,
        (SELECT COUNT(*) FROM flock_members x WHERE x.flock_id = f.id AND x.left_at IS NULL) AS size
      FROM flock_members fm JOIN flocks f ON f.id = fm.flock_id JOIN events e ON e.id = f.event_id WHERE fm.member_id = ? ORDER BY f.meeting_at DESC LIMIT 60`).bind(id)
      .all<{ id: string; title: string; starts_at: number; meeting_place: string; meeting_at: number; joined_at: number; left_at: number | null; host: number; size: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM flock_messages WHERE member_id = ?").bind(id).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE member_id = ? AND status = 'sent'").bind(id).first<{ n: number }>(),
    db.prepare("SELECT MAX(created_at) AS at FROM member_sessions WHERE member_id = ?").bind(id).first<{ at: number | null }>()
  ]);
  return shell(pc, `${p.first_name} – medlem`, html`
  ${crumbs([["Overblik", "/admin"], ["Medlemmer", "/admin/medlemmer"], [p.first_name, null]])}
  ${error ? html`<p class="sk-warn">${error}</p>` : null}
  <section class="sk-card sk-profile">
    ${p.photo_id ? html`<img class="sk-photo" src="/admin/medlemmer/${p.id}/foto" alt="Billede af ${p.first_name}" width="120" height="120">` : html`<div class="sk-photo sk-photo-none" aria-hidden="true">${p.first_name.charAt(0)}</div>`}
    <div>
      <h1>${p.first_name}</h1>
      ${p.age_group ? html`<p class="sk-muted">${p.age_group} år</p>` : null}
      ${p.intro ? html`<p class="sk-intro">“${p.intro}”</p>` : null}
      ${badges({ email_verified_at: p.email_verified_at, times })}
    </div>
  </section>

  <section class="sk-card">
    <h2>Oplysninger</h2>
    <dl class="sk-facts">
      <dt>E-mail</dt><dd>${p.email ? html`<a href="mailto:${p.email}">${p.email}</a>${p.email_verified_at ? html` <span class="sk-tag sk-tag-green">bekræftet</span>` : html` <span class="sk-tag">ikke bekræftet</span>`}` : "Ingen"}</dd>
      <dt>Oprettet</dt><dd>${capitalize(when(p.created_at, now))}</dd>
      <dt>Senest logget ind</dt><dd>${lastLogin?.at ? capitalize(ago(lastLogin.at, now)) : "Ikke inden for de seneste 90 dage"}</dd>
      <dt>Billede</dt><dd>${p.photo_id ? `Ja${p.consent_at ? ", med samtykke" : ""}` : "Nej"}</dd>
      <dt>Chatbeskeder</dt><dd>${num(messages?.n ?? 0)}</dd>
      <dt>Mails sendt</dt><dd>${num(mails?.n ?? 0)}</dd>
    </dl>
  </section>

  <section class="sk-card">
    <h2>Flokke</h2>
    ${flocks.results.length ? html`<ul class="sk-rows">${flocks.results.map(f => html`<li><div><a href="/flokke/${f.id}">${f.title}</a><br><span class="sk-muted">Mødes ${when(f.meeting_at, now)} · ${f.meeting_place}</span></div><div class="sk-counts">${f.left_at ? html`<span class="sk-tag">forlod flokken</span>` : html`<span class="sk-tag sk-tag-green">${f.size} med</span>`}${f.host ? html`<span class="sk-tag sk-tag-butter">startede den</span>` : null}</div></li>`)}</ul>` : html`<p class="sk-empty">Ikke med i nogen flok endnu.</p>`}
  </section>

  <section class="sk-card">
    <h2>“Jeg vil gerne med!”</h2>
    ${interests.results.length ? html`<ul class="sk-rows">${interests.results.map(i => html`<li><div><a href="/admin/interesse/${i.slug}">${i.title}</a><br><span class="sk-muted">${day(i.starts_at, now)} kl. ${hhmm(i.starts_at)}${i.starts_at < now ? " (afholdt)" : ""}</span></div><div class="sk-counts"><span class="sk-tag ${STATUS_TAG[i.status] ?? ""}">${STATUS[i.status] ?? i.status}</span></div></li>`)}</ul>` : html`<p class="sk-empty">Har ikke trykket på noget endnu.</p>`}
  </section>

  <section class="sk-card sk-danger" aria-labelledby="slet">
    <h2 id="slet">Slet ${p.first_name}</h2>
    <p>Profilen slettes for altid sammen med billede, interesser, pladser i flokke, chatbeskeder og indmelding. Flokke, ${p.first_name} har startet, går videre til den næste i flokken. Det kan ikke fortrydes.</p>
    <form method="post" action="/admin/medlemmer/${p.id}/slet">
      <label class="sk-confirm"><input type="checkbox" name="bekraeft" value="ja" required> Ja, slet ${p.first_name} og alt om ${p.first_name}</label>
      <button type="submit" class="button-quiet">Slet medlem</button>
    </form>
  </section>`, error ? 400 : 200);
}

async function interestView(pc: PageContext, db: D1Database, slug: string, now: number): Promise<AdminView | null> {
  const e = await db.prepare("SELECT id, slug, title, starts_at, venue_name FROM events WHERE slug = ?").bind(slug).first<{ id: string; slug: string; title: string; starts_at: number; venue_name: string | null }>();
  if (!e) return null;
  const { results } = await db.prepare(`SELECT m.id, m.first_name, m.age_group, m.email, i.status, i.created_at, i.respond_by,
      ${SK_MEMBER} AS own, EXISTS (SELECT 1 FROM member_photos p WHERE p.member_id = m.id) AS photo
    FROM event_interests i JOIN members m ON m.id = i.member_id WHERE i.event_id = ?
    ORDER BY CASE i.status WHEN 'confirmed' THEN 0 WHEN 'invited' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, i.created_at`).bind(e.id)
    .all<{ id: string; first_name: string; age_group: string | null; email: string | null; status: string; created_at: number; respond_by: number | null; own: number; photo: number }>();
  return shell(pc, `Hvem vil med – ${e.title}`, html`
  ${crumbs([["Overblik", "/admin"], ["Hvem vil med", null]])}
  <h1>${e.title}</h1>
  <p class="sk-muted">${day(e.starts_at, now)} kl. ${hhmm(e.starts_at)}${e.venue_name ? ` · ${e.venue_name}` : ""} · <a href="/events/${e.slug}">Se arrangementet</a></p>
  <section class="sk-card">
    <h2>${num(results.length)} har trykket “Jeg vil gerne med!”</h2>
    ${results.length ? html`<ul class="sk-rows">${results.map(r => html`<li><div>${r.own ? html`<a href="/admin/medlemmer/${r.id}"><strong>${r.first_name}</strong></a>` : html`<strong>${r.first_name}</strong>`}${r.age_group ? html` <span class="sk-muted">${r.age_group} år</span>` : null}${r.email ? html`<br><span class="sk-muted">${r.email}</span>` : null}<br><span class="sk-muted">Trykkede ${ago(r.created_at, now)}${r.status === "invited" && r.respond_by ? ` · skal svare senest ${when(r.respond_by, now)}` : ""}</span></div><div class="sk-counts"><span class="sk-tag ${STATUS_TAG[r.status] ?? ""}">${STATUS[r.status] ?? r.status}</span></div></li>`)}</ul>` : html`<p class="sk-empty">Ingen endnu.</p>`}
  </section>`);
}
