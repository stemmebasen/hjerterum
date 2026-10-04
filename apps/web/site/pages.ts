/** Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt",
 * in the structure of hjerterum.info ("En forside som denne er nu blevet rigtig fin"). Every page names the holistisk.org
 * pages it carries (`sources`); site/redirects.ts sends every old address to its new place, and docs/CONTENT_LEDGER.md
 * accounts for all 56. The untouched originals are archived in docs/legacy/holistisk-org/. Markdown: site/markdown.ts;
 * a line "{{name}}" places a live part of the page (the calendar, the plans, the price calculator …). */

import { SITE_PAGES_EN } from "./pages-en.js";
import { STATUTES } from "./statutes.js";

export type Lang = "da" | "en";
export type Section = "events" | "behandling" | "behandlere" | "medlemskab" | "lej" | "om-os" | "kontakt" | "en";
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
  /** How the page appears as a card on the page above it. */
  card: { title: string; text: string };
  sources: string[];
};

export const NAV: Array<{ section: Section; label: string; href: string }> = [
  { section: "events", label: "Events", href: "/events" },
  { section: "behandling", label: "Behandling & terapi", href: "/behandling" },
  { section: "behandlere", label: "Behandlere & undervisere", href: "/behandlere" },
  { section: "medlemskab", label: "Medlemskab", href: "/medlemskab" },
  { section: "lej", label: "Lej Hjerterum", href: "/lej-hjerterum" },
  { section: "om-os", label: "Vision / om os", href: "/om-os" },
  { section: "kontakt", label: "Kontakt", href: "/kontakt" },
  { section: "en", label: "English", href: "/en" }
];

/** Where people sign up today - the same place hjerterum.info sends them - until payment runs on this platform. */
export const SIGNUP_URL = "https://holistisk.org/bliv-medlem/";
export const CIRKLER_URL = "https://cirkler.net";
export const NEWSLETTER_ACTION = "https://holistisk.us6.list-manage.com/subscribe/post?u=e41afd3f798957ec11726bf83&id=0070dc72a9&f_id=00b8ede5f0";
export const NEWSLETTER_HONEYPOT = "b_e41afd3f798957ec11726bf83_0070dc72a9";

export type Teacher = { name: string; focus: string; url?: string; image: string };
export const TEACHERS: Teacher[] = [
  { name: "Sissel Bronée", focus: "Conscious Dance", url: "https://www.facebook.com/profile.php?id=61557265805074", image: "/media/2025-04-1-small.webp" },
  { name: "Douglas Crawford", focus: "Rebirthing · A Course in Miracles", url: "http://www.masteringlife.dk/", image: "/media/2025-04-douglas-close-up-1.webp" },
  { name: "Anna Carolina", focus: "", image: "/media/2025-04-2-small.webp" },
  { name: "Luca Hillen", focus: "NVC · Kakao · Movement Research", url: "https://www.facebook.com/profile.php?id=100068577652230", image: "/media/2025-04-10-small.webp" },
  { name: "Ras Jensen", focus: "Regressionsterapi · Te-ceremonier · Soul Meditation · Life & Soul Guide", url: "https://www.rasjensenhealing.com/", image: "/media/2025-04-4-small.webp" },
  { name: "Laufey Karítas Einarsdóttir", focus: "Kundalini- og flowyoga · Danceflows · Meditation", url: "https://karitasflow.dk/", image: "/media/2025-04-5-small.webp" },
  { name: "Anna Ananda", focus: "Gong og tibetanske skåle · Lydbade · Ceremoniel kakao · Rene olier", image: "/media/2025-04-6-small.webp" },
  { name: "Sarah Bjørk Lundsberg", focus: "Healing · Yin yoga · Shamanistisk tromme · Skovarbejde · Meditation", url: "https://behandlerhusetstavtrup.dk/sarah_lundsberg/", image: "/media/2025-04-8-small.webp" },
  { name: "Lisa Mai Karina Toft", focus: "Shamanistisk healing · Clairvoyance · Kropsterapi", url: "https://kropsterapi-healing.dk", image: "/media/2025-04-7-small.webp" },
  { name: "Gitta Kaas", focus: "Sanger · Spirituel sangcoach · Lydhealer", url: "https://gittakaas.dk/", image: "/media/2025-04-gitta-small.webp" },
  { name: "Kasper Frausing", focus: "Yoga", image: "/media/2025-04-kasper-frausing-small.webp" }
];

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

Har du ønsker eller idéer til indhold, så skriv til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).

## Vil du holde et event?
Undervisere og arrangører kan leje salen og nå ud til husets store fællesskab. [Læs om at leje Hjerterum](/lej-hjerterum), eller skriv til [events@holistisk.org](mailto:events@holistisk.org).

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

  // ---------------------------------------------------------------- Behandling & terapi
  {
    path: "/behandling", lang: "da", section: "behandling",
    kicker: "Behandling & terapi", title: "Omsorg med plads", em: "til hele dig",
    lead: "Find behandlinger og terapeutiske tilbud, der støtter dig i at lande, mærke efter og finde din egen vej.",
    description: "Behandlinger og terapi i Hjerterum i Aarhus – med rabat for medlemmer – og en introduktion til breathwork.",
    card: { title: "Omsorg med plads til hele dig", text: "Behandlinger og terapeutiske tilbud – med rabat for medlemmer." },
    body: `Som medlem af Hjerterum kan du få rabat på behandlinger og terapisessioner hos en række af husets behandlere. Mange præsenterer sig selv i [oversigten over behandlere og undervisere](/behandlere).

## Behandlere med medlemsrabat {#behandlere}

### Aurora Gayatri – terapeut og selvkærlighedscoach
![Aurora Gayatri – You Unfolding](/media/2019-08-aurora-gayatri-1.webp)

> Jeg er lysarbejder. Mit hjerte brænder for at guide dig hjem – til selvkærlighedens land. At støtte dig i at transformere følelser af mindreværd, angst, depression, vrede og selvhad til livsbekræftende følelser af indre storhed, tillid, frihed, glæde og selvkærlighed. At hjælpe dig med at skabe dybe rødder ned i Moder Jord og turde lade din sande natur udfolde sig – i dit smukke lys.

Aurora tilbyder terapi, healing og breathwork – både individuelt og i grupper. Kontakt hende via [You Unfolding på Facebook](https://www.facebook.com/pg/YouUnfolding/about/), eller send en sms til 27 57 03 96, så ringer hun dig op.

### Soroush Zand – healing og clairvoyant rådgivning
![Soroush Zand – healing og clairvoyant rådgivning](/media/2021-10-soroush-headrer.webp)

- **Clairvoyant rådgivning** – her bliver du set.
- **Samtale** – her drøfter I dine temaer i fællesskab.
- **Behandling** – her kan du slappe helt af og få ny energi.

Soroush tilbyder healing, polaritetsterapi og clairvoyant rådgivning, healingsaftener med krystalsyngeskåle og den gratis spirituelle podcast "Sjæl – samtaler om spiritualitet". Kontakt: 30 64 21 62 · [kontakt@sjæl.dk](mailto:kontakt@xn--sjl-zla.dk) · [sjæl.dk](http://www.xn--sjl-zla.dk/)

### Douglas Crawford – lysarbejder
![Douglas Crawford – lysarbejder](/media/2020-12-lightworker-1.webp)

Douglas' fokus som lysarbejder er tryghed og støtte først, så blokeringer kan slippes let og blidt. Han tilbyder Source Breathwork (rebirthing) og coaching i A Course in Miracles. Læs mere på [masteringlife.dk](http://www.masteringlife.dk/).

## Hvad er breathwork? {#breathwork}
I breathwork bruger vi åndedrættet til at åbne op for ubevidste følelser, tanker og overbevisninger, der blokerer for oplevelsen af indre fred.

Det cirkulære åndedræt, vi bruger i breathwork, dirigerer vi op i brystet, i hjertet – for at kunne få kontakt til alle følelser. Breathwork er en kærlig frisættelsesmetode, og nøgleordet er tryghed: vores fokus som facilitatorer er altid at skabe et trygt og kærligt rum, så du kan komme i kontakt med det, der fylder i kroppen og sindet.

Breathwork lærer dig at rumme hele følelsesspektret. Du bliver mere autentisk og kommer hjem i dig selv – med alt det, du rummer. Når du er tryg med dine følelser og kan rumme dig selv, kan du også rumme andre og det, der foregår omkring dig, på godt og ondt.

**Sådan foregår en session.** Først er der en kort introduktion til den tekniske del. Selve sessionen varer en time: du ligger på en madras og trækker vejret til blid, instrumental musik, og facilitatorerne støtter dig med blid berøring og guidning undervejs. Bagefter får du en stund til at ligge og integrere oplevelsen, og til sidst samles vi i en cirkel, hvor du kan dele dine oplevelser.

[Læs en journaliststuderendes beretning om en breathwork-aften i Hjerterum](/behandling/breathwork).`,
    children: ["/behandling/breathwork", "/behandlere"],
    sources: ["behandling-terapi", "hvad-er-breathwork"]
  },
  {
    path: "/behandling/breathwork", lang: "da", section: "behandling",
    kicker: "Behandling & terapi · Beretning", title: "”Det er bare", em: "en følelse”",
    lead: "En onsdag aften i september prøvede journaliststuderende Sofie Tronier breathwork på egen krop. Hun grinede, græd og var bange – alt sammen inden for en time.",
    description: "En journaliststuderendes beretning om en breathwork-session i Hjerterum.",
    card: { title: "”Det er bare en følelse”", text: "En journaliststuderendes beretning om breathwork." },
    body: `*Artiklen er skrevet af journaliststuderende Sofie Tronier (tekst og foto), som venligt har givet os lov til at bruge den. Den fortæller om, hvad du fx kan opleve i en breathwork-session. Tak til Sofie.*

En stikkende og rystende fornemmelse har bredt sig fra mine fingerspidser til mine lægge og helt op til kæben. Min krop sitrer, og jeg mærker, at jeg langsomt mister kontrollen over den. Jeg trækker stadig vejret dybt ned i brystet, og efter noget tid mærker jeg et tryk i solar plexus. Vi er ikke mere end et kvarter inde i sessionen, før de første tårer langsomt presser sig ud af mine lukkede øjne og ned på siden af mine kinder. Jeg lægger mig fladt ned. Både fordi det er en del af øvelsen, og fordi jeg må erkende, at breathwork har en effekt på min krop.

## Et fællesskab
En halv time tidligere sidder vi 15 mennesker i en rundkreds, både mænd og kvinder. Aurora fortæller, at vi skal trække vejret i brystet. "Det er der, hjertet sidder. Ved at have fokus på området omkring hjertet kan man opnå en større selvkærlighed," siger hun. Jeg tænker, at det lyder alt for abstrakt til at kunne mærke på min egen krop. Imens Aurora fortæller, kigger jeg diskret rundt på de andre deltagere. Kvinden ved siden af mig er omkring 60 år, klædt i yogatøj og med et blik i øjnene, som fortæller, at hun har oplevet en del. Et par pladser længere henne sidder en mand omkring samme alder. Han spørger underviseren, hvordan man skal sidde.

"Du skal ligge ned, medmindre du falder i søvn," svarer Jan.

Den ældre mand smiler, så mellemrummet mellem hans tænder kommer til syne. Han sætter sig til rette i en form for skrædderstilling. Han har jeans på. På den anden side sidder en ung kvinde med næsepiercing. Hendes mørke hår står i kontrast til hendes blege ansigt. Hun virker afslappet.

## Breathwork
Det er den første onsdag i september, klokken er 19, og aftenens breathwork-session er skudt i gang. Breathwork er en måde at trække vejret på, hvor man trækker vejret i den øverste del af brystet – helst med helt åben mund, så man får så meget luft ind som muligt. Formålet er, at vejrtrækningen skal lukke op for følelser, man normalt undertrykker, bevidst eller ubevidst. Det kan føre til både grin, gråd og vrede. Vejrtrækningen kan også give en fysisk reaktion, hvor kroppen ryster og trækker sig sammen. Det føles som en blanding af krampe og fornemmelsen af, at ens krop sover.

## Hjerterum – en indre opdagelsesrejse
Det er Hjerterum, der huser aftenens breathwork-session – blot et af mange events, som Hjerterum afholder. Aftenens undervisere er Maria, Jan og Aurora.

"Breathwork er en måde at komme i kontakt med det ubevidste sind, hvor en masse følelser er blevet fortrængt," siger Jan. Det er også Jan, som fortæller aftenens nye deltagere, hvad de kan forvente af den næste time.

![Jan, Maria og Aurora – undervisere i Hjerterum](/media/2019-11-skaermbillede-2019-11-22-08-04-26.webp "Jan, Maria og Aurora – undervisere i Hjerterum.")

Tilbage i sessionen udgør en grøn vase med orange nelliker rundkredsens midtpunkt og skaber symmetri i rummet. Efter Aurora og de andre undervisere har introduceret breathwork, præsenterer vi hver især os selv og den følelse, vi sidder med. Én føler sig sårbar på grund af en strid med kommunen, en anden føler sig opløftet og klar, og en tredje har voldsom hjertebanken, fordi han ikke kunne finde en parkeringsplads og derfor var ved at komme for sent.

![Rummet i opgangen på Mejlgade](/media/2019-11-skaermbillede-2019-11-22-11-02-49.webp "Rummet i opgangen på Mejlgade er minimalistisk indrettet, men rummer alligevel genstande, jeg forbinder med den meditative verden.")

Da vi er færdige i rundkredsen, lægger jeg mig til rette et tilfældigt sted i rummet, og min krop hviler tungt på madrassen. Med lukkede øjne og til lyden af noget, der minder om meditationsmusik, prøver jeg at holde fokus på min vejrtrækning. Med et stadig distanceret mindset åbner jeg munden på vid gab og trækker vejret dybt ned i brystet. Jeg får associationer til, når lægen skal tjekke min vejrtrækning ved mistanke om lungebetændelse. I starten kan jeg ikke lade være med at grine af de andres vejrtrækninger. De virker voldsomme og overdrevne. Det er grænseoverskridende at ånde ud uden at dæmpe udåndingslyden. Efter noget tid giver jeg alligevel slip og trækker pludselig vejret uden at tænke over, at andre kan høre mig.

![Under sessionen ligger alle på en madras](/media/2019-11-skaermbillede-2019-11-22-08-00-31.webp "Under sessionen ligger alle på en madras – de fleste med en pude under nakken og et tæppe over sig.")

## Fysiske og psykiske reaktioner
Tilbage på madrassen mærker jeg allerede efter et par minutter en stikken i hænderne, som om de sover. Den stikkende fornemmelse bevæger sig ud i hele kroppen. Mens jeg fortsætter min vejrtrækning med lukkede øjne, mærker jeg tårer løbe ned ad mine kinder. Sådan ligger jeg lidt, indtil jeg fornemmer et menneske ved min side. Jeg mærker en varm kvindehånd på min pande.

"Det er okay at give slip, Sofie," siger en rolig stemme.

Hånden bevæger sig blidt hen over mit ansigt, mens den anden hånd lægger et tryk på mit bryst, som hjælper mig til at gøre min vejrtrækning endnu dybere. Efter lidt tid bliver jeg overladt til mig selv igen. Min krop føles lammet, og jeg trækker hænderne op til brystet i et forsøg på at bevare en form for kontrol. Til sidst må jeg holde pause og trække vejret normalt for en stund. Jeg kan knap løfte hænderne fra madrassen. Så mærker jeg igen en hånd på mit hoved. I mellemtiden er flere brudt ud i en blanding af højlydt grin og gråd. Jeg klemmer læberne sammen for ikke at grine af dem, men da underviseren fortæller mig, at alle følelser er velkomne, bryder jeg ud i latter. Underviseren anerkender mine følelser ved at grine med mig og fortæller samtidig, at følelserne er de samme, uanset om det er grin eller gråd. Det mærker jeg kort efter på egen krop, da mit grin pludselig ændrer sig til gråd.

Resten af sessionen kommer deltagerne hele følelsespaletten rundt. På et tidspunkt råber en af mændene i vrede, og jeg kan høre, at han ryster. Jeg får at vide, at jeg ikke skal være bange.

"Det er bare en følelse," siger Maria stille.

## Tilbage til fællesskabet
Efter en time åbner vi øjnene igen. Min krop sitrer og føles udmattet, og jeg må vente lidt med at sætte mig op. Omkring mig er der flere, som stadig græder. Efter lidt tid begynder folk at rejse sig. Alle skal have et glas vand – både fordi sessionen er fysisk hård, og fordi vejrtrækning med åben mund gør en meget tør i munden. Vi sætter os igen i en rundkreds og snakker. Nogle havde en meget fysisk oplevelse, mens andre blev bragt tilbage til bestemte episoder i deres liv. En af deltagerne fik en pludselig trang til pizza, og det griner vi alle lidt af. Jeg åbner op om mine betænkeligheder, og da jeg skal videre til næste sætning, pisker følelserne gennem min krop, og jeg begynder at græde. Jeg kan pludselig ikke færdiggøre mine sætninger. Gruppen giver mig tid til at græde færdig, så jeg til sidst får fremstammet, at jeg er rørt over trygheden i rummet og pladsen til at vise præcis det, jeg føler.

## Tid til refleksion
Da sessionen er slut, er der ingen, der tager direkte hjem. Alle krammer og snakker – om deres oplevelser eller om noget helt andet. Jeg sætter mig i sofaen og sunder mig. Jeg snakker med en ung mand, som, mens han binder sine snørebånd, fortæller, at han har været her et par gange, og at hans oplevelse ændrer sig fra gang til gang. En midaldrende mand fortæller, at nogle sammenligner oplevelsen med at være på svampe. Manden med mellemrum mellem tænderne deler sin oplevelse med kvinden i yogatøj.

"Det er bedre end sex," griner han.

Folk har ikke travlt; de hygger sig, og der går over en halv time, før de sidste er gået. En time efter er jeg selv hjemme. Jeg har behov for at fortælle folk om min oplevelse – som når man har opdaget et rigtig godt stykke musik. Da jeg skal sove, kan jeg mærke, at jeg er øm i kroppen. Min krop er rolig, men min hjerne er forvirret over, hvad jeg egentlig lige har oplevet. Én ting er dog sikker: Jeg oplevede nogle store følelser, og jeg føler mig faktisk lidt lettere.

---

[Læs mere om breathwork i Hjerterum](/behandling#breathwork)`,
    sources: ["udtalelser-om-breathwork"]
  },

  // ---------------------------------------------------------------- Behandlere & undervisere
  {
    path: "/behandlere", lang: "da", section: "behandlere",
    kicker: "Behandlere & undervisere", title: "Mennesker med", em: "noget på hjerte",
    lead: "Mød de behandlere, undervisere og værter, som deler deres faglighed og skaber oplevelser i Hjerterum.",
    description: "Behandlere, undervisere og faste hold i Hjerterum i Aarhus.",
    card: { title: "Mennesker med noget på hjerte", text: "Mød behandlerne, underviserne og værterne i huset." },
    body: `{{profiles}}

## Faste undervisere {#faste-undervisere}
Disse undervisere har faste hold og forløb i Hjerterum. Klik på navnet for at læse mere om dem.

{{teachers}}

Vil du selv undervise i Hjerterum? [Læs om at leje salen](/lej-hjerterum). Er du medlem og underviser eller behandler, kan du lave dit eget visitkort i [medlemsområdet](/member-portal/profil).`,
    sources: ["faste-laerere-regular-teachers"]
  },

  // ---------------------------------------------------------------- Medlemskab
  {
    path: "/medlemskab", lang: "da", section: "medlemskab",
    kicker: "Medlemskab", title: "Bliv en del", em: "af Hjerterum",
    lead: "Vælg det medlemskab, der passer til dig – og få adgang til et fællesskab baseret på nærvær og menneskelig varme.",
    description: "Medlemskab af Hjerterum i Aarhus: priser, fordele, reduceret pris, vilkår og muligheden for at støtte huset.",
    card: { title: "Bliv en del af Hjerterum", text: "Medlemskaber, fordele og vilkår." },
    body: `> **30 dages gratis prøveperiode.** Melder du dig ind senest den 15. oktober 2026, og har du ikke været medlem af Hjerterum før, får du de første 30 dage gratis. Opsiger du, inden prøveperioden udløber, bliver du ikke opkrævet noget.

{{membership-plans}}

## Sådan melder du dig ind {#tilmelding}
Indmeldelse sker indtil videre i vores medlemssystem på holistisk.org: [Meld dig ind her](${SIGNUP_URL}). Er du allerede medlem, kan du [logge ind](/sign-in) og se dit medlemskab, dine tilmeldinger og dine events.

Læs [vilkårene for medlemskab](/medlemskab/vilkaar), før du melder dig ind.

## Reduceret pris {#reduceret}
Reduceret pris er til dig med en lav indkomst – fx SU eller kontanthjælp, eller en nettoløn under 11.000 kr. om måneden. Medlemskabet koster 111 kr. om måneden eller 1.155 kr. om året. Stiger din indkomst over grænsen, beder vi dig opgradere til standardpris.

## Fordele ved et medlemskab {#fordele}
- Du deltager i events til rabatpris og ofte helt gratis.
- Du får jævnligt tilbud på Hjerterums egne events – koncerter, foredrag, temaaftener, fællesspisning, filmaftener og meget mere – som en del af [Hjerterum Open](/events#hjerterum-open). Ofte gratis eller til særlig pris for medlemmer.
- Du kan blive en del af en [Tribe](/om-os/tribes): en lille gruppe på 5–8 medlemmer, der skaber et nærende fællesskab og en dybere, fortrolig forbindelse. Skriv til [tribes@holistisk.org](mailto:tribes@holistisk.org), hvis du vil være med.
- Det er nemmere at tilmelde sig events, når du er logget ind.
- Du får rabat på økologisk specialkaffe, andre specialdrikke og biodynamisk kage og snacks i caféen hver torsdag eftermiddag og til andre arrangementer.
- Du får tilbud på events hos Hjerterums samarbejdspartnere i Aarhus og Østjylland.
- Du kan være med i foreningen med bidrag, idéer og ønsker.
- Du støtter Hjerterum økonomisk, så vi sammen kan blive ved med at udleve visionen om et hjerterum for healing, forbundethed og indre fred.

## Støt Hjerterum {#stoet}
Donationer er – sammen med medlemskontingent og leje af salen – det, der får Hjerterum til at løbe rundt. Enhver donation, lille som stor, modtages med stor taknemmelighed.

- **MobilePay:** 734388
- **Bankoverførsel** (fx ved beløb over 1.000 kr.): Djursland Bank, reg.nr. 7268, kontonr. 1211404

Vil du støtte fast uden medlemsfordele, kan du vælge Support-medlemskabet. På forhånd tak fra teamet bag ♡`,
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
Vil du opsige dit medlemskab eller holde pause et par måneder, så skriv til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).

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

  // ---------------------------------------------------------------- Lej Hjerterum
  {
    path: "/lej-hjerterum", lang: "da", section: "lej",
    kicker: "Lej Hjerterum", title: "Et rum til det,", em: "du vil skabe",
    lead: "Har du en workshop, et foredrag, et forløb eller en lille begivenhed på hjerte? Lej vores sal på ca. 110 m² – fra tidlig morgen til sen aften, alle ugens dage.",
    description: "Lej Hjerterums sal på ca. 110 m² i Aarhus C: faciliteter, priser, prisberegner og sådan booker du dit event.",
    card: { title: "Et rum til det, du vil skabe", text: "Faciliteter, priser og sådan booker du salen." },
    body: `Når du booker dit event hos os, får du ikke bare et inspirerende og stemningsfuldt rum. Du bliver også en del af et stort og engageret fællesskab i Østjylland: dit event bliver vist på vores hjemmeside og Facebook-side, så du når ud til vores mange medlemmer og følgere.

Som arrangør står du selv for at planlægge og afvikle dit event – også opsætning og oprydning. Men du er ikke alene: vores frivillige giver gerne en hånd, hvis du har brug for det. Uanset om du er iværksætter, forening, terapeut eller bare har en god idé, er du velkommen. Kontakt os, og lad os skabe noget fantastisk sammen.

## Faciliteter {#faciliteter}
- Sal på ca. 110 m²
- Fuldt udstyret køkken med tallerkener, kopper, glas og bestik til 40 personer
- 2 toiletter
- 20 yogamåtter, 22 madrasser, 16 meditationsstole og 20 yogablokke
- Puder og tæpper
- Stole til 40 personer og 8 borde
- Musikanlæg med mixer, minijack og Bluetooth, et hifi-anlæg (minijack eller Bluetooth) og en Bluetooth-højttaler
- Projektor med HDMI
- Trådløst internet

## Priser {#priser}
Lejeprisen afhænger af, hvilken slags event du holder. Alle priser er inkl. moms.

### A) Standardpris – uden medlemsrabat
Til events uden medlemsrabat. Du betaler en fast pris efter bookingens længde.

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

### B) Reduceret pris – med medlemsrabat
Til events, hvor medlemmer får en lavere deltagerpris end ikke-medlemmer. Lejen beregnes efter B-tid og A-tid.

| | B-tid: hverdage før kl. 18.30 | A-tid: hverdage efter kl. 18.30 og weekend |
|---|---|---|
| Grundpris inkl. de første 2 timer | 150 kr. | 400 kr. |
| Pris pr. ekstra time | 75 kr. | 150 kr. |
| Mindste rabat til medlemmer | 50 kr. | 100 kr. |

I en periode giver vi 25 % rabat på A-tidspriserne. Det kan du se i prisberegneren.

### C) Gratis leje
Til events, hvor Hjerterum ikke tager betaling for lokalet. Medlemmer deltager gratis, og ikke-medlemmer betaler mindst 150 kr. i A-tid eller 75 kr. i B-tid. For at bruge gratis leje skal du selv være betalende medlem.

### Vigtige regler
- **Ingen overlap:** med medlemsrabat eller gratis leje kan en booking ikke gå hen over kl. 18.30. Den skal ligge helt i B-tid eller helt i A-tid.
- **Varighed:** mindst 2 og højst 10 timer pr. booking.
- **Forberedelse:** tid til opsætning og oprydning skal være med i det bookede tidsrum. Vi anbefaler 30 minutter før og efter.

{{price-calculator}}

## Sådan booker du {#booking}
Find prisen og send din bookingforespørgsel med [prisberegneren og bookingformularen](/beregner). Send os disse oplysninger:

**Om eventet**
- **Titel**
- **Eventtekst** – fx formål, program og lidt om dig som underviser
- **Pris og betaling** – prisen for medlemmer og ikke-medlemmer, hvordan der betales (fx MobilePay eller kontant), og om der betales ved fremmøde eller på forhånd
- **Tilmelding** – via Hjerterums hjemmeside eller direkte hos dig (mail, telefon eller din egen hjemmeside)
- **Datoforslag** – tjek [kalenderen](/events), og send gerne flere datoer, da der kan være optaget
- **Tidspunkt** – både eventets og bookingens start og slut; husk tid til forberedelse før og oprydning efter (typisk ca. 30 minutter)

**PR-materiale**
- Et coverbillede til eventet – og gerne flere billeder
- Evt. link til din hjemmeside eller Facebook-side

**Krav til coverbilledet**
- Billedet skal være uden ophavsret (royalty-free). Vi foretrækker billeder, der ikke er AI-genererede.
- Har du ikke egne billeder, kan du finde gratis billeder på fx unsplash.com (vælg "free" – ellers er der ophavsret på billedet).
- Canva.com kan bruges til den grafiske opsætning.
- Format: 1920 × 1005 px (Facebook-cover), ellers kommer hele billedet ikke med. Filformat: jpg eller png.

### Når bookingen er aftalt
- Vi sender dig en faktura. Vi går først i gang med at oprette dit event, når vi har modtaget betalingen.
- Har du en Facebook-side (fx en virksomhedsside), så opret gerne eventet dér først og send os linket – det letter det administrative arbejde. Gør det først, når bookingen er bekræftet.
- Har du ikke en Facebook-side, opretter vi eventet på hjemmesiden og vores Facebook-side og sender dig et link.

**Planlæg i god tid.** For at have en realistisk chance for at tiltrække deltagere anbefaler vi at planlægge 4–8 uger før eventet. Vi har op til ca. 5 hverdages ekspeditionstid, når vi har modtaget alt materiale.

**Markedsføring er dit ansvar.** Invitér dit netværk, boost dit Facebook-event, og del det i relevante grupper. [Se vores råd og en liste over grupper](/lej-hjerterum/markedsfoering).

+++ Ansvarsfraskrivelse
${DISCLAIMER}
+++`,
    image: { src: "/media/2021-03-hjerterum-e.webp", alt: "Salen i Hjerterum med trægulv, hvide bjælker og planter" },
    gallery: { title: "Salen og livet i Hjerterum", pictures: ROOM_GALLERY },
    children: ["/lej-hjerterum/praktisk", "/lej-hjerterum/vilkaar", "/lej-hjerterum/markedsfoering", "/lej-hjerterum/dine-events"],
    sources: ["brug-centret", "lejepriser", "book-dit-event"]
  },
  {
    path: "/lej-hjerterum/praktisk", lang: "da", section: "lej",
    kicker: "Lej Hjerterum", title: "Praktisk", em: "information",
    lead: "Alt det praktiske, når du bruger Hjerterum: nøgler, dørtelefon, køkken, lyd, projektor og oprydning.",
    description: "Praktisk information til undervisere i Hjerterum: nøgler, dørtelefon, køkken, lydanlæg, projektor og rengøring.",
    card: { title: "Praktisk information", text: "Nøgler, dørtelefon, køkken, lyd og oprydning." },
    body: `## Nøgler
Du finder to sæt nøgler i en lille nøgleboks på ydervæggen ved jernlågerne ud mod Guldsmedgade. Du skal bruge ét af sættene. Et sæt består af en grøn chip til porten og kælderdøren og en almindelig nøgle til Hjerterums hoveddør og hængelåsen på kælderens inderdør. Koden til nøgleboksen får du på mail.

Chippen er nem at bruge: hold den op foran den sorte "dims" på væggen under nøgleboksen. Når lyset bliver grønt, drejer du dimsen med uret, og lågen åbner langsomt.

**Husk at lægge nøglesættet tilbage i nøgleboksen efter dit arrangement.**

![Nøgleboksen og den sorte dims til chippen ved lågen i Guldsmedgade](/media/2022-06-key-boxes.webp)

## Dørtelefon
Dine deltagere kan ringe på dørtelefonen ved gitterlågen i Guldsmedgade. Du lukker dem ind fra dørtelefonen i forgangen ved at trykke på nøgleikonet. Lyser den nederste knap med klokken rødt, er lyden slået fra – tryk på knappen for at slå den til igen.

## Køkken
I køkkenet er der køleskab, fryser, ovn, 2 kogeplader og elkedel, som du gerne må bruge. Medbring selv te, kaffe og lignende. Ryd op efter dig, så køkkenet ser ud, som da du kom.

## Lydanlæg
I salen er der et anlæg med minijack og Bluetooth. Medbring evt. din egen adapter, hvis din telefon ikke har et jackstik. [Se videoen om, hvordan du sætter lydanlægget op](https://www.youtube.com/watch?v=UoYa4tEqANY).

## Høj musik og lyd
Hold vinduer og dør lukket, hvis du bruger høj musik, trommer og lignende – og luft gerne ud i pauserne. Vi tager hensyn til naboerne.

## Projektor
Der er et HDMI-kabel fastgjort til søjlen, der kommer ned fra projektoren. Har din computer ikke HDMI, skal du medbringe en adapter. Fjernbetjeningen skal sidde i søjlens "V".

## Trådløst internet
Netværksnavn og kode får du sammen med din booking – eller spørg os.

## Oprydning og rengøring {#rengoering}
Efterlad stedet rent og pænt, så salen er klar til dem, der kommer efter dig. Book tid nok til rengøringen – vi anbefaler 30 minutter efter dit event.

**Salen**
- Støvsug salen (har I kun brugt et mindre område, er det nok at støvsuge dér)
- Stil stole og måtter tilbage bag gardinet
- Fold puder og tæpper sammen, og læg dem på hylden
- Sæt andre lånte ting tilbage, hvor de stod
- Luft ud

**Køkken og toiletter**
- Vask op i hånden eller fyld opvaskemaskinen – sæt den i gang, hvis den er mere end halvt fuld (tabs står under køkkenvasken)
- Har du dagens sidste booking, så sæt altid opvaskemaskinen i gang, eller vask de få ting op i hånden
- Ryd op i køkkenet
- Tjek håndvaske og toiletter, og tør efter behov over med rengøringsservietter
- Rengør toiletkummen efter behov
- Tøm skraldespandene, når de er halvt fulde, og sæt nye poser i

Støvsuger, rengøringsservietter, klude og rengøringsmidler står i gangen ved toiletterne. Affald kan smides i containeren bag træporten til højre for enden af bygningen eller i containeren på Guldsmedgade.

Er rengøringen ikke i orden, opkræver vi et rengøringsgebyr på 250 kr.

## Gården
Vi deler gården med naboerne. Hold derfor dine deltagere nær Hjerterums hoveddør, og undgå længere pauser og høj larm i gården. Korte pauser på 10 minutter til frisk luft eller en smøg er selvfølgelig fint – så er der plads til alle.

## Ansvar
${DISCLAIMER}

Føl jer hjemme, og nyd jeres tid i Hjerterum ♡ – Team Hjerterum`,
    sources: ["guidelines-for-undervisere"]
  },
  {
    path: "/lej-hjerterum/vilkaar", lang: "da", section: "lej",
    kicker: "Lej Hjerterum", title: "Vilkår", em: "for leje af sal",
    lead: "Betaling, aflysning, rengøring – og hvordan du bedst kommunikerer med os.",
    description: "Vilkår for leje af salen i Hjerterum: betaling, aflysningspolitik, rengøringsgebyr og kommunikationspolitik.",
    card: { title: "Vilkår for leje af sal", text: "Betaling, aflysning, rengøring og kommunikation." },
    body: `Du sender en bookingforespørgsel via [prisberegneren](/beregner). Har du spørgsmål, så skriv til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).

## Pris
Prisen for at leje salen beregner du hurtigt og nemt med vores [prisberegner](/beregner). Den fulde prisliste står under [Priser](/lej-hjerterum#priser).

## Betaling og oprettelse af event {#betaling}
Når vi har aftalt en booking med dig, sender vi dig en faktura pr. mail. Vi går først i gang med at oprette dit event på hjemmesiden og Facebook, når vi har modtaget betalingen. Spørgsmål om fakturaer: [regnskab@holistisk.org](mailto:regnskab@holistisk.org).

## Aflysning {#aflysning}
Hjerterum beholder altid grundprisen, uanset hvornår du aflyser – den dækker administrationen. Ved forløb og gentagne events beholder vi kun én grundpris.

| Du får tilbage af restbeløbet | Hverdage | Weekender og forløb |
|---|---|---|
| 100 % | ved aflysning 4 uger før | ved aflysning 8 uger før |
| 50 % | ved aflysning 3 uger før | ved aflysning 6 uger før |

**Aflysning i sidste øjeblik** koster et gebyr på 250 kr. Du undgår gebyret ved at aflyse senest dagen før kl. 14.00.

Bliver du forhindret i sidste øjeblik, kan du selv aflyse dit event og dermed spare gebyret. Muligheden må kun bruges ved aflysninger i sidste øjeblik – ikke ved almindelige aflysninger. Send altid en mail til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org) om, at du har aflyst. [Se guiden til aflysning](https://docs.google.com/document/d/1Z_eatceSFqqgWLqFq0AEqWP2fce0wayFvvHKr3YZWzA/edit?usp=sharing).

## Rengøring efter event
Sørg for, at salen er ren og pæn, når du går, så den er klar til de næste. Se [kravene til rengøring](/lej-hjerterum/praktisk#rengoering). Er rengøringen ikke i orden, opkræver vi et rengøringsgebyr på 250 kr.

## Kommunikation {#kommunikation}
**Mail er kommunikationsvej nr. 1.** Skriv altid først til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org). Her fanger du os bedst, og alle bookinger, spørgsmål og henvendelser håndteres via mail.

**Hjerterums Messenger-side – til PR og akutte henvendelser.** [Messenger-siden](https://www.facebook.com/share/1BNdSQTGWU/?mibextid=wwXIfr) bruges især til PR-materiale fra undervisere (fx links til opslag, reels eller andet for allerede oprettede events) og til akutte henvendelser, der kræver hurtigt svar. Skriv gerne dit telefonnummer ved akutte henvendelser, så kontakter vi dig hurtigst muligt.

**Hjerterum Café.** Der er ofte bestyrelsesmedlemmer i caféen torsdag eftermiddag. Kig forbi, eller aftal et møde med en af os.

**Det bruger vi ikke.** Send ikke private Messenger-beskeder til bestyrelsesmedlemmer, og ring eller skriv ikke til deres private telefonnumre. Når vi bruger Hjerterums fælles kanaler, går henvendelser ikke tabt, og flere i bestyrelsen kan hjælpe ved behov.

## Ansvar
${DISCLAIMER}`,
    sources: ["betingelser-for-leje-af-sal", "fakturaer", "hjerterum-betalinger"]
  },
  {
    path: "/lej-hjerterum/markedsfoering", lang: "da", section: "lej",
    kicker: "Lej Hjerterum", title: "Markedsføring", em: "af dit event",
    lead: "Dit event bliver vist på vores hjemmeside og Facebook-side med over 6.000 følgere. Her er, hvordan du når endnu længere ud.",
    description: "Sådan markedsfører du dit event i Hjerterum – med en liste over relevante Facebook-grupper.",
    card: { title: "Markedsføring af dit event", text: "Råd og en liste over relevante Facebook-grupper." },
    body: `Når du booker Hjerterum, får dit event automatisk en god eksponering: det bliver offentliggjort både på vores hjemmeside og på vores Facebook-side, som har over 6.000 følgere.

Vil du nå endnu længere ud, er det dit eget ansvar. En effektiv måde er at købe annoncer på Facebook. Du kan også invitere dit netværk og dele dit event i relevante grupper på Facebook. Her er vores forslag – læs altid gruppens retningslinjer, før du deler, så du er sikker på, at dit event passer ind.

${FACEBOOK_GROUPS}`,
    sources: ["markedsforing"]
  },
  {
    path: "/lej-hjerterum/dine-events", lang: "da", section: "lej",
    kicker: "Lej Hjerterum", title: "Administrér", em: "dine events",
    lead: "Se, hvor mange der er tilmeldt, ret dit event, eller aflys det – i medlemsområdet.",
    description: "Sådan administrerer du dine events i Hjerterum: deltagere, redigering og aflysning.",
    card: { title: "Administrér dine events", text: "Deltagere, redigering og aflysning." },
    body: `Events, du har oprettet i medlemsområdet, administrerer du samme sted:

1. Log ind i [medlemsområdet](/member-portal/events).
2. Vælg **Mine events**.
3. Her ser du dine kommende events, hvor mange der er tilmeldt, og om eventet er godkendt.
4. Vælg **Redigér** for at rette titel, tekst, tidspunkt eller pris – eller **Annullér event** for at aflyse.

Aflyser du tæt på eventet, så læs [reglerne for aflysning](/lej-hjerterum/vilkaar#aflysning), og send altid en mail til [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).

## Events i den tidligere kalender
Events, der er oprettet i den tidligere kalender på holistisk.org, administrerer du stadig dér: log ind, åbn dit event i kalenderen, vælg **Admin** over eventets billede og derefter **Dashboard** for at se dine deltagere og rette eventet. [Se videovejledningen](https://www.youtube.com/watch?v=aKVv_aVjuTA).`,
    sources: ["administrer-dine-events"]
  },

  // ---------------------------------------------------------------- Vision / om os
  {
    path: "/om-os", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Mere nærvær.", em: "Mindre støj.",
    lead: "Hjerterum er skabt omkring troen på, at de bedste oplevelser vokser frem, når mennesker mødes med åbenhed og tid. Vi samler foredrag, behandlinger, musik, samtaler og små pauser i hverdagen – i et rum, hvor man må komme, som man er.",
    description: "Hvad er Hjerterum? Visionen, teamet, historien, foreningen og Tribes.",
    card: { title: "Mere nærvær. Mindre støj.", text: "Visionen, menneskene og historien bag Hjerterum." },
    body: `## Hvad er Hjerterum?
Lad os starte med at sige, hvad vi **ikke** er:

- Ikke et sted med færdige svar eller quick fixes.
- Ikke en lukket gruppe eller sekt.
- Ikke bundet til én bestemt tro, religion eller politisk holdning.
- Ikke et sted uden plads til humor og lethed.

**Hjerterum er for alle.** Hjerterum er et åbent og trygt rum for fællesskab, kreativitet og personlig udvikling. Her kan du deltage i en masse nærende og meningsfulde events – fx foredrag, koncerter, yoga, breathwork, workshops og sociale arrangementer. Er du underviser eller facilitator, er du altid velkommen til at [bruge vores sted](/lej-hjerterum).

**Bliv en del af Tribes.** Du kan også blive en del af [Hjerterum Tribes](/om-os/tribes) – en lille gruppe på 5–8 medlemmer, som du er en del af for en tid. Tribes samler Hjerterums medlemmer i et nærende fællesskab og giver mulighed for at lære dig selv og andre mennesker dybere at kende.

Uanset om du søger ro, inspiration eller nye bekendtskaber, er du velkommen. Vi tror på, at god energi og åbenhed skaber gode møder – mellem mennesker og med sig selv.

Velkommen til et sted, der **giver plads til at være** ♡

## En forening
Hjerterum er en forening, Hjerterum F.M.B.A., som drives af medlemmernes kontingent, leje af salen og donationer – og af et team af ildsjæle. [Læs om foreningen, vedtægterne og generalforsamlingen](/om-os/foreningen).`,
    image: { src: "/media/2026-06-vision.webp", alt: "Drømmefanger i sollys" },
    children: ["/om-os/teamet", "/om-os/historien", "/om-os/tribes", "/om-os/foreningen", "/om-os/artikler", "/om-os/himalayan-hermitage"],
    sources: ["vision"]
  },
  {
    path: "/om-os/teamet", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Teamet", em: "bag Hjerterum",
    lead: "Foreningen Hjerterum ledes af et team af dedikerede ildsjæle, der samtidig udgør bestyrelsen.",
    description: "Mød bestyrelsen og teamet bag Hjerterum i Aarhus – og hvordan vi arbejder.",
    card: { title: "Teamet bag", text: "Bestyrelsen, og hvordan vi arbejder." },
    body: `![Bestyrelsen i Hjerterum](/media/2025-12-pcgo-hdy.webp "Fra venstre: Gitta Kaas, Douglas Crawford, Jacob Hauge (formand), Frederik Kærgaard (kasserer) og Lisbeth Jespersen (næstformand).")

## Bestyrelsen
- **Jacob Hauge** – grundlægger, formand og teamleder (frivillig)
- **Lisbeth Jespersen** – næstformand (ansat 8 timer om ugen). Bookinger med nye undervisere, generelle henvendelser samt ind- og udmeldelser.
- **Frederik Kærgaard** – kasserer (ansat 5 timer om ugen). Økonomi, fakturaer m.m.
- **Gitta Kaas** – (ansat 5 timer om ugen). SoMe og PR samt bookinger med faste undervisere.
- **Douglas Crawford** – bestyrelsesmedlem (frivillig). Medlemssystem, hjemmeside, vedligeholdelse og café.

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
    path: "/om-os/historien", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Historien", em: "bag Hjerterum",
    lead: "Et eventyr, der begyndte i et lille lydstudie på Karupvej i 2016 – og som i dag har til huse i en stille oase bag Guldsmedgade.",
    description: "Historien om Hjerterum i Aarhus fra 2016 til i dag.",
    card: { title: "Historien bag Hjerterum", text: "Fra et lydstudie på Karupvej til Guldsmedgade." },
    body: `I hjertet af Aarhus, på den hyggelige Guldsmedgade, gemmer sig et magisk sted kaldet Hjerterum – et rum, hvor man kan sænke skuldrene, give slip på masken og mærke hjertet slå frit. Men som alle eventyr begyndte det et helt andet sted.

## 2016 – Et eventyr tager sin begyndelse
Jacob Hauge arbejdede i efteråret 2016 i sit lille lydstudie på Karupvej. Væggene var fyldt med kabler, mikrofoner og kreativ energi, men rummet føltes ofte tomt. Han længtes efter menneskelig nærhed og dybere mening. Midt i lyden af sin egen musik opstod visionen om et sted, hvor mennesker kunne mødes og udfolde sig – et hjem for hjertet.

## 2017 – Et møde, der tændte lys
Kort tid efter krydsede hans vej Sophia Hasselbjørn ved et julearrangement. Sophia havde selv fået inspiration til et lignende sted, og sammen mærkede de et særligt kald. Som i et stille, magisk partnerskab begyndte de at bygge bro mellem drøm og virkelighed. Allerede i januar 2017 åbnede de dørene, og Hjerterums første arrangementer fyldte rummet med varme smil, nysgerrige blikke og en dragning mod fællesskab.

## Nye kræfter og voksende energi
Efter et halvt år måtte Sophia tage afsked, og Celina Eyja trådte ind som den første lønnede medarbejder. Aurora Gayatri begyndte at bruge det lille behandlerlokale – en skabende energi, der senere skulle blive uundværlig for Hjerterums udvikling.

## 2018 – Et sted at udfolde sig
I 2018 ventede nye eventyr i Frichsparken. Her voksede Hjerterum til et sted med fem behandlerlokaler og en stor sal, hvor energien kunne udfolde sig fuldt ud. Aurora og Marlene Solfred sluttede sig til teamet, og selvom praktiske og økonomiske udfordringer truede med at mørkne himlen, holdt fællesskabet og visionen fast. Løsninger blev fundet!

## 2019 – At finde sit sande hjem
Som i alle eventyr kræver det mod at finde sit rette sted. I 2019 flyttede Hjerterum til Mejlgade 95, hvor fokus igen blev på arrangementer og fællesskab. Teamet bestod nu af Aurora, Douglas Crawford, Mariam Gabriella, Jan Gabriel og Jacob. Sommeren 2020 bragte igen stor forandring, da Jacob måtte træde tilbage på grund af stress. Aurora blev forkvinde og daglig leder, og Soroush Zand kom til som kasserer. Et sandt hjerteteam! Samme år holdt Hjerterum også online events, så fællesskabet kunne mødes under nedlukningen.

![Salen på Mejlgade 95 i 2019](/media/2019-08-hc-sal-1-800-photo.webp "Salen på Mejlgade 95 i 2019.")

## 2021 – En stille oase i midtbyen
I begyndelsen af 2021 fandt Hjerterum sin nuværende skjulte perle på Guldsmedgade – centralt, men alligevel en stille oase bag byens summen. Soroush blev konstitueret leder i 2024 og overtog formelt ledelsen fra Aurora i starten af 2025, før Jacob vendte tilbage som formand i efteråret 2026.

## Et levende eventyr for hjertet
Hjerterum er ikke bare et center, men et levende eventyr – et sted, hvor hjertet altid har plads, og hvor hvert menneske kan finde sin egen sti – både ind i sig selv og tilbage ind i fællesskabet ♡`,
    sources: ["historien-bag-hjerterum"]
  },
  {
    path: "/om-os/tribes", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Hjerterum", em: "Tribes",
    lead: "En tribe er en lille gruppe på 5–8 medlemmer, der skaber et nærende fællesskab – og en mulighed for at lære dig selv og andre dybere at kende.",
    description: "Hjerterum Tribes: små, faste grupper for medlemmer af Hjerterum.",
    card: { title: "Hjerterum Tribes", text: "Små, faste grupper med plads til at blive set." },
    body: `![Hjerterum Tribes](/media/2026-04-hjerterum-2.webp)

Tribes eksisterer for at skabe nærende fællesskaber, der kan give mening og sammenhæng i den enkeltes liv. Det er en unik mulighed for at lære dig selv og andre mennesker dybere at kende og få en meningsfuld og fortrolig forbindelse i et lille og trygt fællesskab.

## Tribemødet
Du mødes med din tribe én gang om måneden – eller oftere, hvis I bliver enige om det. I skiftes til at være ordstyrer. Før hvert møde sender vi materiale ud med et hovedtema og en række underspørgsmål, som I kan arbejde med. På den måde er der en struktur, der hjælper jer med at kaste lys på nogle essentielle områder hos jer selv og hinanden.

Vores intention er at komme med temaer, som I alle på hver jeres måde kan relatere til i jeres daglige liv. Der opstår noget magisk, når man begynder at se, at ens udfordringer ikke er unikke, men deles af andre – at de i virkeligheden er dybt menneskelige og fælles. I mødet med andres genkendelse kan følelsen af at stå alene opløses, og den ensomhed og skam, mange af os bærer på, kan begynde at slippe.

Temaerne varierer, men fælles for dem er, at de retter opmærksomheden mod noget grundlæggende og dybt hos jer hver især. Vi vil bringe emner frem, der vækker jeres sårbarhed og autenticitet, så I kan opleve at blive set på et dybere plan – for den, I er, og med det, I bærer på.

Et typisk tribemøde varer 2 timer. I kan lave jeres egen struktur eller bruge vores programskabelon:

| Tid | Program |
|---|---|
| 19.00 | Åbning – fx et lille musikstykke eller en kort guidning |
| 19.15 | Delerunde og "siden sidst" – check-in |
| 20.00 | Dagens tema |
| 21.00 | Afslutning |

## Et større fællesskab
Jeres tribe er – sammen med andre tribes – en del af et større netværk, så der er rig mulighed for at lære andre at kende. Der bliver arrangeret tribe-arrangementer som caféaftener, koncerter og foredrag. Jo flere der er med, jo flere events bliver der sat op – i og uden for Hjerterum.

## Hvor længe varer en tribe?
En tribe har ingen fast udløbsdato – den fortsætter, så længe der er lyst og vilje. Ønsker du at træde ud, kan du frit gøre det. Vi anbefaler dog, at I til det første møde aftaler et fælles commitment – fx 6 måneder – så der opstår tillid, kontinuitet og dybde i gruppen. Træder et medlem ud, så skriv til os, så hjælper vi jer med at finde et nyt.

## Tilmelding
Er du klar til at gå et spadestik dybere sammen med andre – og opleve en dybere forbindelse til dig selv og andre? [Send en ansøgning](https://tribes.dk/ansog). Tag dig god tid til den: jo tydeligere et billede vi får af dig, desto nemmere er det for os at skabe det helt rigtige match. Du skal være aktivt medlem af Hjerterum for at være med – er du ikke medlem, så [læs om medlemskab](/medlemskab).

Når vi har behandlet din ansøgning og fundet en tribe til dig, sætter vi dig i forbindelse med den. Kan vi mod forventning ikke tilbyde dig en plads, skriver vi til dig.

Vi håber, du vil finde forbindelse, fællesskab og mening med Hjerterum Tribes ♡

*Deltagelse i Hjerterum Tribes sker på eget ansvar. Hjerterum skaber rammen og strukturen, men vi forventer, at du som deltager har en modenhed, så du kan tage ansvar for dig selv i gruppen og for det, der måtte komme op. Opstår der en konflikt i gruppen, opfordrer vi jer til at forsøge at løse den sammen. Bliver noget mod forventning for svært, kan I kontakte os på [tribes@holistisk.org](mailto:tribes@holistisk.org), så hjælper vi efter bedste evne.*`,
    sources: ["hjerterum-tribes"]
  },
  {
    path: "/om-os/foreningen", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Foreningen", em: "Hjerterum",
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
  {
    path: "/om-os/artikler", lang: "da", section: "om-os",
    kicker: "Vision / om os", title: "Artikler", em: "fra Hjerterum",
    lead: "Beretninger fra aftener og foredrag i Hjerterum – skrevet af gæster, der var med.",
    description: "Artikler og beretninger fra arrangementer i Hjerterum.",
    card: { title: "Artikler", text: "Beretninger fra aftener og foredrag i huset." },
    body: `- ["Det er bare en følelse" – en journaliststuderendes beretning om breathwork](/behandling/breathwork)
- [Kan man vaske sine følelser i lavendelolie?](#lavendel)
- [Sex skal mærkes med hele kroppen](#den-hellige-seksualitet)

## Kan man vaske sine følelser i lavendelolie? {#lavendel}
*Af [Lita Domino](http://www.8000.dk), 23. april 2019.*

Vi kender den alle: duften af angstens sved. Men hvad sker der, når vi er grebet af den frygtelige følelse og samtidig inhalerer en duft af lavendel? Kan vi orientere os anderledes klart, kan vi finde ro via lugtesansen, når følelser som fx angst overmander os?

![Æteriske olier og blomster](/media/2019-05-1140-1.webp)

Ubevidst eller bevidst reagerer vi på hinanden og os selv gennem lugtesansen. Vi orienterer os efter den; vi tiltrækkes af dem, der efter vores egen vurdering dufter godt, og frastødes af dem, der dufter giftigt eller alarmerende. Det ligger i vores overlevelse at kunne orientere os via sanserne. Vi kan på den måde påvirke kroppen til at kode vores bevidsthed om via sanserne. Så når vi mærker angst, kan lavendel virke beroligende. Når vi er deprimerede, kan pebermynte virke opløftende.

Jeg er til infoaften i Hjerterum, og aftenens tema er æteriske olier ved Marianne Grene og Aurora Gayatri. Vi sidder i en rundkreds på gulvet, og de to kvinder deler viden om duftens betydning for helbredet, følelserne, miljøet og bæredygtigheden med otte glade tilhørere. Rummet var ikke svært at finde – man skulle bare gå efter duften af rosmarin.

Mange forskellige dufte bliver budt rundt, og vi får fortællinger om deres gunstige virkning på alverdens små og store lidelser – lige fra problemer med helbredet til ønsker om en mere bæredygtig måde at dyrke parfume på, og hvordan vi skærer ned på al den kemi, vi er ved at drukne i.

Vi taler om selvkærlighed og omsorg for andre, og vi taler om det hele menneske, og hvordan vi kan tage godt vare på os selv som de sensitive skabninger, vi er.

## Sex skal mærkes med hele kroppen {#den-hellige-seksualitet}
*Den hellige seksualitet – foredrag med Celestine Andersen. Af [Lita Domino](http://www.8000.dk), 31. marts 2019.*

![Celestine Andersen](/media/2019-05-1133-1.webp)

Hun er en levende fortæller, Celestine Andersen, som med hjerte og humor fortæller om den vigtige balance mellem lyse og mørke tangenter i livet. Hun inviterer publikum til at lege med og undersøge, hvordan det er at se indad – at skabe bevidsthed og nærvær i kroppen for at åbne op for større glæde og livskraft.

Sammen med Celestine lukker vi alle øjnene for at undersøge, hvordan vores livskraft har det i dette øjeblik. Man behøver ikke engang at tage tøjet af for at undersøge kroppen som mirakelsted indeni. Jeg kan mærke min livskraft pulsere i hele kroppen.

### Tantra
Jeg er til foredrag i Hjerterums nye lokaler i hjertet af Aarhus. Her er fuldt hus, for mange er nysgerrige på livskraft og vitalitet og vil gerne vide mere om det nye hotte i moderne tid: tantra. Lige nu er tantramassøren og foredragsholderen Celestine Andersen i byen. Hun kommer fra København og ejer Edens Have, hvorfra hun giver al sin visdom og ildhu videre til søgende mennesker.

### Den hellige seksualitet
Jeg blev meget optaget af Celestines fortællinger om seksualdriften som livsenergi. Hun fortalte, at vi har tre energicentre i kroppen: energicentret for sex nederst i kroppen, energicentret i hjertet midt i kroppen og energicentret for ånd på toppen af hovedet. Ud fra denne model talte hun om det maskuline og det feminine i mennesket – om at fordybe oplevelsen af seksualiteten gennem vejrtrækning, om at adskille orgasme og udløsning, og om at træne nærvær og vitalitet. En smuk helhedstanke om at være mere opmærksom på vores indre og forbindelsen til andre.

Den hellige seksualitet er en sammensmeltning af sex, hjerte og spiritualitet.

Tusind tak til Celestine Andersen og til Hjerterum for at huse hende og dette spændende foredrag.`,
    sources: ["artikler"]
  },
  {
    path: "/om-os/himalayan-hermitage", lang: "da", section: "om-os",
    kicker: "Vision / om os · Samarbejdspartner", title: "Himalayan", em: "Hermitage",
    lead: "Pilgrimsrejser til Nepal, Tibet og Bhutan med Sisse Budolfsen og Alex d'Artois – med meditation, klostre og Himalayas smukke landskaber.",
    description: "Himalayan Hermitage: pilgrimsrejser og meditationsrejser i Nepal, Tibet og Bhutan.",
    card: { title: "Himalayan Hermitage", text: "Pilgrimsrejser til Nepal, Tibet og Bhutan." },
    body: `![Sisse Budolfsen og Alex d'Artois](/media/2019-08-sisse-alex.webp "Sisse og Alex.")

## Baggrund
Himalayan Hermitage blev oprettet af stor kærlighed til Himalaya-regionen. I mere end ti år har danske Sisse Budolfsen med udgangspunkt i Kathmandu i Nepal guidet grupper i Himalaya – nu i samarbejde med sin canadiske partner Alex d'Artois.

Det, der gør Himalayan Hermitages pilgrimsrejser til Nepal, Tibet og Bhutan helt unikke, er muligheden for at komme helt tæt på den spirituelle kulturarv, der lever i disse isolerede egne. Kombineret med vandreture i Himalayas smukke landskaber besøger vi klostre, templer og huler, hvor yogier har praktiseret meditation gennem årtusinder.

Det er intet mindre end episke rejser ind i den autentiske buddhistiske Himalaya-kultur, hvor vi undervejs stifter bekendtskab med meditation og tibetansk buddhistisk filosofi.

## Underviserne og guiderne
Som oftest er det Sisse og Alex, der er undervisere og "lokale" guider på pilgrimsrejserne. Med deres kendskab til både nepalesisk og tibetansk og en baggrund i studier af buddhistisk filosofi på et tibetansk buddhistisk kloster i Kathmandu giver de et helt særligt indblik i både kulturen og religionen i Himalaya.

## Hvad tager man med hjem?
Himalaya-regionen og den spirituelle kulturarv, der lever i kulturerne og menneskene, har det med at røre folks hjerter. Det er forfriskende at opleve en anden måde at leve på, som ikke handler om materielle mål, men i højere grad er præget af nærvær og af at være til stede i sit liv. Ofte hører vi fra rejsedeltagerne, at de tager denne form for nærvær med sig hjem. På pilgrimsrejserne introducerer vi dagligt meditationspraksis, så du kan lære dit sind at kende og få en daglig praksis med hjem til din hverdag.

## Vil du med på rejse?
- [10-dages rejse til Buddhas fødested og junglesafari i Nepal](https://himalayanhermitage.com/pilgrimage/itinerary-for-meditation-journey-in-nepal-bhutan/)
- [15-dages meditationsrejse i Nepal og Bhutan](https://himalayanhermitage.com/product-category/14-day-with-buthan/)

Mange hilsner fra Kathmandu – Sisse og Alex`,
    gallery: {
      title: "Fra rejserne",
      pictures: [
        { src: "/media/2019-08-bell-with-view.webp", alt: "Klokke med udsigt over bjergene" },
        { src: "/media/2019-08-day-4-gompa-locations-option-b.webp", alt: "Stupa i Bhutan" },
        { src: "/media/2019-08-day-6-dordenma-buddha-in-thimphu.webp", alt: "Dordenma-buddhaen i Thimphu" },
        { src: "/media/2019-08-forrest-stupashrine.webp", alt: "Helligdom i skoven" },
        { src: "/media/2019-08-horses-at-taktsang.webp", alt: "Heste ved Taktsang" }
      ]
    },
    sources: ["himalayan-hermitage-2", "himalayan-hermitage"]
  },

  // ---------------------------------------------------------------- Kontakt
  {
    path: "/kontakt", lang: "da", section: "kontakt",
    kicker: "Kontakt", title: "Lad os høre", em: "fra dig",
    lead: "Har du spørgsmål til medlemskab, events eller mulighederne i Hjerterum, er du velkommen til at række ud.",
    description: "Kontakt Hjerterum, Guldsmedgade 26B, 8000 Aarhus C: mail, betaling, parkering og adgangsforhold.",
    card: { title: "Lad os høre fra dig", text: "Adresse, mail, parkering og betaling." },
    body: `## Adresse
**Hjerterum**, Guldsmedgade 26B, st., 8000 Aarhus C

Vil du se stedet? Aftal en tid til fremvisning pr. mail.

## Skriv til os
- **Medlemskab og bookinger:** Team Hjerterum – [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org)
- **Idéer til events:** [events@holistisk.org](mailto:events@holistisk.org)
- **Tribes:** [tribes@holistisk.org](mailto:tribes@holistisk.org)
- **Økonomi og regnskab:** kassereren – [regnskab@holistisk.org](mailto:regnskab@holistisk.org)
- **Andre henvendelser:** Jacob Hauge, formand – [jh@holistisk.org](mailto:jh@holistisk.org)

Send venligst kun din henvendelse til én af adresserne. Du kan forvente svar inden for 3–5 hverdage.

**Undervisere i nødstilfælde:** se [kommunikationspolitikken](/lej-hjerterum/vilkaar#kommunikation). Teamet kan ikke kontaktes via privat Messenger eller sms.

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

export const SITE_PAGES: SitePage[] = [...pages, ...SITE_PAGES_EN];
