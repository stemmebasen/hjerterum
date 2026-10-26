import { dayLabel, hhmm } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { INTERESTS, type FormErrors, type PickForm, type ProfileForm } from "./forms.js";
import { closesAt, PLANS, type MemberSignup, type Participant, type Plan, type SamfolkMember } from "./members.js";
import { costs, picksPath, when } from "./pages.js";
import type { PickRow } from "./store.js";

/** Samfolk's member pages: joining, the profile, logging in, a member's own ture – and creating and running a tur. */

const err = (errors: FormErrors, k: string) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
const invalid = (errors: FormErrors, k: string) => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : "";
const noStore = { "cache-control": "no-store" };
const hp = html`<div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>`;

/** The profile's fields, for joining and for changing it later. */
function profileFields(ctx: PageContext, f: ProfileForm, errors: FormErrors, joining: boolean): SafeHtml {
  return html`
    <div class="field"><label for="m-name">Fornavn</label><input id="m-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${f.firstName}"${invalid(errors, "firstName")}>${err(errors, "firstName")}
      <span class="meta-muted small">Står på de ture, du opretter og melder dig til.</span></div>
    <div class="field"><label for="m-email">Mail</label><input id="m-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid(errors, "email")}>${err(errors, "email")}</div>
    <fieldset class="field"><legend>Hvad har du lyst til at opleve?</legend>
      <div class="f-checks"${invalid(errors, "interests")}>${INTERESTS.map((i, n) => html`<label class="f-check" for="m-i${n}"><input id="m-i${n}" type="checkbox" name="interesser" value="${i}"${f.interests.includes(i) ? raw(" checked") : ""}> ${i}</label>`)}</div>${err(errors, "interests")}
    </fieldset>
    <div class="field"><label for="m-area">Hvor bor du?</label>
      <select id="m-area" name="omraade" required${invalid(errors, "area")}><option value="">Vælg område</option>${ctx.areas.map(a => html`<option value="${a.slug}"${f.area === a.slug ? raw(" selected") : ""}>${a.place}</option>`)}</select>${err(errors, "area")}</div>
    <fieldset class="field"><legend>Medlemskab</legend>
      <div class="f-plans"${invalid(errors, "plan")}>${(Object.keys(PLANS) as Plan[]).map(k => html`<label class="f-check f-plan-option" for="m-plan-${k}"><input id="m-plan-${k}" type="radio" name="medlemskab" value="${k}"${f.plan === k ? raw(" checked") : ""}> ${PLANS[k].price}</label>`)}</div>${err(errors, "plan")}
      <span class="meta-muted small">Betalingen åbner senere. Du betaler ikke noget nu.</span>
    </fieldset>
    <label class="f-check" for="m-letter"><input id="m-letter" type="checkbox" name="brev" value="ja"${f.newsletter ? raw(" checked") : ""}> Send mig Samfolk-brevet med den kommende uges ture</label>
    ${joining ? html`<label class="f-check f-consent" for="m-consent"><input id="m-consent" type="checkbox" name="samtykke" value="ja"${f.consent ? raw(" checked") : ""}${invalid(errors, "consent")}> Samfolk må gemme mine oplysninger og skrive til mig på mail. Mit fornavn står på de ture, jeg opretter og melder mig til. Jeg kan altid melde mig ud.</label>${err(errors, "consent")}` : ""}`;
}

export function joinPage(ctx: PageContext, state: { form: ProfileForm; next: string; errors?: FormErrors; status?: number }): View {
  const f = state.form, errors = state.errors ?? {};
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Bliv medlem", path: "/bliv-medlem" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Bliv medlem af Samfolk</h1>
    <p class="standfirst">Udfyld din profil, så kan du melde dig til ture og oprette dine egne. Du får en personlig kode, som du logger ind med.</p>
    <p class="meta-muted">Samfolk er for alle – vi spørger ikke om alder, køn eller etnicitet.</p>
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">${errors.taken ?? "Ret de markerede felter."}</p>` : ""}
  <form class="form-card f-form" method="post" action="/bliv-medlem" novalidate>
    <input type="hidden" name="naeste" value="${state.next}">
    ${profileFields(ctx, f, errors, true)}
    ${hp}
    <div class="form-actions"><button type="submit">Bliv medlem</button></div>
    <p class="small meta-muted">Har du allerede en kode? <a href="/log-ind">Log ind</a>. <a href="/privatliv">Læs om privatliv</a>.</p>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: "Bliv medlem", description: "Bliv medlem af Foreningen Samfolk: 50 kr. om måneden eller 500 kr. om året. Meld dig til ture, og opret dine egne.", canonical: "/bliv-medlem", breadcrumbs: crumbs }, body) };
}

export function welcomePage(ctx: PageContext, member: SamfolkMember, code: string, next: string): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Velkommen, ${member.first_name}!</h1>
    <p class="standfirst">Du er nu medlem af Samfolk og logget ind.</p>
  </header>
  <section class="f-panel f-code" aria-labelledby="h-code">
    <h2 id="h-code">Din personlige kode</h2>
    <p class="f-code-value">${code}</p>
    <p>Gem koden et sikkert sted – du skal bruge den for at logge ind på en anden telefon eller computer. Vi kan ikke vise den igen.</p>
  </section>
  <p class="f-actions"><a class="button" href="${next}">${next === "/ture" ? "Se de kommende ture" : "Fortsæt"}</a> <a class="button-secondary" href="/ture/ny">Opret en tur</a></p>
</div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Velkommen", description: "Du er nu medlem af Samfolk.", canonical: "/bliv-medlem", noindex: true }, body) };
}

const PROFILE_MESSAGES: Record<string, string> = { gemt: "Din profil er gemt.", udfyld: "Udfyld din profil, før du går videre – så kan du bruge hele siden." };

/** A member's profile: change it, log out, or leave. A member from before Samfolk completes it here first. */
export function profilePage(ctx: PageContext, member: SamfolkMember, state: { form: ProfileForm; next: string; errors?: FormErrors; message?: string | null; status?: number }): View {
  const errors = state.errors ?? {};
  const message = state.message ? PROFILE_MESSAGES[state.message] : null;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Min profil</h1>
    <p class="standfirst">Hej ${member.first_name}. Din profil er det, der giver adgang til at melde dig til ture og oprette dine egne.</p>
  </header>
  ${message ? html`<p class="flash" role="status">${message}</p>` : ""}
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">${errors.taken ?? "Ret de markerede felter."}</p>` : ""}
  <form class="form-card f-form" method="post" action="/min-profil" novalidate>
    <input type="hidden" name="naeste" value="${state.next}">
    ${profileFields(ctx, state.form, errors, false)}
    <div class="form-actions"><button type="submit">Gem profil</button> <a class="button-secondary" href="/mine-ture">Mine ture</a></div>
  </form>
  <section class="f-section my-profile" aria-label="Log ud eller meld dig ud">
    <form method="post" action="/log-ud"><button type="submit" class="button-secondary">Log ud</button></form>
    <details class="leave"><summary>Meld dig ud af Samfolk</summary>
      <form method="post" action="/meld-ud"><p>Din profil, dine tilmeldinger og din tilmelding til brevet bliver slettet. Har du en plads før fristen, går den videre til ventelisten. Kommende ture, du har oprettet, bliver aflyst.</p>
        <label class="f-check"><input type="checkbox" name="bekraeft" value="ja" required> Ja, slet min profil</label>
        <p><button type="submit">Meld mig ud</button></p></form>
    </details>
  </section>
</div>`;
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: "Min profil", description: "Din profil hos Samfolk.", canonical: "/min-profil", noindex: true }, body) };
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
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: "Log ind", description: "Log ind på Samfolk med din personlige kode.", canonical: "/log-ind", noindex: true }, body) };
}

const MESSAGES: Record<string, string> = {
  tilmeldt: "Du er tilmeldt.", venteliste: "Turen er fuld – du står på ventelisten. Bliver der en plads, får du den automatisk.",
  afmeldt: "Du har meldt afbud. Din plads er gået videre.", lukket: "Tilmelding og afbud er lukket for denne tur.",
  oprettet: "Din tur er oprettet og kan ses af alle.", gemt: "Turen er gemt.", aflyst: "Turen er aflyst. De tilmeldte kan se det på turen og under Mine ture."
};
export const flash = (key: string | null) => key && MESSAGES[key] ? html`<p class="flash" role="status">${MESSAGES[key]}</p>` : "";

function statusLine(s: MemberSignup): SafeHtml {
  if (s.flokk_cancelled_at) return html`<strong>Turen er aflyst.</strong>`;
  if (s.signup_status === "cancelled") return html`Du har meldt afbud.`;
  if (s.signup_status === "waitlist") return html`Du står nr. ${String(s.position ?? 1)} på ventelisten.`;
  return html`<strong>Du er tilmeldt.</strong> ${String(s.registered)} tilmeldt i alt.`;
}

const lines = (text: string) => text.split(/\n+/).map((l, i) => html`${i ? html`<br>` : ""}${l}`);

export function myPage(ctx: PageContext, member: SamfolkMember, signups: MemberSignup[], names: Map<string, string[]>, created: PickRow[], message: string | null): View {
  const now = ctx.now;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Mine ture</h1>
    <p class="standfirst">Hej ${member.first_name}. Her er de ture, du har meldt dig til, og dem, du har oprettet.</p>
    <p><a class="button" href="/ture/ny">Opret en tur</a> <a class="button-secondary" href="/min-profil">Min profil</a></p>
  </header>
  ${flash(message)}
  <h2>Tilmeldt</h2>
  ${signups.length ? html`<ul class="my-list">${signups.map(s => {
    const open = !s.flokk_cancelled_at && now < closesAt(s);
    const active = s.signup_status !== "cancelled" && !s.flokk_cancelled_at;
    const flock = names.get(s.id) ?? [];
    return html`<li class="f-panel my-item">
      <p class="f-card-when">${when(s, now)}</p>
      <h3><a href="${picksPath(s)}">${s.title}</a></h3>
      <p>${statusLine(s)}</p>
      ${active && s.signup_status === "registered" ? html`<dl class="f-facts">
        <dt>Mødested</dt><dd>${s.meeting_place ?? "Står ikke på turen endnu."}${s.meeting_at ? html`<br>kl. ${hhmm(s.meeting_at)}` : ""}</dd>
        ${s.programme ? html`<dt>Program</dt><dd>${lines(s.programme)}</dd>` : ""}
        <dt>Udgifter</dt><dd>${costs(s)}</dd>
        <dt>Med på turen</dt><dd>${flock.join(", ")}</dd>
      </dl>` : ""}
      ${active ? open ? html`<form method="post" action="${picksPath(s)}/afbud"><button type="submit" class="button-secondary">Meld afbud</button> <span class="meta-muted small">Muligt til ${dayLabel(closesAt(s), now)} kl. ${hhmm(closesAt(s))}.</span></form>`
        : html`<p class="meta-muted small">Tilmelding og afbud er lukket – deltagerlisten ligger fast.</p>` : ""}
    </li>`;
  })}</ul>` : html`<div class="f-empty"><p>Du er ikke tilmeldt nogen ture endnu.</p><p><a class="button" href="/ture">Se de kommende ture</a></p></div>`}
  <h2>Ture, du har oprettet</h2>
  ${created.length ? html`<ul class="my-list">${created.map(p => html`<li class="f-panel my-item">
      <p class="f-card-when">${when(p, now)}</p>
      <h3><a href="${picksPath(p)}">${p.title}</a></h3>
      ${p.flokk_cancelled_at ? html`<p><strong>Aflyst.</strong></p>` : p.status !== "approved" ? html`<p><strong>Skjult af foreningen.</strong></p>` : ""}
      <p><a href="/ture/${p.id}/ret">Ret turen</a> · <a href="/ture/${p.id}/deltagere">Deltagere</a></p>
    </li>`)}</ul>` : html`<p class="meta-muted">Du har ikke oprettet nogen ture endnu. <a href="/ture/ny">Opret en tur</a>.</p>`}
</div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Mine ture", description: "Dine ture hos Samfolk.", canonical: "/mine-ture", noindex: true }, body) };
}

export function goodbyePage(ctx: PageContext): View {
  const body = html`
<div class="wrap narrow"><header class="page-head"><h1>Du er meldt ud</h1><p class="standfirst">Din profil og dine tilmeldinger er slettet. Du er altid velkommen igen.</p><p><a class="button-secondary" href="/">Til forsiden</a></p></header></div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Du er meldt ud", description: "Du er meldt ud af Samfolk.", canonical: "/meld-ud", noindex: true }, body) };
}

/** The "come along" part of a tur's page, for whoever is looking. */
export function signupBox(ctx: PageContext, p: PickRow, member: SamfolkMember | null, complete: boolean, mine: { status: string; position: number | null } | null,
  c: { registered: number; waitlist: number }, names: string[]): SafeHtml {
  const now = ctx.now;
  const open = !p.flokk_cancelled_at && now < closesAt(p);
  const deadline = `${dayLabel(closesAt(p), now)} kl. ${hhmm(closesAt(p))}`;
  const full = p.places !== null && c.registered >= p.places;
  const numbers = html`<p class="f-numbers">${p.places !== null ? html`${String(Math.min(c.registered, p.places))} af ${String(p.places)} pladser taget` : html`${String(c.registered)} tilmeldt`}${c.waitlist ? html` · ${String(c.waitlist)} på venteliste` : ""}</p>`;
  if (mine && mine.status !== "cancelled") {
    return html`${numbers}<p class="f-mine"><strong>${mine.status === "registered" ? "Du er tilmeldt." : `Du står nr. ${mine.position ?? 1} på ventelisten.`}</strong> <a href="/mine-ture">Mine ture</a></p>
    ${mine.status === "registered" ? html`<dl class="f-facts">
      <dt>Mødested</dt><dd>${p.meeting_place ?? "Står ikke på turen endnu."}${p.meeting_at ? html`<br>kl. ${hhmm(p.meeting_at)}` : ""}</dd>
      ${p.programme ? html`<dt>Program</dt><dd>${lines(p.programme)}</dd>` : ""}
      <dt>Med på turen</dt><dd>${names.join(", ")}</dd>
    </dl>` : ""}
    ${open ? html`<form method="post" action="${picksPath(p)}/afbud"><button type="submit" class="button-secondary">Meld afbud</button> <span class="meta-muted small">Muligt til ${deadline}.</span></form>` : html`<p class="meta-muted small">Tilmelding og afbud er lukket – deltagerlisten ligger fast.</p>`}`;
  }
  if (!open) return html`${numbers}<p class="meta-muted">Tilmeldingen er lukket.</p>`;
  const here = encodeURIComponent(picksPath(p));
  if (!member) return html`${numbers}<p class="f-actions"><a class="button" href="/bliv-medlem?naeste=${here}">Bliv medlem og meld dig til</a> <a class="button-secondary" href="/log-ind?naeste=${here}">Log ind</a></p>
    <p class="small meta-muted">Kun medlemmer kan melde sig til. Tilmelding og afbud lukker ${deadline}.</p>`;
  if (!complete) return html`${numbers}<p class="f-actions"><a class="button" href="/min-profil?naeste=${here}">Udfyld din profil og meld dig til</a></p>`;
  return html`${numbers}<form method="post" action="${picksPath(p)}/tilmeld"><button type="submit">${full ? "Skriv mig på ventelisten" : "Meld mig til"}</button></form>
    <p class="small meta-muted">${full ? "Turen er fuld. Bliver der en plads, får du den automatisk – først til mølle." : "Først til mølle."} Tilmelding og afbud lukker ${deadline}.</p>`;
}

// ————————————————————————————————————————— Creating and running a tur

const field = (id: string, label: string, input: SafeHtml, errors: FormErrors, key: string, hint = "") =>
  html`<div class="field"><label for="${id}">${label}${hint ? html` <span class="meta-muted">${hint}</span>` : ""}</label>${input}${errors[key] ? html`<span class="field-error">${errors[key]}</span>` : ""}</div>`;

/** A tur's fields, for a member's tur and for the volunteers' form. */
export function turFields(f: PickForm, errors: FormErrors, opts: { samfolk?: boolean } = {}): SafeHtml {
  const text = (name: string, value: string, extra = "") => html`<input id="e-${name}" name="${name}" type="text" value="${value}"${raw(extra)}>`;
  return html`
    ${field("e-titel", "Titel", text("titel", f.title, ' maxlength="200" required'), errors, "title")}
    <div class="two-fields">
      ${field("e-start", "Start", html`<input id="e-start" name="start" type="datetime-local" value="${f.start}" required>`, errors, "start")}
      ${field("e-slut", "Slut", html`<input id="e-slut" name="slut" type="datetime-local" value="${f.end}">`, errors, "end", "(valgfrit)")}
    </div>
    ${field("e-beskrivelse", "Hvad skal vi?", html`<textarea id="e-beskrivelse" name="beskrivelse" rows="6" maxlength="4000">${f.description}</textarea>`, errors, "description", "(fortæl med dine egne ord)")}
    ${field("e-sted", "Sted", text("sted", f.venue, ' maxlength="160" placeholder="Fx spillestedet, museet eller skoven"'), errors, "venue")}
    <div class="two-fields">
      ${field("e-adresse", "Adresse", text("adresse", f.address, ' maxlength="200"'), errors, "address")}
      ${field("e-by", "By", text("by", f.city, ' maxlength="80"'), errors, "city")}
    </div>
    <div class="two-fields">
      ${field("e-pladser", "Antal pladser", html`<input id="e-pladser" name="pladser" type="number" min="1" max="200" value="${f.places}">`, errors, "places", "(tom = ingen grænse)")}
      ${field("e-frist", "Tilmeldingsfrist", html`<input id="e-frist" name="frist" type="datetime-local" value="${f.closes}">`, errors, "closes", "(tom = til turen starter)")}
    </div>
    ${field("e-egenbetaling", "Udgifter", text("egenbetaling", f.ownPayment, ` maxlength="120" placeholder="${opts.samfolk ? "Tom = Gratis for medlemmer" : "Fx Billet 150 kr. – køb den selv"}"`), errors, "ownPayment", "(hvad koster det cirka, og hvordan betaler man)")}
    <h2>Hvor mødes I?</h2>
    <p class="meta-muted small">Kan ses af dem, der har meldt sig til.</p>
    <div class="two-fields">
      ${field("e-moedested", "Mødested", text("moedested", f.meetingPlace, ' maxlength="200" placeholder="Fx Ved hovedindgangen, under uret"'), errors, "meetingPlace")}
      ${field("e-moedetid", "Mødetid", html`<input id="e-moedetid" name="moedetid" type="datetime-local" value="${f.meetingAt}">`, errors, "meetingAt")}
    </div>
    ${field("e-program", "Program", html`<textarea id="e-program" name="program" rows="3" maxlength="2000">${f.programme}</textarea>`, errors, "programme", "(valgfrit, en linje pr. punkt)")}
    ${field("e-eftermoede", "Bagefter", text("eftermoede", f.aftermeeting, ' maxlength="200" placeholder="Fx en kop kaffe i caféen"'), errors, "aftermeeting", "(valgfrit)")}
    <h2>Mere om oplevelsen <span class="meta-muted">(valgfrit)</span></h2>
    <div class="two-fields">
      ${field("e-forening", "Arrangør", text("forening", f.association, ' maxlength="160" placeholder="Fx spillestedet eller foreningen"'), errors, "association")}
      ${field("e-forening_url", "Arrangørens hjemmeside", text("forening_url", f.associationUrl, ' maxlength="300"'), errors, "associationUrl")}
    </div>
    ${field("e-link", "Link til oplevelsen", text("link", f.eventUrl, ' maxlength="500"'), errors, "eventUrl")}
    ${field("e-billede", "Billede", text("billede", f.imageUrl, ' maxlength="500"'), errors, "imageUrl", "(https-adresse – brug kun billeder, du må vise)")}`;
}

/** A member creates or changes their own tur. */
export function turFormPage(ctx: PageContext, f: PickForm, state: { id?: string; errors?: FormErrors; status?: number }): View {
  const errors = state.errors ?? {};
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ture", path: "/ture" }, { name: state.id ? "Ret turen" : "Opret en tur", path: ctx.path }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${state.id ? "Ret turen" : "Opret en tur"}</h1>
    ${state.id ? "" : html`<p class="standfirst">Har du lyst til en koncert, et foredrag, en gåtur eller noget helt fjerde? Opret en tur, så kan andre medlemmer melde sig til. Den kan ses, så snart du har oprettet den.</p>`}
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card admin-form" method="post" action="${state.id ? `/ture/${state.id}/ret` : "/ture/ny"}" novalidate>
    ${turFields(f, errors)}
    ${hp}
    <div class="form-actions"><button type="submit">${state.id ? "Gem" : "Opret turen"}</button> <a class="button-secondary" href="/mine-ture">Annuller</a></div>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: noStore, body: page(ctx, { title: state.id ? "Ret turen" : "Opret en tur", description: "Opret en tur, som andre medlemmer af Samfolk kan melde sig til.", canonical: ctx.path, noindex: true, breadcrumbs: crumbs }, body) };
}

const STATUS_LABEL: Record<string, string> = { registered: "Tilmeldt", waitlist: "Venteliste", cancelled: "Afmeldt" };

/** For the one who created a tur: who is coming, in order – first names only – and cancelling it. */
export function creatorParticipantsPage(ctx: PageContext, p: PickRow, people: Participant[]): View {
  const registered = people.filter(x => x.status === "registered");
  const open = !p.flokk_cancelled_at && ctx.now < closesAt(p);
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>${p.title}</h1>
    <p class="standfirst">${when(p, ctx.now)} · ${String(registered.length)}${p.places ? ` af ${p.places}` : ""} tilmeldt · ${String(people.filter(x => x.status === "waitlist").length)} på venteliste</p>
    <p>${open ? `Tilmelding og afbud lukker ${dayLabel(closesAt(p), ctx.now)} kl. ${hhmm(closesAt(p))}.` : "Deltagerlisten ligger fast."} <a href="${picksPath(p)}">Se turen</a> · <a href="/ture/${p.id}/ret">Ret turen</a></p>
  </header>
  ${p.flokk_cancelled_at ? html`<p class="notice"><strong>Turen er aflyst.</strong> De tilmeldte kan se det på turen og under Mine ture.</p>` : ""}
  ${people.length ? html`<ol class="f-people">${people.map(x => html`<li${x.status === "cancelled" ? raw(' class="is-muted"') : ""}>${x.first_name} <span class="meta-muted small">${STATUS_LABEL[x.status]}</span></li>`)}</ol>`
    : html`<p class="empty">Ingen har meldt sig til endnu.</p>`}
  ${p.flokk_cancelled_at ? "" : html`<details class="leave"><summary>Aflys turen</summary>
    <form method="post" action="/ture/${p.id}/aflys"><p>Turen bliver vist som aflyst, og de tilmeldte kan se det på turen og under Mine ture. Det kan ikke fortrydes.</p>
      <label class="f-check"><input type="checkbox" name="bekraeft" value="ja" required> Ja, aflys turen</label>
      <p><button type="submit">Aflys turen</button></p></form></details>`}
  <p><a href="/mine-ture">← Mine ture</a></p>
</div>`;
  return { status: 200, headers: noStore, body: page(ctx, { title: "Deltagere", description: "Deltagerne på din tur.", canonical: ctx.path, noindex: true }, body) };
}
