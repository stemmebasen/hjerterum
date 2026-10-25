import { capitalize, dayLabel, hhmm, localDate } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import type { InquiryErrors, InquiryForm } from "../flokken/partners.js";
import { ROW_ART } from "./brand.js";
import { AGE_GROUPS, AGE_LABELS, INTERESTS, type FormErrors, type InterestForm } from "./forms.js";
import type { PickRow } from "./store.js";

/** Flokk as an association: the public pages. Every promise made here is one the association has chosen to keep
 * (see docs/decisions/0008-flokken-forening.md); nothing about prices, events or people is shown before it is real. */

const picksPath = (p: Pick<PickRow, "slug">) => `/events/${p.slug}`;

export function when(p: Pick<PickRow, "starts_at" | "ends_at">, now: number): string {
  const day = capitalize(dayLabel(p.starts_at, now));
  const end = p.ends_at && localDate(p.ends_at) === localDate(p.starts_at) ? `–${hhmm(p.ends_at)}` : "";
  return `${day} kl. ${hhmm(p.starts_at)}${end}`;
}

const place = (p: Pick<PickRow, "venue_name" | "address" | "city">) => [p.venue_name, p.city].filter(Boolean).join(", ");

function pickCard(p: PickRow, now: number): SafeHtml {
  return html`<article class="f-card">
  <a class="f-card-link" href="${picksPath(p)}">
    ${p.image_url ? html`<span class="f-card-media"><img src="${p.image_url}" alt="" loading="lazy" decoding="async"></span>` : ""}
    <span class="f-card-body">
      <span class="f-card-when">${when(p, now)}</span>
      <span class="f-card-title">${p.title}</span>
      <span class="f-card-meta">${p.association}${place(p) ? ` · ${place(p)}` : ""}</span>
    </span>
  </a>
</article>`;
}

function picksBlock(picks: PickRow[], now: number): SafeHtml {
  if (!picks.length) return html`<div class="f-empty">
  <p><strong>De første events er ved at blive valgt.</strong> Vi håndplukker dem sammen med foreningerne bag. Skriv dig på interesselisten, så hører du fra os, når de er klar.</p>
  <p><a class="button" href="/skriv-dig-op">Skriv dig op</a></p>
</div>`;
  return html`<div class="f-cards">${picks.map(p => pickCard(p, now))}</div>`;
}

const PROMISES: Array<[string, string]> = [
  ["Ingen overraskelser", "Før eventet får du at vide, hvad der skal ske, hvornår og hvor – med et billede af mødestedet, værtens navn og billede, og fornavnene på dem, der kommer."],
  ["Værten tager imod", "Værten venter udenfor på et aftalt sted, og I går ind sammen. Du skal ikke stå alene og lede efter nogen."],
  ["Ingen pres", "Du må gerne bare lytte, tage en pause eller gå tidligt – uden at forklare dig. Eftermødet er frivilligt."],
  ["Rolige rammer", "Vi vælger events og steder med siddepladser, overskuelig lyd og et roligt sted til Eftermødet bagefter."]
];

/** The front page's headline takes turns between these, one per visit. */
export const HEADLINES: SafeHtml[] = [
  html`Nye oplevelser, nye mennesker – <em>i trygge rammer.</em>`,
  html`Kom med ud – <em>vi har gemt en plads til dig.</em>`,
  html`Oplev mere sammen med nye mennesker – <em>trygt og uden pres.</em>`
];

export function homePage(ctx: PageContext, picks: PickRow[], headline = 0): View {
  const body = html`
<section class="f-hero">
  <div class="wrap f-hero-inner">
    <div class="f-hero-text">
      <p class="f-kicker">Der er altid plads til én mere</p>
      <h1>${HEADLINES[headline % HEADLINES.length]!}</h1>
      <p class="standfirst">Flokk er for dig, der ikke synes, det er det nemmeste i verden at møde nye mennesker – men gerne vil. Vi tager dig med til håndplukkede kulturevents i foreningslivet i en lille flok med en vært. Vi står for planlægningen, billetten og en lille en til ganen bagefter. Du skal bare møde op.</p>
      <p class="f-actions"><a class="button" href="/skriv-dig-op">Skriv dig på interesselisten</a> <a class="button-secondary" href="/#saadan">Sådan virker det</a></p>
    </div>
    <div class="f-row">${ROW_ART}</div>
  </div>
</section>
<div class="wrap">
  <section class="f-section f-evening" aria-labelledby="h-evening">
    <h2 id="h-evening">En aften med Flokk</h2>
    <ol class="f-timeline">
      <li><span class="f-evening-time">Før</span><span>Du får program, mødested og værtens navn – og ved, hvem der kommer.</span></li>
      <li><span class="f-evening-time">Kvarteret før</span><span>Værten tager imod jer udenfor. I går ind sammen.</span></li>
      <li><span class="f-evening-time">Eventet</span><span>Koncert, foredrag eller forestilling hos en lokal forening. Billetten er ordnet.</span></li>
      <li><span class="f-evening-time">Bagefter</span><span>Eftermødet: en lille en til ganen og tid til at snakke – hvis du har lyst.</span></li>
    </ol>
  </section>
  <section class="f-section f-for-me" aria-labelledby="h-me">
    <h2 id="h-me">Er Flokk for mig?</h2>
    <p class="f-lead">Måske er du ny i byen. Måske er du genert, bor alene eller har bare svært ved at tage det første skridt. Du har lige så meget lyst til fællesskab og gode oplevelser som alle andre – du vil bare gerne have, at det bliver lidt lettere. Så er Flokk for dig.</p>
  </section>
  <section class="f-section" id="saadan" aria-labelledby="h-how">
    <h2 id="h-how">Sådan virker det</h2>
    <ol class="f-steps">
      <li><span class="f-step-no">1</span><h3>Skriv dig op</h3><p>Fortæl os dit fornavn, din mail og gerne lidt om, hvad du kan lide. Lige nu samler vi en interesseliste – vi kontakter dig, når Flokk åbner.</p></li>
      <li><span class="f-step-no">2</span><h3>Sig "jeg vil gerne med"</h3><p>Hver måned håndplukker vi kulturevents hos foreninger i ${ctx.regionLabel}. Du vælger dem, du har lyst til – gerne sammen med en ven.</p></li>
      <li><span class="f-step-no">3</span><h3>Mød op</h3><p>Vi sætter en lille flok på 4–6 sammen med en vært. Billetten er ordnet, og bagefter er der en lille en til ganen.</p></li>
    </ol>
  </section>
  <section class="f-section" aria-labelledby="h-picks">
    <div class="f-section-head"><h2 id="h-picks">Månedens events</h2>${picks.length ? html`<a class="more" href="/maanedens-events">Alle →</a>` : ""}</div>
    ${picksBlock(picks.slice(0, 6), ctx.now)}
  </section>
  <section class="f-section" aria-labelledby="h-safe">
    <div class="f-section-head"><h2 id="h-safe">Tryghed er en del af planen</h2><a class="more" href="/tryghed">Læs mere →</a></div>
    <ul class="f-promises">${PROMISES.map(([title, text]) => html`<li><h3>${title}</h3><p>${text}</p></li>`)}</ul>
  </section>
  <section class="f-section f-two" aria-label="Pris og foreninger">
    <div class="f-panel">
      <h2>Hvad koster det?</h2>
      <p>Flokk er en forening og finansieres af medlemmernes kontingent. Til hvert event betaler du en lille egenbetaling, som går til billetten. Beløbene fastsættes, når foreningen er stiftet.</p>
      <p><strong>Det koster ikke noget at skrive sig på interesselisten.</strong></p>
    </div>
    <div class="f-panel f-panel-alt">
      <h2>For foreninger</h2>
      <p>Vi kommer med nye deltagere og fortæller om jer og jeres arrangement. Sammen finder vi de events, hvor en lille flok passer godt ind.</p>
      <p><a class="button-secondary" href="/for-foreninger">Samarbejd med Flokk</a></p>
    </div>
  </section>
</div>`;
  return {
    status: 200,
    // Not kept by the browser, so the next visit may show another headline.
    headers: { "cache-control": "no-cache" },
    body: page(ctx, {
      title: "Flokk – nye oplevelser, nye mennesker, i trygge rammer",
      description: "For dig, der ikke synes, det er det nemmeste i verden at møde nye mennesker: håndplukkede kulturevents i foreningslivet i en lille, tryg flok – med planlægning, billet og en lille en til ganen bagefter.",
      canonical: "/"
    }, body)
  };
}

export function picksPage(ctx: PageContext, picks: PickRow[]): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Månedens events", path: "/maanedens-events" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Månedens events</h1>
    <p class="standfirst">Håndplukket sammen med foreningerne bag. Til hvert event tager vi en lille flok med – med en vært, billetten og Eftermødet bagefter.</p>
  </header>
  ${picksBlock(picks, ctx.now)}
</div>`;
  return { status: 200, body: page(ctx, { title: "Månedens events", description: `Håndplukkede kulturevents hos foreninger i ${ctx.regionLabel} – i en lille, tryg flok.`, canonical: "/maanedens-events", breadcrumbs: crumbs }, body) };
}

export function pickPage(ctx: PageContext, p: PickRow): View {
  const over = (p.ends_at ?? p.starts_at + 3 * 3600_000) < ctx.now;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Månedens events", path: "/maanedens-events" }, { name: p.title, path: picksPath(p) }];
  const address = [p.address, p.city].filter(Boolean).join(", ");
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="f-kicker">${p.association}</p>
    <h1>${p.title}</h1>
    <p class="f-when">${when(p, ctx.now)}${p.venue_name ? html` · ${p.venue_name}` : ""}</p>
  </header>
  ${p.image_url ? html`<figure class="f-figure"><img src="${p.image_url}" alt="" decoding="async"></figure>` : ""}
  ${over ? html`<p class="notice" role="status">Dette event er afholdt.</p>` : ""}
  ${p.description ? html`<div class="prose">${p.description.split(/\n{2,}/).map(par => html`<p>${par}</p>`)}</div>` : ""}
  <section class="f-panel f-plan" aria-labelledby="h-plan">
    <h2 id="h-plan">Sådan foregår det med Flokk</h2>
    <dl class="f-facts">
      <dt>Hvornår</dt><dd>${when(p, ctx.now)}</dd>
      ${p.venue_name || address ? html`<dt>Hvor</dt><dd>${p.venue_name ? html`${p.venue_name}<br>` : ""}${address}</dd>` : ""}
      <dt>Din flok</dt><dd>4–6 deltagere og en vært, der tager imod jer udenfor. Mødested og tidspunkt får du, når flokken er sat sammen.</dd>
      <dt>Eftermødet</dt><dd>${p.aftermeeting ?? "En lille en til ganen bagefter – hvis du har lyst."}</dd>
      <dt>Egenbetaling</dt><dd>${p.own_payment ?? "Fastsættes, når foreningen er stiftet."}</dd>
      ${p.places ? html`<dt>Pladser</dt><dd>${String(p.places)}</dd>` : ""}
      <dt>Foreningen</dt><dd>${p.association_url ? html`<a href="${p.association_url}" rel="noopener">${p.association}</a>` : p.association}</dd>
    </dl>
    ${over ? "" : html`<p class="f-actions"><a class="button" href="/skriv-dig-op?event=${p.slug}">Jeg vil gerne med</a></p>
    <p class="small meta-muted">Du kommer på interesselisten til netop dette event. Vi kontakter dig, når flokken bliver sat sammen.</p>`}
  </section>
  ${p.event_url ? html`<p><a href="${p.event_url}" rel="noopener">Læs om eventet hos ${p.association}</a></p>` : ""}
  <p><a href="/maanedens-events">← Alle månedens events</a></p>
</div>`;
  return { status: 200, body: page(ctx, { title: p.title, description: `${when(p, ctx.now)} hos ${p.association} – med Flokk i en lille, tryg flok.`, canonical: picksPath(p), breadcrumbs: crumbs, image: p.image_url, type: "article" }, body) };
}

const err = (errors: FormErrors, k: string) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
const invalid = (errors: FormErrors, k: string) => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : "";

export function signupPage(ctx: PageContext, picks: PickRow[], state: { form: InterestForm; errors?: FormErrors; status?: number }): View {
  const f = state.form, errors = state.errors ?? {};
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Skriv dig op", path: "/skriv-dig-op" }];
  const chosen = picks.find(p => p.slug === f.pick);
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Skriv dig op</h1>
    <p class="standfirst">${chosen ? html`Du vil gerne med til <strong>${chosen.title}</strong>. Skriv dig op, så kontakter vi dig, når flokken bliver sat sammen.` : "Lige nu samler vi en interesseliste. Skriv dig op, så kontakter vi dig, når Flokk åbner – og når der er events, du kan komme med til."}</p>
  </header>
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card f-form" method="post" action="/skriv-dig-op" novalidate>
    <div class="field"><label for="s-name">Fornavn</label><input id="s-name" name="fornavn" type="text" maxlength="30" autocomplete="given-name" required value="${f.firstName}"${invalid(errors, "firstName")}>${err(errors, "firstName")}</div>
    <div class="field"><label for="s-email">Mail</label><input id="s-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid(errors, "email")}>${err(errors, "email")}</div>
    <div class="field"><label for="s-age">Alder <span class="meta-muted">(valgfrit – vi sætter gerne flokke sammen af folk på nogenlunde samme alder)</span></label>
      <select id="s-age" name="alder"${invalid(errors, "ageGroup")}><option value="">Vil ikke oplyse</option>${AGE_GROUPS.map(a => html`<option value="${a}"${f.ageGroup === a ? raw(" selected") : ""}>${AGE_LABELS[a]}</option>`)}</select>${err(errors, "ageGroup")}</div>
    <div class="field"><label for="s-area">Hvor bor du? <span class="meta-muted">(valgfrit)</span></label>
      <select id="s-area" name="omraade"${invalid(errors, "area")}><option value="">Vil ikke oplyse</option>${ctx.areas.map(a => html`<option value="${a.slug}"${f.area === a.slug ? raw(" selected") : ""}>${a.place}</option>`)}</select>${err(errors, "area")}</div>
    <fieldset class="field"><legend>Hvad kan du lide? <span class="meta-muted">(valgfrit)</span></legend>
      <div class="f-checks">${INTERESTS.map((i, n) => html`<label class="f-check" for="s-i${n}"><input id="s-i${n}" type="checkbox" name="interesser" value="${i}"${f.interests.includes(i) ? raw(" checked") : ""}> ${i}</label>`)}</div>
    </fieldset>
    ${picks.length ? html`<div class="field"><label for="s-event">Vil du gerne med til et bestemt event? <span class="meta-muted">(valgfrit)</span></label>
      <select id="s-event" name="event"${invalid(errors, "pick")}><option value="">Ikke et bestemt endnu</option>${picks.map(p => html`<option value="${p.slug}"${f.pick === p.slug ? raw(" selected") : ""}>${p.title} – ${when(p, ctx.now)}</option>`)}</select>${err(errors, "pick")}</div>` : ""}
    <label class="f-check" for="s-friend"><input id="s-friend" type="checkbox" name="ven" value="ja"${f.withFriend ? raw(" checked") : ""}> Jeg vil gerne tage en ven med</label>
    <label class="f-check f-consent" for="s-consent"><input id="s-consent" type="checkbox" name="samtykke" value="ja"${f.consent ? raw(" checked") : ""}${invalid(errors, "consent")}> Flokk må gemme mine oplysninger og kontakte mig på mail om Flokk. Jeg kan altid få dem slettet.</label>${err(errors, "consent")}
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Skriv mig op</button></div>
    <p class="small meta-muted">Vi bruger kun dine oplysninger til Flokk og deler dem ikke med andre. <a href="/privatliv">Læs om privatliv</a>.</p>
  </form>
</div>`;
  return { status: state.status ?? 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Skriv dig op", description: "Skriv dig på Flokks interesseliste – så kontakter vi dig, når Flokk åbner.", canonical: "/skriv-dig-op", breadcrumbs: crumbs }, body) };
}

export function thanksPage(ctx: PageContext, firstName: string, pick: PickRow | null): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Tak, ${firstName}!</h1>
    <p class="standfirst">${pick ? html`Du står nu på listen til <strong>${pick.title}</strong>. Vi kontakter dig på mail, når flokken bliver sat sammen.` : "Du står nu på Flokks interesseliste. Vi kontakter dig på mail, når Flokk åbner."}</p>
    <p>Har du lyst, kan du læse mere om <a href="/tryghed">hvordan vi gør det trygt</a> – eller kigge på <a href="/maanedens-events">månedens events</a>.</p>
  </header>
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Tak", description: "Du er skrevet op.", canonical: "/skriv-dig-op", noindex: true }, body) };
}

export function safetyPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Tryghed", path: "/tryghed" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Tryghed er en del af planen</h1>
    <p class="standfirst">Flokk er bygget til dig, der gerne vil ud, men ikke synes, det er let at gå alene ind et nyt sted. Derfor er trygheden ikke noget, vi håber på – den er planlagt.</p>
  </header>
  ${PROMISES.map(([title, text]) => html`<h2>${title}</h2><p>${text}</p>`)}
  <h2>Små flokke med en vært</h2>
  <p>En flok er 4–6 deltagere og en vært fra Flokk. Værten kender planen, holder styr på tiden og sørger for, at ingen bliver glemt. Du må gerne tage én ven med.</p>
  <h2>Hvis noget ikke føles rigtigt</h2>
  <p>Sig det til værten, eller gå – du skal ikke forklare dig. Vi mødes altid på offentlige steder.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Tryghed", description: "Ingen overraskelser, en vært der tager imod, ingen pres og rolige rammer – sådan gør Flokk det trygt at møde nye mennesker.", canonical: "/tryghed", breadcrumbs: crumbs }, body) };
}

export function aboutPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Om Flokk", path: "/om" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Om Flokk</h1>
    <p class="standfirst">Flokk er en forening under stiftelse i ${ctx.regionLabel}. Vi finansieres af medlemmernes kontingent.</p>
  </header>
  <h2>To formål</h2>
  <ul>
    <li><strong>At bringe folk sammen</strong> om gode oplevelser – særligt dem, der ikke synes, det er det nemmeste i verden at møde nye mennesker.</li>
    <li><strong>At give foreningslivet mere opmærksomhed</strong> – flere skal vide, at foreningerne findes, og hvad de laver.</li>
  </ul>
  <h2>Kun foreningsbaseret</h2>
  <p>Alle Flokks events foregår hos foreninger, vi har valgt at samarbejde med om det enkelte event. Vi håndplukker dem hver måned.</p>
  <h2>Hvad det koster</h2>
  <p>Som medlem betaler du kontingent til foreningen og en lille egenbetaling til hvert event, som går til billetten. Beløbene fastsættes, når foreningen er stiftet. Indtil da kan du skrive dig gratis på interesselisten.</p>
  <h2>Skriv til os</h2>
  <p>Er du en forening, så brug <a href="/for-foreninger#kontakt">formularen for foreninger</a>.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om Flokk", description: `Flokk er en forening under stiftelse i ${ctx.regionLabel}: kultur i en lille, tryg flok – og mere synlighed for foreningslivet.`, canonical: "/om", breadcrumbs: crumbs }, body) };
}

export function associationsPage(ctx: PageContext, state: { form?: InquiryForm; errors?: InquiryErrors; sent?: boolean; status?: number } = {}): View {
  const f = state.form ?? { organisation: "", contactName: "", email: "", website: "", message: "" };
  const errors = (state.errors ?? {}) as FormErrors;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "For foreninger", path: "/for-foreninger" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>For foreninger</h1>
    <p class="standfirst">Flokk tager små, trygge flokke med til arrangementer i foreningslivet. Vi står for planlægningen og billetterne – I får nye ansigter og mere opmærksomhed.</p>
  </header>
  <h2>Det får I ud af det</h2>
  <ul>
    <li><strong>Nye deltagere.</strong> Vi kommer med en lille flok, som måske bliver ved med at komme.</li>
    <li><strong>Synlighed.</strong> Jeres forening og arrangement præsenteres på Flokks side og over for vores medlemmer.</li>
    <li><strong>Mulig radioomtale.</strong> Hvis det passer, kan vi fortælle om jer og arrangementet i radioen – det aftaler vi konkret.</li>
  </ul>
  <h2>Det beder vi om</h2>
  <ul>
    <li><strong>En billetrabat eller reserverede pladser</strong> til flokken, så egenbetalingen for vores medlemmer kan holdes lav.</li>
    <li>Gerne et roligt sted at mødes før og sidde bagefter.</li>
  </ul>
  <p>Vi vælger arrangementerne sammen med jer, ét ad gangen. Intet vises hos os, før I har sagt ja.</p>
  <h2 id="kontakt">Skriv til os</h2>
  ${state.sent ? html`<p class="flash" role="status">Tak for jeres henvendelse. Vi vender tilbage.</p>` : html`
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="/for-foreninger" novalidate>
    <div class="field"><label for="p-org">Forening</label><input id="p-org" name="organisation" type="text" maxlength="120" required value="${f.organisation}"${invalid(errors, "organisation")}>${err(errors, "organisation")}</div>
    <div class="field"><label for="p-name">Dit navn</label><input id="p-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.contactName}"${invalid(errors, "contactName")}>${err(errors, "contactName")}</div>
    <div class="field"><label for="p-email">Mail</label><input id="p-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid(errors, "email")}>${err(errors, "email")}</div>
    <div class="field"><label for="p-web">Hjemmeside <span class="meta-muted">(valgfrit)</span></label><input id="p-web" name="hjemmeside" type="url" maxlength="200" value="${f.website}"${invalid(errors, "website")}>${err(errors, "website")}</div>
    <div class="field"><label for="p-msg">Fortæl gerne om et arrangement, I tænker kunne passe <span class="meta-muted">(valgfrit)</span></label><textarea id="p-msg" name="besked" rows="5" maxlength="2000">${f.message}</textarea>${err(errors, "message")}</div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Send</button></div>
    <p class="small meta-muted">Vi gemmer kun det, I skriver her, for at kunne svare jer.</p>
  </form>`}
</div>`;
  return { status: state.status ?? 200, ...(state.sent || state.errors ? { headers: { "cache-control": "no-store" } } : {}), body: page(ctx, { title: "For foreninger", description: "Flokk tager små, trygge flokke med til jeres arrangementer – nye deltagere, synlighed og mulig radioomtale.", canonical: "/for-foreninger", breadcrumbs: crumbs }, body) };
}

export function privacyPage(ctx: PageContext, state: { deleted?: boolean } = {}): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Privatliv", path: "/privatliv" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Privatliv</h1>
    <p class="standfirst">Vi gemmer så lidt som muligt og bruger det kun til Flokk.</p>
  </header>
  <h2>Hvem er ansvarlig</h2>
  <p>Flokk, en forening under stiftelse i ${ctx.regionLabel}.</p>
  <h2>Hvad vi gemmer</h2>
  <ul>
    <li><strong>Interesselisten:</strong> fornavn og mail – og hvis du vælger det: aldersgruppe, område, interesser, et event du gerne vil med til, og om du tager en ven med.</li>
    <li><strong>Henvendelser fra foreninger:</strong> det, I skriver i formularen.</li>
  </ul>
  <p>Vi bruger det kun til at kontakte dig om Flokk og til at sætte flokke sammen. Vi deler det ikke med andre, og vi bruger ingen sporing eller reklamecookies. Kun Flokks frivillige kan se listen.</p>
  <h2>Hvor længe</h2>
  <p>Til du beder os slette det – eller til Flokk åbner, og du selv vælger at blive medlem.</p>
  <h2 id="slet">Slet mine oplysninger</h2>
  ${state.deleted ? html`<p class="flash" role="status">Hvis mailen stod på listen, er den slettet nu.</p>` : ""}
  <form class="form-card" method="post" action="/privatliv" novalidate>
    <div class="field"><label for="d-email">Din mail</label><input id="d-email" name="email" type="email" maxlength="160" autocomplete="email" required></div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Slet mig fra listen</button></div>
  </form>
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Privatliv", description: "Hvad Flokk gemmer, hvorfor, og hvordan du får det slettet.", canonical: "/privatliv", breadcrumbs: crumbs }, body) };
}

export function notFound(ctx: PageContext): View {
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    <h1>Siden findes ikke</h1>
    <p class="standfirst">Den kan være flyttet, eller eventet er afholdt.</p>
    <p><a class="button" href="/">Til forsiden</a> <a class="button-secondary" href="/maanedens-events">Månedens events</a></p>
  </header>
</div>`;
  return { status: 404, body: page(ctx, { title: "Siden findes ikke", description: "Siden findes ikke.", canonical: ctx.path, noindex: true }, body) };
}
