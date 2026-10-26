import { capitalize, dayLabel, hhmm, localDate } from "../time.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import type { InquiryErrors, InquiryForm } from "../flokken/partners.js";
import { flockArt, ROW_ART } from "./brand.js";
import type { FormErrors } from "./forms.js";
import type { PickRow } from "./store.js";

/** Flokk: the public pages. They follow the concept's direction (docs/decisions/0009-flokk-udflugter.md): the
 * experiences, the company and the clear frame come first; members take part in their own way. Only what has been
 * decided is stated; prices, terms and the like that are not decided are said to be open. */

const picksPath = (p: Pick<PickRow, "slug">) => `/events/${p.slug}`;

/** Sign-up and ordinary cancellation close seven days before a tur. */
export const CLOSES_DAYS = 7;

export function when(p: Pick<PickRow, "starts_at" | "ends_at">, now: number): string {
  const day = capitalize(dayLabel(p.starts_at, now));
  const end = p.ends_at && localDate(p.ends_at) === localDate(p.starts_at) ? `–${hhmm(p.ends_at)}` : "";
  return `${day} kl. ${hhmm(p.starts_at)}${end}`;
}

const closes = (p: Pick<PickRow, "starts_at">, now: number) => dayLabel(p.starts_at - CLOSES_DAYS * 86_400_000, now);
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
  <p><strong>De første ture er ved at blive planlagt.</strong> Vi laver aftaler med arrangører om billetter til udvalgte koncerter, foredrag og andre oplevelser. Bliv medlem, så kan du tilmelde dig, når de er klar.</p>
  <p><a class="button" href="/bliv-medlem">Bliv medlem</a></p>
</div>`;
  return html`<div class="f-cards">${picks.map(p => pickCard(p, now))}</div>`;
}

/** What a member can count on, as decided. */
const FRAME: Array<[string, string]> = [
  ["Du ved, hvad der skal ske", "Før turen får du program, præcist mødested og fornavnene på dem i din flok – til dig personligt, på mail og under Mine ture."],
  ["En lille flok", "En flok bekræftes, når fire medlemmer har tilmeldt sig. I mødes på det aftalte sted og går ind sammen."],
  ["På din egen måde", "Nogle snakker meget, andre lytter mest. Du kan blive til snakken bagefter eller gå hjem, når oplevelsen er slut."],
  ["Klare frister", `Tilmelding og afbud lukker ${CLOSES_DAYS} dage før. Indtil da går din plads videre til ventelisten, og du får beløbet tilbage.`]
];

/** Made-up examples of what a tur can be, for the front page's carousel. They are labelled as examples on the page
 * and name no real organiser, venue, date or price. */
type Example = { kind: string; title: string; when: string; area: string; flock: number; after: string; tint: string };
export const EXAMPLES: Example[] = [
  { kind: "Koncert", title: "Jazz i et lille spillested", when: "Torsdag aften", area: "Aarhus C", flock: 6, after: "En kop te i baren", tint: "coral" },
  { kind: "Foredrag", title: "Foredrag om dansk rockhistorie", when: "Tirsdag aften", area: "Aarhus N", flock: 5, after: "Kaffe og kage i foyeren", tint: "sky" },
  { kind: "Kunst", title: "Rundvisning i en ny udstilling", when: "Lørdag formiddag", area: "Aarhus C", flock: 4, after: "Frokost i museets café", tint: "lilac" },
  { kind: "Natur", title: "Guidet tur i skoven ved kysten", when: "Søndag formiddag", area: "Aarhus syd", flock: 6, after: "Kaffe fra termokanden ved stranden", tint: "green" },
  { kind: "Film", title: "Filmaften i en foreningsbiograf", when: "Onsdag aften", area: "Aarhus V", flock: 5, after: "En snak om filmen i caféen", tint: "night" },
  { kind: "Musik", title: "Fællessang i en gammel kirke", when: "Søndag eftermiddag", area: "Risskov", flock: 6, after: "Gåtur tilbage mod byen", tint: "butter" },
  { kind: "Teater", title: "Forestilling på en lille scene", when: "Fredag aften", area: "Aarhus C", flock: 4, after: "Et glas i teatrets bar", tint: "peach" },
  { kind: "Værksted", title: "Keramik for begyndere", when: "Lørdag eftermiddag", area: "Aarhus Ø", flock: 5, after: "Te, mens leret tørrer", tint: "sky" }
];

function exampleCarousel(): SafeHtml {
  return html`<section class="f-section f-examples" aria-labelledby="h-examples">
    <div class="f-section-head"><h2 id="h-examples">Sådan kan en tur se ud</h2><p class="f-examples-nav" data-carousel-nav hidden><button type="button" data-dir="-1" aria-label="Forrige eksempler">←</button><button type="button" data-dir="1" aria-label="Næste eksempler">→</button></p></div>
    <p class="f-examples-note">Eksempler til inspiration – ikke rigtige ture endnu.</p>
    <ul class="f-carousel" data-carousel tabindex="0" aria-label="Eksempler på ture">
      ${EXAMPLES.map(e => html`<li class="f-ex f-ex-${e.tint}">
        <div class="f-ex-art"><span class="f-ex-tag">Eksempel</span><span class="f-ex-poster" aria-hidden="true">${e.kind}</span>${flockArt(e.flock, e.tint === "night" ? "#f6c445" : "#1d3a33")}</div>
        <div class="f-ex-body">
          <p class="f-ex-kind">${e.kind}</p>
          <h3>${e.title}</h3>
          <p class="f-ex-meta">${e.when} · ${e.area}</p>
          <p class="f-ex-meta">Flok på ${e.flock} · mødested på forhånd</p>
          <p class="f-ex-after">${e.after}</p>
        </div>
      </li>`)}
    </ul>
  </section>`;
}

export function homePage(ctx: PageContext, picks: PickRow[]): View {
  const body = html`
<section class="f-hero">
  <div class="wrap f-hero-inner">
    <div class="f-hero-text">
      <p class="f-kicker">Koncerter, foredrag og andre oplevelser – sammen med en lille gruppe, du ikke kender endnu.</p>
      <h1>Tilmeld dig en tur <em>i samlet flok!</em></h1>
      <p class="standfirst">Oplev et arrangement sammen med mennesker, du ikke kender endnu. Som medlem kan du tilmelde dig en tur til et symbolsk beløb. Du får program og mødested på forhånd og følges med en lille flok andre medlemmer. Du skal bare komme og være dig selv. Bagefter er der mulighed for at mødes og snakke om oplevelsen.</p>
      <p class="f-actions"><a class="button" href="/bliv-medlem">Bliv medlem</a> <a class="button-secondary" href="/saadan-fungerer-det">Sådan fungerer det</a></p>
    </div>
    <div class="f-row">${ROW_ART}</div>
  </div>
</section>
<div class="wrap">
  ${exampleCarousel()}
  <section class="f-section" aria-labelledby="h-picks">
    <div class="f-section-head"><h2 id="h-picks">Kommende ture</h2>${picks.length ? html`<a class="more" href="/ture">Alle →</a>` : ""}</div>
    ${picksBlock(picks.slice(0, 6), ctx.now)}
  </section>
  <section class="f-section f-evening" aria-labelledby="h-evening">
    <h2 id="h-evening">En tur med Flokk</h2>
    <ol class="f-timeline">
      <li><span class="f-evening-time">Du tilmelder dig</span><span>Først til mølle. Er der fuldt, kommer du automatisk på ventelisten.</span></li>
      <li><span class="f-evening-time">${CLOSES_DAYS} dage før</span><span>Tilmelding og afbud lukker, og deltagerlisten ligger fast.</span></li>
      <li><span class="f-evening-time">Før turen</span><span>Du får program, præcist mødested og fornavnene på dem i din flok.</span></li>
      <li><span class="f-evening-time">På dagen og bagefter</span><span>I mødes på mødestedet og oplever det sammen. Bagefter kan I snakke videre, hvis I har lyst.</span></li>
    </ol>
  </section>
  <section class="f-section" aria-labelledby="h-frame">
    <div class="f-section-head"><h2 id="h-frame">Tydelige rammer</h2><a class="more" href="/saadan-fungerer-det">Alle regler →</a></div>
    <ul class="f-promises">${FRAME.map(([title, text]) => html`<li><h3>${title}</h3><p>${text}</p></li>`)}</ul>
  </section>
  <section class="f-section f-two" aria-label="Pris og arrangører">
    <div class="f-panel">
      <h2>Hvad koster det?</h2>
      <p>Du betaler et symbolsk beløb for at deltage i en tur. Beløbet er ikke fastlagt endnu.</p>
      <p><strong>Det koster ikke noget at skrive sig op.</strong></p>
    </div>
    <div class="f-panel f-panel-alt">
      <h2>For arrangører</h2>
      <p>Vi laver aftaler om billetter til udvalgte oplevelser og kommer med en lille flok medlemmer – gerne mod at fortælle om jer og jeres tilbud.</p>
      <p><a class="button-secondary" href="/for-arrangoerer">Samarbejd med Flokk</a></p>
    </div>
  </section>
</div>`;
  return {
    status: 200,
    // Not kept by the browser, so the next visit may show another headline.
    headers: { "cache-control": "no-cache" },
    body: page(ctx, {
      title: "Flokk – nye oplevelser, nye mennesker, i trygge rammer",
      description: "Flokk gør det lettere at opleve mere sammen med andre: ture til udvalgte koncerter, foredrag og andre oplevelser i en lille flok – med program og mødested på forhånd.",
      canonical: "/"
    }, body)
  };
}

export function picksPage(ctx: PageContext, picks: PickRow[]): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ture", path: "/ture" }];
  const body = html`
<div class="wrap">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Kommende ture</h1>
    <p class="standfirst">Udvalgte koncerter, foredrag og andre oplevelser, som vi har aftalt billetter til. Pladserne fordeles efter først til mølle.</p>
  </header>
  ${picksBlock(picks, ctx.now)}
</div>`;
  return { status: 200, body: page(ctx, { title: "Ture", description: `Kommende ture med Flokk i ${ctx.regionLabel}: udvalgte koncerter, foredrag og andre oplevelser i en lille flok.`, canonical: "/ture", breadcrumbs: crumbs }, body) };
}

export function pickPage(ctx: PageContext, p: PickRow, box: SafeHtml = html``, message: SafeHtml | "" = ""): View {
  const over = (p.ends_at ?? p.starts_at + 3 * 3600_000) < ctx.now;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ture", path: "/ture" }, { name: p.title, path: picksPath(p) }];
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
  ${message}
  ${over ? html`<p class="notice" role="status">Denne tur er afholdt.</p>` : ""}
  ${p.description ? html`<div class="prose">${p.description.split(/\n{2,}/).map(par => html`<p>${par}</p>`)}</div>` : ""}
  <section class="f-panel f-plan" aria-labelledby="h-plan">
    <h2 id="h-plan">Turen</h2>
    <dl class="f-facts">
      <dt>Hvornår</dt><dd>${when(p, ctx.now)}</dd>
      ${p.venue_name || address ? html`<dt>Hvor</dt><dd>${p.venue_name ? html`${p.venue_name}<br>` : ""}${address}</dd>` : ""}
      <dt>Din flok</dt><dd>En lille flok medlemmer. Den bekræftes, når fire har tilmeldt sig. Program, præcist mødested og fornavnene får du tilsendt på forhånd.</dd>
      <dt>Bagefter</dt><dd>${p.aftermeeting ?? "Mulighed for at mødes og snakke om oplevelsen, hvis I har lyst."}</dd>
      <dt>Pris</dt><dd>${p.own_payment ?? "Et symbolsk beløb – ikke fastlagt endnu."}</dd>
      ${p.places ? html`<dt>Pladser</dt><dd>${String(p.places)} – først til mølle, derefter venteliste</dd>` : ""}
      ${over ? "" : html`<dt>Tilmelding og afbud</dt><dd>Lukker ${closes(p, ctx.now)}</dd>`}
      <dt>Arrangør</dt><dd>${p.association_url ? html`<a href="${p.association_url}" rel="noopener">${p.association}</a>` : p.association}</dd>
    </dl>
    ${over ? "" : box}
  </section>
  ${p.event_url ? html`<p><a href="${p.event_url}" rel="noopener">Læs om oplevelsen hos ${p.association}</a></p>` : ""}
  <p><a href="/ture">← Alle ture</a></p>
</div>`;
  return { status: 200, body: page(ctx, { title: p.title, description: `${when(p, ctx.now)} hos ${p.association} – en tur med Flokk.`, canonical: picksPath(p), breadcrumbs: crumbs, image: p.image_url, type: "article" }, body) };
}

const err = (errors: FormErrors, k: string) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
const invalid = (errors: FormErrors, k: string) => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : "";

export function howPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Sådan fungerer det", path: "/saadan-fungerer-det" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Sådan fungerer det</h1>
    <p class="standfirst">Flokk gør det lettere at opleve mere sammen med andre. Rammerne er tydelige, så du ved, hvad der skal ske – og kan være med på din egen måde.</p>
  </header>
  <h2>Ture</h2>
  <p>Vi laver aftaler med arrangører om billetter til udvalgte koncerter, foredrag og andre oplevelser. Hver af dem er en tur, som medlemmer kan tilmelde sig til et symbolsk beløb.</p>
  <h2>Medlemskab</h2>
  <ul>
    <li>Alle, der deltager, er medlemmer. Man kan ikke tilmelde en gæst, der ikke er medlem.</li>
    <li>Du må gerne tilmelde dig flere ture, hvis der er plads.</li>
  </ul>
  <h2>Tilmelding og venteliste</h2>
  <ul>
    <li>Pladserne fordeles efter først til mølle.</li>
    <li>Når en tur er fuld, kommer du automatisk på ventelisten – også efter først til mølle.</li>
    <li>En flok bekræftes, når fire har tilmeldt sig. Falder antallet senere under fire, gennemføres turen alligevel.</li>
  </ul>
  <h2>Frister og afbud</h2>
  <ul>
    <li>Tilmelding og almindelige afbud lukker ${CLOSES_DAYS} dage før turen.</li>
    <li>Melder du afbud før fristen, går din plads videre til ventelisten, og du kan få beløbet tilbage.</li>
    <li>Efter fristen ligger deltagerlisten fast.</li>
  </ul>
  <h2>Hvis noget bliver aflyst</h2>
  <ul>
    <li><strong>Hvis Flokk aflyser sin deltagelse</strong>, får du automatisk din betaling tilbage.</li>
    <li><strong>Arrangørens event</strong> ligger uden for Flokks kontrol. Arrangøren gennemfører sit event uanset, hvor mange fra Flokk der kommer.</li>
  </ul>
  <h2>Før turen</h2>
  <ul>
    <li>Du får program og præcist mødested på forhånd – til dig personligt, på mail og under Mine ture.</li>
    <li>Du får fornavnene på dem i din flok, så I lettere kan finde hinanden.</li>
    <li>Der oprettes ikke automatisk en gruppechat.</li>
  </ul>
  <h2>På dagen</h2>
  <p>Der er ikke en vært fra Flokk med. I mødes selv på det aftalte sted og går ind sammen. Bagefter er der mulighed for at mødes og snakke om oplevelsen – hvis I har lyst. Du deltager på din egen måde: Nogle snakker meget, andre lytter mest, og det er lige godt.</p>
  <h2>Det er ikke fastlagt endnu</h2>
  <ul>
    <li>Beløbet for en tur og de øvrige økonomiske detaljer.</li>
    <li>Medlemsvilkår.</li>
    <li>Hvad der sker med billetten, hvis arrangøren aflyser sit event.</li>
  </ul>
</div>`;
  return { status: 200, body: page(ctx, { title: "Sådan fungerer det", description: "Ture med Flokk: først til mølle med venteliste, en flok bekræftes ved fire tilmeldte, tilmelding og afbud lukker syv dage før, og du får program og mødested på forhånd.", canonical: "/saadan-fungerer-det", breadcrumbs: crumbs }, body) };
}

export function aboutPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Om Flokk", path: "/om" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Om Flokk</h1>
    <p class="standfirst">Flokk gør det lettere at opleve mere sammen med andre.</p>
  </header>
  <p>Hver måned laver vi aftaler med arrangører om billetter til udvalgte koncerter, foredrag og andre oplevelser. Som medlem kan du tilmelde dig en tur til et symbolsk beløb. Du får program og mødested på forhånd og følges med en lille flok andre medlemmer. Du deltager på din egen måde, og bagefter er der mulighed for at mødes og snakke om oplevelsen.</p>
  <h2>Gode oplevelser, tydelige rammer</h2>
  <p>Vi tror på, at det er lettere at komme afsted, når man ved, hvad der skal ske, og hvem man skal mødes med. Fællesskabet er frivilligt – du er med på den måde, der passer dig.</p>
  <h2>Under udvikling</h2>
  <p>Flokk er et koncept under udvikling. Beløb, medlemsvilkår og flere detaljer er ikke fastlagt endnu – <a href="/saadan-fungerer-det">her kan du se, hvad der er besluttet</a>.</p>
  <h2>Skriv til os</h2>
  <p>Er du arrangør, så brug <a href="/for-arrangoerer#kontakt">formularen for arrangører</a>. Vil du være med, så <a href="/bliv-medlem">bliv medlem</a>.</p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om Flokk", description: "Flokk gør det lettere at opleve mere sammen med andre – ture til udvalgte koncerter, foredrag og andre oplevelser i en lille flok.", canonical: "/om", breadcrumbs: crumbs }, body) };
}

export function organisersPage(ctx: PageContext, state: { form?: InquiryForm; errors?: InquiryErrors; sent?: boolean; status?: number } = {}): View {
  const f = state.form ?? { organisation: "", contactName: "", email: "", website: "", message: "" };
  const errors = (state.errors ?? {}) as FormErrors;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "For arrangører", path: "/for-arrangoerer" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>For arrangører</h1>
    <p class="standfirst">Flokk laver aftaler med arrangører om billetter til udvalgte koncerter, foredrag og andre oplevelser – og kommer med en lille flok medlemmer.</p>
  </header>
  <h2>Sådan kan et samarbejde se ud</h2>
  <ul>
    <li><strong>Billetter til en tur.</strong> Vi aftaler et antal billetter til et af jeres arrangementer, som vores medlemmer kan tilmelde sig.</li>
    <li><strong>Vi fortæller om jer.</strong> Eventuelt mod at vi markedsfører jer og jeres tilbud over for vores medlemmer.</li>
    <li><strong>Jeres arrangement er jeres.</strong> Det gennemføres uanset, hvor mange fra Flokk der kommer.</li>
  </ul>
  <p>Vi finder de konkrete vilkår sammen, ét arrangement ad gangen. Intet vises hos os, før I har sagt ja.</p>
  <h2 id="kontakt">Skriv til os</h2>
  ${state.sent ? html`<p class="flash" role="status">Tak for jeres henvendelse. Vi vender tilbage.</p>` : html`
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="/for-arrangoerer" novalidate>
    <div class="field"><label for="p-org">Arrangør</label><input id="p-org" name="organisation" type="text" maxlength="120" required value="${f.organisation}"${invalid(errors, "organisation")}>${err(errors, "organisation")}</div>
    <div class="field"><label for="p-name">Dit navn</label><input id="p-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.contactName}"${invalid(errors, "contactName")}>${err(errors, "contactName")}</div>
    <div class="field"><label for="p-email">Mail</label><input id="p-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid(errors, "email")}>${err(errors, "email")}</div>
    <div class="field"><label for="p-web">Hjemmeside <span class="meta-muted">(valgfrit)</span></label><input id="p-web" name="hjemmeside" type="url" maxlength="200" value="${f.website}"${invalid(errors, "website")}>${err(errors, "website")}</div>
    <div class="field"><label for="p-msg">Fortæl gerne om et arrangement, I tænker kunne passe <span class="meta-muted">(valgfrit)</span></label><textarea id="p-msg" name="besked" rows="5" maxlength="2000">${f.message}</textarea>${err(errors, "message")}</div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Send</button></div>
    <p class="small meta-muted">Vi gemmer kun det, I skriver her, for at kunne svare jer.</p>
  </form>`}
</div>`;
  return { status: state.status ?? 200, ...(state.sent || state.errors ? { headers: { "cache-control": "no-store" } } : {}), body: page(ctx, { title: "For arrangører", description: "Flokk laver aftaler med arrangører om billetter til udvalgte oplevelser og kommer med en lille flok medlemmer.", canonical: "/for-arrangoerer", breadcrumbs: crumbs }, body) };
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
  <h2>Hvad vi gemmer</h2>
  <ul>
    <li><strong>Som medlem:</strong> fornavn og mail – og hvis du vælger det: hvad du har lyst til at opleve, område og aldersgruppe – samt dine tilmeldinger. Din kode gemmes kun i en form, der ikke kan læses tilbage.</li>
    <li><strong>I din flok:</strong> de andre i flokken ser dit fornavn, når flokken er bekræftet.</li>
    <li><strong>Fra den tidligere interesseliste:</strong> fornavn, mail og de valg, du gjorde.</li>
    <li><strong>Henvendelser fra arrangører:</strong> det, I skriver i formularen.</li>
  </ul>
  <p>Vi bruger det kun til Flokk: til at skrive til dig om dine ture og til at sætte flokke sammen. Vi deler det ikke med andre, og vi bruger ingen sporing eller reklamecookies. Kun de få, der arbejder med Flokk, kan se listen.</p>
  <h2>Hvor længe</h2>
  <p>Til du melder dig ud. Det gør du selv under <a href="/mine-ture">Mine ture</a> – så slettes din profil og dine tilmeldinger.</p>
  <h2 id="slet">Slet mig fra interesselisten</h2>
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
    <p class="standfirst">Den kan være flyttet, eller turen er afholdt.</p>
    <p><a class="button" href="/">Til forsiden</a> <a class="button-secondary" href="/ture">Kommende ture</a></p>
  </header>
</div>`;
  return { status: 404, body: page(ctx, { title: "Siden findes ikke", description: "Siden findes ikke.", canonical: ctx.path, noindex: true }, body) };
}
