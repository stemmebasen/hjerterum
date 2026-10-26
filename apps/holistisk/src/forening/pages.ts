import { capitalize, dayLabel, hhmm, localDate } from "../time.js";
import { html, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { flockArt, ROW_ART } from "./brand.js";
import { NO_ORGANISER, SAMFOLK } from "./forms.js";
import { closesAt } from "./members.js";
import type { PickRow } from "./store.js";

/** Foreningen Samfolk: the public pages, by the decisions in docs/decisions/0010-samfolk.md. An association for
 * experiencing things together with like-minded people: members create ture themselves and any member can sign up,
 * whatever their age, gender or ethnicity; Samfolk holds one event of its own a month, free for members. Only what has
 * been decided is stated; what is not, is said to be open. */

export const picksPath = (p: Pick<PickRow, "slug">) => `/events/${p.slug}`;

export function when(p: Pick<PickRow, "starts_at" | "ends_at">, now: number): string {
  const day = capitalize(dayLabel(p.starts_at, now));
  const end = p.ends_at && localDate(p.ends_at) === localDate(p.starts_at) ? `–${hhmm(p.ends_at)}` : "";
  return `${day} kl. ${hhmm(p.starts_at)}${end}`;
}

const place = (p: Pick<PickRow, "venue_name" | "city">) => [p.venue_name, p.city].filter(Boolean).join(", ");
/** The organiser a tur names, if any – a member's tur need not have one. */
export const organiser = (p: Pick<PickRow, "association">) => p.association === NO_ORGANISER || p.association === SAMFOLK ? null : p.association;
export const SAMFOLK_EVENT = "Samfolk-event · gratis for medlemmer";
/** What taking part costs: what the creator wrote, else the rule. */
export const costs = (p: Pick<PickRow, "own_payment" | "kind">) => p.own_payment ?? (p.kind === "samfolk" ? "Gratis for medlemmer." : "Hver betaler selv sine udgifter.");

function pickCard(p: PickRow, now: number): SafeHtml {
  const who = organiser(p);
  return html`<article class="f-card${p.kind === "samfolk" ? " f-card-samfolk" : ""}">
  <a class="f-card-link" href="${picksPath(p)}">
    ${p.image_url ? html`<span class="f-card-media"><img src="${p.image_url}" alt="" loading="lazy" decoding="async"></span>` : ""}
    <span class="f-card-body">
      ${p.kind === "samfolk" ? html`<span class="f-badge">${SAMFOLK_EVENT}</span>` : ""}
      <span class="f-card-when">${when(p, now)}</span>
      <span class="f-card-title">${p.title}</span>
      <span class="f-card-meta">${[who, place(p)].filter(Boolean).join(" · ")}</span>
      ${p.flokk_cancelled_at ? html`<span class="f-card-cancelled">Aflyst</span>` : ""}
    </span>
  </a>
</article>`;
}

function picksBlock(picks: PickRow[], now: number): SafeHtml {
  if (!picks.length) return html`<div class="f-empty">
  <p><strong>Der er ingen ture endnu.</strong> Som medlem kan du oprette den første – en koncert, et foredrag, en gåtur eller noget helt fjerde.</p>
  <p><a class="button" href="/ture/ny">Opret en tur</a></p>
</div>`;
  return html`<div class="f-cards">${picks.map(p => pickCard(p, now))}</div>`;
}

/** Made-up examples of what a tur can be, for the front page's carousel. They are labelled as examples on the page
 * and name no real organiser, venue, date or price. */
type Example = { kind: string; title: string; when: string; area: string; places: number; after: string; tint: string };
export const EXAMPLES: Example[] = [
  { kind: "Koncert", title: "Jazz i et lille spillested", when: "Torsdag aften", area: "Aarhus C", places: 6, after: "En kop te i baren", tint: "coral" },
  { kind: "Foredrag", title: "Foredrag om dansk rockhistorie", when: "Tirsdag aften", area: "Aarhus N", places: 5, after: "Kaffe og kage i foyeren", tint: "sky" },
  { kind: "Kunst", title: "Rundvisning i en ny udstilling", when: "Lørdag formiddag", area: "Aarhus C", places: 4, after: "Frokost i museets café", tint: "lilac" },
  { kind: "Natur", title: "Gåtur i skoven ved kysten", when: "Søndag formiddag", area: "Aarhus syd", places: 6, after: "Kaffe fra termokanden ved stranden", tint: "green" },
  { kind: "Film", title: "Filmaften i en foreningsbiograf", when: "Onsdag aften", area: "Aarhus V", places: 5, after: "En snak om filmen i caféen", tint: "night" },
  { kind: "Musik", title: "Fællessang i en gammel kirke", when: "Søndag eftermiddag", area: "Risskov", places: 6, after: "Gåtur tilbage mod byen", tint: "butter" },
  { kind: "Teater", title: "Forestilling på en lille scene", when: "Fredag aften", area: "Aarhus C", places: 4, after: "Et glas i teatrets bar", tint: "peach" },
  { kind: "Værksted", title: "Keramik for begyndere", when: "Lørdag eftermiddag", area: "Aarhus Ø", places: 5, after: "Te, mens leret tørrer", tint: "sky" }
];

function exampleCarousel(): SafeHtml {
  return html`<section class="f-section f-examples" aria-labelledby="h-examples">
    <div class="f-section-head"><h2 id="h-examples">Sådan kan en tur se ud</h2><p class="f-examples-nav" data-carousel-nav hidden><button type="button" data-dir="-1" aria-label="Forrige eksempler">←</button><button type="button" data-dir="1" aria-label="Næste eksempler">→</button></p></div>
    <p class="f-examples-note">Eksempler til inspiration – ikke rigtige ture endnu.</p>
    <ul class="f-carousel" data-carousel tabindex="0" aria-label="Eksempler på ture">
      ${EXAMPLES.map(e => html`<li class="f-ex f-ex-${e.tint}">
        <div class="f-ex-art"><span class="f-ex-tag">Eksempel</span><span class="f-ex-poster" aria-hidden="true">${e.kind}</span>${flockArt(e.places, e.tint === "night" ? "#f6c445" : "#1d3a33")}</div>
        <div class="f-ex-body">
          <p class="f-ex-kind">${e.kind}</p>
          <h3>${e.title}</h3>
          <p class="f-ex-meta">${e.when} · ${e.area}</p>
          <p class="f-ex-meta">${e.places} pladser · mødested på forhånd</p>
          <p class="f-ex-after">${e.after}</p>
        </div>
      </li>`)}
    </ul>
  </section>`;
}

const PRICES = html`<p class="f-prices"><span><strong>50 kr.</strong> om måneden</span> <span>eller</span> <span><strong>500 kr.</strong> om året</span></p>`;

export function newsletterForm(compact = false): SafeHtml {
  return html`<form class="f-letter-form" method="post" action="/samfolk-brevet" novalidate>
    <div class="field"><label for="n-email${compact ? "-c" : ""}">Din mail</label><input id="n-email${compact ? "-c" : ""}" name="email" type="email" maxlength="160" autocomplete="email" required></div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <button type="submit">Tilmeld mig brevet</button>
  </form>`;
}

export function homePage(ctx: PageContext, picks: PickRow[]): View {
  const next = picks.find(p => p.kind === "samfolk" && !p.flokk_cancelled_at);
  const body = html`
<section class="f-hero">
  <div class="wrap f-hero-inner">
    <div class="f-hero-text">
      <p class="f-kicker">Foreningen Samfolk</p>
      <h1>Oplevelser er bedre <em>sammen.</em></h1>
      <p class="standfirst">Samfolk er en forening for dig, der vil ud og opleve noget sammen med ligesindede. Medlemmerne opretter selv ture – til koncerter, foredrag, gåture og meget andet – og alle medlemmer kan melde sig til. En gang om måneden laver Samfolk sit eget event, som er gratis for medlemmer.</p>
      <p class="f-actions"><a class="button" href="/bliv-medlem">Bliv medlem</a> <a class="button-secondary" href="/ture">Se kommende ture</a></p>
    </div>
    <div class="f-row">${ROW_ART}</div>
  </div>
</section>
<div class="wrap">
  <section class="f-section f-monthly" aria-labelledby="h-monthly">
    <div class="f-section-head"><h2 id="h-monthly">Samfolks eget event</h2></div>
    ${next ? html`<div class="f-cards f-cards-one">${pickCard(next, ctx.now)}</div>`
      : html`<p class="f-empty">En gang om måneden laver Samfolk sit eget event, som er gratis for medlemmer. Det næste bliver vist her, så snart det er på plads.</p>`}
  </section>
  <section class="f-section" aria-labelledby="h-picks">
    <div class="f-section-head"><h2 id="h-picks">Kommende ture</h2>${picks.length ? html`<a class="more" href="/ture">Alle →</a>` : ""}</div>
    ${picksBlock(picks.slice(0, 6), ctx.now)}
    ${picks.length ? html`<p class="more-line"><a class="button-secondary" href="/ture/ny">Opret en tur</a></p>` : ""}
  </section>
  ${exampleCarousel()}
  <section class="f-section f-evening" aria-labelledby="h-evening">
    <h2 id="h-evening">Sådan fungerer Samfolk</h2>
    <ol class="f-timeline">
      <li><span class="f-evening-time">Bliv medlem</span><span>Udfyld din profil, og vælg medlemskab for en måned eller et år.</span></li>
      <li><span class="f-evening-time">Find en tur – eller opret din egen</span><span>Medlemmerne opretter selv ture. Din tur kan ses, så snart du har oprettet den.</span></li>
      <li><span class="f-evening-time">Meld dig til</span><span>Først til mølle. Er der fuldt, kommer du automatisk på ventelisten.</span></li>
      <li><span class="f-evening-time">Oplev det sammen</span><span>I mødes, som turen beskriver. Udgifter som billetter betaler hver især selv.</span></li>
    </ol>
  </section>
  <section class="f-section f-for-all" aria-labelledby="h-all">
    <h2 id="h-all">Samfolk er for alle</h2>
    <p>Alle medlemmer kan melde sig til en tur – uanset alder, køn og etnicitet. Derfor spørger vi heller ikke om det i din profil.</p>
  </section>
  <section class="f-section f-two" aria-label="Medlemskab og Samfolk-brevet">
    <div class="f-panel">
      <h2>Medlemskab</h2>
      ${PRICES}
      <p>Som medlem kan du melde dig til ture og oprette dine egne. Udgifter på turene, fx billetter, betaler du selv. Samfolks eget event en gang om måneden er gratis for medlemmer.</p>
      <p class="meta-muted">Betalingen åbner senere. Du betaler ikke noget nu.</p>
      <p><a class="button" href="/bliv-medlem">Bliv medlem</a></p>
    </div>
    <div class="f-panel f-panel-alt">
      <h2>Samfolk-brevet</h2>
      <p>Hver uge: den kommende uges ture, samlet i én mail. Du behøver ikke være medlem for at få det.</p>
      ${newsletterForm(true)}
    </div>
  </section>
</div>`;
  return {
    status: 200,
    headers: { "cache-control": "no-cache" },
    body: page(ctx, {
      title: "Foreningen Samfolk – oplevelser sammen med ligesindede",
      description: "Samfolk er en forening for dig, der vil ud og opleve noget sammen med ligesindede. Medlemmerne opretter selv ture, og alle medlemmer kan melde sig til.",
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
    <p class="standfirst">Ture, som medlemmerne har oprettet – og Samfolks eget event. Alle medlemmer kan melde sig til, først til mølle.</p>
    <p><a class="button" href="/ture/ny">Opret en tur</a></p>
  </header>
  ${picksBlock(picks, ctx.now)}
</div>`;
  return { status: 200, body: page(ctx, { title: "Ture", description: `Kommende ture med Samfolk i ${ctx.regionLabel}: koncerter, foredrag, gåture og meget andet – sammen med ligesindede.`, canonical: "/ture", breadcrumbs: crumbs }, body) };
}

/** A tur's page. `creator` is the first name of the member who created it; `manage` adds the links to change it. */
export function pickPage(ctx: PageContext, p: PickRow, opts: { box?: SafeHtml; message?: SafeHtml | ""; creator?: string | null; manage?: boolean } = {}): View {
  const over = (p.ends_at ?? p.starts_at + 3 * 3600_000) < ctx.now;
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Ture", path: "/ture" }, { name: p.title, path: picksPath(p) }];
  const address = [p.address, p.city].filter(Boolean).join(", ");
  const who = organiser(p);
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="f-kicker">${p.kind === "samfolk" ? SAMFOLK_EVENT : opts.creator ? `Tur oprettet af ${opts.creator}` : "Tur"}</p>
    <h1>${p.title}</h1>
    <p class="f-when">${when(p, ctx.now)}${p.venue_name ? html` · ${p.venue_name}` : ""}</p>
  </header>
  ${opts.manage ? html`<p class="f-manage"><a class="button-secondary" href="/ture/${p.id}/ret">Ret turen</a> <a class="button-secondary" href="/ture/${p.id}/deltagere">Deltagere</a></p>` : ""}
  ${p.image_url ? html`<figure class="f-figure"><img src="${p.image_url}" alt="" decoding="async"></figure>` : ""}
  ${opts.message ?? ""}
  ${p.flokk_cancelled_at ? html`<p class="notice" role="status"><strong>Turen er aflyst.</strong></p>` : over ? html`<p class="notice" role="status">Denne tur er afholdt.</p>` : ""}
  ${p.description ? html`<div class="prose">${p.description.split(/\n{2,}/).map(par => html`<p>${par}</p>`)}</div>` : ""}
  <section class="f-panel f-plan" aria-labelledby="h-plan">
    <h2 id="h-plan">Turen</h2>
    <dl class="f-facts">
      <dt>Hvornår</dt><dd>${when(p, ctx.now)}</dd>
      ${p.venue_name || address ? html`<dt>Hvor</dt><dd>${p.venue_name ? html`${p.venue_name}<br>` : ""}${address}</dd>` : ""}
      <dt>Pladser</dt><dd>${p.places ? `${p.places} – først til mølle, derefter venteliste` : "Ingen grænse"}</dd>
      <dt>Udgifter</dt><dd>${costs(p)}</dd>
      ${p.aftermeeting ? html`<dt>Bagefter</dt><dd>${p.aftermeeting}</dd>` : ""}
      ${over || p.flokk_cancelled_at ? "" : html`<dt>Tilmelding og afbud</dt><dd>Lukker ${dayLabel(closesAt(p), ctx.now)} kl. ${hhmm(closesAt(p))}</dd>`}
      ${who ? html`<dt>Arrangør</dt><dd>${p.association_url ? html`<a href="${p.association_url}" rel="noopener">${who}</a>` : who}</dd>` : ""}
      <dt>Oprettet af</dt><dd>${p.kind === "samfolk" ? "Foreningen Samfolk" : opts.creator ?? "Et medlem"}</dd>
    </dl>
    ${over || p.flokk_cancelled_at ? "" : opts.box ?? ""}
  </section>
  ${p.event_url ? html`<p><a href="${p.event_url}" rel="noopener">Læs mere om oplevelsen${who ? ` hos ${who}` : ""}</a></p>` : ""}
  <p><a href="/ture">← Alle ture</a></p>
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: p.title, description: `${when(p, ctx.now)}${p.venue_name ? `, ${p.venue_name}` : ""} – en tur med Samfolk.`, canonical: picksPath(p), breadcrumbs: crumbs, image: p.image_url, type: "article" }, body) };
}

export function howPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Sådan fungerer det", path: "/saadan-fungerer-det" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Sådan fungerer det</h1>
    <p class="standfirst">Samfolk er en forening, der alene handler om at få oplevelser sammen med ligesindede.</p>
  </header>
  <h2>Medlemskab</h2>
  <ul>
    <li>Medlemskab koster 50 kr. om måneden eller 500 kr. om året. Betalingen åbner senere – du betaler ikke noget nu.</li>
    <li>For at bruge siden udfylder du din profil: fornavn, mail, hvad du har lyst til at opleve, og hvor du bor.</li>
    <li>Kun medlemmer kan melde sig til en tur.</li>
    <li>Du logger ind med en personlig kode, som du får, når du bliver medlem.</li>
  </ul>
  <h2>For alle</h2>
  <p>Alle medlemmer kan melde sig til en tur – uanset alder, køn og etnicitet. Derfor spørger vi ikke om det i din profil.</p>
  <h2>Ture</h2>
  <ul>
    <li>Medlemmerne opretter selv ture, som andre medlemmer kan melde sig til.</li>
    <li>En tur kan ses, så snart den er oprettet. Foreningen kan skjule en tur bagefter.</li>
    <li>Den, der opretter turen, vælger antal pladser og tilmeldingsfrist – og beskriver, hvor I mødes.</li>
    <li>En gang om måneden laver Samfolk sit eget event, som er gratis for medlemmer.</li>
  </ul>
  <h2>Tilmelding og venteliste</h2>
  <ul>
    <li>Pladserne fordeles efter først til mølle.</li>
    <li>Når en tur er fuld, kommer du automatisk på ventelisten – også efter først til mølle.</li>
    <li>Du kan melde fra indtil fristen. Så går din plads videre til den første på ventelisten.</li>
    <li>Har turen ingen frist, er tilmelding og afbud åbne, til turen starter.</li>
  </ul>
  <h2>Udgifter</h2>
  <p>Udgifter på turene, fx billetter, betaler hver især selv. Den, der opretter turen, skriver, hvad det cirka koster.</p>
  <h2>Hvis en tur bliver aflyst</h2>
  <p>Den, der har oprettet turen, kan aflyse den. Så kan alle tilmeldte se det på turen og under Mine ture.</p>
  <h2>Samfolk-brevet</h2>
  <p>Hver uge: den kommende uges ture, samlet i én mail. Alle kan <a href="/samfolk-brevet">tilmelde sig brevet</a> – også uden at være medlem.</p>
  <h2>Det er ikke fastlagt endnu</h2>
  <ul>
    <li>Hvordan kontingentet betales.</li>
  </ul>
</div>`;
  return { status: 200, body: page(ctx, { title: "Sådan fungerer det", description: "Samfolk: medlemskab for 50 kr. om måneden eller 500 kr. om året, ture som medlemmerne selv opretter, først til mølle med venteliste – og et gratis event for medlemmer hver måned.", canonical: "/saadan-fungerer-det", breadcrumbs: crumbs }, body) };
}

export function aboutPage(ctx: PageContext): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Om Samfolk", path: "/om" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Om Foreningen Samfolk</h1>
    <p class="standfirst">En forening, der alene handler om at få oplevelser sammen med ligesindede.</p>
  </header>
  <p>I Samfolk opretter medlemmerne selv ture – til koncerter, foredrag, gåture, værksteder og meget andet – og alle medlemmer kan melde sig til. En gang om måneden laver Samfolk sit eget event, som er gratis for medlemmer.</p>
  <h2>For alle</h2>
  <p>Der skal ikke være nogen forskelsbehandling i Samfolk. Alle medlemmer kan melde sig til en tur – uanset alder, køn og etnicitet.</p>
  <h2>Medlemskab</h2>
  <p>50 kr. om måneden eller 500 kr. om året. Udgifter på turene betaler hver især selv. <a href="/saadan-fungerer-det">Her kan du se, hvordan det hele fungerer</a>.</p>
  <h2>Under opbygning</h2>
  <p>Samfolk er under opbygning, og siden bliver udbygget med tiden.</p>
  <p class="f-actions"><a class="button" href="/bliv-medlem">Bliv medlem</a> <a class="button-secondary" href="/samfolk-brevet">Få Samfolk-brevet</a></p>
</div>`;
  return { status: 200, body: page(ctx, { title: "Om Samfolk", description: "Foreningen Samfolk handler alene om at få oplevelser sammen med ligesindede – for alle, uanset alder, køn og etnicitet.", canonical: "/om", breadcrumbs: crumbs }, body) };
}

const LETTER_MESSAGES: Record<string, string> = {
  tilmeldt: "Du er tilmeldt Samfolk-brevet.", afmeldt: "Hvis mailen stod på listen, er den afmeldt nu.", fejl: "Skriv en mailadresse, vi kan skrive til."
};

export function newsletterPage(ctx: PageContext, message: string | null): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Samfolk-brevet", path: "/samfolk-brevet" }];
  const text = message ? LETTER_MESSAGES[message] : null;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Samfolk-brevet</h1>
    <p class="standfirst">Hver uge: den kommende uges ture, samlet i én mail. Du behøver ikke være medlem for at få det.</p>
  </header>
  ${text ? html`<p class="flash${message === "fejl" ? " flash-error" : ""}" role="${message === "fejl" ? "alert" : "status"}">${text}</p>` : ""}
  <section class="form-card">${newsletterForm()}
    <p class="small meta-muted">Vi bruger kun din mail til brevet. Er du medlem, kan du også slå det til og fra under <a href="/min-profil">Min profil</a>.</p>
  </section>
  <details class="leave"><summary>Afmeld brevet</summary>
    <form method="post" action="/samfolk-brevet/afmeld" novalidate>
      <div class="field"><label for="u-email">Din mail</label><input id="u-email" name="email" type="email" maxlength="160" autocomplete="email" required></div>
      <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
      <p><button type="submit">Afmeld</button></p>
    </form>
  </details>
</div>`;
  return { status: message === "fejl" ? 400 : 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Samfolk-brevet", description: "Samfolk-brevet: hver uge den kommende uges ture i én mail.", canonical: "/samfolk-brevet", breadcrumbs: crumbs }, body) };
}

export function privacyPage(ctx: PageContext, state: { deleted?: boolean } = {}): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Privatliv", path: "/privatliv" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Privatliv</h1>
    <p class="standfirst">Vi gemmer så lidt som muligt og bruger det kun til Samfolk.</p>
  </header>
  <h2>Hvad vi gemmer</h2>
  <ul>
    <li><strong>Som medlem:</strong> fornavn, mail, hvad du har lyst til at opleve, hvor du bor, dit medlemskab, dine tilmeldinger og de ture, du opretter. Din kode gemmes kun i en form, der ikke kan læses tilbage. Vi spørger ikke om alder, køn eller etnicitet.</li>
    <li><strong>Hvem ser hvad:</strong> på en tur, du opretter, står dit fornavn. Den, der har oprettet en tur, ser fornavnene på dem, der har meldt sig til. De tilmeldte ser hinandens fornavne.</li>
    <li><strong>Samfolk-brevet:</strong> din mail.</li>
    <li><strong>Fra tidligere versioner af siden:</strong> en interesseliste og henvendelser fra arrangører.</li>
  </ul>
  <p>Vi deler det ikke med andre, og vi bruger ingen sporing eller reklamecookies. Kun de få, der arbejder med Samfolk, kan se medlemslisten.</p>
  <h2>Hvor længe</h2>
  <p>Til du melder dig ud. Det gør du selv under <a href="/min-profil">Min profil</a> – så slettes din profil, dine tilmeldinger og din tilmelding til brevet, og kommende ture, du har oprettet, bliver aflyst. Brevet kan du <a href="/samfolk-brevet">afmelde her</a>.</p>
  <h2 id="slet">Slet mig fra den tidligere interesseliste</h2>
  ${state.deleted ? html`<p class="flash" role="status">Hvis mailen stod på listen, er den slettet nu.</p>` : ""}
  <form class="form-card" method="post" action="/privatliv" novalidate>
    <div class="field"><label for="d-email">Din mail</label><input id="d-email" name="email" type="email" maxlength="160" autocomplete="email" required></div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Slet mig fra listen</button></div>
  </form>
</div>`;
  return { status: 200, headers: { "cache-control": "no-store" }, body: page(ctx, { title: "Privatliv", description: "Hvad Samfolk gemmer, hvorfor, og hvordan du får det slettet.", canonical: "/privatliv", breadcrumbs: crumbs }, body) };
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

