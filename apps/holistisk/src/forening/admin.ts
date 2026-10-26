import { categoryBySlug } from "../categories.js";
import { capitalize, dayLabel, hhmm } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { page, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import type { EventRow } from "../web/queries.js";
import { AGE_LABELS, type FormErrors, type PickForm } from "./forms.js";
import { turFields } from "./memberPages.js";
import { closesAt, PLANS, type Counts, type Participant, type SamfolkMember } from "./members.js";
import { picksPath, when } from "./pages.js";
import type { Interest, PickRow, PickWithCreator, Subscriber } from "./store.js";

/** The volunteers' pages (behind login): every tur, Samfolk's own events, the members, Samfolk-brevet's list, and
 * what is left from earlier versions (the interest list, inquiries from organisers). Never indexed, never cached. */

function adminPage(ctx: PageContext, title: string, body: SafeHtml, status = 200): View {
  const nav = html`<nav class="admin-nav" aria-label="Admin"><a href="/admin">Oversigt</a><a href="/admin/events/ny">Nyt Samfolk-event</a><a href="/admin/forslag">Forslag</a><a href="/admin/medlemmer">Medlemmer</a><a href="/admin/samfolk-brevet">Samfolk-brevet</a><a href="/admin/interesseliste">Interesseliste</a><a href="/admin/henvendelser">Henvendelser</a><form method="post" action="/log-ud"><button type="submit" class="link-button">Log ud</button></form></nav>`;
  return { status, headers: { "cache-control": "no-store" }, body: page(ctx, { title: `${title} – admin`, description: "Samfolks administration.", canonical: ctx.path, noindex: true }, html`<div class="wrap admin">${nav}${body}</div>`) };
}

const flash = (message: string | null) => message ? html`<p class="flash" role="status">${message}</p>` : "";

export function overviewPage(ctx: PageContext, picks: PickWithCreator[], numbers: Map<string, Counts>, stats: { members: number; subscribers: number; people: number; inquiries: number }, message: string | null): View {
  const upcoming = picks.filter(p => (p.ends_at ?? p.starts_at + 3 * 3600_000) >= ctx.now);
  return adminPage(ctx, "Oversigt", html`
  <h1>Oversigt</h1>
  ${flash(message)}
  <p class="admin-stats"><a href="/admin/medlemmer"><strong>${String(stats.members)}</strong> medlemmer</a> · <a href="/admin/samfolk-brevet"><strong>${String(stats.subscribers)}</strong> på Samfolk-brevet</a> · <a href="/admin/interesseliste"><strong>${String(stats.people)}</strong> på den tidligere interesseliste</a> · <a href="/admin/henvendelser"><strong>${String(stats.inquiries)}</strong> henvendelser</a></p>
  <p><a class="button" href="/admin/events/ny">Nyt Samfolk-event</a> <a class="button-secondary" href="/admin/forslag">Find et event i forslagslisten</a></p>
  <h2>Ture</h2>
  ${upcoming.length ? html`<table class="admin-table"><thead><tr><th>Hvornår</th><th>Tur</th><th>Oprettet af</th><th>Tilmeldt</th><th>Venteliste</th><th>Status</th><th></th></tr></thead><tbody>
    ${upcoming.map(p => {
      const c = numbers.get(p.id) ?? { registered: 0, waitlist: 0 };
      const state = p.flokk_cancelled_at ? "Aflyst" : p.status !== "approved" ? "Skjult" : "Vises";
      return html`<tr${p.status === "withdrawn" || p.flokk_cancelled_at ? raw(' class="is-muted"') : ""}><td>${when(p, ctx.now)}</td><td><a href="${picksPath(p)}">${p.title}</a></td><td>${p.kind === "samfolk" ? "Samfolk-event" : p.creator_name ?? "Tidligere medlem"}</td><td>${String(c.registered)}${p.places ? ` / ${p.places}` : ""}</td><td>${String(c.waitlist)}</td><td>${state}</td><td><a href="/admin/events/${p.id}/deltagere">Deltagere</a> · <a href="/admin/events/${p.id}">Ret</a></td></tr>`;
    })}
  </tbody></table>` : html`<p class="empty">Ingen ture endnu.</p>`}`);
}

export function suggestionsPage(ctx: PageContext, events: EventRow[], q: string): View {
  return adminPage(ctx, "Forslag", html`
  <h1>Forslag fra arrangørernes kalendere</h1>
  <p class="standfirst">Kommende events, som hentes automatisk. Vælg et, så bliver det til et Samfolk-event, som I kan tjekke og rette, før det gemmes som vist.</p>
  <form class="admin-search" method="get" action="/admin/forslag"><label for="q">Søg</label><input id="q" name="q" type="search" value="${q}" placeholder="Titel, arrangør eller sted"><button type="submit">Søg</button></form>
  ${events.length ? html`<table class="admin-table"><thead><tr><th>Hvornår</th><th>Event</th><th>Arrangør og sted</th><th></th></tr></thead><tbody>
    ${events.map(e => html`<tr><td>${capitalize(dayLabel(e.starts_at, ctx.now))}${e.all_day ? "" : ` kl. ${hhmm(e.starts_at)}`}</td>
      <td>${e.title}<br><span class="meta-muted small">${categoryBySlug((e.categories ?? "").split(",")[0] ?? "")?.short ?? ""}${e.source_url ? html` <a href="${e.source_url}" rel="noopener">kilde</a>` : ""}</span></td>
      <td>${e.organizer_name ?? e.source_name}<br><span class="meta-muted small">${[e.venue_name, e.city].filter(Boolean).join(", ")}</span></td>
      <td><form method="post" action="/admin/forslag"><input type="hidden" name="event" value="${e.id}"><button type="submit" class="button-small">Brug</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen forslag${q ? " for den søgning" : ""}.</p>`}`);
}

/** Any tur, for the volunteers: Samfolk's own events, and a member's tur when it needs a hand. */
export function pickFormPage(ctx: PageContext, f: PickForm, state: { id?: string; samfolk: boolean; errors?: FormErrors; message?: string | null; status?: number }): View {
  const errors = state.errors ?? {};
  const action = state.id ? `/admin/events/${state.id}` : "/admin/events/ny";
  const title = state.id ? "Ret tur" : "Nyt Samfolk-event";
  return adminPage(ctx, title, html`
  <h1>${title}</h1>
  ${state.id ? "" : html`<p class="standfirst">Samfolks eget event – gratis for medlemmer, en gang om måneden.</p>`}
  ${flash(state.message ?? null)}
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card admin-form" method="post" action="${action}" novalidate>
    ${turFields(f, errors, { samfolk: state.samfolk })}
    <fieldset class="field"><legend>Status</legend>
      <label class="f-check"><input type="radio" name="status" value="approved"${f.status !== "withdrawn" ? raw(" checked") : ""}> Vises på siden</label>
      <label class="f-check"><input type="radio" name="status" value="withdrawn"${f.status === "withdrawn" ? raw(" checked") : ""}> Skjult (vises ikke)</label>
    </fieldset>
    <div class="form-actions"><button type="submit">Gem</button>${state.id ? html` <a class="button-secondary" href="/admin">Tilbage</a>` : ""}</div>
  </form>`, state.status);
}

type Row = Interest & { pick_title: string | null; pick_starts_at: number | null };

export function interestsPage(ctx: PageContext, rows: Row[]): View {
  const people = new Set(rows.map(r => r.email)).size;
  return adminPage(ctx, "Interesseliste", html`
  <h1>Den tidligere interesseliste</h1>
  <p>${String(people)} personer · ${String(rows.length)} linjer. <a href="/admin/interesseliste.csv">Hent som regneark (CSV)</a></p>
  ${rows.length ? html`<table class="admin-table"><thead><tr><th>Skrevet op</th><th>Fornavn</th><th>Mail</th><th>Alder</th><th>Område</th><th>Interesser</th><th>Vil med på</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td>${capitalize(dayLabel(r.created_at, ctx.now))}</td><td>${r.first_name}</td><td><a href="mailto:${r.email}">${r.email}</a></td><td>${r.age_group ? AGE_LABELS[r.age_group] ?? r.age_group : ""}</td><td>${r.area ?? ""}</td><td>${r.interests ?? ""}</td><td>${r.pick_title ?? ""}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen på listen.</p>`}`);
}

function csv(head: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // A leading = + - @ would be read as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [head.join(";"), ...rows.map(r => r.map(cell).join(";"))].join("\r\n") + "\r\n";
}

export const interestsCsv = (rows: Row[]) => csv(["Skrevet op", "Fornavn", "Mail", "Alder", "Område", "Interesser", "Vil med på"],
  rows.map(r => [new Date(r.created_at).toISOString().slice(0, 10), r.first_name, r.email, r.age_group, r.area, r.interests, r.pick_title]));

export function subscribersPage(ctx: PageContext, rows: Subscriber[]): View {
  return adminPage(ctx, "Samfolk-brevet", html`
  <h1>Samfolk-brevet</h1>
  <p>${String(rows.length)} tilmeldt. <a href="/admin/samfolk-brevet.csv">Hent som regneark (CSV)</a></p>
  ${rows.length ? html`<table class="admin-table"><thead><tr><th>Tilmeldt</th><th>Mail</th><th>Medlem</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td>${capitalize(dayLabel(r.created_at, ctx.now))}</td><td>${r.email}</td><td>${r.member_name ?? ""}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen tilmeldt endnu.</p>`}`);
}

export const subscribersCsv = (rows: Subscriber[]) => csv(["Tilmeldt", "Mail", "Medlem"], rows.map(r => [new Date(r.created_at).toISOString().slice(0, 10), r.email, r.member_name]));

export function inquiriesPage(ctx: PageContext, rows: Array<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>): View {
  return adminPage(ctx, "Henvendelser", html`
  <h1>Henvendelser fra arrangører</h1>
  ${rows.length ? html`<ul class="admin-list">${rows.map(r => html`<li><p><strong>${r.organisation}</strong> · ${r.contact_name} · <a href="mailto:${r.email}">${r.email}</a>${r.website ? html` · <a href="${r.website}" rel="noopener">${r.website}</a>` : ""} <span class="meta-muted small">${capitalize(dayLabel(r.created_at, ctx.now))}</span></p>${r.message ? html`<p>${r.message}</p>` : ""}</li>`)}</ul>`
    : html`<p class="empty">Ingen henvendelser.</p>`}`);
}

const STATUS_LABEL: Record<string, string> = { registered: "Tilmeldt", waitlist: "Venteliste", cancelled: "Afmeldt" };

export function participantsPage(ctx: PageContext, p: PickRow, people: Participant[], message: string | null): View {
  const registered = people.filter(x => x.status === "registered");
  const open = !p.flokk_cancelled_at && ctx.now < closesAt(p);
  return adminPage(ctx, "Deltagere", html`
  <h1>${p.title}</h1>
  <p>${when(p, ctx.now)} · ${String(registered.length)}${p.places ? ` af ${p.places}` : ""} tilmeldt · ${String(people.filter(x => x.status === "waitlist").length)} på venteliste ·
    ${open ? `tilmelding og afbud lukker ${dayLabel(closesAt(p), ctx.now)}` : "deltagerlisten ligger fast"}</p>
  ${flash(message)}
  ${p.flokk_cancelled_at ? html`<p class="notice"><strong>Turen er aflyst</strong> (${capitalize(dayLabel(p.flokk_cancelled_at, ctx.now))}).</p>` : ""}
  ${people.length ? html`<table class="admin-table"><thead><tr><th>#</th><th>Fornavn</th><th>Mail</th><th>Status</th><th>Skrevet op</th></tr></thead><tbody>
    ${people.map((x, i) => html`<tr${x.status === "cancelled" ? raw(' class="is-muted"') : ""}><td>${String(i + 1)}</td><td>${x.first_name}</td><td>${x.email ? html`<a href="mailto:${x.email}">${x.email}</a>` : ""}</td><td>${STATUS_LABEL[x.status]}</td><td>${capitalize(dayLabel(x.queued_at, ctx.now))} kl. ${hhmm(x.queued_at)}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen tilmeldte endnu.</p>`}
  ${p.flokk_cancelled_at ? "" : html`<details class="leave"><summary>Aflys turen</summary>
    <form method="post" action="/admin/events/${p.id}/aflys"><p>Turen bliver vist som aflyst, og de tilmeldte kan se det på turen og under Mine ture.</p>
      <label class="f-check"><input type="checkbox" name="bekraeft" value="ja" required> Ja, aflys turen</label>
      <p><button type="submit">Aflys</button></p></form></details>`}
  <p><a href="/admin">← Oversigt</a></p>`);
}

export function membersPage(ctx: PageContext, members: Array<SamfolkMember & { signups: number; created: number }>, renewed: { name: string; code: string } | null): View {
  return adminPage(ctx, "Medlemmer", html`
  <h1>Medlemmer</h1>
  ${renewed ? html`<p class="flash" role="status">Ny kode til ${renewed.name}: <strong class="f-code-inline">${renewed.code}</strong> – giv den videre; den gamle virker ikke længere.</p>` : ""}
  ${members.length ? html`<table class="admin-table"><thead><tr><th>Fornavn</th><th>Mail</th><th>Medlemskab</th><th>Medlem siden</th><th>Tilmeldinger</th><th>Oprettede ture</th><th></th></tr></thead><tbody>
    ${members.map(m => html`<tr><td>${m.first_name}${m.is_admin ? " (frivillig)" : ""}</td><td>${m.email ?? ""}</td><td>${m.plan ? PLANS[m.plan].price : "Profil ikke udfyldt"}</td><td>${m.flokk_joined_at ? capitalize(dayLabel(m.flokk_joined_at, ctx.now)) : ""}</td><td>${String(m.signups)}</td><td>${String(m.created)}</td>
      <td><form method="post" action="/admin/medlemmer"><input type="hidden" name="medlem" value="${m.id}"><button type="submit" class="link-button">Ny kode</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen medlemmer endnu.</p>`}`);
}
