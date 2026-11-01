import { membershipPlans } from "../../membership.js";
import { SIGNUP_URL } from "../../site/pages.js";
import { CURRENT_SITE, sitePage, sitePageText } from "../site-knowledge.js";

/** Requested: "Hej \"navn\" Jeg er Saga. Spørg mig f. eks. om vedtægter, beslutninger, sager, møder, arrangementer og
 * medlemsskab. Og så skal hun sættes ind i disse ting - ikke mindst medlemsskaber". Asked later: "tjek også om der er andre områder
 * hun skal have opdateret sin viden" - the text read from holistisk.org on 2 Oct 2026 had grown old (a trial period "inden 15. oktober"
 * still offered). What she knows now is what hjerterum.info says about membership (its pages, the day they are deployed), the plans
 * as the platform sells them, and the move from MembershipWorks. The statutes (§ 4), the member figures and the board's decisions
 * about membership come from their own sections. */

const kr = (minor: number) => `${(minor / 100).toLocaleString("da-DK")} kr.`;

const MEMBERSHIP_PAGES = ["/medlemskab", "/medlemskab/vilkaar"];

export function membershipFacts(): string {
  return [
    `Kilde: hjemmesiden ${CURRENT_SITE} (siderne nedenfor, som de står på siden nu). Vedtægternes § 4 om medlemskab står under VEDTÆGTER.`,
    "MEDLEMSKABER OG PRISER (pr. måned / pr. år):",
    ...Object.values(membershipPlans).map(p => `- ${p.name}: ${kr(p.month)} / ${kr(p.year)}. ${p.description}${p.benefits ? "" : " Giver ikke adgang til medlemsfordelene."}`),
    // Requested: "Som medlem af Hjerterum kan man deltage i Cirkler" - the details are Saga's CIRKLER section (cockpit/cirkler.ts).
    "CIRKLER: gratis for medlemmer med Standard, Generøst og Reduceret pris - ikke Support. Tilmelding fra medlemsområdet.",
    "Står en dato for et tilbud (fx en prøveperiode) i teksten, så hold den op mod dagens dato: er den passeret, gælder tilbuddet ikke længere - sig det, og at hjemmesiden måske skal opdateres.",
    ...MEMBERSHIP_PAGES.map(sitePage).filter((page): page is NonNullable<typeof page> => !!page).map(sitePageText),
    "OVERGANGEN (Hjerterums blueprint): Medlemskaber og betalingsaftaler i MembershipWorks bevares og flyttes ikke. Det nye system læser dem kun og giver de aktive medlemmer adgang. "
      + `Indmeldelse sker indtil videre via ${SIGNUP_URL} (MembershipWorks), med de samme fire medlemskaber. Eksisterende medlemmer får ikke en ny prøveperiode ved import.`
  ].join("\n");
}
