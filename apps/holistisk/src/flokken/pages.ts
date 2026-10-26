import type { EventRow } from "../web/queries.js";
import { eventPath, placeLine } from "../web/components.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import { capitalize, dayLabel, hhmm, timeRangeLabel } from "../time.js";
import type { Member } from "./auth.js";
import type { FieldErrors, FlockForm } from "./forms.js";
import { flockGiftBox, GIFT_FLOCK_SIZE, halfPriceOffer, offersFor, sponsorName } from "./partners.js";
import { eventOver, isFull, MAX_SIZE, MIN_SIZE, type FlockRow } from "./store.js";

/** Flokken's own pages and the flock panel on event pages. Words used throughout: flok, Opret en flok, Find en flok,
 * Bliv en del af flokken, Eftermødet. */

export type View = { status: number; body: string; headers?: Record<string, string> };
const PRIVATE = { "cache-control": "private, no-store" };

export const flockPath = (id: string) => `/flokke/${id}`;
const loginPath = (next: string) => `/log-ind?naeste=${encodeURIComponent(next)}`;
const meetingLine = (f: Pick<FlockRow, "meeting_at" | "meeting_place">, now: number) =>
  `${capitalize(dayLabel(f.meeting_at, now))} kl. ${hhmm(f.meeting_at)} · ${f.meeting_place}`;
const spotsLine = (f: Pick<FlockRow, "member_count" | "max_size">) => {
  const left = f.max_size - f.member_count;
  return `${f.member_count} af ${f.max_size}${left > 0 ? ` · plads til ${left} mere` : " · fuld"}`;
};

/** Messages shown after an action (?besked=…). */
const MESSAGES: Record<string, string> = {
  oprettet: "Din flok er oprettet. Andre kan nu finde den på eventets side.",
  tilsluttet: "Du er nu en del af flokken. Mødested og tidspunkt står herunder.",
  forladt: "Du har forladt flokken.",
  rettet: "Mødested og tidspunkt er opdateret.",
  eftermoede_ja: "Tak! Du har sagt ja til at finde på noget sammen igen.",
  eftermoede_nej: "Tak. Du har sagt nej tak denne gang.",
  logget_ud: "Du er logget ud.",
  tak: "Tak for din henvendelse. Vi vender tilbage."
};
const ERRORS: Record<string, string> = {
  event_closed: "Eventet er gået i gang, afholdt eller aflyst, så flokken kan ikke ændres.",
  already_in_flock: "Du er allerede i en flok til dette event. Forlad den først, hvis du vil skifte.",
  too_many: "Du har oprettet mange flokke i dag. Prøv igen i morgen.",
  full: "Flokken er fuld.",
  closed: "Flokken er lukket.",
  not_member: "Du er ikke en del af flokken.",
  not_host: "Kun den, der står for flokken, kan rette mødested og tidspunkt.",
  too_small: "Flokken har allerede flere medlemmer end det.",
  not_eftermoede: "Du kan kun fortsætte fra en flok, hvor du har sagt ja til Eftermødet."
};
export const flash = (code: string | null): SafeHtml => {
  if (!code) return html``;
  const ok = MESSAGES[code];
  const err = ERRORS[code];
  return ok ? html`<p class="flash" role="status">${ok}</p>` : err ? html`<p class="flash flash-error" role="alert">${err}</p>` : html``;
};

const trustLine = html`<p class="trust-line">Flokke mødes et offentligt sted. Du deler kun dit fornavn, og du kan altid forlade en flok. <a href="/tryghed">Sådan holder vi det trygt</a></p>`;

// ————————————————————————————————————————— On the event page

export function flockPanel(e: EventRow, flocks: FlockRow[], member: Member | null, myFlockId: string | null, now: number): SafeHtml {
  const over = (e.ends_at ?? e.starts_at + 3 * 3600_000) < now;
  const canStart = e.status === "scheduled" && e.starts_at > now;
  const create = `${eventPath(e)}/opret-flok`;
  const action = (f: FlockRow): SafeHtml => {
    if (f.is_member) return html`<a class="button" href="${flockPath(f.id)}">Du er en del af flokken – se den</a>`;
    if (!canStart) return html`<a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    if (isFull(f)) return html`<span class="flock-state">Flokken er fuld</span> <a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    if (!member) return html`<a class="button" href="${loginPath(flockPath(f.id))}">Bliv en del af flokken</a>`;
    if (myFlockId) return html`<a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    return html`<form method="post" action="${flockPath(f.id)}/bliv-del-af"><button type="submit">Bliv en del af flokken</button></form> <a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
  };
  return html`<section class="flock-panel" id="flokke" aria-labelledby="h-flokke">
  <div class="flock-panel-head">
    <h2 id="h-flokke">Find en flok</h2>
    <p>Følges med andre til eventet. En flok er en lille, uformel gruppe, der mødes et offentligt sted før eventet – og bagefter vælger hver især, om de vil finde på noget sammen igen.</p>
  </div>
  ${flocks.length ? html`<ul class="flock-list">${flocks.map(f => html`<li class="flock-card${f.is_member ? " is-mine" : ""}">
    <p class="flock-when"><span class="visually-hidden">Mødes: </span>${meetingLine(f, now)}</p>
    <p class="flock-meta">${spotsLine(f)}</p>
    ${f.note ? html`<p class="flock-note">${f.note}</p>` : ""}
    <div class="flock-actions">${action(f)}</div>
  </li>`)}</ul>`
    : html`<p class="flock-empty">${over ? "Der var ingen flok til dette event." : "Der er ingen flok til eventet endnu. Opret den første – så kan andre finde den her."}</p>`}
  ${canStart ? myFlockId && member ? flocks.some(f => f.id === myFlockId) ? "" : html`<p class="flock-mine">Du er med i en flok til eventet. <a href="${flockPath(myFlockId)}">Se din flok</a></p>`
    : html`<p class="flock-create"><a class="button button-alt" href="${member ? create : loginPath(create)}">Opret en flok</a></p>` : ""}
  ${over && myFlockId ? html`<p class="flock-mine"><a href="${flockPath(myFlockId)}#eftermoedet">Eftermødet: vil du finde på noget sammen igen?</a></p>` : ""}
  ${trustLine}
</section>`;
}

// ————————————————————————————————————————— A flock's own page

export function flockPage(ctx: PageContext, f: FlockRow, e: EventRow | null, names: Array<{ id: string; first_name: string; again: number | null }>, member: Member | null, hostId: string | null, message: string | null, giftCode: string | null = null): View {
  const over = eventOver(f, ctx.now);
  const canJoin = f.status === "open" && f.event_status === "scheduled" && f.event_starts_at > ctx.now;
  const isHost = !!member && hostId === member.id;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: f.event_title, path: `/events/${f.event_slug}` }, { name: "Flokken", path: flockPath(f.id) }];
  const join = !canJoin || f.is_member ? html``
    : isFull(f) ? html`<p class="flock-state">Flokken er fuld.</p>`
    : member ? html`<form method="post" action="${flockPath(f.id)}/bliv-del-af"><button type="submit">Bliv en del af flokken</button></form>`
    : html`<a class="button" href="${loginPath(flockPath(f.id))}">Bliv en del af flokken</a>`;
  const yes = names.filter(n => n.again === 1);
  const gift = e ? halfPriceOffer(offersFor(e)) : undefined;
  const place = member ? names.findIndex(n => n.id === member.id) : -1;
  const giftBox = gift && e && !over ? f.is_member
    ? flockGiftBox(gift, { sponsor: sponsorName(gift, e.organizer_name), memberCount: f.member_count, maxSize: f.max_size, place: place < 0 ? null : place, code: giftCode, contactEmail: ctx.contactEmail })
    : html`<p class="flock-note">Gave ved dette event: halv pris på billetten, når ${GIFT_FLOCK_SIZE} er samlet i flokken – sponsoreret af ${sponsorName(gift, e.organizer_name)}.</p>` : html``;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">Flok til eventet</p>
    <h1>${f.event_title}</h1>
    ${flash(message)}
    ${f.status === "closed" ? html`<p class="notice">Flokken er lukket.</p>` : ""}
  </header>
  <section class="meet-box" aria-labelledby="h-meet">
    <h2 id="h-meet">Her mødes flokken</h2>
    <dl class="facts-list">
      <dt>Hvornår</dt><dd>${capitalize(dayLabel(f.meeting_at, ctx.now))} kl. ${hhmm(f.meeting_at)}</dd>
      <dt>Hvor</dt><dd>${f.meeting_place}<br><a href="https://www.openstreetmap.org/search?query=${encodeURIComponent([f.meeting_place.replace(/^ved\s+(indgangen\s+til\s+)?/i, ""), f.event_city].filter(Boolean).join(", "))}" rel="noopener" target="_blank">Find det på kortet</a></dd>
      <dt>Eventet</dt><dd><a href="/events/${f.event_slug}">${f.event_title}</a><br>${capitalize(dayLabel(f.event_starts_at, ctx.now))} · ${timeRangeLabel(f.event_starts_at, f.event_ends_at, false, ctx.now)}${e ? html`<br>${placeLine(e)}` : ""}</dd>
      <dt>Flokken</dt><dd>${spotsLine(f)}</dd>
    </dl>
    ${f.note ? html`<p class="flock-note">${f.note}</p>` : ""}
    ${e?.signup_url && canJoin ? html`<p class="small meta-muted">Billet eller tilmelding sker hos arrangøren – hver for sig. <a href="${e.signup_url}" rel="noopener" target="_blank">Tilmeld hos arrangøren</a></p>` : ""}
    ${giftBox}
    <div class="flock-actions">${join}${isHost && canJoin ? html`<a class="button-secondary" href="${flockPath(f.id)}/ret">Ret mødested og tidspunkt</a>` : ""}</div>
  </section>
  ${f.is_member ? html`<section class="section" aria-labelledby="h-members">
    <div class="section-head"><h2 id="h-members">I flokken</h2></div>
    <ul class="member-list">${names.map(n => html`<li>${n.first_name}${member && n.id === member.id ? html` <span class="meta-muted">(dig)</span>` : ""}${n.id === hostId ? html` <span class="pill-small">står for flokken</span>` : ""}</li>`)}</ul>
    <p class="small meta-muted">Kun medlemmer af flokken kan se navnene. I finder hinanden ved mødestedet.</p>
  </section>
  <section class="section eftermoede" id="eftermoedet" aria-labelledby="h-eftermoede">
    <div class="section-head"><h2 id="h-eftermoede">Eftermødet</h2></div>
    <p>${over ? "Eventet er slut." : "Når eventet er slut,"} vil du så finde på noget sammen igen? Det er helt frivilligt – du vælger fra event til event.</p>
    <form method="post" action="${flockPath(f.id)}/eftermoedet" class="choice-row">
      <button type="submit" name="svar" value="ja"${f.again === 1 ? raw(' aria-pressed="true" class="is-chosen"') : raw(' class="button-secondary"')}>Ja, gerne igen</button>
      <button type="submit" name="svar" value="nej"${f.again === 0 ? raw(' aria-pressed="true" class="is-chosen"') : raw(' class="button-secondary"')}>Ikke denne gang</button>
    </form>
    ${f.again === 1 ? html`<p>${yes.length > 1 ? html`Også ja: ${yes.filter(n => n.id !== member?.id).map((n, i) => html`${i ? ", " : ""}${n.first_name}`)}. ` : ""}Find et nyt event i <a href="/kalender">kalenderen</a> og vælg <strong>Opret en flok</strong> – vælg denne flok som udgangspunkt, så kan de andre, der har sagt ja, se den under <a href="/flokke">Mine flokke</a> og selv vælge at være med.</p>` : ""}
  </section>
  <section class="section" aria-labelledby="h-leave">
    <form method="post" action="${flockPath(f.id)}/forlad"><button type="submit" class="button-quiet">Forlad flokken</button></form>
  </section>` : html`<p class="meta-muted">${f.member_count === 1 ? "1 person" : `${f.member_count} personer`} er med. Navnene kan kun ses af dem i flokken.</p>`}
  ${trustLine}
</div>`;
  return { status: 200, headers: PRIVATE, body: page(ctx, { title: `Flok til ${f.event_title}`, description: `En flok følges til ${f.event_title}. ${meetingLine(f, ctx.now)}.`, canonical: flockPath(f.id), noindex: true, breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Creating and editing

export function flockFormPage(ctx: PageContext, e: EventRow, form: FlockForm, errors: FieldErrors, options: { mode: "create" | "edit"; action: string; follows?: FlockRow[]; status?: number }): View {
  const err = (k: keyof FieldErrors) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
  const describedBy = (k: keyof FieldErrors) => errors[k] ? raw(` aria-describedby="err-${k}" aria-invalid="true"`) : "";
  const create = options.mode === "create";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: e.title, path: eventPath(e) }, { name: create ? "Opret en flok" : "Ret flokken", path: options.action }];
  const sizes = Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => i + MIN_SIZE);
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">${create ? "Opret en flok" : "Ret flokken"}</p>
    <h1>${e.title}</h1>
    <p class="standfirst">${capitalize(dayLabel(e.starts_at, ctx.now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, ctx.now)} · ${placeLine(e)}</p>
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="${options.action}" novalidate>
    <div class="field">
      <label for="f-place">Mødested</label>
      <input id="f-place" name="moedested" type="text" maxlength="120" required value="${form.meetingPlace}"${describedBy("meetingPlace")}>
      <span class="hint">Et offentligt sted tæt på eventet: indgangen, en café, et torv.</span>
      ${err("meetingPlace")}
    </div>
    <div class="field">
      <label for="f-time">Hvornår mødes I?</label>
      <input id="f-time" name="tidspunkt" type="datetime-local" required value="${form.meetingAt}"${describedBy("meetingAt")}>
      ${err("meetingAt")}
    </div>
    <div class="field">
      <label for="f-size">Hvor mange må være med (inkl. dig)?</label>
      <select id="f-size" name="stoerrelse"${describedBy("maxSize")}>${sizes.map(n => html`<option value="${n}"${String(n) === form.maxSize ? raw(" selected") : ""}>${n}</option>`)}</select>
      ${err("maxSize")}
    </div>
    <div class="field">
      <label for="f-note">Et par ord til flokken <span class="meta-muted">(valgfrit)</span></label>
      <textarea id="f-note" name="note" rows="3" maxlength="280"${describedBy("note")}>${form.note}</textarea>
      <span class="hint">Fx “Vi tager en kop kaffe først” eller “Første gang for mig også”. Skriv ikke telefonnummer eller adresse.</span>
      ${err("note")}
    </div>
    ${create && options.follows?.length ? html`<div class="field">
      <label for="f-follows">Fortsæt fra en tidligere flok <span class="meta-muted">(valgfrit)</span></label>
      <select id="f-follows" name="fra_flok"${describedBy("followsFlockId")}>
        <option value="">Nej, en ny flok</option>
        ${options.follows.map(p => html`<option value="${p.id}"${form.followsFlockId === p.id ? raw(" selected") : ""}>${p.event_title} (${dayLabel(p.event_starts_at, ctx.now)})</option>`)}
      </select>
      <span class="hint">De andre fra den flok, der også sagde ja til Eftermødet, kan så se den nye flok og selv vælge at være med.</span>
      ${err("followsFlockId")}
    </div>` : ""}
    <div class="field field-check">
      <label><input type="checkbox" name="offentligt" value="ja"${form.publicPlace ? raw(" checked") : ""}${describedBy("publicPlace")}> Mødestedet er et offentligt sted</label>
      ${err("publicPlace")}
    </div>
    <div class="form-actions">
      <button type="submit">${create ? "Opret en flok" : "Gem ændringer"}</button>
      <a href="${eventPath(e)}">Fortryd</a>
    </div>
  </form>
  ${trustLine}
</div>`;
  return { status: options.status ?? 200, headers: PRIVATE, body: page(ctx, { title: `${create ? "Opret en flok" : "Ret flokken"} – ${e.title}`, description: "Opret en flok og følges med andre til eventet.", canonical: options.action, noindex: true, breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Mine flokke

export function myFlocksPage(ctx: PageContext, member: Member, flocks: FlockRow[], invitations: Array<FlockRow & { started_by: string; from_title: string }>, message: string | null): View {
  const upcoming = flocks.filter(f => !eventOver(f, ctx.now)).reverse();
  const past = flocks.filter(f => eventOver(f, ctx.now));
  const row = (f: FlockRow) => html`<li class="flock-card"><a href="${flockPath(f.id)}"><span class="flock-title">${f.event_title}</span>
    <span class="flock-when">${meetingLine(f, ctx.now)}</span><span class="flock-meta">${spotsLine(f)}${eventOver(f, ctx.now) ? html` · Eftermødet: ${f.again === 1 ? "ja" : f.again === 0 ? "ikke denne gang" : "ikke svaret"}` : ""}</span></a></li>`;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Mine flokke", path: "/flokke" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Hej ${member.first_name}</h1>
    ${flash(message)}
    <p class="standfirst">Her er dine flokke. Find et event i <a href="/kalender">kalenderen</a> for at finde eller oprette en flok.</p>
  </header>
  ${invitations.length ? html`<section class="section" aria-labelledby="h-inv">
    <div class="section-head"><h2 id="h-inv">Fra dine Eftermøder</h2></div>
    <ul class="flock-list">${invitations.map(f => html`<li class="flock-card"><a href="${flockPath(f.id)}"><span class="flock-title">${f.event_title}</span>
      <span class="flock-when">${meetingLine(f, ctx.now)}</span><span class="flock-meta">${f.started_by} fra jeres flok til ${f.from_title} har oprettet en flok. Du vælger selv, om du vil være med.</span></a></li>`)}</ul>
  </section>` : ""}
  <section class="section" aria-labelledby="h-up">
    <div class="section-head"><h2 id="h-up">Kommende</h2></div>
    ${upcoming.length ? html`<ul class="flock-list">${upcoming.map(row)}</ul>` : html`<p class="empty">Du er ikke i nogen flok endnu. <a href="/kalender">Find et event</a> og vælg <strong>Find en flok</strong> eller <strong>Opret en flok</strong>.</p>`}
  </section>
  ${past.length ? html`<section class="section" aria-labelledby="h-past">
    <div class="section-head"><h2 id="h-past">Tidligere</h2></div>
    <ul class="flock-list">${past.map(row)}</ul>
  </section>` : ""}
  <section class="section" aria-labelledby="h-account">
    <div class="section-head"><h2 id="h-account">Din profil</h2></div>
    <p>Du er med som <strong>${member.first_name}</strong>. Det er det eneste, andre i dine flokke ser. Du logger ind på en ny enhed med den personlige kode, du fik, da du blev medlem.</p>
    <form method="post" action="/log-ud"><button type="submit" class="button-secondary">Log ud</button></form>
  </section>
</div>`;
  return { status: 200, headers: PRIVATE, body: page(ctx, { title: "Mine flokke", description: "Dine flokke på Flokken.", canonical: "/flokke", noindex: true, breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Joining and logging in

export function loginPage(ctx: PageContext, next: string, state: { nameError?: string; codeError?: string; name?: string; status?: number } = {}): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Log ind", path: "/log-ind" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Bliv en del af Flokken</h1>
    <p class="standfirst">For at finde, oprette eller blive en del af en flok skal du være medlem. Det kræver kun dit fornavn – ingen e-mail, intet telefonnummer.</p>
  </header>
  <div class="two-forms">
    <form class="form-card" method="post" action="/bliv-medlem" novalidate>
      <h2>Ny her?</h2>
      <input type="hidden" name="naeste" value="${next}">
      <div class="field">
        <label for="m-name">Dit fornavn</label>
        <input id="m-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${state.name ?? ""}"${state.nameError ? raw(' aria-invalid="true" aria-describedby="err-name"') : ""}>
        <span class="hint">Det er det eneste, andre i dine flokke ser.</span>
        ${state.nameError ? html`<span class="field-error" id="err-name">${state.nameError}</span>` : ""}
      </div>
      <div class="form-actions"><button type="submit">Bliv medlem</button></div>
      <p class="small meta-muted">Du får en personlig kode, som du bruger til at logge ind på andre enheder. Læs <a href="/tryghed">sådan holder vi det trygt</a>.</p>
    </form>
    <form class="form-card" method="post" action="/log-ind" novalidate>
      <h2>Har du en kode?</h2>
      <input type="hidden" name="naeste" value="${next}">
      <div class="field">
        <label for="m-code">Din personlige kode</label>
        <input id="m-code" name="kode" type="text" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" required${state.codeError ? raw(' aria-invalid="true" aria-describedby="err-code"') : ""}>
        ${state.codeError ? html`<span class="field-error" id="err-code">${state.codeError}</span>` : ""}
      </div>
      <div class="form-actions"><button type="submit" class="button-alt">Log ind</button></div>
    </form>
  </div>
</div>`;
  return { status: state.status ?? 200, headers: PRIVATE, body: page(ctx, { title: "Log ind – Flokken", description: "Bliv medlem af Flokken eller log ind.", canonical: "/log-ind", noindex: true, breadcrumbs: crumbs }, body) };
}

export function welcomePage(ctx: PageContext, member: Member, code: string, next: string): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Velkommen, ${member.first_name}!</h1>
    <p class="standfirst">Du er nu medlem af Flokken og logget ind på denne enhed.</p>
  </header>
  <section class="code-box" aria-labelledby="h-code">
    <h2 id="h-code">Din personlige kode</h2>
    <p class="code">${code}</p>
    <p>Gem koden et sikkert sted, fx som en note på din telefon. Du skal bruge den for at logge ind på en anden enhed. Vi viser den ikke igen og kan ikke finde den frem for dig.</p>
  </section>
  <p class="more-line"><a class="button" href="${next}">Fortsæt</a></p>
</div>`;
  return { status: 200, headers: PRIVATE, body: page(ctx, { title: "Velkommen til Flokken", description: "Din personlige kode.", canonical: "/log-ind", noindex: true }, body) };
}

// ————————————————————————————————————————— Safety

export function safetyPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Tryghed", path: "/tryghed" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Sådan holder vi det trygt</h1>
    <p class="standfirst">En flok er nogle få mennesker, der følges til det samme event. Det skal føles trygt at sige ja.</p>
  </header>
  <h2>Mød altid et offentligt sted</h2>
  <p>En flok mødes ved indgangen til eventet, på en café eller et andet offentligt sted – aldrig hjemme hos nogen. Den, der opretter en flok, bekræfter, at mødestedet er offentligt.</p>
  <h2>Du deler kun dit fornavn</h2>
  <p>Flokken kender kun dit fornavn. Vi beder ikke om e-mail, telefonnummer, alder eller billede. Navnene i en flok kan kun ses af dem, der er med i den. Del ikke telefonnummer eller adresse i flokkens besked.</p>
  <h2>Du bestemmer selv</h2>
  <p>Ingen bliver sat i en flok automatisk. Du vælger selv, om du vil oprette en flok eller være en del af en. Du kan forlade en flok når som helst – også i sidste øjeblik. Efter eventet vælger du selv, om du vil finde på noget sammen igen (Eftermødet).</p>
  <h2>Billet og tilmelding</h2>
  <p>Hver person køber selv billet eller tilmelder sig hos arrangøren. Flokken håndterer ikke betaling.</p>
  <h2>Det har vi ikke endnu</h2>
  <p>Flokken har endnu ikke blokering, indberetning eller verificerede profiler.${ctx.contactEmail ? html` Oplever du noget ubehageligt, så skriv til <a href="mailto:${ctx.contactEmail}">${ctx.contactEmail}</a>.` : ""} Gå fra, hvis noget føles forkert – og forlad flokken.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Tryghed i Flokken", description: "Offentlige mødesteder, kun fornavn, og du kan altid forlade en flok.", canonical: "/tryghed", breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Find en flok (all open flocks) and the front page's part

/** Open flocks as cards linking to each flock: event, meeting time and place, room left. */
export function flockCards(flocks: FlockRow[], now: number): SafeHtml {
  return html`<ul class="flock-grid">${flocks.map(f => html`<li class="flock-card"><a href="${flockPath(f.id)}">
    <span class="flock-title">${f.event_title}</span>
    <span class="flock-when">${meetingLine(f, now)}</span>
    <span class="flock-meta">${spotsLine(f)}</span>
  </a></li>`)}</ul>`;
}

/** The three steps, on the front page and on Find en flok. */
export const howItWorks = html`<ol class="how">
  <li><span class="how-n" aria-hidden="true">1</span><strong>Find et event</strong><span>Koncerter, teater, foredrag, caféjazz, yoga og workshops fra spillesteder, biblioteker og foreninger.</span></li>
  <li><span class="how-n" aria-hidden="true">2</span><strong>Find en flok – eller opret en</strong><span>Alting er sjovere i samlet flok. Når I er 5 samlet, giver vi en <span class="secret" aria-hidden="true">*****</span><span class="visually-hidden">overraskelse – hvad det bliver, er ikke afgjort endnu</span>. Ved enkelte events giver arrangøren halv pris på billetten til de 5 – det står på eventet.</span></li>
  <li><span class="how-n" aria-hidden="true">3</span><strong>Mød hinanden</strong><span>Et offentligt sted før eventet. Bagefter vælger I selv, om I vil ses igen – det er Eftermødet.</span></li>
</ol>`;

export function findFlockPage(ctx: PageContext, flocks: FlockRow[]): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Find en flok", path: "/find-en-flok" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Find en flok</h1>
    <p class="standfirst">Flokke, der skal til et event i ${ctx.regionLabel} og har plads til flere. Vælg en, se hvor og hvornår den mødes, og bliv en del af flokken. Er der ingen til dit event, så find eventet i <a href="/kalender">kalenderen</a> og opret en flok.</p>
  </header>
  ${flocks.length ? flockCards(flocks, ctx.now) : html`<p class="empty">Der er ingen åbne flokke lige nu. Find et event i <a href="/kalender">kalenderen</a> og vælg <strong>Opret en flok</strong> – så kan andre finde den her.</p>`}
  <section class="section" aria-labelledby="h-how"><div class="section-head"><h2 id="h-how">Sådan virker en flok</h2></div>${howItWorks}</section>
  ${trustLine}
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: `Find en flok – følges med andre til events i ${ctx.regionLabel}`, description: `Åbne flokke til events i ${ctx.regionLabel}: se hvor og hvornår de mødes, og bliv en del af flokken.`, canonical: "/find-en-flok", breadcrumbs: crumbs }, body) };
}
