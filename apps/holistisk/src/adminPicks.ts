import type { D1Database } from "./db.js";
import { DAILY, pickDay, sameArrangement, scoreEvent, setCuration, type DayPick } from "./curation.js";
import { addDays, capitalize, dayLabel, hhmm, localDate, nextLocalDate, startOfLocalDay, weekdayIndex } from "./time.js";
import { html, type SafeHtml } from "./web/html.js";
import type { PageContext } from "./web/layout.js";
import { curationPool, type PoolRow } from "./web/queries.js";
import { shell, type AdminView } from "./admin.js";

/** /admin/udvalg: "Dagens fem" day by day (src/curation.ts), with why each arrangement is or isn't among them, and
 * buttons to pin an arrangement (always among its day's picks) or hide it (off every list and search). src/admin.ts
 * has checked that the request comes from the admin. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]{1,90}$/;
const SHOW_DAYS = 14;
const WEEKDAYS = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];

export async function adminPicksRoute(request: Request, db: D1Database, pc: PageContext, path: string, url: URL, now: number): Promise<AdminView | null> {
  const today = localDate(now);
  if (path === "/admin/udvalg" && request.method !== "POST") {
    const asked = url.searchParams.get("dag") ?? "";
    const day = DATE.test(asked) && asked >= today && asked <= addDays(today, 89) ? asked : today;
    return picksView(pc, db, day, now);
  }
  const m = /^\/admin\/udvalg\/([^/]+)$/.exec(path);
  if (m && request.method === "POST" && SLUG.test(m[1]!)) {
    const form = await request.formData().catch(() => null);
    const action = String(form?.get("handling") ?? "");
    const day = String(form?.get("dag") ?? "");
    const mode = action === "fastgoer" ? "pin" : action === "skjul" ? "hide" : action === "nulstil" ? null : undefined;
    if (mode === undefined) return null;
    const event = await db.prepare("SELECT id FROM events WHERE slug = ?").bind(m[1]!).first<{ id: string }>();
    if (!event) return null;
    await setCuration(db, event.id, mode, now);
    return { status: 303, body: "", redirect: `/admin/udvalg${DATE.test(day) ? `?dag=${day}` : ""}#${m[1]}` };
  }
  return null;
}

async function dayPool(db: D1Database, day: string): Promise<PoolRow[]> {
  const from = startOfLocalDay(day), until = startOfLocalDay(nextLocalDate(day));
  return from === null || until === null ? [] : curationPool(db, from, until);
}

async function picksView(pc: PageContext, db: D1Database, day: string, now: number): Promise<AdminView> {
  const today = localDate(now);
  const days = Array.from({ length: SHOW_DAYS }, (_, i) => addDays(today, i));
  const counts = await db.prepare("SELECT day, COUNT(*) AS n FROM event_picks WHERE day >= ? AND day <= ? GROUP BY day").bind(today, days[days.length - 1]!).all<{ day: string; n: number }>();
  const pickedOn = new Map(counts.results.map(r => [r.day, r.n]));
  const pool = await dayPool(db, day);
  const picks = pickDay(pool);
  const pickedIds = new Set(picks.map(p => p.event.id));
  const rest = pool.filter(e => !pickedIds.has(e.id))
    .map(e => ({ e, s: scoreEvent(e) }))
    .sort((a, b) => ("score" in b.s ? b.s.score : -99) - ("score" in a.s ? a.s.score : -99) || a.e.starts_at - b.e.starts_at);
  const label = capitalize(dayLabel(startOfLocalDay(day) ?? now, now));

  const actions = (e: PoolRow): SafeHtml => {
    const button = (handling: string, text: string) => html`<form method="post" action="/admin/udvalg/${e.slug}"><input type="hidden" name="dag" value="${day}"><input type="hidden" name="handling" value="${handling}"><button type="submit" class="button-link">${text}</button></form>`;
    return html`<div class="sk-actions">${e.curation === "pin" ? button("nulstil", "Fjern fastgørelse") : button("fastgoer", "Fastgør")}${e.curation === "hide" ? button("nulstil", "Vis igen") : button("skjul", "Skjul")}</div>`;
  };
  const line = (e: PoolRow, tags: SafeHtml, why: string) => html`<li id="${e.slug}"><div>
      <a href="/events/${e.slug}">${e.title}</a><br>
      <span class="sk-muted">${e.all_day ? "Hele dagen" : `Kl. ${hhmm(e.starts_at)}`} · ${e.venue_name ?? e.organizer_name ?? ""}</span><br>
      <span class="sk-muted">${why}</span>
      ${actions(e)}
    </div><div class="sk-counts">${tags}</div></li>`;
  const pickTag = (p: DayPick) => p.why === "fastgjort" ? html`<span class="sk-tag sk-tag-berry">fastgjort</span>`
    : p.why === "flok" ? html`<span class="sk-tag sk-tag-green">flok på vej</span>` : html`<span class="sk-tag sk-tag-green">${p.score} point</span>`;

  return shell(pc, "Dagens fem", html`
  <nav class="sk-crumbs" aria-label="Brødkrumme"><a href="/admin">Overblik</a> / Dagens fem</nav>
  <h1>Dagens fem</h1>
  <p class="sk-lead">Kalenderen viser højst ${DAILY} arrangementer om dagen: dem, der får flest point for at være gode at tage til sammen med andre, med højst én fra samme sted og sjældent mere end to af samme slags. Søgning og arrangørernes egne sider viser stadig alle, undtagen dem du har skjult.</p>
  <nav class="sk-days" aria-label="Vælg en dag">${days.map(d => {
    const [, m2, d2] = d.split("-").map(Number);
    return html`<a href="/admin/udvalg?dag=${d}"${d === day ? html` aria-current="page"` : ""}><span>${WEEKDAYS[weekdayIndex(d)]}</span><strong>${d2}/${m2}</strong><small>${pickedOn.get(d) ?? 0} valgt</small></a>`;
  })}</nav>

  <section class="sk-card" aria-labelledby="valgt">
    <h2 id="valgt">${label}: ${picks.length} med</h2>
    ${picks.length ? html`<ul class="sk-rows">${picks.map(p => line(p.event as PoolRow, pickTag(p), p.reasons.join(", ")))}</ul>` : html`<p class="sk-empty">Ingen arrangementer er gode nok denne dag.</p>`}
  </section>

  <section class="sk-card" aria-labelledby="ikke-med">
    <h2 id="ikke-med">Ikke med (${rest.length})</h2>
    ${rest.length ? html`<ul class="sk-rows">${rest.map(({ e, s }) => {
      const twin = picks.find(p => sameArrangement(p.event, e));
      return line(e, "excluded" in s
        ? html`<span class="sk-tag">${s.excluded}</span>`
        : html`<span class="sk-tag">${twin ? "dublet" : `${s.score} point`}</span>`, "excluded" in s ? "" : twin ? `Samme som “${twin.event.title}”` : s.reasons.join(", "));
    })}</ul>` : html`<p class="sk-empty">Alle denne dags arrangementer er med.</p>`}
  </section>`);
}
