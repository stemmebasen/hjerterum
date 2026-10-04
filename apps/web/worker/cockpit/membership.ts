import { membershipPlans } from "../../membership.js";

/** Requested: "Hej \"navn\" Jeg er Saga. Spørg mig f. eks. om vedtægter, beslutninger, sager, møder, arrangementer og
 * medlemsskab. Og så skal hun sættes ind i disse ting - ikke mindst medlemsskaber". What Hjerterum says about its
 * membership on holistisk.org (read 2 Oct 2026), and the plans as the new platform sells them. The statutes (§ 4),
 * the member figures and the board's decisions about membership come from their own sections. */

const kr = (minor: number) => `${(minor / 100).toLocaleString("da-DK")} kr.`;

export const MEMBERSHIP_URLS = {
  join: "https://holistisk.org/bliv-medlem/",
  benefits: "https://holistisk.org/fordele-ved-medlemskab/",
  terms: "https://holistisk.org/medlemskabs-betingelser/"
} as const;

export const MEMBERSHIP_FACTS = [
  `Kilder: ${MEMBERSHIP_URLS.join} (bliv medlem), ${MEMBERSHIP_URLS.benefits} (fordele), ${MEMBERSHIP_URLS.terms} (vilkår) - læst 2. oktober 2026. Vedtægternes § 4 om medlemskab står under VEDTÆGTER.`,
  "MEDLEMSKABER OG PRISER (pr. måned / pr. år):",
  ...Object.values(membershipPlans).map(p => `- ${p.name}: ${kr(p.month)} / ${kr(p.year)}. ${p.description}${p.benefits ? "" : " Giver ikke adgang til medlemsfordelene."}`),
  "PRØVEPERIODE: Melder man sig ind inden 15. oktober (2026), får alle, der ikke har været medlem før, 30 dages gratis prøvemedlemskab. Opsiges det inden prøveperioden udløber, opkræves intet. "
    + "En gratis prøveperiode kan kun bruges én gang.",
  "FORDELE (står på holistisk.org):",
  "- Rabat på events og ofte helt gratis adgang.",
  "- Tilbud på Hjerterums egne events (Hjerterum Open Events: koncerter, foredrag, tema-aftener, fællesspisning, filmaftener mv.), ofte gratis eller til særlig reduceret pris.",
  "- Nemmere booking af events, når man er logget ind (navn og mail udfyldes).",
  "- Rabat på økologisk specialkaffe, andre specialdrikke og biodynamisk kage/snacks i caféen hver torsdag eftermiddag og til andre arrangementer.",
  "- Tilbud på events hos Hjerterums samarbejdspartnere i Aarhus og Østjylland.",
  "- Mulighed for at deltage i foreningen med bidrag, idéer og ønsker - og man støtter Hjerterum økonomisk.",
  "VILKÅR (står på holistisk.org):",
  "- Medlemskabet er personligt og kan ikke overdrages eller deles.",
  "- Betaling med Dankort/VISA-Dankort, VISA, VISA Electron og Mastercard. Første betaling trækkes ved tilmelding, derefter automatisk dagen før en ny periode.",
  "- Medlemmet sørger selv for, at kortet i systemet er gyldigt. Fejler en kortbetaling, er man stadig medlem og forventes at betale, til man opsiger.",
  "- Gyldigt fra oprettelsen, til det opsiges. Opsigelse eller pause (fx et par måneder) sker ved mail til hjerterum@holistisk.org.",
  "- Bindingsperiode: løbende måned + 1 måned, dvs. man betaler én gang mere efter opsigelsen.",
  "- Kontooplysninger gemmes højst 2 år til statistik.",
  "OVERGANGEN (Hjerterums blueprint): Medlemskaber og betalingsaftaler i MembershipWorks bevares og flyttes ikke. Det nye system læser dem kun (spejling via CSV-import) og giver de aktive medlemmer adgang. "
    + "Planen er, at nye medlemmer melder sig ind i det nye system med de samme fire medlemskaber og de første 30 dage gratis - men betaling dér er ikke åbnet endnu, så indtil videre sker indmeldelse via holistisk.org (MembershipWorks). "
    + "Eksisterende medlemmer får ikke en ny prøveperiode ved import."
].join("\n");
