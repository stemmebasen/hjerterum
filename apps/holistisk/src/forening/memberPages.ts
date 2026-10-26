import { dayLabel, hhmm } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { AGE_GROUPS, AGE_LABELS, INTERESTS, type FormErrors, type InterestForm } from "./forms.js";
import { CONFIRM_AT, closesAt, type FlokkMember, type MemberSignup } from "./members.js";
import { when } from "./pages.js";

/** Flokk's member pages: joining, logging in, and a member's own Udflugter. */

const err = (errors: FormErrors, k: string) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
const invalid = (errors: FormErrors, k: string) => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : "";
const noStore = { "cache-control": "no-store" };

export function joinPage(ctx: PageContext, state: { form: InterestForm; next: string; errors?: FormErrors; status?: number }): View {
  const f = state.form, errors = state.errors ?? {};
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Bliv medlem", path: "/bliv-medlem" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Bliv medlem</h1>
    <p class="standfirst">Som medlem kan du tilmelde dig Udflugter. Du får en personlig kode, som du logger ind med.</p>
    <p class="meta-muted">Beløb og medlemsvilkår er ikke fastlagt endnu. Du betaler ikke noget nu.</p>
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">${errors.taken ?? "Ret de markerede felter."}</p>` : ""}
  <form class="form-card f-form" method="post" action="/bliv-medlem" novalidate>
    <input type="hidden" name="naeste" value="${state.next}">
    <div class="field"><label for="m-name">Fornavn</label><input id="m-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${f.firstName}"${invalid(errors, "firstName")}>${err(errors, "firstName")}
      <span class="meta-muted small">Dit fornavn står på listen over din flok, så I kan finde hinanden.</span></div>
    <div class="field"><label for="m-email">Mail</label><input id="m-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid(errors, "email")}>${err(errors, "email")}
      <span class="meta-muted small">Vi skriver til dig om dine Udflugter.</span></div>
    <fieldset class="field"><legend>Hvad har du lyst til at opleve? <span class="meta-muted">(valgfrit)</span></legend>
      <div class="f-checks">${INTERESTS.map((i, n) => html`<label class="f-check" for="m-i${n}"><input id="m-i${n}" type="checkbox" name="interesser" value="${i}"${f.interests.includes(i) ? raw(" checked") : ""}> ${i}</label>`)}</div>
    </fieldset>
    <div class="two-fields">
      <div class="field"><label for="m-area">Hvor bor du? <span class="meta-muted">(valgfrit)</span></label>
        <select id="m-area" name="omraade"${invalid(errors, "area")}><option value="">Vil ikke oplyse</option>${ctx.areas.map(a => html`<option value="${a.slug}"${f.area === a.slug ? raw(" selected") : ""}>${a.place}</option>`)}</select>${err(errors, "area")}</div>
      <div class="field"><label for="m-age">Alder <span class="meta-muted">(valgfrit)</span></label>
        <select id="m-age" name="alder"${invalid(errors, "ageGroup")}><option value="">Vil ikke oplyse</option>${AGE_GROUPS.map(a => html`<option value="${a}"${f.ageGroup === a ? raw(" selected") : ""}>${AGE_LABELS[a]}</option>`)}</select>${err(errors, "ageGroup")}</div>
    </div>
    <label class="f-check f-consent" for="m-consent"><input id="m-consent" type="checkbox" name="samtykke" value="ja"${f.consent ? raw(" checked") : ""}${invalid(errors, "consent")}> Flokk må gemme mine oplysninger, skrive til mig på mail og vise mit fornavn for dem i min flok. Jeg kan altid melde mig ud.</label>${err(errors, "consent")}
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Bliv medlem</button></div>
    <p class="small meta-muted">Har du allerede en kode? <a href="/log-ind">Log ind</a>. <a href="/privatliv">Læs om privatliv</a>.</p>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: "Bliv medlem", description: "Bliv medlem af Flokk, og tilmeld dig Udflugter til udvalgte koncerter, foredrag og andre oplevelser.", canonical: "/bliv-medlem", breadcrumbs: crumbs }, body) };
}

export function welcomePage(ctx: PageContext, member: FlokkMember, code: string, next: string): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Velkommen, ${member.first_name}!</h1>
    <p class="standfirst">Du er nu medlem af Flokk og logget ind.</p>
  </header>
  <section class="f-panel f-code" aria-labelledby="h-code">
    <h2 id="h-code">Din personlige kode</h2>
    <p class="f-code-value">${code}</p>
    <p>Gem koden et sikkert sted – du skal bruge den for at logge ind på en anden telefon eller computer. Vi kan ikke vise den igen.</p>
  </section>
  <p class="f-actions"><a class="button" href="${next}">${next === "/udflugter" ? "Se de kommende Udflugter" : "Fortsæt"}</a> <a class="button-secondary" href="/mine-udflugter">Mine Udflugter</a></p>
</div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Velkommen", description: "Du er nu medlem af Flokk.", canonical: "/bliv-medlem", noindex: true }, body) };
}

export function loginPage(ctx: PageContext, state: { next: string; error?: string; status?: number }): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head"><h1>Log ind</h1><p class="standfirst">Med den personlige kode, du fik, da du blev medlem.</p></header>
  ${state.error ? html`<p class="flash flash-error" role="alert">${state.error}</p>` : ""}
  <form class="form-card" method="post" action="/log-ind" novalidate>
    <input type="hidden" name="naeste" value="${state.next}">
    <div class="field"><label for="l-code">Din kode</label><input id="l-code" name="kode" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required placeholder="XXXX-XXXX-XXXX"></div>
    <div class="form-actions"><button type="submit">Log ind</button></div>
    <p class="small meta-muted">Ikke medlem endnu? <a href="/bliv-medlem">Bliv medlem</a>.</p>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: "Log ind", description: "Log ind på Flokk med din personlige kode.", canonical: "/log-ind", noindex: true }, body) };
}

const MESSAGES: Record<string, string> = {
  tilmeldt: "Du er tilmeldt.", venteliste: "Udflugten er fuld – du står på ventelisten. Bliver der en plads, får du den automatisk.",
  afmeldt: "Du har meldt afbud. Din plads er gået videre.", lukket: "Tilmelding og afbud er lukket for denne Udflugt."
};
export const flash = (key: string | null) => key && MESSAGES[key] ? html`<p class="flash" role="status">${MESSAGES[key]}</p>` : "";

function statusLine(s: MemberSignup, now: number): SafeHtml {
  if (s.flokk_cancelled_at) return html`<strong>Flokk har aflyst sin deltagelse.</strong> Har du betalt, får du automatisk pengene tilbage.`;
  if (s.signup_status === "cancelled") return html`Du har meldt afbud.`;
  if (s.signup_status === "waitlist") return html`Du står nr. ${String(s.position ?? 1)} på ventelisten.`;
  const confirmed = s.confirmed_at ? "Flokken er bekræftet." : `Flokken bekræftes, når ${CONFIRM_AT} har tilmeldt sig (${s.registered} indtil nu).`;
  return html`<strong>Du er tilmeldt.</strong> ${confirmed}`;
}

export function myPage(ctx: PageContext, member: FlokkMember, signups: MemberSignup[], names: Map<string, string[]>, message: string | null): View {
  const now = ctx.now;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Mine Udflugter</h1>
    <p class="standfirst">Hej ${member.first_name}. Her ser du dine tilmeldinger – og program, mødested og fornavne, når de er klar.</p>
  </header>
  ${flash(message)}
  ${signups.length ? html`<ul class="my-list">${signups.map(s => {
    const open = !s.flokk_cancelled_at && now < closesAt(s);
    const active = s.signup_status !== "cancelled" && !s.flokk_cancelled_at;
    const flock = names.get(s.id) ?? [];
    return html`<li class="f-panel my-item">
      <p class="f-card-when">${when(s, now)}</p>
      <h2><a href="/events/${s.slug}">${s.title}</a></h2>
      <p>${statusLine(s, now)}</p>
      ${active && s.signup_status === "registered" ? html`<dl class="f-facts">
        <dt>Mødested</dt><dd>${s.meeting_place ?? "Kommer før Udflugten."}${s.meeting_at ? html`<br>kl. ${hhmm(s.meeting_at)}` : ""}</dd>
        ${s.programme ? html`<dt>Program</dt><dd>${s.programme.split(/\n+/).map((l, i) => html`${i ? html`<br>` : ""}${l}`)}</dd>` : ""}
        <dt>Din flok</dt><dd>${s.confirmed_at && flock.length ? flock.join(", ") : "Fornavnene kommer, når flokken er bekræftet."}</dd>
      </dl>` : ""}
      ${active ? open ? html`<form method="post" action="/events/${s.slug}/afbud"><button type="submit" class="button-secondary">Meld afbud</button> <span class="meta-muted small">Muligt til ${dayLabel(closesAt(s), now)}.</span></form>`
        : html`<p class="meta-muted small">Tilmelding og afbud er lukket – deltagerlisten ligger fast.</p>` : ""}
    </li>`;
  })}</ul>` : html`<div class="f-empty"><p>Du er ikke tilmeldt nogen Udflugter endnu.</p><p><a class="button" href="/udflugter">Se de kommende Udflugter</a></p></div>`}
  <section class="f-section my-profile" aria-labelledby="h-profile">
    <h2 id="h-profile">Din profil</h2>
    <p>${member.first_name}${member.email ? html` · ${member.email}` : ""}</p>
    <form method="post" action="/log-ud"><button type="submit" class="button-secondary">Log ud</button></form>
    <details class="leave"><summary>Meld dig ud af Flokk</summary>
      <form method="post" action="/meld-ud"><p>Din profil og dine tilmeldinger bliver slettet. Har du en plads før fristen, går den videre til ventelisten.</p>
        <label class="f-check"><input type="checkbox" name="bekraeft" value="ja" required> Ja, slet min profil</label>
        <p><button type="submit">Meld mig ud</button></p></form>
    </details>
  </section>
</div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Mine Udflugter", description: "Dine tilmeldinger hos Flokk.", canonical: "/mine-udflugter", noindex: true }, body) };
}

export function goodbyePage(ctx: PageContext): View {
  const body = html`
<div class="wrap narrow"><header class="page-head"><h1>Du er meldt ud</h1><p class="standfirst">Din profil og dine tilmeldinger er slettet. Du er altid velkommen igen.</p><p><a class="button-secondary" href="/">Til forsiden</a></p></header></div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Du er meldt ud", description: "Du er meldt ud af Flokk.", canonical: "/meld-ud", noindex: true }, body) };
}

/** The "how to come along" part of an Udflugt's page, for whoever is looking. */
export function signupBox(ctx: PageContext, p: { slug: string; starts_at: number; places: number | null; confirmed_at: number | null; flokk_cancelled_at: number | null },
  member: FlokkMember | null, mine: { status: string; position: number | null } | null, c: { registered: number; waitlist: number }): SafeHtml {
  const now = ctx.now;
  const open = !p.flokk_cancelled_at && now < closesAt(p);
  const full = p.places !== null && c.registered >= p.places;
  const numbers = html`<p class="f-numbers">${p.places !== null ? html`${String(Math.min(c.registered, p.places))} af ${String(p.places)} pladser taget` : html`${String(c.registered)} tilmeldt`}${c.waitlist ? html` · ${String(c.waitlist)} på venteliste` : ""} · ${p.confirmed_at ? "flokken er bekræftet" : `flokken bekræftes ved ${CONFIRM_AT} tilmeldte`}</p>`;
  if (p.flokk_cancelled_at) return html`<p class="notice" role="status"><strong>Flokk har aflyst sin deltagelse i denne Udflugt.</strong> Har du betalt, får du automatisk pengene tilbage. Arrangørens event er et andet spørgsmål – se arrangørens egen side.</p>`;
  if (mine && mine.status !== "cancelled") {
    return html`${numbers}<p class="f-mine"><strong>${mine.status === "registered" ? "Du er tilmeldt." : `Du står nr. ${mine.position ?? 1} på ventelisten.`}</strong> <a href="/mine-udflugter">Mine Udflugter</a></p>
    ${open ? html`<form method="post" action="/events/${p.slug}/afbud"><button type="submit" class="button-secondary">Meld afbud</button> <span class="meta-muted small">Muligt til ${dayLabel(closesAt(p), now)}.</span></form>` : html`<p class="meta-muted small">Tilmelding og afbud er lukket – deltagerlisten ligger fast.</p>`}`;
  }
  if (!open) return html`${numbers}<p class="meta-muted">Tilmeldingen er lukket.</p>`;
  if (!member) return html`${numbers}<p class="f-actions"><a class="button" href="/bliv-medlem?naeste=/events/${p.slug}">Bliv medlem og tilmeld dig</a> <a class="button-secondary" href="/log-ind?naeste=/events/${p.slug}">Log ind</a></p>
    <p class="small meta-muted">Kun medlemmer kan deltage. Tilmelding og afbud lukker ${dayLabel(closesAt(p), now)}.</p>`;
  return html`${numbers}<form method="post" action="/events/${p.slug}/tilmeld"><button type="submit">${full ? "Skriv mig på ventelisten" : "Tilmeld mig"}</button></form>
    <p class="small meta-muted">${full ? "Udflugten er fuld. Bliver der en plads, får du den automatisk – først til mølle." : "Først til mølle."} Tilmelding og afbud lukker ${dayLabel(closesAt(p), now)}.</p>`;
}

