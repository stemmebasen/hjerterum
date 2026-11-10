import type { EventRow } from "../web/queries.js";
import { eventPath, placeLine, seats } from "../web/components.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import { capitalize, dayLabel, hhmm, timeRangeLabel } from "../time.js";
import type { Member } from "./auth.js";
import type { FieldErrors, FlockForm } from "./forms.js";
import { eventOver, isFull, MAX_SIZE, MIN_SIZE, type FlockRow } from "./store.js";
import { MAX_LENGTH, type ChatMessage } from "./chat.js";
import type { SignupErrors, SignupForm } from "./membership.js";
import { AGE_GROUPS, AGE_LABELS, FREE_OUTINGS, INTRO_MAX, type FlockMember, type Profile, type ProfileErrors, type ProfileForm } from "./profile.js";

/** Flokken's own pages and the flock panel on event pages. Words used throughout: flok, Vil du med?, Jeg er interesseret, start selv en flok,
 * Bliv en del af flokken. */

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
  logget_ud: "Du er logget ud.",
  tak: "Tak for din henvendelse. Vi vender tilbage.",
  meldt: "Tak. Beskeden er meldt og skjult for dig. Vi kigger på den.",
  profil_gemt: "Din profil er gemt.",
  interesser_gemt: "Tak! Du står på listen – helt uforpligtende. Når vi er en håndfuld, der vil med til det samme, samler vi en flok og spørger dig, om du vil med.",
  interesse_fjernet: "Eventet er fjernet fra din liste.",
  interesse_her: "Tak! Du er på listen – helt uforpligtende. Når vi er en håndfuld, samler vi en flok og skriver til dig.",
  nej_tak: "Tak for svaret. Pladsen går videre til den næste.",
  bekraeftet: "Du er med! Sig hej i chatten herunder, og find sammen ud af, hvor I mødes."
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
  chat_closed: "Chatten er lukket. Den lukker en uge efter eventet.",
  chat_empty: "Skriv en besked først.",
  chat_too_long: `Beskeden er for lang. Højst ${MAX_LENGTH} tegn.`,
  chat_too_fast: "Du har skrevet mange beskeder på kort tid. Vent lidt, og prøv igen.",
  not_found: "Beskeden findes ikke længere.",
  invitation_not_invited: "Invitationen findes ikke længere.",
  invitation_too_late: "Fristen for at svare er gået, så pladsen er gået videre. Sæt kryds igen, hvis du stadig vil med.",
  invitation_full: "Flokken blev fuld i mellemtiden. Du står forrest på listen til den næste.",
  invitation_event_closed: "Eventet er gået i gang, afholdt eller aflyst.",
  intet_valgt: "Vælg mindst ét event først."
};
/** The text for a ?besked= code, for the chat's JSON answers. */
export const noticeText = (code: string): string => MESSAGES[code] ?? ERRORS[code] ?? "Noget gik galt. Prøv igen.";
/** "I dag kl. 18.42" for a chat message. */
export const chatTime = (at: number, now: number): string => `${capitalize(dayLabel(at, now))} kl. ${hhmm(at)}`;
export const flash = (code: string | null): SafeHtml => {
  if (!code) return html``;
  const ok = MESSAGES[code];
  const err = ERRORS[code];
  return ok ? html`<p class="flash" role="status">${ok}</p>` : err ? html`<p class="flash flash-error" role="alert">${err}</p>` : html``;
};

const trustLine = html`<p class="trust-line">Flokke mødes et offentligt sted. Kun dem i flokken ser dit fornavn, din alder og din linje om dig selv, og du kan altid forlade en flok. <a href="/tryghed">Sådan holder vi det trygt</a></p>`;

// ————————————————————————————————————————— On the event page

/** What the visitor has said about the event on the interest list: how many others are interested, and their own
 * standing (null when they have not ticked it). */
export type EventInterest = { others: number; mine: "waiting" | "invited" | "confirmed" | "declined" | "expired" | null };

/** "1 anden er interesseret", "3 andre er interesseret". Only said when there is at least one. */
const othersLine = (n: number, also: boolean): string => n === 1 ? `1 anden er ${also ? "også " : ""}interesseret.` : `${n} andre er ${also ? "også " : ""}interesseret.`;

/** "Vil du med?" on the event page. The interest list's tick for this one event comes first: Socialklubben gathers a
 * flock when a handful are interested. Flocks with room are still shown, and starting one yourself is a small link. */
export function flockPanel(e: EventRow, flocks: FlockRow[], member: Member | null, myFlockId: string | null, now: number, interest: EventInterest = { others: 0, mine: null }): SafeHtml {
  const over = (e.ends_at ?? e.starts_at + 3 * 3600_000) < now;
  const canStart = e.status === "scheduled" && e.starts_at > now;
  const create = `${eventPath(e)}/opret-flok`;
  const interestPath = `${eventPath(e)}/interesse`;
  const action = (f: FlockRow): SafeHtml => {
    if (f.is_member) return html`<a class="button" href="${flockPath(f.id)}">Du er en del af flokken – se den</a>`;
    if (!canStart) return html`<a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    if (isFull(f)) return html`<span class="flock-state">Flokken er fuld</span> <a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    if (!member) return html`<a class="button" href="${loginPath(flockPath(f.id))}">Bliv en del af flokken</a>`;
    if (myFlockId) return html`<a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
    return html`<form method="post" action="${flockPath(f.id)}/bliv-del-af"><button type="submit">Bliv en del af flokken</button></form> <a class="button-secondary" href="${flockPath(f.id)}">Se flokken</a>`;
  };
  const inFlock = !!(myFlockId && member);
  const count = interest.others > 0 ? html` <span class="interest-count">${othersLine(interest.others, interest.mine === "waiting")}</span>` : "";
  const tick = (): SafeHtml => {
    if (interest.mine === "waiting") return html`<div class="flock-interest is-on">
      <p class="flock-interest-state"><strong>Du er på listen.</strong> Vi skriver, når der er en flok.${count}</p>
      <form method="post" action="${interestPath}/fjern" class="inline-form"><button type="submit" class="button-link">Fjern mig fra listen</button></form>
    </div>`;
    if (interest.mine === "invited") return html`<div class="flock-interest is-on">
      <p class="flock-interest-state"><strong>Din flok er klar!</strong> <a href="/flokke#interesser">Sig ja eller nej tak under Mine flokke</a>.</p>
    </div>`;
    return html`<form method="post" action="${interestPath}" class="flock-interest">
      <button type="submit">Jeg er interesseret</button>${count}
    </form>`;
  };
  return html`<section class="flock-panel" id="flokke" aria-labelledby="h-flokke">
  <div class="flock-panel-head">
    <h2 id="h-flokke">Vil du med?</h2>
    ${canStart && !inFlock ? html`<p>Sæt kryds, hvis du har lyst til at opleve det her sammen med andre. Når vi er en håndfuld, samler vi en flok og skriver til dig. Først dér siger du ja.</p>` : ""}
  </div>
  ${flocks.length ? html`<ul class="flock-list">${flocks.map(f => html`<li class="flock-card${f.is_member ? " is-mine" : ""}">
    <p class="flock-when"><span class="visually-hidden">Mødes: </span>${meetingLine(f, now)}</p>
    <p class="flock-meta">${seats(f.member_count, f.max_size)} ${spotsLine(f)}</p>
    ${f.note ? html`<p class="flock-note">${f.note}</p>` : ""}
    <div class="flock-actions">${action(f)}</div>
  </li>`)}</ul>` : over ? html`<p class="flock-empty">Der var ingen flok til dette event.</p>` : ""}
  ${canStart ? inFlock ? flocks.some(f => f.id === myFlockId) ? "" : html`<p class="flock-mine">Du er med i en flok til eventet. <a href="${flockPath(myFlockId!)}">Se din flok</a></p>`
    : html`${tick()}<p class="flock-create small">eller <a href="${member ? create : loginPath(create)}">start selv en flok</a></p>` : ""}
  ${trustLine}
</section>`;
}

// ————————————————————————————————————————— A flock's own page

// ————————————————————————————————————————— The flock's chat

function chatItem(c: ChatMessage, memberId: string, flockId: string, now: number): SafeHtml {
  const mine = c.member_id === memberId;
  return html`<li class="chat-msg${mine ? " is-mine" : ""}" data-id="${c.id}" data-at="${c.created_at}">
    <p class="chat-meta"><strong>${c.first_name}</strong>${mine ? html` <span class="meta-muted">(dig)</span>` : ""} <time datetime="${new Date(c.created_at).toISOString()}">${chatTime(c.created_at, now)}</time></p>
    <p class="chat-body">${c.body}</p>
    ${mine ? "" : html`<form method="post" action="${flockPath(flockId)}/chat/${c.id}/meld" class="chat-report" data-chat-report><button type="submit" class="button-link">Meld besked</button></form>`}
  </li>`;
}

export function chatSection(f: Pick<FlockRow, "id">, chat: { messages: ChatMessage[]; open: boolean }, member: Member, now: number): SafeHtml {
  return html`<section class="section chat" id="chat" aria-labelledby="h-chat">
    <div class="section-head"><h2 id="h-chat">Chat</h2></div>
    <p class="small meta-muted">Kun dem i flokken kan læse med. Sig hej, aftal detaljer eller skriv, hvis du bliver forsinket. Telefonnumre og e-mails bliver skjult.</p>
    <p class="chat-empty" data-chat-empty${chat.messages.length ? raw(" hidden") : ""}>Ingen beskeder endnu. Sig hej!</p>
    <ol class="chat-list" data-chat aria-live="polite">${chat.messages.map(c => chatItem(c, member.id, f.id, now))}</ol>
    ${chat.open ? html`<form method="post" action="${flockPath(f.id)}/chat" class="chat-form" data-chat-form>
      <label for="chat-text" class="visually-hidden">Skriv en besked</label>
      <textarea id="chat-text" name="tekst" rows="2" maxlength="${MAX_LENGTH}" required placeholder="Skriv en besked …"></textarea>
      <button type="submit">Send</button>
      <p class="field-error" data-chat-error role="alert" hidden></p>
    </form>` : html`<p class="notice" data-chat-closed>Chatten er lukket. Den lukker en uge efter eventet.</p>`}
  </section>`;
}

/** "Har været med 3 gange", or "Første flok" for someone new. */
export const timesLine = (n: number): string => n === 0 ? "Første flok" : `Har været med ${n} ${n === 1 ? "gang" : "gange"}`;
/** "30–39, 40–49" */
const ageList = (ages: string[]) => ages.map(a => (AGE_LABELS[a] ?? a).replace(/ år$/, "")).join(", ");

function memberCard(n: FlockMember, flockId: string, member: Member | null, hostId: string | null): SafeHtml {
  const initial = [...n.first_name][0]?.toUpperCase() ?? "?";
  return html`<li class="member-card">
    ${n.photo_id ? html`<img class="avatar" src="${flockPath(flockId)}/foto/${n.photo_id}" alt="${n.first_name}" width="56" height="56" loading="lazy">` : html`<span class="avatar avatar-initial" aria-hidden="true">${initial}</span>`}
    <div class="member-text">
      <p class="member-name"><strong>${n.first_name}</strong>${n.age_group ? html` <span class="meta-muted">· ${AGE_LABELS[n.age_group] ?? n.age_group}</span>` : ""}${member && n.id === member.id ? html` <span class="meta-muted">(dig)</span>` : ""}${n.id === hostId ? html` <span class="pill-small">står for flokken</span>` : ""}</p>
      ${n.intro ? html`<p class="member-intro">${n.intro}</p>` : ""}
      <p class="member-times small meta-muted">${timesLine(n.times)}</p>
    </div>
  </li>`;
}

export function flockPage(ctx: PageContext, f: FlockRow, e: EventRow | null, people: FlockMember[], member: Member | null, hostId: string | null, message: string | null, chat: { messages: ChatMessage[]; open: boolean } | null = null, ages: string[] = []): View {
  const canJoin = f.status === "open" && f.event_status === "scheduled" && f.event_starts_at > ctx.now;
  const isHost = !!member && hostId === member.id;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: f.event_title, path: `/events/${f.event_slug}` }, { name: "Flokken", path: flockPath(f.id) }];
  const join = !canJoin || f.is_member ? html``
    : isFull(f) ? html`<p class="flock-state">Flokken er fuld.</p>`
    : member ? html`<form method="post" action="${flockPath(f.id)}/bliv-del-af"><button type="submit">Bliv en del af flokken</button></form>`
    : html`<a class="button" href="${loginPath(flockPath(f.id))}">Bliv en del af flokken</a>`;
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
      <dt>Flokken</dt><dd>${seats(f.member_count, f.max_size)} ${spotsLine(f)}</dd>
    </dl>
    ${f.note ? html`<p class="flock-note">${f.note}</p>` : ""}
    ${e?.signup_url && canJoin ? html`<p class="small meta-muted">Billet eller tilmelding sker hos arrangøren – hver for sig. <a href="${e.signup_url}" rel="noopener" target="_blank">Tilmeld hos arrangøren</a></p>` : ""}
    <div class="flock-actions">${join}${isHost && canJoin ? html`<a class="button-secondary" href="${flockPath(f.id)}/ret">Ret mødested og tidspunkt</a>` : ""}</div>
  </section>
  ${f.is_member ? html`<section class="section" aria-labelledby="h-members">
    <div class="section-head"><h2 id="h-members">I flokken</h2></div>
    <ul class="member-cards">${people.map(n => memberCard(n, f.id, member, hostId))}</ul>
    <p class="small meta-muted">Kun dem i flokken kan se, hvem der er med. I finder hinanden ved mødestedet. <a href="/profil?naeste=${encodeURIComponent(flockPath(f.id))}">Ret din profil</a></p>
  </section>
  ${chat && member ? chatSection(f, chat, member, ctx.now) : ""}
  <section class="section" aria-labelledby="h-leave">
    <form method="post" action="${flockPath(f.id)}/forlad"><button type="submit" class="button-quiet">Forlad flokken</button></form>
  </section>` : html`<p class="meta-muted">${f.member_count === 1 ? "1 person" : `${f.member_count} personer`} er med${ages.length ? html` (${ageList(ages)} år)` : ""}. Navne og præsentationer kan kun ses af dem i flokken.</p>`}
  ${trustLine}
</div>`;
  return { status: 200, headers: PRIVATE, body: page(ctx, { title: `Flok til ${f.event_title}`, description: `En flok følges til ${f.event_title}. ${meetingLine(f, ctx.now)}.`, canonical: flockPath(f.id), noindex: true, breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Creating and editing

export function flockFormPage(ctx: PageContext, e: EventRow, form: FlockForm, errors: FieldErrors, options: { mode: "create" | "edit"; action: string; status?: number }): View {
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

/** "1 af 3 udflugter uden medlemskab brugt", with a dot per free outing. */
export function freeOutings(used: number): SafeHtml {
  const n = Math.min(used, FREE_OUTINGS);
  const text = used >= FREE_OUTINGS ? `Du har brugt dine ${FREE_OUTINGS} udflugter uden medlemskab` : `${n} af ${FREE_OUTINGS} udflugter uden medlemskab brugt`;
  return html`<p class="free-outings"><span class="free-dots" aria-hidden="true">${Array.from({ length: FREE_OUTINGS }, (_, i) => html`<span class="free-dot${i < n ? " is-used" : ""}"></span>`)}</span>
    <span><strong>${text}</strong> <span class="meta-muted">· En udflugt tæller, når du har været afsted med en flok.</span></span></p>`;
}

export function myFlocksPage(ctx: PageContext, member: Member, flocks: FlockRow[], message: string | null, extra: { top?: SafeHtml; interests?: SafeHtml; outings?: number } = {}): View {
  const upcoming = flocks.filter(f => !eventOver(f, ctx.now)).reverse();
  const past = flocks.filter(f => eventOver(f, ctx.now));
  const row = (f: FlockRow) => html`<li class="flock-card"><a href="${flockPath(f.id)}"><span class="flock-title">${f.event_title}</span>
    <span class="flock-when">${meetingLine(f, ctx.now)}</span><span class="flock-meta">${spotsLine(f)}</span></a></li>`;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Mine flokke", path: "/flokke" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Hej ${member.first_name}</h1>
    ${flash(message)}
    <p class="standfirst">Her er dine flokke. Find et event i <a href="/kalender">kalenderen</a> for at finde eller oprette en flok.</p>
    ${extra.outings !== undefined ? freeOutings(extra.outings) : ""}
  </header>
  ${extra.top ?? ""}
  ${extra.interests ?? ""}
  <section class="section" aria-labelledby="h-up">
    <div class="section-head"><h2 id="h-up">Kommende</h2></div>
    ${upcoming.length ? html`<ul class="flock-list">${upcoming.map(row)}</ul>` : html`<p class="empty">Du er ikke i nogen flok endnu. <a href="/kalender">Find et event</a>, og tryk <strong>Jeg er interesseret</strong> under <strong>Vil du med?</strong>.</p>`}
  </section>
  ${past.length ? html`<section class="section" aria-labelledby="h-past">
    <div class="section-head"><h2 id="h-past">Tidligere</h2></div>
    <ul class="flock-list">${past.map(row)}</ul>
  </section>` : ""}
  <section class="section" aria-labelledby="h-account">
    <div class="section-head"><h2 id="h-account">Din profil</h2></div>
    <p>Du er med som <strong>${member.first_name}</strong>. Dem i dine flokke ser dit fornavn, din aldersgruppe, din linje om dig selv og dit billede, hvis du har lagt et op. Du logger ind på en ny enhed med den personlige kode, du fik, da du blev medlem.</p>
    <p class="flock-actions"><a class="button-secondary" href="/profil?naeste=%2Fflokke">Ret din profil</a></p>
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
    <p class="standfirst">For at oprette eller blive en del af en flok skal du have en profil. Det kræver kun dit fornavn – intet telefonnummer. Når du vil være med i en flok, beder vi om din aldersgruppe og en linje om dig selv, så de andre ved, hvem de skal møde. Vil du have besked, når vi har samlet en flok til dig, beder vi også om din e-mail.</p>
  </header>
  <div class="two-forms">
    <form class="form-card" method="post" action="/bliv-medlem" novalidate>
      <h2>Ny her?</h2>
      <input type="hidden" name="naeste" value="${next}">
      <div class="field">
        <label for="m-name">Dit fornavn</label>
        <input id="m-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${state.name ?? ""}"${state.nameError ? raw(' aria-invalid="true" aria-describedby="err-name"') : ""}>
        <span class="hint">Kun dem i dine flokke ser det.</span>
        ${state.nameError ? html`<span class="field-error" id="err-name">${state.nameError}</span>` : ""}
      </div>
      <div class="form-actions"><button type="submit">Opret profil</button></div>
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
  return { status: state.status ?? 200, headers: PRIVATE, body: page(ctx, { title: "Log ind – Flokken", description: "Opret en profil på Flokken eller log ind.", canonical: "/log-ind", noindex: true, breadcrumbs: crumbs }, body) };
}

export function welcomePage(ctx: PageContext, member: Member, code: string, next: string): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Velkommen, ${member.first_name}!</h1>
    <p class="standfirst">Din profil er oprettet, og du er logget ind på denne enhed. Du kan deltage i de første ${FREE_OUTINGS} udflugter uden at være medlem.</p>
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

// ————————————————————————————————————————— Membership

/** "Bliv medlem": what membership of the association means. No payment yet; the first outings need none. */
export function membershipPage(ctx: PageContext, loggedIn: boolean, state: { form?: SignupForm; errors?: SignupErrors; sent?: boolean; status?: number } = {}): View {
  const f = state.form ?? { name: "", email: "" };
  const errors = state.errors ?? {};
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Bliv medlem", path: "/bliv-medlem" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Bliv medlem af Flokken</h1>
    <p class="standfirst">Flokken er en forening, og den findes, fordi folk er med. Som medlem holder du fællesskabet i gang – for dig selv og for dem, der har brug for en ekstra hånd for at komme ud. <a href="#meld-ind">Meld dig ind her</a>.</p>
  </header>
  <h2>Prøv det først</h2>
  <p>Du kan deltage i de første ${FREE_OUTINGS} udflugter uden at være medlem. Opret en profil med dit fornavn, sæt kryds ved det, du har lyst til, og kom med, når vi har samlet en flok. Så ved du, hvad du siger ja til.</p>
  <h2>Som medlem</h2>
  <ul>
    <li>kan du blive ved med at tage med i flokke, så ofte du vil,</li>
    <li>er du med til at forme foreningen – kom med idéer, ønsker og arrangementer,</li>
    <li>hjælper du byens mindre spillesteder, teatre og foreninger med at blive set,</li>
    <li>gør du det lettere for nye i byen at finde en vej ind i fællesskabet.</li>
  </ul>
  <h2>Kontingent</h2>
  <p>Kontingentet er <strong>250 kr. om året</strong> (inkl. moms), og pengene går tilbage til foreningen og fællesskabet. Betalingen er ikke åben endnu. Du kan melde dig ind nu, og vi skriver til dig, før du skal betale noget.</p>
  <p class="more-line">${loggedIn
    ? html`<a class="button" href="/kom-godt-i-gang">Find en oplevelse</a> <a class="button-secondary" href="/flokke">Mine flokke</a>`
    : html`<a class="button" href="/log-ind?naeste=/kom-godt-i-gang">Opret profil og kom i gang</a>`}</p>
  <h2 id="meld-ind">Meld dig ind</h2>
  <p>Du behøver ingen profil for at være medlem, og du behøver ikke tage med på noget. Mange er medlem for at støtte fællesskabet – også selvom de ikke selv tager med. Skriv dit navn og din e-mail, så skriver vi til dig, når betalingen åbner.</p>
  ${state.sent
    ? html`<p class="notice" role="status">Tak, du er meldt ind! Vi skriver til dig, når betalingen åbner.</p>`
    : html`<form class="form-card" method="post" action="/bliv-medlem/meld-ind#meld-ind" novalidate>
    <div class="field">
      <label for="s-name">Dit navn</label>
      <input id="s-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.name}"${errors.name ? raw(' aria-invalid="true" aria-describedby="err-s-name"') : ""}>
      ${errors.name ? html`<span class="field-error" id="err-s-name">${errors.name}</span>` : ""}
    </div>
    <div class="field">
      <label for="s-email">Din e-mail</label>
      <input id="s-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${errors.email ? raw(' aria-invalid="true" aria-describedby="err-s-email"') : ""}>
      <span class="hint">Vi bruger den kun til at skrive til dig om dit medlemskab.</span>
      ${errors.email ? html`<span class="field-error" id="err-s-email">${errors.email}</span>` : ""}
    </div>
    <div class="hp" aria-hidden="true"><label for="s-web">Lad dette felt være tomt</label><input id="s-web" name="website_url" type="text" tabindex="-1" autocomplete="off"></div>
    <div class="form-actions"><button type="submit">Bliv medlem</button></div>
  </form>`}
</div>`;
  return { status: state.status ?? 200, body: page(ctx, { title: "Bliv medlem af Flokken", description: `Flokken er en forening. Du kan deltage i de første ${FREE_OUTINGS} udflugter uden at være medlem – og som medlem holder du fællesskabet i gang.`, canonical: "/bliv-medlem", breadcrumbs: crumbs }, body) };
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
  <h2>I ved, hvem I skal møde</h2>
  <p>Når du vil være med i en flok, beder vi om dit fornavn, din aldersgruppe og én linje om dig selv, fx “Glæder mig til jazz, er lidt genert i starten”. Et billede er frivilligt. Det hele kan kun ses af dem, der er med i flokken. Andre kan kun se, hvilke aldersgrupper der er med, før de siger ja. Vi beder aldrig om telefonnummer eller adresse, og telefonnumre og e-mails bliver skjult, hvis de står i en præsentation. Din e-mail, hvis du giver den, bruger vi kun til at give dig besked om dine flokke – ingen andre ser den.</p>
  <p>Ved hver person står, hvor mange flokke de har været med i før. Det giver en idé om, hvem der har prøvet det før, og hvem der er ny.</p>
  <h2>Chatten i flokken</h2>
  <p>Hver flok har en lille chat, som kun dem i flokken kan læse. Telefonnumre og e-mails bliver skjult automatisk, så I ikke behøver at dele dem. Chatten lukker en uge efter eventet, og beskederne slettes 30 dage efter.</p>
  <p>Er en besked ubehagelig, så tryk <strong>Meld besked</strong>. Den forsvinder med det samme for dig, og når to har meldt den, forsvinder den for alle. Vi læser alle meldinger.</p>
  <h2>Du bestemmer selv</h2>
  <p>Ingen bliver sat i en flok automatisk. Du vælger selv, om du vil oprette en flok eller være en del af en. Står du på listen over interesserede, og vi samler en flok, er du først med, når du selv har bekræftet. Du kan forlade en flok når som helst – også i sidste øjeblik.</p>
  <h2>Billet og tilmelding</h2>
  <p>Hver person køber selv billet eller tilmelder sig hos arrangøren. Flokken håndterer ikke betaling.</p>
  <h2>Det har vi ikke endnu</h2>
  <p>Vi har endnu ikke blokering eller verificerede profiler.${ctx.contactEmail ? html` Oplever du noget ubehageligt, så skriv til <a href="mailto:${ctx.contactEmail}">${ctx.contactEmail}</a>.` : ""} Gå fra, hvis noget føles forkert – og forlad flokken.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Tryghed i Flokken", description: "Offentlige mødesteder, en kort præsentation kun for flokken, og du kan altid forlade en flok.", canonical: "/tryghed", breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Vil du med? (all open flocks) and the front page's part

/** Open flocks as cards linking to each flock: event, meeting time and place, room left. */
export function flockCards(flocks: FlockRow[], now: number): SafeHtml {
  return html`<ul class="flock-grid">${flocks.map(f => html`<li class="flock-card"><a href="${flockPath(f.id)}">
    <span class="flock-title">${f.event_title}</span>
    <span class="flock-when">${meetingLine(f, now)}</span>
    <span class="flock-meta">${seats(f.member_count, f.max_size)} ${spotsLine(f)}</span>
  </a></li>`)}</ul>`;
}

/** The three steps, on the front page and on Vil du med?. */
export const howItWorks = html`<ol class="how">
  <li><span class="how-n" aria-hidden="true">1</span><strong>Find et event</strong><span>Koncerter, teater, foredrag, caféjazz, yoga og workshops fra spillesteder, biblioteker og foreninger.</span></li>
  <li><span class="how-n" aria-hidden="true">2</span><strong>Vis interesse – så samler vi flokken</strong><span>Alting er sjovere i samlet flok. Når I er 5 samlet, giver vi en <span class="secret" aria-hidden="true">*****</span><span class="visually-hidden">overraskelse – hvad det bliver, er ikke afgjort endnu</span>.</span></li>
  <li><span class="how-n" aria-hidden="true">3</span><strong>Mød hinanden</strong><span>Et offentligt sted før eventet – og så går I ind sammen.</span></li>
</ol>`;

export function findFlockPage(ctx: PageContext, flocks: FlockRow[]): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Vil du med?", path: "/find-en-flok" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Vil du med?</h1>
    <p class="standfirst">Sæt kryds ved de events, du har lyst til at opleve sammen med andre. Når vi er en håndfuld, samler vi en flok og skriver til dig – først dér siger du ja. Find eventet i <a href="/kalender">kalenderen</a> og tryk <strong>Jeg er interesseret</strong>, eller vælg flere på én gang: <a href="/kom-godt-i-gang">Lad os komme godt i gang</a>.</p>
  </header>
  ${flocks.length ? html`<section class="section" aria-labelledby="h-open"><div class="section-head"><h2 id="h-open">Flokke med plads lige nu</h2></div>${flockCards(flocks, ctx.now)}</section>` : ""}
  <section class="section" aria-labelledby="h-how"><div class="section-head"><h2 id="h-how">Sådan virker en flok</h2></div>${howItWorks}</section>
  ${trustLine}
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: `Vil du med? – følges med andre til events i ${ctx.regionLabel}`, description: `Vis interesse for events i ${ctx.regionLabel}, så samler vi en lille flok, der følges ad. Helt uforpligtende.`, canonical: "/find-en-flok", breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— Profile: age group, one line and an optional photo

export function profilePage(ctx: PageContext, state: { action: string; next: string; joinId: string | null; profile: Profile; firstTime: boolean; requireEmail?: boolean; form: ProfileForm; errors: ProfileErrors; status?: number }): View {
  const { form, errors } = state;
  const err = (k: keyof ProfileErrors) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
  const describedBy = (k: keyof ProfileErrors, hint?: string) => errors[k] ? raw(` aria-describedby="err-${k}${hint ? ` ${hint}` : ""}" aria-invalid="true"`) : hint ? raw(` aria-describedby="${hint}"`) : "";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Mine flokke", path: "/flokke" }, { name: "Din profil", path: "/profil" }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${state.firstTime ? "Sig hej til flokken" : "Din profil"}</h1>
    <p class="standfirst">${state.firstTime ? "Før du er med i en flok, så fortæl de andre lidt om dig selv. Det tager 20 sekunder, og det gør det lettere at møde nogen, man ikke kender." : "Det her ser dem i dine flokke."}</p>
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="${state.action}" enctype="multipart/form-data" novalidate data-profile-form>
    <div class="field">
      <label for="p-name">Fornavn</label>
      <input id="p-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${form.firstName}"${describedBy("firstName")}>
      ${err("firstName")}
    </div>
    <div class="field">
      <label for="p-age">Alder</label>
      <select id="p-age" name="alder" required${describedBy("ageGroup")}>
        <option value="">Vælg aldersgruppe</option>
        ${AGE_GROUPS.map(a => html`<option value="${a}"${a === form.ageGroup ? raw(" selected") : ""}>${AGE_LABELS[a]}</option>`)}
      </select>
      ${err("ageGroup")}
    </div>
    <div class="field">
      <label for="p-intro">En linje om dig selv</label>
      <input id="p-intro" name="om_mig" type="text" maxlength="${INTRO_MAX}" required value="${form.intro}" placeholder="Fx Glæder mig til jazz, er lidt genert i starten"${describedBy("intro", "hint-intro")}>
      <span class="hint" id="hint-intro">Hvad glæder du dig til, og hvordan er du, når du møder nye? Skriv ikke telefonnummer eller adresse.</span>
      ${err("intro")}
    </div>
    <div class="field">
      <label for="p-email">E-mail${state.requireEmail ? "" : html` <span class="meta-muted">(frivilligt)</span>`}</label>
      <input id="p-email" name="email" type="email" maxlength="160" autocomplete="email"${state.requireEmail ? raw(" required") : ""} value="${form.email}"${describedBy("email", "hint-email")}>
      <span class="hint" id="hint-email">Kun til at give dig besked, når en flok er klar til dig, eller hvis et event bliver aflyst. Ingen andre ser den.</span>
      ${err("email")}
    </div>
    <div class="field">
      <label for="p-photo">Billede <span class="meta-muted">(frivilligt)</span></label>
      ${state.profile.photo_id ? html`<p class="small">Du har et billede. Vælg et nyt for at skifte det.</p>` : ""}
      <input id="p-photo" name="foto" type="file" accept="image/jpeg,image/png,image/webp" data-photo-input${describedBy("photo", "hint-photo")}>
      <span class="hint" id="hint-photo">Kun dem i dine flokke kan se det, og først når du er med. Det gør det lettere at finde hinanden ved mødestedet.</span>
      ${err("photo")}
    </div>
    ${state.profile.photo_id ? html`<div class="field field-check"><label><input type="checkbox" name="fjern_foto" value="ja"${form.removePhoto ? raw(" checked") : ""}> Fjern mit billede</label></div>` : ""}
    <div class="form-actions">
      <button type="submit">${state.joinId ? "Gem og bliv en del af flokken" : state.requireEmail ? "Gem og sæt mig på listen" : "Gem"}</button>
      <a href="${state.next}">Fortryd</a>
    </div>
  </form>
  ${trustLine}
</div>`;
  return { status: state.status ?? 200, headers: PRIVATE, body: page(ctx, { title: "Din profil", description: "Det, dem i dine flokke ser om dig.", canonical: "/profil", noindex: true, breadcrumbs: crumbs }, body) };
}
