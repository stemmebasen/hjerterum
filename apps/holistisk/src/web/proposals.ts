import { html, type SafeHtml } from "./html.js";
import { page, type PageContext } from "./layout.js";
import type { View } from "./pages.js";

/** Three concept proposals for Socialklubben, side by side in one layout, for showing a partner (/forslag). Static
 * example content: it needs no database, so the page works even when the database does not. */

type Counter = { kind: "dots"; filled: string[]; total: number } | { kind: "meter"; value: number; max: number };
type Example = { day: string; date: string; month: string; title: string; when: string; place: string; price: string; free: boolean; label: string; head: string; counter: Counter; sub: string; action: string; note?: string };
type Proposal = {
  slug: string; tab: string; name: string;
  title: string; standfirst: string; cta: string;
  cardLabel: string; cardBig: string; cardText: string; card: SafeHtml; cardFoot: string;
  steps: Array<[string, string]>;
  examplesTitle: string; examples: Example[];
  compare: { core: string; gift: string; discount: string; plus: string; minus: string };
};

const dots = (filled: string[], total = 5): Counter => ({ kind: "dots", filled, total });
const meter = (value: number, max: number): Counter => ({ kind: "meter", value, max });
const ev = (day: string, date: string, month: string, title: string, when: string, place: string, price: string, free: boolean) => ({ day, date, month, title, when, place, price, free });
const AUTUMN = [
  ev("Fre", "6", "nov", "Koncert med Rasmus", "Kl. 20.00", "Spillested i midtbyen", "220 kr.", false),
  ev("Lør", "7", "nov", "Fællessang i parken", "Kl. 14.00", "Mølleparken", "Gratis", true),
  ev("Tor", "12", "nov", "Brætspilsaften", "Kl. 19.00", "Hovedbiblioteket", "Gratis", true),
  ev("Fre", "13", "nov", "Stand-up-aften", "Kl. 20.30", "Comedy-scene, Frederiksbjerg", "150 kr.", false)
];

export const PROPOSALS: Proposal[] = [
  {
    slug: "", tab: "1 · Små grupper", name: "Små grupper",
    title: "Tag afsted sammen – i en lille, tryg gruppe",
    standfirst: "Find et event og følg med en gruppe på op til fem. I mødes et offentligt sted før, og I deler kun fornavne. Når fem er samlet, giver vi en gave.",
    cta: "Find en gruppe",
    cardLabel: "Løftet", cardBig: "Når 5 er samlet, giver vi en gave",
    cardText: "Det gælder alle events – også de gratis. Gaven er vores tak, fordi I tog afsted sammen.",
    card: html`<div class="p-dots p-dots-big" aria-label="3 af 5 i gruppen">${["M", "A", "S", "", ""].map(l => html`<span class="p-dot${l ? " is-filled" : ""}" aria-hidden="true">${l}</span>`)}<strong>+ gave</strong></div>`,
    cardFoot: "Ved nogle partner-events kan gruppen også få halv pris. Det er en ekstra bonus, ikke hovedsagen.",
    steps: [["Vælg et event", "Gratis eller med billet. Alt i Aarhus samlet ét sted."], ["Bliv en del af en gruppe", "Eller opret en selv. Højst fem, og I deler kun fornavne."], ["Mød hinanden før", "Et offentligt sted tæt på. Når I er fem, giver vi en gave."]],
    examplesTitle: "Det sker i Aarhus",
    examples: [
      { ...AUTUMN[0]!, label: "Små grupper", head: "3 af 5 i gruppen", counter: dots(["Mette", "Ali", "Sofie"]), sub: "Mette, Ali og Sofie er med. 2 mere, så giver vi en gave.", action: "Bliv en del af gruppen", note: "Partner-event: halv pris for 5" },
      { ...AUTUMN[1]!, label: "Små grupper", head: "4 af 5 i gruppen", counter: dots(["Jonas", "Ida", "Karim", "Lise"]), sub: "1 mere, så giver vi en gave.", action: "Bliv en del af gruppen" },
      { ...AUTUMN[2]!, label: "Små grupper", head: "Ingen gruppe endnu", counter: dots([]), sub: "Opret den første, så kan andre finde den her.", action: "Opret en gruppe" },
      { ...AUTUMN[3]!, label: "Små grupper", head: "2 af 5 i gruppen", counter: dots(["Freja", "Omar"]), sub: "Freja og Omar er med. 3 mere, så giver vi en gave.", action: "Bliv en del af gruppen", note: "Partner-event: halv pris for 5" }
    ],
    compare: { core: "At tage afsted sammen i en tryg gruppe på fem.", gift: "Når 5 er samlet, til alle events.", discount: "Valgfri halv pris ved enkelte partner-events.", plus: "Enkelt, trygt og virker lige godt for gratis events.", minus: "Mindre at tjene på og mindre grund til at dele." }
  },
  {
    slug: "faellesbillet", tab: "2 · Fællesbillet", name: "Fællesbillet",
    title: "Jo flere der tager med, jo billigere bliver det",
    standfirst: "Til særlige events samler vi en fællesbillet. Tælleren viser, hvor tæt I er på næste rabat. I mødes samlet før eventet, og en vært tager imod.",
    cta: "Se fællesbilletter",
    cardLabel: "Koncert med Rasmus · fællesbillet", cardBig: "11 af 20 tilmeldt – 9 mere for 25% rabat",
    cardText: "Del eventet med dine venner og få tælleren op. Rabatten gælder alle, der er tilmeldt.",
    card: html`<div class="p-steps-bar"><meter class="p-meter" min="0" max="20" value="11">11 af 20</meter><p class="p-scale"><span>0</span><span>10 tilmeldt · 10% rabat</span><span>20 tilmeldt · 25% rabat</span></p></div>`,
    cardFoot: "Til gratis events viser tælleren bare, hvor mange der tager med. Så er det nemmere at tage med første gang.",
    steps: [["Tag med på fællesbilletten", "Særlige events har en tæller, der viser hvor mange der er med."], ["Få tælleren op", "Del med venner. Ved 10 får alle 10% rabat, ved 20 får alle 25%."], ["Mød de andre", "I mødes samlet før eventet, og en vært tager imod."]],
    examplesTitle: "Det sker i Aarhus",
    examples: [
      { ...AUTUMN[0]!, label: "Fællesbillet", head: "11 af 20 tilmeldt – 9 mere for 25% rabat", counter: meter(11, 20), sub: "Allerede 10% rabat. I mødes samlet ved indgangen, og en vært tager imod.", action: "Tag med på fællesbilletten", note: "Del med en ven" },
      { ...AUTUMN[1]!, label: "Fællestilmelding", head: "14 af 30 tilmeldt", counter: meter(14, 30), sub: "Gratis event, så ingen rabat. I mødes ved indgangen kl. 13.45.", action: "Tag med" },
      { ...AUTUMN[2]!, label: "Fællestilmelding", head: "8 af 20 tilmeldt", counter: meter(8, 20), sub: "Gratis event, så ingen rabat. Vi sætter borde op til jer.", action: "Tag med" },
      { ...AUTUMN[3]!, label: "Fællesbillet", head: "6 af 10 tilmeldt – 4 mere for 10% rabat", counter: meter(6, 10), sub: "Næste trin: 20 tilmeldt giver 25% rabat.", action: "Tag med på fællesbilletten", note: "Del med en ven" }
    ],
    compare: { core: "Store fælles tilmeldinger til særlige events.", gift: "Ingen gave. Rabatten er belønningen.", discount: "Trappe: 10% ved 10, 25% ved 20.", plus: "Fart, deling og en klar aftale med partnere.", minus: "Kan føles som salg. Kræver aftaler med arrangører." }
  },
  {
    slug: "programmet", tab: "3 · Programmet", name: "Programmet",
    title: "Oplevelser du ikke har prøvet før – med folk du ikke har mødt før",
    standfirst: "Tilmeld dig en sæson. Vi sætter dig sammen med fire andre, du ikke kender, og I får fem håndplukkede oplevelser, I nok aldrig selv havde valgt. Lidt som skolebio, hvor filmen bliver valgt for dig – eller en rundrejse med fremmede, hvor du ser steder, du ikke selv havde tænkt på.",
    cta: "Tilmeld dig forårssæsonen",
    cardLabel: "Forårssæsonen 2027", cardBig: "5 oplevelser · 5 mennesker · 5 måneder",
    cardText: "Én oplevelse om måneden fra januar til maj. Vi vælger oplevelserne og sætter gruppen. Du skal bare møde op med et åbent sind.",
    card: html`<dl class="p-facts"><dt>Hvornår</dt><dd>Én gang om måneden, januar til maj</dd><dt>Gruppen</dt><dd>5 personer, der ikke kender hinanden</dd><dt>Inkluderet</dt><dd>Billetter, entré og det, oplevelsen kræver</dd><dt>Pris</dt><dd>[Pris for hele sæsonen]</dd></dl>`,
    cardFoot: "Gruppen er den samme hele sæsonen. Bagefter vælger I selv, om I vil ses igen.",
    steps: [["Tilmeld dig en sæson", "Fortæl os lidt om dig – især hvad du aldrig har prøvet."], ["Vi sætter gruppen", "Fem mennesker, der ikke kender hinanden, blandet på tværs."], ["Fem oplevelser sammen", "Håndplukket, smalt og nyt. Billetter og det praktiske er klaret."]],
    examplesTitle: "Forårssæsonens program",
    examples: [
      { ...ev("Tor", "14", "jan", "Koncert i totalt mørke", "Kl. 19.30", "Lille spillested", "Inkluderet", true), label: "Oplevelse 1 af 5", head: "I mødes for første gang", counter: dots(["?", "?", "?", "?", "?"]), sub: "Når man ikke kan se noget, lytter man anderledes – og det er nemmere at sige hej bagefter.", action: "Læs mere", note: "Med i sæsonen" },
      { ...ev("Søn", "7", "feb", "Japansk teceremoni", "Kl. 14.00", "Tehus i Latinerkvarteret", "Inkluderet", true), label: "Oplevelse 2 af 5", head: "Langsomt, stille og præcist", counter: dots(["?", "?", "?", "?", "?"]), sub: "En tetemester viser jer et ritual, de færreste i Aarhus har prøvet.", action: "Læs mere", note: "Med i sæsonen" },
      { ...ev("Fre", "12", "mar", "Eksperimenterende dansteater", "Kl. 20.00", "Lille scene", "Inkluderet", true), label: "Oplevelse 3 af 5", head: "Noget, I ikke selv havde købt billet til", counter: dots(["?", "?", "?", "?", "?"]), sub: "Eksperimenterende dans, og bagefter en snak med koreografen kun for jer.", action: "Læs mere", note: "Med i sæsonen" },
      { ...ev("Lør", "17", "apr", "Saunagus og havbad", "Kl. 10.00", "Havnebadet", "Inkluderet", true), label: "Oplevelse 4 af 5", head: "Varmt, koldt og lidt grænseoverskridende", counter: dots(["?", "?", "?", "?", "?"]), sub: "En saunagusmester tager jer gennem et gus, og så hopper I i havnen.", action: "Læs mere", note: "Med i sæsonen" },
      { ...ev("Lør", "15", "maj", "Vild mad i skoven", "Kl. 11.00", "Skov syd for byen", "Inkluderet", true), label: "Oplevelse 5 af 5", head: "Sæsonens afslutning", counter: dots(["?", "?", "?", "?", "?"]), sub: "I samler vilde urter med en guide og laver frokost sammen i skoven.", action: "Læs mere", note: "Med i sæsonen" },
      { ...ev("Jeres", "5", "pers.", "Din gruppe", "Hele sæsonen", "Den samme gruppe", "Afsløres", false), label: "Jeres gruppe", head: "Fire andre, du ikke har mødt før", counter: dots(["?", "?", "?", "?", "?"]), sub: "Vi blander på tværs af alder og baggrund. Navnene får I, når sæsonen starter.", action: "Sådan sætter vi grupperne" }
    ],
    compare: { core: "En sæson med 5 håndplukkede oplevelser for 5, der ikke har mødt hinanden.", gift: "Oplevelserne er selve gaven. Alt er betalt og planlagt.", discount: "Ingen rabat. Én samlet sæsonpris, højere end i de andre.", plus: "En rigtig forretning med kendt indtægt pr. sæson og et klart løfte.", minus: "Kræver kuratering hver sæson, og prisen er en større beslutning." }
  }
];

const pathOf = (p: Proposal) => p.slug ? `/forslag/${p.slug}` : "/forslag";

const counter = (c: Counter): SafeHtml => c.kind === "meter"
  ? html`<meter class="p-meter" min="0" max="${c.max}" value="${c.value}">${c.value} af ${c.max}</meter>`
  : html`<div class="p-dots" aria-hidden="true">${Array.from({ length: c.total }, (_, i) => c.filled[i]).map(n => html`<span class="p-dot${n && n !== "?" ? " is-filled" : ""}">${n ? n.charAt(0) : ""}</span>`)}</div>`;

/** The page for one proposal (slug "" is the first), or null for an unknown one. */
export function proposalsPage(ctx: PageContext, slug: string): View | null {
  const p = PROPOSALS.find(x => x.slug === slug);
  if (!p) return null;
  const body = html`
<nav class="p-tabs" aria-label="Tre forslag til Socialklubben">
  <div class="wrap p-tabs-inner">
    <p class="p-tabs-title">Tre forslag til Socialklubben</p>
    <ul>${PROPOSALS.map(x => html`<li><a href="${pathOf(x)}"${x === p ? html` aria-current="page"` : ""}>${x.tab}</a></li>`)}</ul>
    <p class="p-tabs-note">Samme side, tre måder at gøre det på</p>
  </div>
</nav>
<section class="hero">
  <div class="wrap hero-inner">
    <div>
      <p class="hero-kicker">Forslag ${PROPOSALS.indexOf(p) + 1} · ${p.name}</p>
      <h1>${p.title}</h1>
      <p class="standfirst">${p.standfirst}</p>
      <p class="p-actions"><span class="button">${p.cta}</span> <a class="button-secondary" href="/tryghed">Sådan holder vi det trygt</a></p>
    </div>
    <div class="p-card">
      <p class="p-card-label">${p.cardLabel}</p>
      <p class="p-card-big">${p.cardBig}</p>
      <p>${p.cardText}</p>
      ${p.card}
      <p class="p-card-foot">${p.cardFoot}</p>
    </div>
  </div>
</section>
<div class="wrap">
  <section class="section" aria-labelledby="h-how">
    <div class="section-head"><h2 id="h-how">Sådan virker det</h2></div>
    <ol class="p-steps">${p.steps.map(([t, x], i) => html`<li><span class="p-step-n" aria-hidden="true">${i + 1}</span><h3>${t}</h3><p>${x}</p></li>`)}</ol>
  </section>
  <section class="section" aria-labelledby="h-examples">
    <div class="section-head"><h2 id="h-examples">${p.examplesTitle}</h2><p class="small meta-muted">Eksempler – navne, tal og priser er kun til illustration</p></div>
    <div class="p-events">${p.examples.map(e => html`<article class="p-ticket">
      <p class="p-stub"><span>${e.day}</span><strong>${e.date}</strong><span>${e.month}</span></p>
      <div class="p-main">
        <div class="p-head"><div><h3>${e.title}</h3><p class="meta">${e.when} · ${e.place}</p></div><span class="p-price${e.free ? " is-free" : ""}">${e.price}</span></div>
        <div class="p-box"><p class="p-box-label">${e.label}</p><p class="p-box-head">${e.head}</p>${counter(e.counter)}<p class="small">${e.sub}</p></div>
        <p class="p-actions"><span class="button">${e.action}</span>${e.note ? html` <span class="small meta-muted">${e.note}</span>` : ""}</p>
      </div>
    </article>`)}</div>
  </section>
</div>
<section class="p-compare-band" aria-labelledby="h-compare">
  <div class="wrap">
    <h2 id="h-compare">De tre forslag side om side</h2>
    <p>Det samme Socialklubben. Det, der ændrer sig, er hvad vi lægger vægt på.</p>
    <div class="p-compare">${PROPOSALS.map(x => html`<div class="p-compare-card${x === p ? " is-current" : ""}">
      <h3><a href="${pathOf(x)}">${x.name}</a>${x === p ? html` <span class="pill-small">vises nu</span>` : ""}</h3>
      <dl><dt>Kernen</dt><dd>${x.compare.core}</dd><dt>Gaven</dt><dd>${x.compare.gift}</dd><dt>Rabat</dt><dd>${x.compare.discount}</dd><dt>Styrke</dt><dd>${x.compare.plus}</dd><dt>Risiko</dt><dd>${x.compare.minus}</dd></dl>
    </div>`)}</div>
  </div>
</section>`;
  return { status: 200, body: page(ctx, { title: `Forslag: ${p.name}`, description: "Tre forslag til, hvordan Socialklubben kan se ud og fungere.", canonical: pathOf(p), noindex: true, styles: ["/assets/forslag.css?v=1"] }, body) };
}
