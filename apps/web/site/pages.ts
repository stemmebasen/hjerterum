/** Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt",
 * in the structure of hjerterum.info ("En forside som denne er nu blevet rigtig fin"). Every page names the holistisk.org
 * pages it carries (`sources`); site/redirects.ts sends every old address to its new place, and docs/CONTENT_LEDGER.md
 * accounts for all 56. The untouched originals are archived in docs/legacy/holistisk-org/. Markdown: site/markdown.ts;
 * a line "{{name}}" places a live part of the page (the calendar, the plans, the price calculator …). */

import { SITE_PAGES_EN } from "./pages-en.js";
import { STATUTES } from "./statutes.js";

export type Lang = "da" | "en";
export type Section = "events" | "medlemskab" | "lej" | "om-os" | "kontakt" | "en";
export type Picture = { src: string; alt: string };

export type SitePage = {
  path: string;
  lang: Lang;
  section: Section;
  kicker: string;
  title: string;
  /** The italic, terracotta second line of the headline (as on hjerterum.info: "Mere nærvær. / Mindre støj."). */
  em?: string;
  lead: string;
  description: string;
  body: string;
  image?: Picture;
  gallery?: { title: string; pictures: Picture[] };
  children?: string[];
  /** A long text read from one end to the other (the chair's report): the headline, the introduction and the text in one
   * centred column instead of the headline beside the introduction. Asked of the report: "Er det meningen at layoutet skal være sådan her?" */
  article?: boolean;
  /** How the page appears as a card on the page above it. */
  card: { title: string; text: string };
  /** Its name in the menu and the tabs, when the card's title is a headline rather than a name. */
  menu?: string;
  sources: string[];
};

/** sub: the item opens a menu of its own pages - requested for Brug Hjerterum ("Altså under punktet: Brug Hjerterum") and for Om Hjerterum:
 * "Menupunktet for behandlere skal ikke være i menuen men appear under Om Hjerterum som menupunkt. Det samme skal de undersider du finder via Om Hjerterums side". */
export const NAV: Array<{ section: Section; label: string; href: string; sub?: boolean }> = [
  { section: "events", label: "Events", href: "/events" },
  { section: "medlemskab", label: "Medlemskab", href: "/medlemskab" },
  { section: "lej", label: "Brug Hjerterum", href: "/brug-hjerterum", sub: true },
  { section: "om-os", label: "Om Hjerterum", href: "/om-os", sub: true },
  { section: "kontakt", label: "Kontakt", href: "/kontakt" }
];
/** Requested: "English skal stå på en anden måde så det ikke fylder i menuen" - a small language switch beside the menu. */
export const ENGLISH = { section: "en" as Section, label: "EN", title: "English", href: "/en" };
/** Requested: "relevante links i footeren": Handelsbetingelser, Privatlivspolitik, Cookies, © Hjerterum F.M.B.A. and the version. */
export const LEGAL_LINKS = [
  { label: "Handelsbetingelser", href: "/handelsbetingelser" },
  { label: "Privatlivspolitik", href: "/privatliv" },
  { label: "Cookies", href: "/cookies" }
];

/** Where people sign up today - the same place hjerterum.info sends them - until payment runs on this platform. */
/** Requested: "Denne tekst må gerne stå relevante steder på hjemmesiden og i medlemssektionen. Lav gerne alternative formuleringer". */
export const BENEFITS = {
  full: "Som betalende medlem af Hjerterum får du adgang til en række særlige fordele. Du får bl.a. rabat eller gratis adgang til events, mulighed for at oprette events for andre medlemmer, adgang til CIRKLER og mulighed for at oprette en offentlig profil som behandler eller underviser.",
  front: "Som betalende medlem får du mere end et sted at komme: rabat eller gratis adgang til events, mulighed for selv at skabe events for andre medlemmer, en plads i CIRKLER og din egen offentlige profil, hvis du er behandler eller underviser.",
  member: "Dit medlemskab giver dig rabat eller gratis adgang til events, mulighed for at oprette dine egne events, en plads i CIRKLER og – hvis du underviser eller behandler – din egen offentlige profil.",
  upgrade: "Med et betalende medlemskab får du events med rabat eller gratis, kan oprette dine egne events, være med i CIRKLER og få en offentlig profil som behandler eller underviser."
} as const;

/** Requested: "Brug også disse formuleringer om Hjerterum der findes her https://holistisk.org/" - the old front page's words, kept as they were. */
export const ABOUT_WORDS = {
  tagline: "Hjerterum i Aarhus tilbyder arrangementer, workshops og fællesskab indenfor personlig udvikling, indre transformation og spiritualitet ♥️",
  intro: "Hjerterum i Aarhus er et åbent og inkluderende rum, hvor du kan udforske personlig vækst, selvudvikling og fællesskab. Vi tilbyder arrangementer, workshops og inspirerende møder, der hjælper dig med at finde balance, indre styrke og nye perspektiver på livet.",
  welcome: "Uanset om du søger fordybelse, refleksion eller bare en pause fra hverdagen, er Hjerterum et sted, hvor alle er velkomne. Kom og bliv en del af et fællesskab, der inspirerer og forbinder mennesker på tværs af livets mange facetter.",
  kinds: "Fællesskab, film, sang, musik, dans, fællesspisning, foredrag, kurser, yoga, åndedrætsøvelser, meditation, bevægelse, kreativitet – og alt det, der skaber glæde, forbindelse og inspiration.",
  membership: (monthKr: number) => `Bliv medlem for kun ${monthKr} kr./måned og deltag i medlemsarrangementer, og få en stor rabat på arrangementer, hvor ikke-medlemmer er tilladt – og nogle gange gratis.`,
  teachers: "Som underviser kan du bruge vores skønne og veludstyrede rum til dine begivenheder til meget rimelige priser og drage fordel af vores store netværk af medlemmer og følgere."
} as const;

/** Requested: "team@hjerterum.info ... bliver i øvrigt den nye officielle kontaktadresse" (1 Nov 2026). */
export const CONTACT_EMAIL = "team@hjerterum.info";
export const SIGNUP_URL = "https://holistisk.org/bliv-medlem/";
export const CIRKLER_URL = "https://cirkler.net";
export const NEWSLETTER_ACTION = "https://holistisk.us6.list-manage.com/subscribe/post?u=e41afd3f798957ec11726bf83&id=0070dc72a9&f_id=00b8ede5f0";
export const NEWSLETTER_HONEYPOT = "b_e41afd3f798957ec11726bf83_0070dc72a9";

const HENVENDELSER = `## Når du skriver til os {#henvendelser}
Sender du en henvendelse med en af formularerne på hjemmesiden, kommer den som en mail i Hjerterums fælles indbakke, så teamet kan svare dig. Vi bruger dine oplysninger til at besvare henvendelsen og gemmer dem ikke på hjemmesiden. Mails i indbakken sorteres med hjælp fra Saga, så de rigtige i bestyrelsen ser dem. I statistikken tæller vi kun, at der kom en henvendelse – hvilken dag, om hvilket emne og fra hvilken side.`;

const DISCLAIMER = `Ved events og arrangementer, som ikke er arrangeret direkte af Hjerterum, fungerer Hjerterum alene som formidler og udlejer af lokaler. Hjerterum har ikke ansvar for indhold, undervisning, rådgivning eller andre forhold i samarbejdet mellem deltager og eksterne undervisere eller arrangører. Eventuelle aftaler, forløb eller uoverensstemmelser er et anliggende mellem deltageren og den pågældende tredjepart.

Opstår der i forbindelse med events eller aktiviteter situationer, hvor enkeltpersoner gentagne gange opleves som generende eller grænseoverskridende, kan du altid kontakte Hjerterums bestyrelse.`;


const PHOTO_POLICY = `**Spørg, før du filmer og fotograferer – og respektér et nej.**

I Hjerterum tager vi som udgangspunkt ikke telefonen frem for at filme eller fotografere. Ønsker du alligevel at gøre det, skal du have et klart og tydeligt samtykke fra alle involverede og fortælle, hvad materialet skal bruges til.

Du har altid ret til at trække dit samtykke tilbage og bede om, at billeder eller videoer, hvor du indgår, bliver slettet.

Ved koncertaftener må der tages billeder og videoer, der indfanger stemningen i rummet. Er enkeltpersoner tydeligt med, spørger man altid først – og respekterer selvfølgelig et nej.

I Hjerterum passer vi på hinandens tryghed, privatliv og tillid – også digitalt.`;


/** The adopted text as Markdown: each "§" line as a bold heading of its own, the rest as written. */
const statutesMarkdown = (text: string) => text.split("\n").map(line => /^§/.test(line) ? `\n**${line}**\n` : line).join("\n");

const FACEBOOK_GROUPS = `**Danske Facebook-grupper**
- [Holistisk Opslagstavle](https://www.facebook.com/groups/1183865201632072)
- [Spirituelle begivenheder i Aarhus](https://www.facebook.com/groups/161399494007664)
- [Dit Århus og Omegn](https://www.facebook.com/groups/514775842034512)
- [Århus – Spirituelt Forum](https://www.facebook.com/groups/221075511308141)
- [Spirituelt Midtjylland](https://www.facebook.com/groups/976715929009924)
- [Spirituelle Arrangementer Midt/Vest](https://www.facebook.com/groups/143089905880636)
- [Det spirituelle Jylland](https://www.facebook.com/groups/198586690318668)
- [Det spirituelle Kronjylland](https://www.facebook.com/groups/553677581359415)
- [Spirituelt & Alternativt i Jylland](https://www.facebook.com/groups/SpiritueltogAlternativtiJylland)
- [Spirituelle arrangementer og workshops](https://www.facebook.com/groups/433286063394696)
- [Kurser, workshops, online, uddannelser mm.](https://www.facebook.com/groups/1427433190885392)
- [Danmarks Spirituelle Opslagstavle](https://www.facebook.com/groups/danmarksspirituelleopslagstavle)
- [Ny Danmarks Spirituelle Opslagstavle](https://www.facebook.com/groups/1895185204069368)
- [Danmarks nye Spirituelle opslagstavle](https://www.facebook.com/groups/140696266590624)
- [Spirituelle Begivenheder & Opslag i Danmark](https://www.facebook.com/groups/503938470079477)
- [Events og begivenheder – det sker i Århus omegn, Risskov, Skødstrup mm.](https://www.facebook.com/groups/eventbegivenheder)
- [Det sker i Skanderborg og Omegn](https://www.facebook.com/groups/829490851216186)
- [Ny Spirituel Opslagstavle](https://www.facebook.com/groups/600611426812523)
- [Spirituel reklame gruppe](https://www.facebook.com/groups/405352766283079)
- [Det sker i Aarhus](https://www.facebook.com/groups/376215567796538)
- [Dette sker i de jyske byer](https://www.facebook.com/groups/207118127171227)
- [Spirituel Reklamesøjle Danmark](https://www.facebook.com/groups/340434139480272)
- [Spirituelle centre i Danmark](https://www.facebook.com/groups/1461326270667522)
- [Danmarks Spirituelle Fællesskab](https://www.facebook.com/groups/1580841652237397)
- [Spirituelt Fællesskab Danmark](https://www.facebook.com/groups/144748368873708)
- [Det Spirituelle Danmark](https://www.facebook.com/groups/362353954938295)
- [Det Holistisk Aarhus](https://www.facebook.com/groups/2472075053049238)

**Engelsksprogede grupper**
- [Events in Aarhus](https://www.facebook.com/groups/281989928869750)
- [Aarhus Events Community](https://www.facebook.com/groups/1972770316279876)
- [Spiritual Events in Denmark](https://www.facebook.com/groups/spiritualseventsindenmark)

**Kun til gratis events**
- [Gratis begivenheder i Aarhus](https://www.facebook.com/groups/900118463368050)

**Andre grupper, du kan søge efter**
- Events i Aarhus og omegn
- Spirituelle begivenheder Aarhus
- Det spirituelle netværk
- Netværk for alternative spirituelle i Danmark, Reklamesøjlen
- Spirituelle i Danmark (kun gratis arrangementer)
- Mindfulness DK
- Alternativ/spirituel dans/fest Aarhus
- Det Spirituelle fællesskab Midt- & Nordjylland
- Alternative Behandlere mv. – arrangementer, messer, workshops (Jylland)`;

const ROOM_GALLERY: Picture[] = [
  { src: "/media/2021-03-hjerterum-e.webp", alt: "Salen i Hjerterum med trægulv, hvide bjælker og planter" },
  { src: "/media/2020-11-hjerterum-a.webp", alt: "Salen set fra indgangen" },
  { src: "/media/2021-03-hjerterum-d-1.webp", alt: "Sofahjørnet i salen" },
  { src: "/media/2021-03-hjerterum-f.webp", alt: "Salen med de høje vinduer" },
  { src: "/media/2021-03-hjerterum-c.webp", alt: "Salen badet i lys" },
  { src: "/media/2021-05-room-2-1.webp", alt: "Madrasser lagt frem til en session" },
  { src: "/media/2021-06-p1010197.webp", alt: "Stole i rundkreds om et lys" },
  { src: "/media/2026-06-hjerterum2-1.webp", alt: "Yoga i salen" },
  { src: "/media/2021-05-guitar-player.webp", alt: "Koncert med guitar i Hjerterum" },
  { src: "/media/2021-05-guitar-player-1.webp", alt: "Publikum til koncert i salen" },
  { src: "/media/2021-05-cafe-time.webp", alt: "Café-stemning i køkkenet" },
  { src: "/media/2021-05-cafe.webp", alt: "Kager i caféen" },
  { src: "/media/2019-11-food-2.webp", alt: "Fællesspisning med mange små retter" },
  { src: "/media/2021-05-shanti-kugler.webp", alt: "Hjemmelavede energikugler" },
  { src: "/media/2021-05-johannes-ae.webp", alt: "En deltager ved et arrangement" },
  { src: "/media/2021-05-aurora-plus.webp", alt: "Deltagere i snak efter et event" }
];

const pages: SitePage[] = [
  // ---------------------------------------------------------------- Events
  {
    path: "/events", lang: "da", section: "events",
    kicker: "Events", title: "Det sker", em: "i Hjerterum",
    lead: "Yoga, meditation, breathwork, trommerejser, mantrasang, fællesspisning, filmaftener, koncerter og dans – der er noget for enhver smag.",
    description: "Kalender over yoga, meditation, breathwork, koncerter, foredrag og fællesskab i Hjerterum, Guldsmedgade 26B i Aarhus.",
    card: { title: "Events", text: "Kalenderen med alt, hvad der sker i huset." },
    body: `{{events}}

## Tilmelding
De fleste events tilmelder du dig direkte her på siden. Kan du ikke tilmelde dig et event, er der enten ikke flere pladser, eller også sker tilmeldingen et andet sted – fx pr. mail eller via et link til arrangørens egen side.

Som medlem deltager du til rabatpris og ofte helt gratis. [Læs om medlemskab](/medlemskab).

## Hjerterum Open {#hjerterum-open}
Hjerterum Open er events, som Hjerterum selv skaber og arrangerer – koncerter, foredrag, fællesspisning, dans, meditation, temaaftener og meget mere. De er til glæde for hele fællesskabet: medlemmerne, husets dygtige undervisere og alle de mennesker, der finder vej til Hjerterum.

**Formålet er**
- at styrke og samle fællesskabet
- at invitere nye mennesker ind i Hjerterum
- at skabe samarbejde og samskabelse på tværs

**Sådan fungerer det**
- Hjerterum står som arrangør – ofte i samarbejde med inviterede undervisere, kunstnere eller organisationer.
- Eventene er åbne for både medlemmer og ikke-medlemmer.
- Medlemmer deltager ofte gratis eller til reduceret pris. Prisen for ikke-medlemmer fastsættes fra event til event, og nogle events er gratis for alle.

Har du ønsker eller idéer til indhold, så skriv til [team@hjerterum.info](mailto:team@hjerterum.info).

## Spørgsmål til et event? {#skriv}
Har du spørgsmål om tilmelding, pladser eller et bestemt event, så skriv til os her.

{{enquiry-event-deltagelse}}

## Vil du holde et event?
Undervisere og arrangører kan leje salen og nå ud til husets store fællesskab. [Læs om at bruge Hjerterum](/brug-hjerterum), eller [skriv til os om dit event](/brug-hjerterum#skriv).

+++ Politik om fotografering og video
${PHOTO_POLICY}
+++

+++ Ansvarsfraskrivelse
${DISCLAIMER}
+++`,
    gallery: {
      title: "Fællesspisning i Hjerterum",
      pictures: ["7222", "7223", "7224", "7225", "7226", "7229", "7231", "7232"].map(n => ({ src: `/media/2019-08-dsc-${n}-1.webp`, alt: "Fællesspisning i Hjerterum" }))
    },
    sources: ["events", "kalendervisning", "nye-community-events-hjerterum-events", "online-events", "faellesspisning-i-hjerterum"]
  },

  // ---------------------------------------------------------------- Behandlere & undervisere
  {
    path: "/behandlere", lang: "da", section: "om-os", menu: "Behandlere & undervisere",
    kicker: "Behandlere & undervisere", title: "Mennesker med", em: "noget på hjerte",
    lead: "Mød de behandlere, undervisere og værter, som deler deres faglighed og skaber oplevelser i Hjerterum.",
    description: "Behandlere, undervisere og faste hold i Hjerterum i Aarhus.",
    card: { title: "Mennesker med noget på hjerte", text: "Mød behandlerne, underviserne og værterne i huset." },
    body: `{{profiles}}

Vil du selv undervise i Hjerterum? [Læs om at bruge Hjerterum](/brug-hjerterum). Er du medlem og underviser eller behandler, kan du lave dit eget visitkort i [medlemsområdet](/member-portal/profil).`,
    sources: ["faste-laerere-regular-teachers"]
  },

  // ---------------------------------------------------------------- Medlemskab
  {
    path: "/medlemskab", lang: "da", section: "medlemskab",
    kicker: "Medlemskab", title: "Bliv en del", em: "af Hjerterum",
    lead: "Vælg det medlemskab, der passer til dig – og få adgang til et fællesskab baseret på nærvær og menneskelig varme.",
    description: "Medlemskab af Hjerterum i Aarhus: priser, fordele, reduceret pris, vilkår og muligheden for at støtte huset.",
    card: { title: "Bliv en del af Hjerterum", text: "Medlemskaber, fordele og vilkår." },
    body: `Som betalende medlem af Hjerterum får du adgang til en række særlige fordele. Du får bl.a. rabat eller gratis adgang til events, mulighed for at oprette events for andre medlemmer, adgang til CIRKLER og mulighed for at oprette en offentlig profil som behandler eller underviser.

{{membership-plans}}

## Sådan melder du dig ind {#tilmelding}
Indmeldelse sker indtil videre i vores medlemssystem på holistisk.org: [Meld dig ind her](${SIGNUP_URL}). Er du allerede medlem, kan du [logge ind](/sign-in) og se dit medlemskab, dine tilmeldinger og dine events.

Læs [vilkårene for medlemskab](/medlemskab/vilkaar), før du melder dig ind.

## Reduceret pris {#reduceret}
Reduceret pris er til dig med en lav indkomst – fx SU eller kontanthjælp, eller en nettoløn under 13.500 kr. om måneden. Medlemskabet koster 111 kr. om måneden eller 1.155 kr. om året. Stiger din indkomst over grænsen, beder vi dig opgradere til standardpris.

## Fordele ved et medlemskab {#fordele}
- Du deltager i events til rabatpris og ofte helt gratis.
- Du får jævnligt tilbud på Hjerterums egne events – koncerter, foredrag, temaaftener, fællesspisning, filmaftener og meget mere – som en del af [Hjerterum Open](/events#hjerterum-open). Ofte gratis eller til særlig pris for medlemmer.
- Det er nemmere at tilmelde sig events, når du er logget ind.
- Du får rabat på økologisk specialkaffe, andre specialdrikke og biodynamisk kage og snacks i caféen hver torsdag eftermiddag og til andre arrangementer.
- Du får tilbud på events hos Hjerterums samarbejdspartnere i Aarhus og Østjylland.
- Du kan være med i foreningen med bidrag, idéer og ønsker.
- Du støtter Hjerterum økonomisk, så vi sammen kan blive ved med at udleve visionen om et hjerterum for healing, forbundethed og indre fred.

## Støt Hjerterum {#stoet}
Donationer er – sammen med medlemskontingent og leje af salen – det, der får Hjerterum til at løbe rundt. Enhver donation, lille som stor, modtages med stor taknemmelighed.

- **MobilePay:** 734388
- **Bankoverførsel** (fx ved beløb over 1.000 kr.): Djursland Bank, reg.nr. 7268, kontonr. 1211404

Vil du støtte fast uden medlemsfordele, kan du vælge Support-medlemskabet. På forhånd tak fra teamet bag ♡

## Spørgsmål om medlemskab? {#skriv}
Skriv til os, hvis du vil vide mere om medlemskaberne, reduceret pris eller dit eget medlemskab.

{{enquiry-medlemskab}}`,
    image: { src: "/media/2021-05-cafe-time.webp", alt: "Café-stemning i Hjerterum" },
    children: ["/medlemskab/vilkaar"],
    sources: ["bliv-medlem", "fordele-ved-medlemskab", "lav-indkomst-medlemskab-low-income-membership", "donationer"]
  },
  {
    path: "/medlemskab/vilkaar", lang: "da", section: "medlemskab",
    kicker: "Medlemskab", title: "Vilkår", em: "for medlemskab",
    lead: "De betingelser, der gælder, når du melder dig ind i Hjerterum F.M.B.A.",
    description: "Vilkår for medlemskab af Hjerterum: betaling, opsigelse, bindingsperiode og prøveperiode.",
    card: { title: "Vilkår for medlemskab", text: "Betaling, opsigelse, bindingsperiode og prøveperiode." },
    body: `## Aftalen
Handelsbetingelserne gælder mellem dig og Hjerterum F.M.B.A. Medlemskabet er personligt og kan ikke overdrages eller deles med andre.

## Betaling
Vi modtager betaling med Dankort/Visa-Dankort, Visa, Visa Electron og Mastercard. Første betaling trækkes, når aftalen indgås. Derefter trækkes prisen automatisk dagen før en ny periode begynder – månedligt eller årligt.

Det er dit ansvar, at et korrekt og gyldigt betalingskort er registreret.

## Kvittering
Når du har meldt dig ind, får du en bekræftelse pr. mail med alle oplysninger om dit medlemskab.

## Gyldighed
Medlemskabet gælder fra oprettelsesdatoen, til det opsiges.

## Opsigelse og pause {#opsigelse}
Du opsiger selv dit medlemskab, når du er logget ind: gå til [Min profil → Medlemskab](https://medlem.hjerterum.info/member-portal/medlemskab), og vælg **Opsig medlemskab**. Har du brug for hjælp – eller vil du holde pause et par måneder – så skriv til [team@hjerterum.info](mailto:team@hjerterum.info).

## Bindingsperiode
Bindingsperioden er løbende måned + 1 måned. Det betyder, at du betaler én gang mere, efter du har opsagt.

Gennemføres en kortbetaling af en eller anden grund ikke, er du stadig medlem, indtil du opsiger – og betalingen forventes at fortsætte.

## 30 dages prøveperiode
Tilbyder vi en gratis prøveperiode, kan den kun bruges én gang. Opsiger du og vil melde dig ind igen, logger du ind på din konto og opdaterer dine betalingsoplysninger.

## Dine oplysninger
Vi opbevarer kun dine kontooplysninger i højst 2 år til statistiske formål.

## Vedtægterne
Medlemskab af foreningen er også beskrevet i [vedtægternes § 4 og § 5](/om-os/foreningen#vedtaegter).`,
    sources: ["medlemskabs-betingelser"]
  },

  // ---------------------------------------------------------------- Brug Hjerterum
  // Requested by Gitta (18 October 2026): "Forslag til ny mere simpel fane-orden under Brug Hjerterum" - Om at bruge Hjerterum,
  // then Booking & leje, Praktisk information and Eventguides & PR, each with its own short pages. The old /lej-hjerterum
  // addresses lead here (site/redirects.ts).
  {
    path: "/brug-hjerterum", lang: "da", section: "lej",
    kicker: "Brug Hjerterum", title: "Et rum til det,", em: "du vil skabe",
    lead: "Har du en workshop, et foredrag, et forløb eller en lille begivenhed på hjerte? Lej vores sal på ca. 110 m² – fra tidlig morgen til sen aften, alle ugens dage.",
    description: "Brug Hjerterums sal på ca. 110 m² i Aarhus C: booking og priser, praktisk information og guides til dit event.",
    card: { title: "Om at bruge Hjerterum", text: "Salen, priserne og alt det praktiske – samlet ét sted." },
    body: `Du får et smukt rum på ca. 110 m² – og et fællesskab: dit event kommer på vores hjemmeside og Facebook-side, så du når ud til vores mange medlemmer og følgere. Du står selv for at planlægge og afvikle eventet, men vores frivillige giver gerne en hånd.

{{booking-choice}}

## Her finder du
- **[Booking & leje](/brug-hjerterum/booking)** – [lejepriser og booking](/brug-hjerterum/lejepriser), [vilkår for leje](/brug-hjerterum/vilkaar) og [ofte stillede spørgsmål](/brug-hjerterum/faq).
- **[Praktisk information](/brug-hjerterum/praktisk)** – [adgang og nøgle](/brug-hjerterum/adgang), [køkken og faciliteter](/brug-hjerterum/koekken), [lydanlæg og udstyr](/brug-hjerterum/udstyr), [rengøring](/brug-hjerterum/rengoering), [wifi og praktiske detaljer](/brug-hjerterum/wifi) og [husregler og hensyn](/brug-hjerterum/husregler).
- **[Eventguides & PR](/brug-hjerterum/eventguides)** – [kom godt i gang](/brug-hjerterum/kom-i-gang), [Facebook-begivenhed](/brug-hjerterum/facebook), [eventbillede og grafik](/brug-hjerterum/eventbillede), [markedsføring](/brug-hjerterum/markedsfoering), [ændr dit event](/brug-hjerterum/aendr-event) og [aflys dit event](/brug-hjerterum/aflys-event).

+++ Ansvarsfraskrivelse
${DISCLAIMER}
+++

## Spørgsmål? {#skriv}
Er du i tvivl om datoer, pris eller hvordan dit event passer ind i Hjerterum, så skriv til os her.

{{enquiry-event-opsaetning}}`,
    image: { src: "/media/2021-03-hjerterum-e.webp", alt: "Salen i Hjerterum med trægulv, hvide bjælker og planter" },
    gallery: { title: "Salen og livet i Hjerterum", pictures: ROOM_GALLERY },
    children: ["/brug-hjerterum/booking", "/brug-hjerterum/praktisk", "/brug-hjerterum/eventguides"],
    sources: ["brug-centret"]
  },

  // Booking & leje
  {
    path: "/brug-hjerterum/booking", lang: "da", section: "lej",
    kicker: "Brug Hjerterum", title: "Booking", em: "& leje",
    lead: "Priser, sådan booker du, vilkårene for leje – og svar på de spørgsmål, vi oftest får.",
    description: "Booking og leje af Hjerterums sal: lejepriser og booking, vilkår for leje og ofte stillede spørgsmål.",
    card: { title: "Booking & leje", text: "Lejepriser, vilkår og ofte stillede spørgsmål." },
    body: `Planlæg gerne 4–8 uger før dit event. Find prisen i [prisberegneren](/brug-hjerterum/lejepriser#beregner), og læs [vilkårene](/brug-hjerterum/vilkaar), før du booker.`,
    children: ["/brug-hjerterum/lejepriser", "/brug-hjerterum/vilkaar", "/brug-hjerterum/faq"],
    sources: []
  },
  {
    path: "/brug-hjerterum/lejepriser", lang: "da", section: "lej",
    kicker: "Booking & leje", title: "Lejepriser", em: "& booking",
    lead: "Tre måder at leje salen på, prisberegneren – og det, du sender med, når du booker.",
    description: "Lejepriser for Hjerterums sal: standardpris, medlemsrabat og gratis leje, prisberegner og sådan booker du.",
    card: { title: "Lejepriser & booking", text: "Priser, prisberegner og sådan booker du." },
    body: `## Sådan kommer du i gang {#booking}
1. **Find prisen.** Vælg lejetype og tidspunkt i [prisberegneren](#beregner) herunder.
2. **Book.** Er du medlem og vil du bruge Hjerterum til reduceret pris eller med helt gratis leje, opretter du selv dit event på [medlemssiden](https://medlem.hjerterum.info/member-portal/events) – vores digitale assistent, Saga, hjælper dig gerne. Alle medlemsoprettede events skal først godkendes af Hjerterums team.
3. **Vi bekræfter.** Ved standardpris får du en faktura, og når den er betalt, lægger vi eventet på hjemmesiden og Facebook (op til ca. 5 hverdage). Planlæg gerne 4–8 uger før.

{{booking-choice}}

## Priser {#priser}
Alle priser er inkl. moms.

### A) Standardpris – uden medlemsrabat
Fast pris efter bookingens længde.

| Varighed | Pris |
|---|---|
| 2 timer | 720 kr. |
| 3 timer | 1.080 kr. |
| 4 timer | 1.380 kr. |
| 5 timer | 1.680 kr. |
| 6 timer | 1.920 kr. |
| 7 timer | 2.160 kr. |
| 8 timer | 2.340 kr. |
| 9 timer | 2.520 kr. |
| 10 timer | 2.700 kr. |

> **Kun for medlemmer:** B) Reduceret pris – med medlemsrabat og C) Gratis leje kræver, at du selv er betalende medlem af Hjerterum. I de tilfælde opretter du selv dit event på [medlemssiden](https://medlem.hjerterum.info/member-portal/events).

### B) Reduceret pris – med medlemsrabat
Til events, hvor medlemmer betaler mindre end ikke-medlemmer.

| | B-tid: hverdage før kl. 18.30 | A-tid: hverdage efter kl. 18.30 og weekend |
|---|---|---|
| Grundpris inkl. de første 2 timer | 150 kr. | 400 kr. |
| Pris pr. ekstra time | 75 kr. | 150 kr. |
| Mindste rabat til medlemmer | 50 kr. | 100 kr. |

I en periode giver vi 25 % rabat på A-tidspriserne – det ser du i prisberegneren.

### C) Gratis leje
Hjerterum tager ikke betaling for lokalet. Medlemmer deltager gratis, og ikke-medlemmer betaler mindst 75 kr. pr. person, som underviseren selv opkræver. Som underviser kan du booke ét event med gratis leje om ugen.

### Regler
- **Varighed:** mindst 2 og højst 10 timer pr. booking.
- **Ingen overlap:** med medlemsrabat eller gratis leje må bookingen ikke gå hen over kl. 18.30 på hverdage.
- **Forberedelse:** opsætning og oprydning skal ligge inden for den bookede tid – vi anbefaler 30 minutter før og efter.

## Prisberegner {#beregner}
{{price-calculator}}

## Det sender du med en bookingforespørgsel {#materiale}
- **Titel og eventtekst** – formål, program og lidt om dig
- **Pris og betaling** – pris for medlemmer og ikke-medlemmer, og hvordan der betales
- **Tilmelding** – via Hjerterums hjemmeside eller direkte hos dig
- **Datoforslag og tidspunkt** – tjek [kalenderen](/events); eventets tid og bookingens tid med forberedelse og oprydning
- **Coverbillede** – se [eventbillede og grafik](/brug-hjerterum/eventbillede)

Når bookingen er bekræftet, kan du [oprette eventet på Facebook](/brug-hjerterum/facebook). Markedsføring ud over vores hjemmeside og Facebook er dit ansvar – [se vores råd og grupper](/brug-hjerterum/markedsfoering).

## Spørgsmål? {#skriv}
Er du i tvivl om datoer, pris eller hvordan dit event passer ind i Hjerterum, så skriv til os her.

{{enquiry-event-opsaetning}}`,
    sources: ["lejepriser", "book-dit-event"]
  },
  {
    path: "/brug-hjerterum/vilkaar", lang: "da", section: "lej",
    kicker: "Booking & leje", title: "Vilkår", em: "for leje",
    lead: "Betaling, aflysning, rengøring – og hvordan du bedst kommunikerer med os.",
    description: "Vilkår for leje af salen i Hjerterum: betaling, aflysningspolitik, rengøringsgebyr og kommunikationspolitik.",
    card: { title: "Vilkår for leje", text: "Betaling, aflysning, rengøring og kommunikation." },
    body: `Priser og sådan booker du: se [lejepriser og booking](/brug-hjerterum/lejepriser). Har du spørgsmål, så skriv til [team@hjerterum.info](mailto:team@hjerterum.info).

## Betaling og oprettelse af event {#betaling}
Når vi har aftalt en booking med dig, sender vi dig en faktura pr. mail. Vi går først i gang med at oprette dit event på hjemmesiden og Facebook, når vi har modtaget betalingen. Spørgsmål om fakturaer: [skriv til os](#skriv) eller til [regnskab@holistisk.org](mailto:regnskab@holistisk.org).

## Aflysning {#aflysning}
Hjerterum beholder altid grundprisen, uanset hvornår du aflyser – den dækker administrationen. Ved forløb og gentagne events beholder vi kun én grundpris.

| Du får tilbage af restbeløbet | Hverdage | Weekender og forløb |
|---|---|---|
| 100 % | ved aflysning 4 uger før | ved aflysning 8 uger før |
| 50 % | ved aflysning 3 uger før | ved aflysning 6 uger før |

**Aflysning i sidste øjeblik** koster et gebyr på 250 kr. Du undgår gebyret ved at aflyse senest dagen før kl. 14.00. Sådan gør du: [aflys dit event](/brug-hjerterum/aflys-event).

## Rengøring efter event
Efterlad salen ren og pæn – se [kravene til rengøring](/brug-hjerterum/rengoering). Ellers opkræver vi et rengøringsgebyr på 250 kr.

## Kommunikation {#kommunikation}
**Mail er kommunikationsvej nr. 1.** Skriv altid først til [team@hjerterum.info](mailto:team@hjerterum.info). Her fanger du os bedst, og alle bookinger, spørgsmål og henvendelser håndteres via mail.

**Hjerterums Messenger-side – til PR og akutte henvendelser.** [Messenger-siden](https://www.facebook.com/share/1BNdSQTGWU/?mibextid=wwXIfr) bruges især til PR-materiale fra undervisere (fx links til opslag, reels eller andet for allerede oprettede events) og til akutte henvendelser, der kræver hurtigt svar. Skriv gerne dit telefonnummer ved akutte henvendelser, så kontakter vi dig hurtigst muligt.

**Hjerterum Café.** Der er ofte bestyrelsesmedlemmer i caféen torsdag eftermiddag. Kig forbi, eller aftal et møde med en af os.

**Det bruger vi ikke.** Send ikke private Messenger-beskeder til bestyrelsesmedlemmer, og ring eller skriv ikke til deres private telefonnumre. Når vi bruger Hjerterums fælles kanaler, går henvendelser ikke tabt, og flere i bestyrelsen kan hjælpe ved behov.

## Ansvar
${DISCLAIMER}

## Spørgsmål om faktura og betaling? {#skriv}
{{enquiry-oekonomi}}`,
    sources: ["betingelser-for-leje-af-sal", "fakturaer", "hjerterum-betalinger"]
  },
  {
    path: "/brug-hjerterum/faq", lang: "da", section: "lej",
    kicker: "Booking & leje", title: "Ofte stillede", em: "spørgsmål",
    lead: "Korte svar på det, undervisere og arrangører oftest spørger om. Står dit spørgsmål her ikke, så skriv til os.",
    description: "Ofte stillede spørgsmål om at leje Hjerterum: priser, booking, betaling, aflysning, nøgler, wifi og rengøring.",
    card: { title: "FAQ", text: "Korte svar på de spørgsmål, vi oftest får." },
    body: `+++ Hvor stor er salen, og hvornår kan den lejes?
Salen er på ca. 110 m², og den kan lejes fra tidlig morgen til sen aften, alle ugens dage. Se [køkken og faciliteter](/brug-hjerterum/koekken).
+++

+++ Hvad koster det at leje salen?
Det afhænger af, om du lejer til standardpris, med medlemsrabat eller gratis, og af tidspunktet. Standardprisen starter ved 720 kr. for 2 timer. Se alle [lejepriser](/brug-hjerterum/lejepriser#priser), eller brug [prisberegneren](/brug-hjerterum/lejepriser#beregner).
+++

+++ Skal jeg være medlem for at leje?
Nej. Alle kan leje til standardpris. Reduceret pris med medlemsrabat og gratis leje kræver, at du selv er betalende medlem af Hjerterum.
+++

+++ Hvor lang tid kan jeg booke?
Mindst 2 og højst 10 timer pr. booking. Opsætning og oprydning skal ligge inden for den bookede tid – vi anbefaler 30 minutter før og efter.
+++

+++ Hvor lang tid før skal jeg booke?
Planlæg gerne 4–8 uger før. Ved standardpris lægger vi eventet på hjemmesiden og Facebook, når fakturaen er betalt – det tager op til ca. 5 hverdage.
+++

+++ Hvordan betaler jeg?
Når vi har aftalt en booking, sender vi en faktura pr. mail. Se [betaling](/brug-hjerterum/vilkaar#betaling).
+++

+++ Hvad sker der, hvis jeg aflyser?
Hjerterum beholder altid grundprisen. Hvor meget af resten du får tilbage, afhænger af, hvor længe før du aflyser. Se [aflysning](/brug-hjerterum/vilkaar#aflysning) og [aflys dit event](/brug-hjerterum/aflys-event).
+++

+++ Hvordan kommer jeg ind?
Nøglerne ligger i en nøgleboks ved lågen i Guldsmedgade, og koden får du på mail. Se [adgang og nøgle](/brug-hjerterum/adgang).
+++

+++ Hvad er koden til wifi?
Netværksnavn og kode får du sammen med din booking – eller spørg os.
+++

+++ Skal jeg selv gøre rent?
Ja. Efterlad salen, køkkenet og toiletterne, som du fandt dem. Ellers opkræver vi et rengøringsgebyr på 250 kr. Se [rengøring](/brug-hjerterum/rengoering).
+++

+++ Hvem markedsfører mit event?
Vi lægger dit event på vores hjemmeside og Facebook-side. Markedsføring ud over det er dit ansvar – se [markedsføring af dit event](/brug-hjerterum/markedsfoering).
+++

## Fandt du ikke svaret? {#skriv}
{{enquiry-event-opsaetning}}`,
    sources: []
  },

  // Praktisk information
  {
    path: "/brug-hjerterum/praktisk", lang: "da", section: "lej",
    kicker: "Brug Hjerterum", title: "Praktisk", em: "information",
    lead: "Alt det praktiske, når du bruger Hjerterum: nøgler, køkken, lyd og udstyr, rengøring, wifi og husregler.",
    description: "Praktisk information til undervisere i Hjerterum: nøgler, dørtelefon, køkken, lydanlæg, projektor, rengøring og husregler.",
    card: { title: "Praktisk information", text: "Nøgler, køkken, lyd, rengøring, wifi og husregler." },
    body: `Føl jer hjemme, og nyd jeres tid i Hjerterum ♡ – Team Hjerterum`,
    children: ["/brug-hjerterum/adgang", "/brug-hjerterum/koekken", "/brug-hjerterum/udstyr", "/brug-hjerterum/rengoering", "/brug-hjerterum/wifi", "/brug-hjerterum/husregler"],
    sources: ["guidelines-for-undervisere"]
  },
  {
    path: "/brug-hjerterum/adgang", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Adgang", em: "& nøgle",
    lead: "Sådan kommer du og dine deltagere ind: nøgleboksen, chippen til lågen og dørtelefonen.",
    description: "Adgang til Hjerterum: nøgleboksen ved lågen i Guldsmedgade, chippen og dørtelefonen.",
    card: { title: "Adgang & nøgle", text: "Nøgleboksen, chippen og dørtelefonen." },
    body: `## Nøgler
Du finder to sæt nøgler i en lille nøgleboks på ydervæggen ved jernlågerne ud mod Guldsmedgade. Du skal bruge ét af sættene. Et sæt består af en grøn chip til porten og kælderdøren og en almindelig nøgle til Hjerterums hoveddør og hængelåsen på kælderens inderdør. Koden til nøgleboksen får du på mail.

Chippen er nem at bruge: hold den op foran den sorte "dims" på væggen under nøgleboksen. Når lyset bliver grønt, drejer du dimsen med uret, og lågen åbner langsomt.

**Husk at lægge nøglesættet tilbage i nøgleboksen efter dit arrangement.**

![Nøgleboksen og den sorte dims til chippen ved lågen i Guldsmedgade](/media/2022-06-key-boxes.webp)

## Dørtelefon
Dine deltagere kan ringe på dørtelefonen ved gitterlågen i Guldsmedgade. Du lukker dem ind fra dørtelefonen i forgangen ved at trykke på nøgleikonet. Lyser den nederste knap med klokken rødt, er lyden slået fra – tryk på knappen for at slå den til igen.`,
    sources: []
  },
  {
    path: "/brug-hjerterum/koekken", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Køkken", em: "& faciliteter",
    lead: "Salen, køkkenet og det, du kan låne, når du bruger Hjerterum.",
    description: "Faciliteterne i Hjerterum: sal på ca. 110 m², køkken med service til 40, måtter, stole, borde og toiletter.",
    card: { title: "Køkken & faciliteter", text: "Salen, køkkenet og det, du kan låne." },
    body: `## Faciliteter {#faciliteter}
- Sal på ca. 110 m², 2 toiletter og trådløst internet
- Fuldt udstyret køkken med service til 40 personer
- 20 yogamåtter, 22 madrasser, 16 meditationsstole, 20 yogablokke, puder og tæpper
- Stole til 40 personer og 8 borde
- Musikanlæg (minijack og Bluetooth) og projektor med HDMI – se [lydanlæg og udstyr](/brug-hjerterum/udstyr)

## Køkken
I køkkenet er der køleskab, fryser, ovn, 2 kogeplader og elkedel, som du gerne må bruge. Medbring selv te, kaffe og lignende. Ryd op efter dig, så køkkenet ser ud, som da du kom.`,
    sources: []
  },
  {
    path: "/brug-hjerterum/udstyr", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Lydanlæg", em: "& udstyr",
    lead: "Sådan bruger du lydanlægget og projektoren i salen.",
    description: "Lydanlæg og projektor i Hjerterum: minijack, Bluetooth og HDMI – og hvad du selv skal medbringe.",
    card: { title: "Lydanlæg & udstyr", text: "Lydanlæg, projektor og adaptere." },
    body: `## Lydanlæg
I salen er der et anlæg med minijack og Bluetooth. Medbring evt. din egen adapter, hvis din telefon ikke har et jackstik. [Se videoen om, hvordan du sætter lydanlægget op](https://www.youtube.com/watch?v=UoYa4tEqANY).

## Projektor
Der er et HDMI-kabel fastgjort til søjlen, der kommer ned fra projektoren. Har din computer ikke HDMI, skal du medbringe en adapter. Fjernbetjeningen skal sidde i søjlens "V".

## Måtter, puder og stole
Yogamåtter, madrasser, meditationsstole, yogablokke, puder, tæpper, stole og borde – se [køkken og faciliteter](/brug-hjerterum/koekken). Sæt det hele tilbage, hvor det stod, når du er færdig.`,
    sources: []
  },
  {
    path: "/brug-hjerterum/rengoering", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Rengøring", em: "efter dit event",
    lead: "Efterlad stedet rent og pænt, så salen er klar til dem, der kommer efter dig.",
    description: "Rengøring efter dit event i Hjerterum: salen, køkkenet, toiletterne, affald og rengøringsgebyret.",
    card: { title: "Rengøring", text: "Tjeklisten til salen, køkkenet og toiletterne." },
    body: `Book tid nok til rengøringen – vi anbefaler 30 minutter efter dit event.

## Oprydning
- Alt kommer tilbage på plads i salen, køkkenet, på toilettet og i gangen: køkkengrej, puder, tæpper, måtter, stole, yogapøller og så videre. Stole og måtter står bag gardinet, puder og tæpper ligger sammenfoldet på hylden.
- Opvasken tager du med dig eller sætter i opvaskemaskinen. Er maskinen mere end halvt fuld, så sæt den i gang (tabs står under køkkenvasken). Har du dagens sidste booking, så sæt den altid i gang.

## Rengøring
- Køkkenet skal altid se ud som før – tør bordene over.
- Håndvaske og toiletter skal altid tørres af med rengøringsservietter.
- Gulvet skal altid fejes med tørmoppen.
- Skraldespandene tømmes, når de er halvt fulde, og der sættes nye poser i.

## Rengøringsmidler og affald
Støvsuger, rengøringsservietter, klude og rengøringsmidler står i gangen ved toiletterne. Affald kan smides i containeren bag træporten til højre for enden af bygningen eller i containeren på Guldsmedgade.

Er rengøringen ikke i orden, opkræver vi et rengøringsgebyr på 250 kr.`,
    sources: []
  },
  {
    path: "/brug-hjerterum/wifi", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Wifi", em: "& praktiske detaljer",
    lead: "Internet, adresse og hvem du kontakter, hvis noget går galt.",
    description: "Wifi og praktiske detaljer i Hjerterum: trådløst internet, adressen og hvem du kontakter ved akutte problemer.",
    card: { title: "WiFi & praktiske detaljer", text: "Internet, adresse og akut kontakt." },
    body: `## Trådløst internet
Netværksnavn og kode får du sammen med din booking – eller spørg os.

## Adressen
Hjerterum, Guldsmedgade 26B, st., 8000 Aarhus C. Indgangen er ved gitterlågen i Guldsmedgade – se [adgang og nøgle](/brug-hjerterum/adgang).

## Hvis noget går galt
Skriv til [Hjerterums Messenger-side](https://www.facebook.com/share/1BNdSQTGWU/?mibextid=wwXIfr) ved akutte henvendelser, der kræver hurtigt svar, og skriv gerne dit telefonnummer, så kontakter vi dig hurtigst muligt. Alt andet går til [team@hjerterum.info](mailto:team@hjerterum.info) – se [kommunikation](/brug-hjerterum/vilkaar#kommunikation).`,
    sources: []
  },
  {
    path: "/brug-hjerterum/husregler", lang: "da", section: "lej",
    kicker: "Praktisk information", title: "Husregler", em: "& hensyn",
    lead: "Vi deler huset og gården med naboerne – og passer på hinandens tryghed.",
    description: "Husregler i Hjerterum: høj musik, gården og naboerne, foto og video, og ansvar ved events.",
    card: { title: "Husregler & hensyn", text: "Musik, gården, foto og video, og ansvar." },
    body: `## Høj musik og lyd
Hold vinduer og dør lukket, hvis du bruger høj musik, trommer og lignende – og luft gerne ud i pauserne. Vi tager hensyn til naboerne.

## Gården
Vi deler gården med naboerne. Hold derfor dine deltagere nær Hjerterums hoveddør, og undgå længere pauser og høj larm i gården. Korte pauser på 10 minutter til frisk luft eller en smøg er selvfølgelig fint – så er der plads til alle.

## Foto og video
${PHOTO_POLICY}

## Ansvar
${DISCLAIMER}`,
    sources: []
  },

  // Eventguides & PR
  {
    path: "/brug-hjerterum/eventguides", lang: "da", section: "lej",
    kicker: "Brug Hjerterum", title: "Eventguides", em: "& PR",
    lead: "Fra idé til event i kalenderen: sådan kommer du i gang, laver dit billede, når ud til flere – og ændrer eller aflyser.",
    description: "Guides til dit event i Hjerterum: kom godt i gang, Facebook-begivenhed, eventbillede, markedsføring, ændring og aflysning.",
    card: { title: "Eventguides & PR", text: "Fra idé til event – og ud til flere." },
    body: `Har du ønsker eller idéer til indhold, så skriv til [team@hjerterum.info](mailto:team@hjerterum.info).`,
    children: ["/brug-hjerterum/kom-i-gang", "/brug-hjerterum/facebook", "/brug-hjerterum/eventbillede", "/brug-hjerterum/markedsfoering", "/brug-hjerterum/aendr-event", "/brug-hjerterum/aflys-event"],
    sources: []
  },
  {
    path: "/brug-hjerterum/kom-i-gang", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Kom godt", em: "i gang",
    lead: "Sådan får du dit event i Hjerterums kalender – trin for trin.",
    description: "Kom godt i gang med dit event i Hjerterum: vælg lejetype, find en dato, book og få dit event i kalenderen.",
    card: { title: "Kom godt i gang", text: "Fra idé til event i kalenderen, trin for trin." },
    body: `1. **Vælg, hvordan du lejer.** Standardpris for alle – eller, hvis du er medlem, med medlemsrabat eller helt gratis. Se [lejepriser](/brug-hjerterum/lejepriser#priser).
2. **Find en dato.** Tjek [kalenderen](/events), og planlæg gerne 4–8 uger før.
3. **Book.**
   - Er du medlem, opretter du selv dit event på [medlemssiden](https://medlem.hjerterum.info/member-portal/events) – Saga hjælper dig. Alle medlemsoprettede events skal først godkendes af Hjerterums team.
   - Ved standardpris sender du en bookingforespørgsel med [det, vi skal bruge](/brug-hjerterum/lejepriser#materiale).
4. **Lav et godt eventbillede.** Se [eventbillede og grafik](/brug-hjerterum/eventbillede).
5. **Vi bekræfter.** Ved standardpris får du en faktura, og når den er betalt, lægger vi eventet på hjemmesiden og Facebook (op til ca. 5 hverdage).
6. **Del dit event.** [Opret det på Facebook](/brug-hjerterum/facebook), og [nå endnu længere ud](/brug-hjerterum/markedsfoering).

Du står selv for at planlægge og afvikle eventet, men vores frivillige giver gerne en hånd. Læs [det praktiske](/brug-hjerterum/praktisk), før du kommer.`,
    sources: []
  },
  {
    path: "/brug-hjerterum/facebook", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Opret", em: "Facebook-begivenhed",
    lead: "Vi lægger dit event på Hjerterums Facebook-side. Har du din egen side, kan du også oprette det dér.",
    description: "Sådan opretter du en Facebook-begivenhed for dit event i Hjerterum og sender os linket.",
    card: { title: "Opret Facebook-begivenhed", text: "Sådan opretter du eventet på din egen Facebook-side." },
    body: `Når din booking er bekræftet, lægger vi dit event på Hjerterums hjemmeside og Facebook-side. Har du en Facebook-side, så opret gerne eventet dér også, og send os linket.

## Sådan gør du
1. Gå til din Facebook-side, og vælg at oprette en begivenhed.
2. Giv den samme titel, dato og tidspunkt som dit event i Hjerterum.
3. Skriv stedet: Hjerterum, Guldsmedgade 26B, st., 8000 Aarhus C.
4. Brug samme eventtekst og [coverbillede](/brug-hjerterum/eventbillede) som til Hjerterum.
5. Skriv, hvor man tilmelder sig – på Hjerterums hjemmeside eller direkte hos dig.
6. Offentliggør begivenheden, og send linket til [Hjerterums Messenger-side](https://www.facebook.com/share/1BNdSQTGWU/?mibextid=wwXIfr), som bruges til PR-materiale for allerede oprettede events.

Vil du nå endnu længere ud, så se [markedsføring af dit event](/brug-hjerterum/markedsfoering).`,
    sources: []
  },
  {
    path: "/brug-hjerterum/eventbillede", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Eventbillede", em: "& grafik",
    lead: "Et godt coverbillede er det første, folk ser. Sådan skal det være.",
    description: "Eventbillede til dit event i Hjerterum: format 1920 × 1005 px, jpg eller png, uden ophavsret – og hvor du finder billeder.",
    card: { title: "Eventbillede & grafik", text: "Format, rettigheder og hvor du finder billeder." },
    body: `## Coverbilledet
- **Format:** 1920 × 1005 px, jpg eller png
- **Rettigheder:** uden ophavsret – du skal have lov til at bruge billedet
- **Gerne ikke AI:** brug helst rigtige billeder

## Hvor finder jeg billeder?
- Gratis billeder: [unsplash.com](https://unsplash.com)
- Opsætning med tekst og grafik: [canva.com](https://www.canva.com)

## Opretter du dit event som medlem?
Så uploader du billedet, når du opretter eventet på [medlemssiden](https://medlem.hjerterum.info/member-portal/events), og Saga tjekker format, opløsning og kvalitet.

Billeder fra selve eventet er gode til at dele bagefter – men husk [reglerne for foto og video](/brug-hjerterum/husregler).`,
    sources: []
  },
  {
    path: "/brug-hjerterum/markedsfoering", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Markedsføring", em: "af dit event",
    lead: "Dit event bliver vist på vores hjemmeside og Facebook-side med over 6.000 følgere. Her er, hvordan du når endnu længere ud.",
    description: "Sådan markedsfører du dit event i Hjerterum – med en liste over relevante Facebook-grupper.",
    card: { title: "Markedsføring af dit event", text: "Råd og en liste over relevante Facebook-grupper." },
    body: `Når du booker Hjerterum, får dit event automatisk en god eksponering: det bliver offentliggjort både på vores hjemmeside og på vores Facebook-side, som har over 6.000 følgere.

Vil du nå endnu længere ud, er det dit eget ansvar. En effektiv måde er at købe annoncer på Facebook. Du kan også invitere dit netværk og dele dit event i relevante grupper på Facebook. Her er vores forslag – læs altid gruppens retningslinjer, før du deler, så du er sikker på, at dit event passer ind.

${FACEBOOK_GROUPS}`,
    sources: ["markedsforing"]
  },
  {
    path: "/brug-hjerterum/aendr-event", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Ændr", em: "dit event",
    lead: "Ret titel, tekst, tidspunkt eller pris – og se, hvor mange der er tilmeldt.",
    description: "Sådan ændrer du dit event i Hjerterum og ser dine deltagere i medlemsområdet.",
    card: { title: "Ændr dit event", text: "Ret dit event, og se dine deltagere." },
    body: `Events, du har oprettet i medlemsområdet, administrerer du samme sted:

1. Log ind i [medlemsområdet](/member-portal/events).
2. Vælg **Mine events**.
3. Her ser du dine kommende events, hvor mange der er tilmeldt, og om eventet er godkendt.
4. Vælg **Redigér** for at rette titel, tekst, tidspunkt eller pris.

Har du booket til standardpris, så skriv til [team@hjerterum.info](mailto:team@hjerterum.info), hvis noget skal ændres.

## Events i den tidligere kalender
Events, der er oprettet i den tidligere kalender på holistisk.org, administrerer du stadig dér: log ind, åbn dit event i kalenderen, vælg **Admin** over eventets billede og derefter **Dashboard** for at se dine deltagere og rette eventet. [Se videovejledningen](https://www.youtube.com/watch?v=aKVv_aVjuTA).`,
    sources: ["administrer-dine-events"]
  },
  {
    path: "/brug-hjerterum/aflys-event", lang: "da", section: "lej",
    kicker: "Eventguides & PR", title: "Aflys", em: "dit event",
    lead: "Sådan aflyser du – og hvad det koster.",
    description: "Sådan aflyser du dit event i Hjerterum: i medlemsområdet, i sidste øjeblik, og hvad du får tilbage.",
    card: { title: "Aflys dit event", text: "Sådan aflyser du, og hvad det koster." },
    body: `## Sådan aflyser du
1. Log ind i [medlemsområdet](/member-portal/events), og vælg **Mine events**.
2. Vælg **Annullér event** ved det event, du vil aflyse.
3. Send altid en mail til [team@hjerterum.info](mailto:team@hjerterum.info) om, at du har aflyst.

## Hvad koster det?
Hjerterum beholder altid grundprisen, og hvor meget af resten du får tilbage, afhænger af, hvor længe før du aflyser. Se [reglerne for aflysning](/brug-hjerterum/vilkaar#aflysning).

## Aflysning i sidste øjeblik
Aflysning i sidste øjeblik koster et gebyr på 250 kr. Du undgår gebyret ved at aflyse senest dagen før kl. 14.00.

Bliver du forhindret i sidste øjeblik, kan du selv aflyse dit event og dermed spare gebyret. Muligheden må kun bruges ved aflysninger i sidste øjeblik – ikke ved almindelige aflysninger. [Se guiden til aflysning](https://docs.google.com/document/d/1Z_eatceSFqqgWLqFq0AEqWP2fce0wayFvvHKr3YZWzA/edit?usp=sharing).`,
    sources: []
  },
  // ---------------------------------------------------------------- Om Hjerterum (/om-os)
  {
    path: "/om-os", lang: "da", section: "om-os", menu: "Hvad er Hjerterum?",
    kicker: "Om Hjerterum", title: "Mere nærvær.", em: "Mindre støj.",
    lead: "Hjerterum er skabt omkring troen på, at de bedste oplevelser vokser frem, når mennesker mødes med åbenhed og tid. Vi samler foredrag, behandlinger, musik, samtaler og små pauser i hverdagen – i et rum, hvor man må komme, som man er.",
    description: "Hvad er Hjerterum? Visionen, teamet, historien og foreningen.",
    card: { title: "Mere nærvær. Mindre støj.", text: "Visionen, menneskene og historien bag Hjerterum." },
    body: `## Hvad er Hjerterum?
Lad os starte med at sige, hvad vi **ikke** er:

- Ikke et sted med færdige svar eller quick fixes.
- Ikke en lukket gruppe eller sekt.
- Ikke bundet til én bestemt tro, religion eller politisk holdning.
- Ikke et sted uden plads til humor og lethed.

**Hjerterum er for alle.** Hjerterum er et åbent og trygt rum for fællesskab, kreativitet og personlig udvikling. Her kan du deltage i en masse nærende og meningsfulde events – fx foredrag, koncerter, yoga, breathwork, workshops og sociale arrangementer. Er du underviser eller facilitator, er du altid velkommen til at [bruge vores sted](/brug-hjerterum).

Uanset om du søger ro, inspiration eller nye bekendtskaber, er du velkommen. Vi tror på, at god energi og åbenhed skaber gode møder – mellem mennesker og med sig selv.

Velkommen til et sted, der **giver plads til at være** ♡

## Formandens beretning 2026 {#beretning}
> „Ti år er lang tid. Mere end 4.000 arrangementer er mange møder mellem mennesker. Hvis Hjerterum har gjort en forskel i bare en del af de menneskers liv, der har været her, så har vi skabt noget, der er større end det, vi kan gøre op i kroner og øre."
>
> Jacob Hauge, formand – generalforsamlingen 14. oktober 2026. [Læs hele beretningen →](/om-os/formandens-beretning)

## En forening
Hjerterum er en forening, Hjerterum F.M.B.A., som drives af medlemmernes kontingent, leje af salen og donationer – og af et team af ildsjæle. [Læs om foreningen, vedtægterne og generalforsamlingen](/om-os/foreningen).

## Vil du samarbejde med Hjerterum? {#samarbejde}
Har du en idé til et samarbejde – som forening, virksomhed, kunstner eller underviser – hører vi gerne fra dig.

{{enquiry-samarbejde}}`,
    image: { src: "/media/2026-06-vision.webp", alt: "Drømmefanger i sollys" },
    children: ["/behandlere", "/om-os/teamet", "/om-os/historien", "/om-os/foreningen", "/om-os/formandens-beretning"],
    sources: ["vision"]
  },
  {
    path: "/om-os/teamet", lang: "da", section: "om-os",
    kicker: "Om Hjerterum", title: "Teamet", em: "bag Hjerterum",
    lead: "Foreningen Hjerterum ledes af et team af dedikerede ildsjæle, der samtidig udgør bestyrelsen.",
    description: "Mød bestyrelsen og teamet bag Hjerterum i Aarhus – og hvordan vi arbejder.",
    card: { title: "Teamet bag", text: "Bestyrelsen, og hvordan vi arbejder." },
    body: `## Bestyrelsen
{{board}}

For vores ansatte stopper engagementet sjældent ved de faste timetal. De lægger ofte ekstra frivillige timer, fordi de brænder for Hjerterum og fællesskabet.

## En flad struktur
Vi har bevidst valgt en flad struktur. Det betyder, at vi alle – ansatte og frivillige – deler ansvaret for, at tingene fungerer. Der er ingen chef i traditionel forstand; vi løfter opgaverne i flok, med forskellige roller og opgaver. Det er den struktur, vi tror på, fordi den passer til Hjerterums ånd og værdier.

## Sådan arbejder vi i dag
Hjerterum drives i dag med færre arbejdstimer end tidligere. Derfor står undervisere og arrangører i højere grad selv for forberedelsen. Skriver du til os, kan du forvente svar inden for 3–5 hverdage.

Når du vil booke et event, er det vigtigt, at du

- har konkrete forslag til dato og tidspunkt
- har tekst og coverbillede klar (eller et godt billede – helst ikke AI)
- følger de guides, du får tilsendt
- orienterer dig her på hjemmesiden, hvor mange svar allerede findes

Jo bedre forberedt materialet er, desto nemmere kan vi finde tider og oprette events – og desto flere bookinger kan vi nå.

## Vores fælles mål
At Hjerterum ledes professionelt og med hjerte – så Hjerterum trives bedst muligt ♡

[Kontakt os](/kontakt)`,
    sources: ["teamet"]
  },
  {
    // Requested: "Tilføj en rubrik med Formandens beretning that links to the full speech" - "Om Hjerterum". The chair's report to the general assembly, as he gave it.
    path: "/om-os/formandens-beretning", lang: "da", section: "om-os", article: true,
    kicker: "Om Hjerterum", title: "Formandens beretning", em: "2026",
    lead: "Jacob Hauges beretning til generalforsamlingen 14. oktober 2026 – om ti år med Hjerterum, året der gik, og det næste kapitel, vi skal skrive sammen.",
    description: "Formandens beretning til Hjerterums generalforsamling 14. oktober 2026.",
    card: { title: "Formandens beretning 2026", text: "Ti år med Hjerterum, året der gik, og det næste kapitel." },
    body: `Kære alle sammen.

Hjerterum har faktisk eksisteret i ti år nu.

Når jeg tænker over det, bliver jeg både ydmyg og taknemmelig. Gennem årene har der været mere end 4.000 events her i huset og de 3 hjem vi havde før dette. Mange medarbejdere, bestyrelsesmedlemmer og frivillige har lagt tid, idéer og hjerte i at skabe stedet. Og mennesker er kommet ind ad døren og har fundet fællesskaber, inspiration og måske en lettere måde at være sig selv på.

Nogle har været her én gang. Andre har været her i årevis. Og vi er her stadig. Det synes jeg er værd at standse op ved.

Hjerterum har ikke altid haft en stærk økonomi, og vi har ikke altid haft alle svarene. Men der har igen og igen været mennesker, som troede på stedet og bidrog til, at huset kunne eksistere.

Nogle gange tænker jeg, at der måske er nogen, der passer lidt på Hjerterum. At den ubeskrivelige følelse jeg havde da det første fundament blev lagt i 2017 - en vild oplevelse af usynlige og også synlige væsener, der bakkede op og som gjorde første version af Hjerterum ikke bare lige muligt, men jeg havde en utrolig oplevelse af rygstøtte og at dette er ikke bare muligt, men MEANT TO BE!

Og måske skal vi også selv huske at gøre det. Ikke ved at lade stå til, men ved at udvikle Hjerterum og samtidig passe på det, der gør stedet til Hjerterum.

For mig er det blevet et af de vigtigste spørgsmål i mit første år som formand: Hvordan sikrer vi, at Hjerterum også er her om ti år, uden at miste det, der gjorde stedet værdifuldt i første omgang? Det spørgsmål har været den røde tråd i bestyrelsens arbejde.

For omkring et år siden begyndte et nyt kapitel. Soroush overdrog stafetten, en ny bestyrelse kom til, og jeg blev formand igen. Vi fik også et fantastisk og velfungerende team!

Når roller skifter, er der noget, der skal gives videre, noget der skal bevares, og noget der skal have lov til at ændre sig. Vi har brugt en stor del af året på at se på økonomi, priser, medlemskaber, arbejdsgange og identitet.

Vi har spurgt os selv: Hvem er Hjerterum? Hvad vil vi gerne stå for? Hvem vil vi gerne tiltrække?

Hvordan kan vi blive ved med at eksistere uden at slide de mennesker op, som får huset til at fungere?

Det har været et år med oprydning og professionalisering, men også med gode samtaler og sjove øjeblikke. Jeg er taknemmelig for samarbejdet. Vi har haft meget få konflikter, og når vi har været uenige, har vi kunnet tale om tingene og finde løsninger. Det betyder noget, at fællesskab og menneskelighed også kan mærkes i den måde, vi arbejder sammen på.

En vigtig del af arbejdet har handlet om arbejdsgangene. Hvordan skaber vi rammer, hvor engagement ikke bliver til overbelastning, og hvor mennesker kan holde til at blive ved? Hjerterum må ikke bygge på, at mennesker giver mere af selv end de kan holde til, selvom de måske godt synes de kan i en periode. Vi skal passe på Hjerterum, og det betyder også, at vi skal passe på de mennesker, der hver dag er med til at holde huset levende.

I løbet af sommeren blev vi konfronteret med en økonomisk situation, der krævede handling. Medarbejdernes timetal blev sat ned, og de reducerede timer er foreløbig fastholdt. Det var ikke et mål i sig selv, men en nødvendig reaktion på situationen. Det understreger, hvor vigtigt det er, at vi har et realistisk blik på vores økonomi og vores ressourcer.

Vi har set grundigt på priserne. Jeg kommer selv fra en mere kommerciel og virksomhedsorienteret arbejdskultur, så i begyndelsen undrede jeg mig over, hvor billigt det var at bruge Hjerterums lokaler. Jeg tænkte lidt hardcore og tunnelsynet at nu skal vi tage en pris, der afspejler den værdi, huset tilbyder. Det mener jeg egentlig stadig.

Men jeg har også lært noget siden: at Hjerterum er et sted, man kan have brug for på forskellige tidspunkter i livet. Nogle har ikke mange penge mellem hænderne, selvom behovet for fællesskab og nye forbindelser er stort. Jeg kan godt lide tanken om, at Hjerterum ikke behøver at være en stor, kommerciel organisation for at være en succes. Vi må gerne være professionelle og økonomisk ansvarlige, samtidig med at det fortsat er muligt at være med.

Derfor arbejder vi med en tydeligere model for lokaleleje, der skelner mellem A- og B-tid. Når et arrangement er gratis for medlemmerne, kan lokalet stilles gratis til rådighed efter de gældende vilkår. I A-tid gives der 25 procent rabat.

Vi tilbyder også indimellem en gratis prøveperiode på medlemskabet i 30 dage for at se om vi kan få nye sjæle med ombord.

Målet er ikke bare at gøre alting dyrere eller billigere. Vi forsøger at finde en model, hvor økonomien kan hænge sammen, og Hjerterum fortsat er tilgængeligt. Vi har taget et skridt mod større gennemsigtighed, men vi skal blive ved med at følge, hvordan det virker i praksis.

Vi har arbejdet med medlemsmodellerne og med, hvordan vi både gør medlemskabet attraktivt og giver plads til forskellige økonomiske vilkår.

Et medlemskab handler ikke kun om indtægter. Det handler også om, hvem vi inviterer indenfor, og hvilke fællesskaber vi gør mulige. Vi må samtidig erkende, at medlemstallet fortsat ligger nogenlunde stabilt. Hvis Hjerterum er så særligt, som vi oplever, hvorfor er der så ikke flere, der bliver medlemmer? Måske skal vi blive bedre til at fortælle, hvem vi er, og hvad man får ud af at være en del af huset.

Vi ved fra tilbagemeldinger, at Hjerterum har haft betydning for mange. Mennesker har fundet nye forbindelser, fællesskaber og plads til at udforske nye sider af sig selv. Men vi kan ikke regne med, at alle i Aarhus ved, at Hjerterum findes, eller hvad det kan betyde. Så markedsføring er noget af det vi vil satse endnu mere på i den kommende tid.

Fundraising-weekenden viste også, hvad opbakning kan føre til. Den gav et overskud på cirka 8.000 til 8.500 kroner. Det er et konkret bidrag til økonomien, og samtidig et tegn på, at mennesker har lyst til at engagere sig og hjælpe med at holde stedet levende.

Hjerterums værdi kan ikke kun aflæses i et regnskab. Men den skal kunne holde til at møde virkeligheden i et regnskab. Det er den balance, vi skal finde: at tage økonomien alvorligt uden at gøre penge til det vigtigste, og at skabe struktur uden at fjerne det frie og menneskelige.

En af de store opgaver, vi arbejder videre med, er et nyt digitalt system og Hjerterums digitale hjem på hjerterum.info. Det er stadig under udvikling. Målet er lancering indenfor de næste måneder.

Det handler ikke kun om teknik. Vi har stadig timer, hvor salen står tom, samtidig med at medlemmer og brugere har idéer og lyst til at skabe noget. Ambitionen er at gøre vejen fra idé til arrangement langt kortere og mindske ventetiden på at få sit event op og ud til omverdenen.

Tanken er, at man på den nye hjemmeside kan betjene sig selv langt mere og bedre. Man kommer til at kunne se ledige tider i salen og oprette et arrangement og arbejde med tekst, billede og praktiske oplysninger på egen hånd - fra ide til event der ligger i kalenderen. Fra medlemssiden kan man holde øje med tilmeldinger. Og planen er at der også kan ske en automatisk udbetaling efter eventet er færdigt.

I princippet vil man kunne komme live med sit event på et kvarter.

Saga er tænkt som en digital assistent, der skal hjælpe med at formulere teksten, kontrollere billedet og gennemgå arrangementet - passer dette event til Hjerterum? Møder det Hjerterums fundamentale krav?, inden det offentliggøres.

Hvis man ikke selv kan stå for oprettelsen, skal teamet fortsat kunne hjælpe mod et mindre gebyr. Vi arbejder også på profiler for behandlere og undervisere og et bedre overblik for medlemmer over deres medlemskab og besparelser.

Vi vil gerne flytte Hjerterum fra kun at være et sted, man kommer og deltager, til også at være et sted, man selv er med til at skabe. Fra medlem til medlem. Vi kan stille rammerne til rådighed og gøre det lettere at bruge huset, men vi kan og skal som bestyrelse ikke alene skabe det liv, der skal fylde det.

Det liv kommer fra jer.

Fra jeres idéer, interesser, faglighed og lyst til at mødes. Måske har du længe haft en idé til en workshop, en gruppe, en koncert eller noget helt andet. Jeg håber, at det kommende system vil gøre det lettere at komme i gang.

På generalforsamlingen skal vi også have valgt nye suppleanter. Jeg håber, at flere har lyst til at tage del i ansvaret for Hjerterums fremtid. Hjerterum er ikke kun bestyrelsens eller medarbejdernes ansvar. Det er et fællesskab, som kun kan eksistere, hvis mennesker bliver ved med at tage del i det.

Når jeg ser tilbage på året, er jeg først og fremmest taknemmelig. For arbejdet, samarbejdet, de ærlige samtaler og viljen til at finde løsninger, også når de ikke er enkle. Og for, at vi stadig har et sted, hvor mennesker kan mødes, finde hinanden og måske opdage nye sider af sig selv.

Jeg ved ikke præcis, hvordan Hjerterum ser ud om ti år. Men jeg håber, at det stadig er et sted, hvor man kan komme, som man er, og finde fællesskab og nye muligheder. Et sted, der er økonomisk bæredygtigt uden at blive utilgængeligt.

Måske behøver Hjerterum ikke at blive noget helt andet for at lykkes. Måske skal vi først og fremmest blive bedre til at forstå, hvad vi er, og tage ansvar for at passe på det.

Ti år er lang tid. Mere end 4.000 arrangementer er mange møder mellem mennesker. Hvis Hjerterum har gjort en forskel i bare en del af de menneskers liv, der har været her, så har vi skabt noget, der er større end det, vi kan gøre op i kroner og øre.

Det forpligter os, men det giver os også en god grund til at fortsætte.

Tak for jeres tillid, jeres engagement og jeres bidrag til Hjerterum. Jeg glæder mig til det næste kapitel, vi skal skrive sammen.

*Jacob Hauge, formand for Hjerterum – generalforsamlingen 14. oktober 2026*`,
    sources: []
  },
  {
    path: "/om-os/historien", lang: "da", section: "om-os",
    kicker: "Om Hjerterum", title: "Historien", em: "bag Hjerterum",
    lead: "Det begyndte i et lille lydstudie på Karupvej i 2016. I dag holder vi til i en stille gård bag Guldsmedgade.",
    description: "Historien om Hjerterum i Aarhus fra 2016 til i dag.",
    card: { title: "Historien bag Hjerterum", text: "Fra et lydstudie på Karupvej til Guldsmedgade." },
    // Requested: "optimere denne tekst så den bliver mere uformel og varm, og mindre AI" - the same facts, in plainer words.
    body: `Bag Guldsmedgade i Aarhus ligger Hjerterum: et sted, hvor du kan sænke skuldrene, lade facaden falde og bare være dig. Men sådan startede det ikke.

## 2016 – Et lydstudie, der var for stille
I efteråret 2016 sad Jacob Hauge i sit lille lydstudie på Karupvej. Der var kabler og mikrofoner overalt, og musikken var god – men rummet føltes tomt. Han savnede mennesker. Og ud af det voksede en idé: et sted, hvor folk kunne mødes, øve sig, dele og være sammen. Et hjem for hjertet.

## 2017 – To med samme drøm
Til et julearrangement mødte han Sophia Hasselbjørn, som gik med en lignende drøm. De slog pjalterne sammen, og allerede i januar 2017 åbnede dørene. De første arrangementer var fyldt med smil, nysgerrighed og lyst til fællesskab.

## Flere kom til
Efter et halvt år gik Sophia videre, og Celina Eyja blev vores første lønnede medarbejder. Aurora Gayatri begyndte at bruge det lille behandlerlokale – og hun kom til at betyde rigtig meget for, hvordan Hjerterum voksede.

## 2018 – Mere plads
I 2018 flyttede vi til Frichsparken. Her fik vi fem behandlerlokaler og en stor sal. Aurora og Marlene Solfred blev en del af teamet. Der var praktiske og økonomiske bump på vejen, men fællesskabet holdt, og vi fandt løsninger.

## 2019 – Mejlgade
I 2019 flyttede Hjerterum til Mejlgade 95, og fokus kom igen på arrangementer og fællesskab. Teamet var nu Aurora, Douglas Crawford, Mariam Gabriella, Jan Gabriel og Jacob. I sommeren 2020 måtte Jacob trække sig på grund af stress. Aurora blev forkvinde og daglig leder, og Soroush Zand kom til som kasserer. Samme år holdt vi online events, så vi kunne ses under nedlukningen.

![Salen på Mejlgade 95 i 2019](/media/2019-08-hc-sal-1-800-photo.webp "Salen på Mejlgade 95 i 2019.")

## 2021 – Guldsmedgade
I starten af 2021 fandt vi vores nuværende hjem på Guldsmedgade: midt i byen, men stille, gemt væk i en gård. Soroush blev konstitueret leder i 2024 og overtog ledelsen fra Aurora i starten af 2025. I efteråret 2026 kom Jacob tilbage som formand.

## Og nu?
Hjerterum er ikke bare et center. Det er et sted, der lever af de mennesker, der kommer her – hvor der er plads til dig, som du er, og hvor du kan finde vej både ind i dig selv og ud i fællesskabet ♡`,
    sources: ["historien-bag-hjerterum"]
  },
  {
    path: "/om-os/foreningen", lang: "da", section: "om-os",
    kicker: "Om Hjerterum", title: "Foreningen", em: "Hjerterum",
    lead: "Hjerterum F.M.B.A. er en forening med generalforsamling, vedtægter og en bestyrelse valgt af medlemmerne. Her finder du referater, budgetter, nyhedsbreve og vedtægter.",
    description: "Foreningen Hjerterum F.M.B.A.: generalforsamling, referater, budget, nyhedsbreve og vedtægter.",
    card: { title: "Foreningen", text: "Generalforsamling, dokumenter, nyhedsbreve og vedtægter." },
    body: `## Generalforsamling og møder {#generalforsamling}
Generalforsamlingen er foreningens højeste myndighed. Den holdes én gang om året inden udgangen af september, og alle betalende medlemmer kan deltage, stemme og stille op.

- [Referat af ekstraordinær generalforsamling 30. oktober 2025](/dokumenter/2025-11-referat-af-ekstraordinaer-generalforsamling-30-oktober-2025.pdf)
- [Dagsordener og referater 2025–26](/dokumenter/2025-10-dagsordener-referater-2025-26-1.pdf)
- [Resultatopgørelse 2024](/dokumenter/2025-10-resultatopgorelse-2024.pdf)
- [Driftsbudget for Hjerterum 2025](/dokumenter/2025-06-driftsbudget-hjerterum-2025.pdf)
- [Referat af ekstraordinær generalforsamling 9. juni 2025](/dokumenter/2025-06-referat-af-ekstraordinaer-generalforsamling-69-2025.pdf)
- [Forretningsorden 2025/26](/dokumenter/2025-05-forretningsorden-20256.pdf)
- [Referat af generalforsamling 21. januar 2025 inkl. årsberetning og nye vedtægter](/dokumenter/2025-02-referat-fra-generalforsamling-21012025-inkl-arsberetning-og-nye-vedtaegter.pdf)

## Nyhedsbreve {#nyhedsbreve}
{{newsletter}}

Tidligere nyhedsbreve:

- [Vinter 2024/2025](https://mailchi.mp/80f0f488dbef/nyhedsbrev-februar-10908825)
- [Efterår 2024](/dokumenter/2024-10-efterar-i-hjerterum.pdf)
- [April 2023](https://mailchi.mp/1915c79665db/nyhedsbrev-februar-8120551)
- [Marts 2023](https://mailchi.mp/5b25091def33/nyhedsbrev-februar-8117663)

## Vedtægter {#vedtaegter}
+++ Læs vedtægterne for Hjerterum F.M.B.A. (opdateret 21. januar 2025)
${statutesMarkdown(STATUTES)}
+++`,
    gallery: {
      title: "Fra nyhedsbrevene",
      pictures: [
        { src: "/media/2025-02-ef88165c-bdc6-b2d2-3a45-ed41df03ba7e.webp", alt: "Vinter i Hjerterum – levende lys" },
        { src: "/media/2024-10-46158d74-18bd-6953-aff5-73484d2d851a.webp", alt: "Efterår i Hjerterum" },
        { src: "/media/2023-04-flowers.webp", alt: "Forårsblomster" },
        { src: "/media/2023-03-dafs.webp", alt: "Påskeliljer" }
      ]
    },
    sources: ["generalforsamling-general-assembly", "nyhedsbrev"]
  },

  // ---------------------------------------------------------------- Kontakt
  {
    // Requested: "Gem besøg i 6 måneder, og slet dem derefter automatisk. Nævn det i privatlivsteksten." (worker/site-stats.ts)
    path: "/privatliv", lang: "da", section: "om-os",
    kicker: "Privatlivspolitik", title: "Sådan passer vi på", em: "dine oplysninger",
    lead: "Hvilke oplysninger Hjerterum har om dig, hvorfor, hvem der hjælper os med dem, og hvad du kan bede os om.",
    description: "Hjerterums privatlivspolitik: medlemskab, events, booking, Saga, nyhedsbrev, besøgsstatistik uden cookies og dine rettigheder.",
    card: { title: "Privatlivspolitik", text: "Dine oplysninger og dine rettigheder." },
    body: `## Dataansvarlig {#ansvarlig}
Hjerterum F.M.B.A., CVR 40827692, Guldsmedgade 26B, st., 8000 Aarhus C. Skriv til [team@hjerterum.info](mailto:team@hjerterum.info) om alt, der handler om dine oplysninger.

## Når du er medlem {#medlem}
Vi har dit navn, din e-mail, dit medlemskab (type, start og betalinger) og - hvis du selv skriver dem - dit telefonnummer og din fødselsdag. Vi bruger dem til at administrere medlemskabet, give dig adgang til medlemssiden og sende dig besked om dit medlemskab. Grundlaget er medlemsaftalen med dig. Når du melder dig ud, sletter vi dine oplysninger, når vi ikke længere skal bruge dem - regnskabsoplysninger gemmer vi i 5 år efter regnskabsårets udløb, som bogføringsloven kræver.

## Events, booking og visitkort {#events}
Tilmelder du dig et event, gemmer vi din tilmelding, så arrangøren og Hjerterum ved, hvem der kommer. Opretter du et event eller lejer salen, gemmer vi eventet, tidspunkterne, lejen og de filer og billeder, du lægger op. Godkendte events og deres billeder vises offentligt. Laver du et visitkort, vises det offentligt, når du selv vælger at offentliggøre det, og du kan til enhver tid tage det ned igen.

## Saga - vores digitale assistent {#saga}
Skriver du med Saga på medlemssiden, eller sender du et foto til hende, behandles beskeden af en AI-model hos vores leverandør i EU for at give dig et svar. Samtalen bruges ikke til at træne modellen. Skriv ikke følsomme oplysninger til Saga.

${HENVENDELSER}

## Nyhedsbrev {#nyhedsbrev}
Tilmelder du dig nyhedsbrevet, får vi dit navn og din e-mail gennem Mailchimp. Du kan altid framelde dig med linket nederst i hvert nyhedsbrev.

## Dem, der hjælper os {#databehandlere}
Vi bruger leverandører (databehandlere), som kun må bruge oplysningerne efter vores anvisning: Cloudflare (hjemmeside, medlemsside og database), Clerk (login), Stripe (betaling, når den er slået til), Mailchimp (nyhedsbrev), One.com (mail) og en AI-tjeneste i EU (Saga). Ligger en leverandør uden for EU, sker overførslen på grundlag af EU-Kommissionens standardkontraktbestemmelser eller EU-U.S. Data Privacy Framework.

## Besøgsstatistik uden cookies {#statistik}
Når du ser en side på hjemmesiden, sender din browser et lille signal om, hvilken side det var. Vi bruger ingen cookies og gemmer intet i din browser.

## Det gemmer vi
- hvilken side du så, og hvilken dag
- for den første side, du ser på en dag: hvilken hjemmeside du kom fra (kun dens navn, fx google.com) og en eventuel kampagne (utm-mærkerne i linket)
- om du bruger mobil, tablet eller computer, og hvilket land besøget kom fra

## Det gemmer vi ikke
Vi gemmer ikke din IP-adresse. For at kunne tælle dig én gang pr. dag laver vi en kode ud fra din IP-adresse, din browser og hjemmesidens adresse sammen med en hemmelig nøgle, der skifter hver dag. Koden kan ikke føres tilbage til dig, og den er ny hver dag, så ingen kan følge dig fra dag til dag.

Har din browser Global Privacy Control slået til, tæller vi slet ikke dit besøg. Login, medlemsområdet og administrationen tælles heller ikke.

## Hvem ser tallene, og hvor længe gemmes de {#sletning}
Tallene bruges kun samlet – fx hvor mange besøgende en side havde – af bestyrelsen og Hjerterums administration. **Besøg og optællingen af henvendelser slettes automatisk efter 6 måneder.**

## Dine rettigheder {#rettigheder}
Du kan bede om at se de oplysninger, vi har om dig, få dem rettet eller slettet, få dem udleveret, eller gøre indsigelse mod, at vi bruger dem. Skriv til [team@hjerterum.info](mailto:team@hjerterum.info). Er du utilfreds med, hvordan vi behandler dine oplysninger, kan du klage til [Datatilsynet](https://www.datatilsynet.dk).

Se også [cookies](/cookies) og [handelsbetingelser](/handelsbetingelser).`,
    sources: []
  },
  {
    // Requested: "relevante links i footeren. Handelsbetingelser, Privatlivspolitik, Cookies".
    path: "/handelsbetingelser", lang: "da", section: "om-os",
    kicker: "Handelsbetingelser", title: "Handels", em: "betingelser",
    lead: "Betingelserne, når du køber medlemskab, billet til et event eller lejer salen i Hjerterum.",
    description: "Hjerterums handelsbetingelser: medlemskab, billetter, leje af sal, betaling, fortrydelsesret, opsigelse og klager.",
    card: { title: "Handelsbetingelser", text: "Medlemskab, billetter, leje og betaling." },
    body: `## Sælger {#saelger}
Hjerterum F.M.B.A., CVR 40827692, Guldsmedgade 26B, st., 8000 Aarhus C, [team@hjerterum.info](mailto:team@hjerterum.info).

## Priser og betaling {#betaling}
Alle priser er i danske kroner inkl. eventuel moms. Du betaler med betalingskort gennem vores betalingsleverandør; vi ser og gemmer ikke dine kortoplysninger. Leje af salen til standardpris betales efter faktura.

## Medlemskab {#medlemskab}
Medlemskabet løber pr. måned eller pr. år, alt efter hvad du vælger, og fornyes automatisk, til du opsiger det. Betalingen trækkes forud for hver periode. Du kan opsige medlemskabet når som helst under Min profil på medlemssiden eller ved at skrive til os; det gælder så til udgangen af den periode, du har betalt for. Hvad medlemskabet giver, står under [Medlemskab](/medlemskab).

## Billetter til events {#billetter}
Køber du billet til et event, er købet bindende. Aflyser Hjerterum eller arrangøren eventet, får du pengene tilbage. Arrangøren er ansvarlig for indholdet af sit event.

## Leje af salen {#leje}
For leje af salen gælder [vilkårene for leje](/brug-hjerterum/vilkaar), herunder aflysning og rengøring.

## Fortrydelsesret {#fortrydelse}
Når du køber medlemskab, har du 14 dages fortrydelsesret fra købet. Beder du os om at starte medlemskabet med det samme, og fortryder du inden for de 14 dage, betaler du for den del, du har haft. Fortryd ved at skrive til [team@hjerterum.info](mailto:team@hjerterum.info) inden fristen. Billetter til events på en bestemt dato og leje af salen til en bestemt tid er undtaget fra fortrydelsesretten (forbrugeraftalelovens § 18, stk. 2, nr. 12).

## Klager {#klager}
Skriv først til os, så finder vi en løsning. Kan vi ikke blive enige, kan du klage til Center for Klageløsning, Nævnenes Hus, Toldboden 2, 8800 Viborg, [naevneneshus.dk](https://naevneneshus.dk).

## Persondata
Sådan behandler vi dine oplysninger: se [privatlivspolitikken](/privatliv).`,
    sources: []
  },
  {
    path: "/cookies", lang: "da", section: "om-os",
    kicker: "Cookies", title: "Cookies", em: "kun det nødvendige",
    lead: "Hjemmesiden bruger ingen cookies til statistik eller annoncer. Kun login bruger de cookies, det ikke kan undvære.",
    description: "Hjerterums cookiepolitik: ingen sporing eller annoncecookies - kun de nødvendige cookies til login på medlemssiden.",
    card: { title: "Cookies", text: "Kun de nødvendige - ingen sporing." },
    body: `## Hjemmesiden {#hjemmesiden}
Når du læser hjemmesiden, sætter vi ingen cookies. Vi tæller besøg uden cookies og uden at kunne genkende dig - se [besøgsstatistikken](/privatliv#statistik). Derfor spørger vi heller ikke om samtykke.

## Login og medlemssiden {#login}
Når du logger ind, sætter vores loginleverandør (Clerk) de cookies, der skal til for at holde dig logget ind og beskytte din konto. De er nødvendige for, at login virker, og kræver derfor ikke samtykke. De forsvinder, når du logger ud, eller når de udløber.

## Links til andre sider {#andre}
Klikker du videre til fx Facebook, YouTube, Mailchimp eller CIRKLER, gælder deres egne regler for cookies. Kortet på eventsiderne vises fra OpenStreetMap, og "Find rejse" åbner Rejseplanen - her gælder deres regler.

## Sådan sletter du cookies {#slet}
Du kan altid slette cookies i din browsers indstillinger. Sletter du login-cookies, bliver du logget ud.`,
    sources: []

  },
  {
    path: "/kontakt", lang: "da", section: "kontakt",
    kicker: "Kontakt", title: "Lad os høre", em: "fra dig",
    lead: "Har du spørgsmål til medlemskab, events eller mulighederne i Hjerterum, er du velkommen til at række ud.",
    description: "Kontakt Hjerterum, Guldsmedgade 26B, 8000 Aarhus C: mail, betaling, parkering og adgangsforhold.",
    card: { title: "Lad os høre fra dig", text: "Adresse, mail, parkering og betaling." },
    body: `Mød bestyrelsen og se alt om foreningen på [Om Hjerterum](/om-hjerterum).

## Adresse
**Hjerterum**, Guldsmedgade 26B, st., 8000 Aarhus C

Vil du se stedet? Aftal en tid til fremvisning pr. mail.

## Skriv til os {#skriv}
Vælg, hvad din henvendelse handler om, så kommer den til de rette i teamet. Du kan forvente svar inden for 3–5 hverdage.

{{enquiry-generel}}

## Eller skriv direkte
- **Medlemskab og bookinger:** Team Hjerterum – [team@hjerterum.info](mailto:team@hjerterum.info)
- **Idéer til events:** [events@holistisk.org](mailto:events@holistisk.org)
- **Økonomi og regnskab:** kassereren – [regnskab@holistisk.org](mailto:regnskab@holistisk.org)
- **Andre henvendelser:** Jacob Hauge, formand – [jh@holistisk.org](mailto:jh@holistisk.org)

Send venligst kun din henvendelse ét sted – med formularen eller til én af adresserne.

**Undervisere i nødstilfælde:** se [kommunikationspolitikken](/brug-hjerterum/vilkaar#kommunikation). Teamet kan ikke kontaktes via privat Messenger eller sms.

## Betaling og foreningsoplysninger
- **MobilePay:** 734388
- **Djursland Bank:** reg.nr. 7268, kontonr. 1211404
- **Hjerterum F.M.B.A.**, CVR 40827692

## Parkering og adgang {#parkering}
Der er gratis parkering om søndagen og på helligdage i Aarhus Kommune og 2 timers gratis parkering i den gule zone. Vi kan anbefale Kirkegårdsvej, hvor der ofte er plads i dagtimerne – derfra er der 10–15 minutters gang til Hjerterum. Læs mere om parkeringsregler, priser og zoner på [Aarhus Kommunes hjemmeside](https://aarhus.dk/borger/trafik-og-parkering/parkering).

Hjerterum er desværre ikke tilgængeligt for kørestolsbrugere: selvom vi ligger i stueetagen, er der 5 trin op til hoveddøren, og der er ikke plads til en kørestol på toilettet. Der er en handicapparkeringsbås foran hovedindgangen. Har du spørgsmål om vores faciliteter, er du velkommen til at skrive.

## Godt at vide
Når du bruger Hjerterum, er du selv ansvarlig for eventuelle skader på dig selv og dine ejendele.

Følg os på [Facebook](https://www.facebook.com/holistiskcenter). Søger du selvudvikling i mindre grupper, så se også [CIRKLER](${CIRKLER_URL}).

{{newsletter}}`,
    gallery: {
      title: "Find vej",
      pictures: [
        { src: "/media/2021-01-141519045-1831739383657105-8794282662640002364-o.webp", alt: "Huset i gården bag Guldsmedgade, hvor Hjerterum ligger i stueetagen" },
        { src: "/media/2021-01-141092920-1831940920303618-8786842229571861787-n.webp", alt: "Kort over Hjerterums placering ved Guldsmedgade i Aarhus C" }
      ]
    },
    sources: ["kontakt-os", "kontakt"]
  }
];

/** The homepage is its own page (src/site-pages.tsx); it carries the draft of holistisk.org's new front page. */
export const HOME_SOURCES = ["test"];

/** Requested: "en flot Om Hjerterum-side som skal være den samme her /member-portal/kontakt og på hjemmesiden. Her er både kontaktoplysninger
 * og information om bestyrelsen med billede." The board, written once: the website's Teamet and Om Hjerterum and the member area all show it. */
export type BoardMember = { name: string; role: string; hours: string; tasks: string };
export const BOARD_PHOTO: Picture & { caption: string } = { src: "/media/2025-12-pcgo-hdy.webp", alt: "Bestyrelsen i Hjerterum",
  caption: "Fra venstre: Gitta Kaas, Douglas Crawford, Jacob Hauge (formand), Frederik Kærgaard (kasserer) og Lisbeth Jespersen (næstformand)." };
export const BOARD: BoardMember[] = [
  { name: "Jacob Hauge", role: "Formand", hours: "Grundlægger og teamleder · frivillig", tasks: "Andre henvendelser og det overordnede." },
  { name: "Lisbeth Jespersen", role: "Næstformand", hours: "Ansat 8 timer om ugen", tasks: "Bookinger med nye undervisere, generelle henvendelser samt ind- og udmeldelser." },
  { name: "Frederik Kærgaard", role: "Kasserer", hours: "Ansat 5 timer om ugen", tasks: "Økonomi, fakturaer m.m." },
  { name: "Gitta Kaas", role: "SoMe og PR", hours: "Ansat 5 timer om ugen", tasks: "SoMe og PR samt bookinger med faste undervisere." },
  { name: "Douglas Crawford", role: "Bestyrelsesmedlem", hours: "Frivillig", tasks: "Medlemssystem, hjemmeside, vedligeholdelse og café." }
];

const ABOUT: SitePage = {
  path: "/om-hjerterum", lang: "da", section: "kontakt",
  kicker: "Om Hjerterum", title: "Huset og", em: "menneskene bag",
  lead: "Hjerterum i Aarhus er et åbent og inkluderende rum, hvor du kan udforske personlig vækst, selvudvikling og fællesskab. Vi tilbyder arrangementer, workshops og inspirerende møder, der hjælper dig med at finde balance, indre styrke og nye perspektiver på livet.",
  description: "Hjerterum i Aarhus tilbyder arrangementer, workshops og fællesskab indenfor personlig udvikling, indre transformation og spiritualitet.",
  card: { title: "Om Hjerterum", text: "Kontakt, bestyrelsen og foreningen." },
  body: `Uanset om du søger fordybelse, refleksion eller bare en pause fra hverdagen, er Hjerterum et sted, hvor alle er velkomne. Kom og bliv en del af et fællesskab, der inspirerer og forbinder mennesker på tværs af livets mange facetter.

## Kontakt {#kontakt}
**Hjerterum**, Guldsmedgade 26B, st., 8000 Aarhus C

- **Medlemskab og bookinger:** [team@hjerterum.info](mailto:team@hjerterum.info)
- **Idéer til events:** [events@holistisk.org](mailto:events@holistisk.org)
- **Økonomi og regnskab:** [regnskab@holistisk.org](mailto:regnskab@holistisk.org)
- **Andre henvendelser:** Jacob Hauge, formand – [jh@holistisk.org](mailto:jh@holistisk.org)

Du kan forvente svar inden for 3–5 hverdage. Du kan også [skrive til os med formularen](/kontakt#skriv) eller læse om [parkering og adgang](/kontakt#parkering).

## Bestyrelsen {#bestyrelsen}
{{board}}
Vi har en flad struktur: ansatte og frivillige deler ansvaret og løfter opgaverne i flok. [Læs mere om, hvordan vi arbejder](/om-os/teamet).

## Foreningen {#foreningen}
- **Hjerterum F.M.B.A.**, CVR 40827692
- **MobilePay:** 734388
- **Djursland Bank:** reg.nr. 7268, kontonr. 1211404

[Vedtægterne](/om-os/foreningen#vedtaegter) · [Historien](/om-os/historien)`,
  sources: []
};

export const SITE_PAGES: SitePage[] = [...pages, ABOUT, ...SITE_PAGES_EN];
