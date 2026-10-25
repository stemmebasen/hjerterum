import { categoryBySlug } from "../categories.js";
import { capitalize, dayLabel, hhmm } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { page, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import type { EventRow } from "../web/queries.js";
import { AGE_LABELS, type FormErrors, type PickForm } from "./forms.js";
import { when } from "./pages.js";
import type { Interest, PickRow } from "./store.js";

/** The volunteers' pages (behind login): approve events from the collector or type them in, edit them, and read the
 * interest list. Never indexed, never cached. */

function adminPage(ctx: PageContext, title: string, body: SafeHtml, status = 200): View {
  const nav = html`<nav class="admin-nav" aria-label="Admin"><a href="/admin">Oversigt</a><a href="/admin/forslag">Forslag</a><a href="/admin/events/ny">Skriv et event ind</a><a href="/admin/interesseliste">Interesseliste</a><a href="/admin/henvendelser">Henvendelser</a><form method="post" action="/log-ud"><button type="submit" class="link-button">Log ud</button></form></nav>`;
  return { status, headers: { "cache-control": "no-store" }, body: page(ctx, { title: `${title} – admin`, description: "Flokkens administration.", canonical: ctx.path, noindex: true }, html`<div class="wrap admin">${nav}${body}</div>`) };
}

const flash = (message: string | null) => message ? html`<p class="flash" role="status">${message}</p>` : "";

export function loginPage(ctx: PageContext, state: { error?: string; status?: number } = {}): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head"><h1>Log ind</h1><p class="standfirst">For Flokkens frivillige.</p></header>
  ${state.error ? html`<p class="flash flash-error" role="alert">${state.error}</p>` : ""}
  <form class="form-card" method="post" action="/log-ind" novalidate>
    <div class="field"><label for="l-code">Din kode</label><input id="l-code" name="kode" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required placeholder="XXXX-XXXX-XXXX"></div>
    <div class="form-actions"><button type="submit">Log ind</button></div>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Log ind", description: "Log ind for Flokkens frivillige.", canonical: "/log-ind", noindex: true }, body) };
}

export function overviewPage(ctx: PageContext, picks: Array<PickRow & { interested: number }>, people: number, inquiries: number, message: string | null): View {
  const upcoming = picks.filter(p => (p.ends_at ?? p.starts_at + 3 * 3600_000) >= ctx.now);
  return adminPage(ctx, "Oversigt", html`
  <h1>Oversigt</h1>
  ${flash(message)}
  <p class="admin-stats"><a href="/admin/interesseliste"><strong>${String(people)}</strong> på interesselisten</a> · <a href="/admin/henvendelser"><strong>${String(inquiries)}</strong> henvendelser fra foreninger</a></p>
  <p><a class="button" href="/admin/forslag">Find events i forslagslisten</a> <a class="button-secondary" href="/admin/events/ny">Skriv et event ind</a></p>
  <h2>Godkendte events</h2>
  ${upcoming.length ? html`<table class="admin-table"><thead><tr><th>Hvornår</th><th>Event</th><th>Forening</th><th>Vil med</th><th>Status</th><th></th></tr></thead><tbody>
    ${upcoming.map(p => html`<tr${p.status === "withdrawn" ? raw(' class="is-muted"') : ""}><td>${when(p, ctx.now)}</td><td><a href="/events/${p.slug}">${p.title}</a></td><td>${p.association}</td><td>${String(p.interested)}</td><td>${p.status === "approved" ? "Vises" : "Trukket tilbage"}</td><td><a href="/admin/events/${p.id}">Ret</a></td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen godkendte events endnu. Find et i <a href="/admin/forslag">forslagslisten</a>, eller <a href="/admin/events/ny">skriv et ind</a>.</p>`}`);
}

export function suggestionsPage(ctx: PageContext, events: EventRow[], q: string): View {
  return adminPage(ctx, "Forslag", html`
  <h1>Forslag fra foreningernes kalendere</h1>
  <p class="standfirst">Kommende events, som Flokken henter automatisk. Et event vises først på siden, når I har godkendt det og tjekket oplysningerne.</p>
  <form class="admin-search" method="get" action="/admin/forslag"><label for="q">Søg</label><input id="q" name="q" type="search" value="${q}" placeholder="Titel, forening eller sted"><button type="submit">Søg</button></form>
  ${events.length ? html`<table class="admin-table"><thead><tr><th>Hvornår</th><th>Event</th><th>Arrangør og sted</th><th></th></tr></thead><tbody>
    ${events.map(e => html`<tr><td>${capitalize(dayLabel(e.starts_at, ctx.now))}${e.all_day ? "" : ` kl. ${hhmm(e.starts_at)}`}</td>
      <td>${e.title}<br><span class="meta-muted small">${categoryBySlug((e.categories ?? "").split(",")[0] ?? "")?.short ?? ""}${e.source_url ? html` <a href="${e.source_url}" rel="noopener">kilde</a>` : ""}</span></td>
      <td>${e.organizer_name ?? e.source_name}<br><span class="meta-muted small">${[e.venue_name, e.city].filter(Boolean).join(", ")}</span></td>
      <td><form method="post" action="/admin/forslag"><input type="hidden" name="event" value="${e.id}"><button type="submit" class="button-small">Godkend</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen forslag${q ? " for den søgning" : ""}.</p>`}`);
}

const field = (id: string, label: string, input: SafeHtml, errors: FormErrors, key: string, hint = "") =>
  html`<div class="field"><label for="${id}">${label}${hint ? html` <span class="meta-muted">${hint}</span>` : ""}</label>${input}${errors[key] ? html`<span class="field-error">${errors[key]}</span>` : ""}</div>`;

export function pickFormPage(ctx: PageContext, f: PickForm, state: { id?: string; errors?: FormErrors; message?: string | null; status?: number }): View {
  const errors = state.errors ?? {};
  const text = (name: string, value: string, extra = "") => html`<input id="e-${name}" name="${name}" type="text" value="${value}"${raw(extra)}>`;
  const action = state.id ? `/admin/events/${state.id}` : "/admin/events/ny";
  return adminPage(ctx, state.id ? "Ret event" : "Nyt event", html`
  <h1>${state.id ? "Ret event" : "Skriv et event ind"}</h1>
  ${flash(state.message ?? null)}
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card admin-form" method="post" action="${action}" novalidate>
    ${field("e-titel", "Titel", text("titel", f.title, ' maxlength="200" required'), errors, "title")}
    <div class="two-fields">
      ${field("e-start", "Start", html`<input id="e-start" name="start" type="datetime-local" value="${f.start}" required>`, errors, "start")}
      ${field("e-slut", "Slut", html`<input id="e-slut" name="slut" type="datetime-local" value="${f.end}">`, errors, "end", "(valgfrit)")}
    </div>
    <div class="two-fields">
      ${field("e-forening", "Forening", text("forening", f.association, ' maxlength="160" required'), errors, "association")}
      ${field("e-forening_url", "Foreningens hjemmeside", text("forening_url", f.associationUrl, ' maxlength="300"'), errors, "associationUrl", "(valgfrit)")}
    </div>
    ${field("e-sted", "Sted", text("sted", f.venue, ' maxlength="160"'), errors, "venue")}
    <div class="two-fields">
      ${field("e-adresse", "Adresse", text("adresse", f.address, ' maxlength="200"'), errors, "address")}
      ${field("e-by", "By", text("by", f.city, ' maxlength="80"'), errors, "city")}
    </div>
    ${field("e-link", "Link til eventet", text("link", f.eventUrl, ' maxlength="500"'), errors, "eventUrl", "(valgfrit)")}
    ${field("e-beskrivelse", "Beskrivelse", html`<textarea id="e-beskrivelse" name="beskrivelse" rows="6" maxlength="4000">${f.description}</textarea>`, errors, "description", "(med egne ord, eller et kort uddrag)")}
    ${field("e-billede", "Billede", text("billede", f.imageUrl, ' maxlength="500"'), errors, "imageUrl", "(https-adresse, valgfrit – brug kun billeder, I må vise)")}
    <div class="two-fields">
      ${field("e-pladser", "Pladser til Flokken", html`<input id="e-pladser" name="pladser" type="number" min="1" max="200" value="${f.places}">`, errors, "places", "(valgfrit)")}
      ${field("e-egenbetaling", "Egenbetaling", text("egenbetaling", f.ownPayment, ' maxlength="120" placeholder="Tom = Fastsættes"'), errors, "ownPayment")}
    </div>
    ${field("e-eftermoede", "Eftermødet", text("eftermoede", f.aftermeeting, ' maxlength="200" placeholder="Tom = En lille en til ganen bagefter"'), errors, "aftermeeting", "(hvor og hvad)")}
    <fieldset class="field"><legend>Status</legend>
      <label class="f-check"><input type="radio" name="status" value="approved"${f.status !== "withdrawn" ? raw(" checked") : ""}> Vises på siden</label>
      <label class="f-check"><input type="radio" name="status" value="withdrawn"${f.status === "withdrawn" ? raw(" checked") : ""}> Trukket tilbage (vises ikke)</label>
    </fieldset>
    <div class="form-actions"><button type="submit">Gem</button>${state.id ? html` <a class="button-secondary" href="/admin">Tilbage</a>` : ""}</div>
  </form>`, state.status);
}

type Row = Interest & { pick_title: string | null; pick_starts_at: number | null };

export function interestsPage(ctx: PageContext, rows: Row[]): View {
  const people = new Set(rows.map(r => r.email)).size;
  return adminPage(ctx, "Interesseliste", html`
  <h1>Interesseliste</h1>
  <p>${String(people)} personer · ${String(rows.length)} linjer (én pr. event, man vil med til). <a href="/admin/interesseliste.csv">Hent som regneark (CSV)</a></p>
  ${rows.length ? html`<table class="admin-table"><thead><tr><th>Skrevet op</th><th>Fornavn</th><th>Mail</th><th>Alder</th><th>Område</th><th>Interesser</th><th>Vil med til</th><th>Ven</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td>${capitalize(dayLabel(r.created_at, ctx.now))}</td><td>${r.first_name}</td><td><a href="mailto:${r.email}">${r.email}</a></td><td>${r.age_group ? AGE_LABELS[r.age_group] ?? r.age_group : ""}</td><td>${r.area ?? ""}</td><td>${r.interests ?? ""}</td><td>${r.pick_title ?? ""}</td><td>${r.with_friend ? "Ja" : ""}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen på listen endnu.</p>`}`);
}

export function interestsCsv(rows: Row[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // A leading = + - @ would be read as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Skrevet op", "Fornavn", "Mail", "Alder", "Område", "Interesser", "Vil med til", "Ven med"];
  const lines = rows.map(r => [new Date(r.created_at).toISOString().slice(0, 10), r.first_name, r.email, r.age_group, r.area, r.interests, r.pick_title, r.with_friend ? "ja" : ""].map(cell).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

export function inquiriesPage(ctx: PageContext, rows: Array<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>): View {
  return adminPage(ctx, "Henvendelser", html`
  <h1>Henvendelser fra foreninger</h1>
  ${rows.length ? html`<ul class="admin-list">${rows.map(r => html`<li><p><strong>${r.organisation}</strong> · ${r.contact_name} · <a href="mailto:${r.email}">${r.email}</a>${r.website ? html` · <a href="${r.website}" rel="noopener">${r.website}</a>` : ""} <span class="meta-muted small">${capitalize(dayLabel(r.created_at, ctx.now))}</span></p>${r.message ? html`<p>${r.message}</p>` : ""}</li>`)}</ul>`
    : html`<p class="empty">Ingen henvendelser endnu.</p>`}`);
}
