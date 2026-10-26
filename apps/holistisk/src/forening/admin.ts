import { categoryBySlug } from "../categories.js";
import { capitalize, dayLabel, hhmm } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { page, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import type { EventRow } from "../web/queries.js";
import { AGE_LABELS, type FormErrors, type PickForm } from "./forms.js";
import { when } from "./pages.js";
import type { Interest, PickRow } from "./store.js";
import { CONFIRM_AT, closesAt, type Counts, type FlokkMember, type Participant } from "./members.js";

/** The volunteers' pages (behind login): approve events from the collector or type them in, edit them, and read the
 * interest list. Never indexed, never cached. */

function adminPage(ctx: PageContext, title: string, body: SafeHtml, status = 200): View {
  const nav = html`<nav class="admin-nav" aria-label="Admin"><a href="/admin">Oversigt</a><a href="/admin/forslag">Forslag</a><a href="/admin/events/ny">Skriv en tur ind</a><a href="/admin/medlemmer">Medlemmer</a><a href="/admin/interesseliste">Interesseliste</a><a href="/admin/henvendelser">Henvendelser</a><form method="post" action="/log-ud"><button type="submit" class="link-button">Log ud</button></form></nav>`;
  return { status, headers: { "cache-control": "no-store" }, body: page(ctx, { title: `${title} – admin`, description: "Flokks administration.", canonical: ctx.path, noindex: true }, html`<div class="wrap admin">${nav}${body}</div>`) };
}

const flash = (message: string | null) => message ? html`<p class="flash" role="status">${message}</p>` : "";

export function overviewPage(ctx: PageContext, picks: Array<PickRow & { interested: number }>, numbers: Map<string, Counts>, members: number, people: number, inquiries: number, message: string | null): View {
  const upcoming = picks.filter(p => (p.ends_at ?? p.starts_at + 3 * 3600_000) >= ctx.now);
  return adminPage(ctx, "Oversigt", html`
  <h1>Oversigt</h1>
  ${flash(message)}
  <p class="admin-stats"><a href="/admin/medlemmer"><strong>${String(members)}</strong> medlemmer</a> · <a href="/admin/interesseliste"><strong>${String(people)}</strong> på den tidligere interesseliste</a> · <a href="/admin/henvendelser"><strong>${String(inquiries)}</strong> henvendelser fra arrangører</a></p>
  <p><a class="button" href="/admin/forslag">Find et event i forslagslisten</a> <a class="button-secondary" href="/admin/events/ny">Skriv en tur ind</a></p>
  <h2>Ture</h2>
  ${upcoming.length ? html`<table class="admin-table"><thead><tr><th>Hvornår</th><th>Tur</th><th>Arrangør</th><th>Tilmeldt</th><th>Venteliste</th><th>Status</th><th></th></tr></thead><tbody>
    ${upcoming.map(p => {
      const c = numbers.get(p.id) ?? { registered: 0, waitlist: 0 };
      const state = p.flokk_cancelled_at ? "Aflyst af Flokk" : p.status !== "approved" ? "Trukket tilbage" : p.confirmed_at ? "Bekræftet" : `Vises – bekræftes ved ${CONFIRM_AT}`;
      return html`<tr${p.status === "withdrawn" || p.flokk_cancelled_at ? raw(' class="is-muted"') : ""}><td>${when(p, ctx.now)}</td><td><a href="/events/${p.slug}">${p.title}</a></td><td>${p.association}</td><td>${String(c.registered)}${p.places ? ` / ${p.places}` : ""}</td><td>${String(c.waitlist)}</td><td>${state}</td><td><a href="/admin/events/${p.id}/deltagere">Deltagere</a> · <a href="/admin/events/${p.id}">Ret</a></td></tr>`;
    })}
  </tbody></table>` : html`<p class="empty">Ingen ture endnu. Find et i <a href="/admin/forslag">forslagslisten</a>, eller <a href="/admin/events/ny">skriv et ind</a>.</p>`}`);
}

export function suggestionsPage(ctx: PageContext, events: EventRow[], q: string): View {
  return adminPage(ctx, "Forslag", html`
  <h1>Forslag fra arrangørernes kalendere</h1>
  <p class="standfirst">Kommende events, som Flokk henter automatisk. Et event bliver først til en tur på siden, når I har godkendt det og tjekket oplysningerne.</p>
  <form class="admin-search" method="get" action="/admin/forslag"><label for="q">Søg</label><input id="q" name="q" type="search" value="${q}" placeholder="Titel, arrangør eller sted"><button type="submit">Søg</button></form>
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
  return adminPage(ctx, state.id ? "Ret tur" : "Ny tur", html`
  <h1>${state.id ? "Ret tur" : "Skriv en tur ind"}</h1>
  ${flash(state.message ?? null)}
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card admin-form" method="post" action="${action}" novalidate>
    ${field("e-titel", "Titel", text("titel", f.title, ' maxlength="200" required'), errors, "title")}
    <div class="two-fields">
      ${field("e-start", "Start", html`<input id="e-start" name="start" type="datetime-local" value="${f.start}" required>`, errors, "start")}
      ${field("e-slut", "Slut", html`<input id="e-slut" name="slut" type="datetime-local" value="${f.end}">`, errors, "end", "(valgfrit)")}
    </div>
    <div class="two-fields">
      ${field("e-forening", "Arrangør", text("forening", f.association, ' maxlength="160" required'), errors, "association")}
      ${field("e-forening_url", "Arrangørens hjemmeside", text("forening_url", f.associationUrl, ' maxlength="300"'), errors, "associationUrl", "(valgfrit)")}
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
      ${field("e-pladser", "Pladser til Flokk", html`<input id="e-pladser" name="pladser" type="number" min="1" max="200" value="${f.places}">`, errors, "places", "(tom = ingen grænse; flere pladser giver straks pladser til ventelisten)")}
      ${field("e-egenbetaling", "Pris for medlemmer", text("egenbetaling", f.ownPayment, ' maxlength="120" placeholder="Tom = Et symbolsk beløb – ikke fastlagt endnu"'), errors, "ownPayment")}
    </div>
    ${field("e-eftermoede", "Bagefter", text("eftermoede", f.aftermeeting, ' maxlength="200" placeholder="Tom = Mulighed for at mødes og snakke om oplevelsen"'), errors, "aftermeeting", "(fx et sted at mødes efter oplevelsen)")}
    <h2>Praktisk information til flokken</h2>
    <p class="meta-muted small">Vises for de tilmeldte under Mine ture og kommer med i mailen til hver deltager.</p>
    <div class="two-fields">
      ${field("e-moedested", "Præcist mødested", text("moedested", f.meetingPlace, ' maxlength="200" placeholder="Fx Ved hovedindgangen, under uret"'), errors, "meetingPlace")}
      ${field("e-moedetid", "Mødetid", html`<input id="e-moedetid" name="moedetid" type="datetime-local" value="${f.meetingAt}">`, errors, "meetingAt")}
    </div>
    ${field("e-program", "Program", html`<textarea id="e-program" name="program" rows="4" maxlength="2000">${f.programme}</textarea>`, errors, "programme", "(en linje pr. punkt)")}
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
  <p>${String(people)} personer · ${String(rows.length)} linjer (én pr. tur, man vil med på). <a href="/admin/interesseliste.csv">Hent som regneark (CSV)</a></p>
  ${rows.length ? html`<table class="admin-table"><thead><tr><th>Skrevet op</th><th>Fornavn</th><th>Mail</th><th>Alder</th><th>Område</th><th>Interesser</th><th>Vil med på</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td>${capitalize(dayLabel(r.created_at, ctx.now))}</td><td>${r.first_name}</td><td><a href="mailto:${r.email}">${r.email}</a></td><td>${r.age_group ? AGE_LABELS[r.age_group] ?? r.age_group : ""}</td><td>${r.area ?? ""}</td><td>${r.interests ?? ""}</td><td>${r.pick_title ?? ""}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen på listen endnu.</p>`}`);
}

export function interestsCsv(rows: Row[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // A leading = + - @ would be read as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Skrevet op", "Fornavn", "Mail", "Alder", "Område", "Interesser", "Vil med på"];
  const lines = rows.map(r => [new Date(r.created_at).toISOString().slice(0, 10), r.first_name, r.email, r.age_group, r.area, r.interests, r.pick_title].map(cell).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

export function inquiriesPage(ctx: PageContext, rows: Array<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>): View {
  return adminPage(ctx, "Henvendelser", html`
  <h1>Henvendelser fra arrangører</h1>
  ${rows.length ? html`<ul class="admin-list">${rows.map(r => html`<li><p><strong>${r.organisation}</strong> · ${r.contact_name} · <a href="mailto:${r.email}">${r.email}</a>${r.website ? html` · <a href="${r.website}" rel="noopener">${r.website}</a>` : ""} <span class="meta-muted small">${capitalize(dayLabel(r.created_at, ctx.now))}</span></p>${r.message ? html`<p>${r.message}</p>` : ""}</li>`)}</ul>`
    : html`<p class="empty">Ingen henvendelser endnu.</p>`}`);
}

const STATUS_LABEL: Record<string, string> = { registered: "Tilmeldt", waitlist: "Venteliste", cancelled: "Afmeldt" };

/** The practical mail for one participant, ready to send from your own mail. */
function mailFor(p: PickRow, person: Participant, names: string[], now: number): string {
  const lines = [
    `Hej ${person.first_name}`, "",
    `Her er det praktiske til turen: ${p.title}, ${when(p, now)}${p.venue_name ? `, ${p.venue_name}` : ""}.`, "",
    `Mødested: ${p.meeting_place ?? "(kommer)"}${p.meeting_at ? `, kl. ${hhmm(p.meeting_at)}` : ""}`,
    ...(p.programme ? ["", "Program:", p.programme] : []), "",
    `Din flok: ${names.join(", ")}`, "",
    "Du deltager på din egen måde – og bagefter er der mulighed for at mødes og snakke om oplevelsen.", "",
    "Venlig hilsen", "Flokk"
  ];
  return `mailto:${encodeURIComponent(person.email ?? "")}?subject=${encodeURIComponent(`Flokk: ${p.title}`)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export function participantsPage(ctx: PageContext, p: PickRow, people: Participant[], message: string | null): View {
  const registered = people.filter(x => x.status === "registered");
  const names = registered.map(x => x.first_name);
  const open = !p.flokk_cancelled_at && ctx.now < closesAt(p);
  return adminPage(ctx, "Deltagere", html`
  <h1>${p.title}</h1>
  <p>${when(p, ctx.now)} · ${String(registered.length)}${p.places ? ` af ${p.places}` : ""} tilmeldt · ${String(people.filter(x => x.status === "waitlist").length)} på venteliste ·
    ${p.confirmed_at ? "flokken er bekræftet" : `bekræftes ved ${CONFIRM_AT}`} · ${open ? `tilmelding og afbud lukker ${dayLabel(closesAt(p), ctx.now)}` : "deltagerlisten ligger fast"}</p>
  ${flash(message)}
  ${p.flokk_cancelled_at ? html`<p class="notice"><strong>Flokk har aflyst sin deltagelse</strong> (${capitalize(dayLabel(p.flokk_cancelled_at, ctx.now))}). Medlemmerne ser det under Mine ture.</p>` : ""}
  ${!p.meeting_place ? html`<p class="notice">Mødestedet mangler – <a href="/admin/events/${p.id}">skriv det ind</a>, før I sender mails.</p>` : ""}
  ${people.length ? html`<table class="admin-table"><thead><tr><th>#</th><th>Fornavn</th><th>Mail</th><th>Status</th><th>Skrevet op</th><th></th></tr></thead><tbody>
    ${people.map((x, i) => html`<tr${x.status === "cancelled" ? raw(' class="is-muted"') : ""}><td>${String(i + 1)}</td><td>${x.first_name}</td><td>${x.email ?? ""}</td><td>${STATUS_LABEL[x.status]}</td><td>${capitalize(dayLabel(x.queued_at, ctx.now))} kl. ${hhmm(x.queued_at)}</td>
      <td>${x.status === "registered" && x.email ? html`<a href="${mailFor(p, x, names, ctx.now)}">Skriv mail</a>` : ""}</td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen tilmeldte endnu.</p>`}
  ${p.flokk_cancelled_at ? "" : html`<details class="leave"><summary>Aflys Flokks deltagelse</summary>
    <form method="post" action="/admin/events/${p.id}/aflys"><p>Flokk aflyser sin deltagelse i turen. Medlemmerne ser det på siden, og de har krav på at få deres betaling tilbage. Arrangørens event påvirkes ikke.</p>
      <label class="f-check"><input type="checkbox" name="bekraeft" value="ja" required> Ja, aflys Flokks deltagelse</label>
      <p><button type="submit">Aflys</button></p></form></details>`}
  <p><a href="/admin">← Oversigt</a></p>`);
}

export function membersPage(ctx: PageContext, members: Array<FlokkMember & { signups: number }>, renewed: { name: string; code: string } | null): View {
  return adminPage(ctx, "Medlemmer", html`
  <h1>Medlemmer</h1>
  ${renewed ? html`<p class="flash" role="status">Ny kode til ${renewed.name}: <strong class="f-code-inline">${renewed.code}</strong> – giv den videre; den gamle virker ikke længere.</p>` : ""}
  ${members.length ? html`<table class="admin-table"><thead><tr><th>Fornavn</th><th>Mail</th><th>Medlem siden</th><th>Tilmeldinger</th><th></th></tr></thead><tbody>
    ${members.map(m => html`<tr><td>${m.first_name}${m.is_admin ? " (frivillig)" : ""}</td><td>${m.email ?? ""}</td><td>${m.flokk_joined_at ? capitalize(dayLabel(m.flokk_joined_at, ctx.now)) : ""}</td><td>${String(m.signups)}</td>
      <td><form method="post" action="/admin/medlemmer"><input type="hidden" name="medlem" value="${m.id}"><button type="submit" class="link-button">Ny kode</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="empty">Ingen medlemmer endnu.</p>`}`);
}
