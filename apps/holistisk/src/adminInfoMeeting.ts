import type { D1Database } from "./db.js";
import { html, type SafeHtml } from "./web/html.js";
import type { PageContext } from "./web/layout.js";
import { deleteInfo, INFO_MEETING, listInfo, timeLabel } from "./flokken/infoMeeting.js";
import { ago, num, shell, type AdminView } from "./admin.js";

/** The admin's list of who signed up for the information meeting (Jake 2026-11-24), with every e-mail ready to copy
 * and a way to remove someone. src/admin.ts has checked that the request comes from the admin. */

const ID = /^[0-9a-f-]{36}$/;
const MAIL: Record<string, string> = { sent: "bekræftelse sendt", failed: "bekræftelse fejlede", off: "mail er ikke sat op", held: "dagens mailgrænse nået" };
const go = (to: string): AdminView => ({ status: 303, body: "", redirect: to });
const crumbs = (items: Array<[string, string | null]>): SafeHtml => html`<nav class="sk-crumbs" aria-label="Brødkrumme">${items.map(([label, href], i) => html`${i ? " / " : ""}${href ? html`<a href="${href}">${label}</a>` : label}`)}</nav>`;

export async function adminInfoMeetingRoute(request: Request, db: D1Database, pc: PageContext, path: string, url: URL, now: number): Promise<AdminView | null> {
  const post = request.method === "POST";
  if (path === "/admin/informationsmoede" && !post) return listView(pc, db, url, now);
  const del = /^\/admin\/informationsmoede\/([^/]+)\/slet$/.exec(path)?.[1];
  if (del && post && ID.test(del)) {
    const form = await request.formData().catch(() => null);
    if (form?.get("bekraeft") !== "ja") return go("/admin/informationsmoede?fejl=bekraeft");
    const name = await deleteInfo(db, del);
    return name ? go(`/admin/informationsmoede?slettet=${encodeURIComponent(name)}`) : null;
  }
  return null;
}

async function listView(pc: PageContext, db: D1Database, url: URL, now: number): Promise<AdminView> {
  const rows = await listInfo(db);
  const steering = rows.filter(r => r.steering);
  const deleted = url.searchParams.get("slettet");
  const error = url.searchParams.get("fejl") === "bekraeft";
  return shell(pc, "Informationsmøde", html`
  ${crumbs([["Overblik", "/admin"], ["Informationsmøde", null]])}
  <h1>Informationsmøde ${INFO_MEETING.shortDate}</h1>
  <p class="sk-updated">${INFO_MEETING.dateLabel}, ${timeLabel()}, ${INFO_MEETING.place}. <a class="sk-more" href="/informationsmoede">Se siden</a></p>
  ${deleted ? html`<p class="sk-ok">${deleted} er fjernet fra listen.</p>` : null}
  ${error ? html`<p class="sk-warn">Sæt flueben for at bekræfte, før du fjerner nogen.</p>` : null}

  <section class="sk-card" aria-labelledby="tilmeldte">
    <h2 id="tilmeldte">Tilmeldte (${num(rows.length)})</h2>
    <p class="sk-note">${num(steering.length)} har sat kryds ved, at de måske kunne have lyst til at være med i styregruppen.</p>
    ${rows.length ? html`<ul class="sk-rows">${rows.map(r => html`<li><div><strong>${r.name}</strong>${r.steering ? html` <span class="sk-tag sk-tag-green">styregruppe?</span>` : null}${r.mail === "sent" ? null : html` <span class="sk-tag sk-tag-berry">${MAIL[r.mail] ?? r.mail}</span>`}<br><a class="sk-muted" href="mailto:${r.email}">${r.email}</a>
      <details class="sk-delete-small"><summary>Fjern</summary><form method="post" action="/admin/informationsmoede/${r.id}/slet"><label><input type="checkbox" name="bekraeft" value="ja" required> Ja, fjern ${r.name} fra listen</label><button type="submit" class="button-quiet">Fjern</button></form></details></div><time>${ago(r.created_at, now)}</time></li>`)}</ul>` : html`<p class="sk-empty">Ingen tilmeldte endnu.</p>`}
  </section>

  ${rows.length ? html`<section class="sk-card" aria-labelledby="adresser">
    <h2 id="adresser">Alle e-mails</h2>
    <p class="sk-note">Kopiér dem ind i Bcc-feltet, hvis du vil skrive til alle på én gang.</p>
    <textarea class="sk-copy" rows="4" readonly aria-labelledby="adresser">${rows.map(r => r.email).join(", ")}</textarea>
    ${steering.length ? html`<h3>Måske styregruppe</h3><textarea class="sk-copy" rows="2" readonly aria-label="E-mails, måske styregruppe">${steering.map(r => r.email).join(", ")}</textarea>` : null}
  </section>` : null}`);
}
