import { describe, expect, it } from "vitest";
import { cleanMailText } from "./mailText";

describe("cleanMailText", () => {
  it("keeps the words and drops links, tracking and footers", () => {
    const raw = `hej jeg må desværre opsige mit medlemsskab hos jer. de bedste hilsner Kamilla <https://www.avast.com/sig-email?utm_medium=email&utm_source=link&utm_campaign=sig-email&utm_content=webmail> Virus-free.[www.avast.com](https://www.avast.com) <https://www.avast.com/sig-email?utm_medium=email> <#DAB4FAD8-2DD7-40BB-A1B8-4E2AA1F9FDF2> skriv til kamilla@example.dk`;
    const out = cleanMailText(raw);
    expect(out).toBe("hej jeg må desværre opsige mit medlemsskab hos jer. de bedste hilsner Kamilla www.avast.com skriv til kamilla@example.dk".replace(" www.avast.com", ""));
  });
});

import { mailBody, mailSnippet, readableMail } from "./mailText";
describe("readableMail", () => {
  it("keeps line breaks of a new mail, with no links", () => {
    expect(mailBody("Hej\r\n\r\n\r\n\r\nSe https://x.dk/a  her\n  Hilsen   Jacob")).toBe("Hej\n\nSe her\nHilsen Jacob");
  });
  it("breaks an old one-line booking mail at its labels and drops the empty fields and the file boilerplate", () => {
    const old = "Hej, Her er de 1 forespørgsel(er). --- Forespørgsel 1 (06.10.2026, 14.04) --- Navn: Olivia Email: o@example.com Telefon: 30722279 Beskrivelse: På denne fredag. Videolinks: (Ingen links angivet) Bemærkninger: Instagram: Nalii PR-materiale: Forsidebillede: Foto.jpg (vedhæftet; ikke gemt i materialebank) PR-billeder til sociale medier: (Ingen filer indsendt) Filopbevarin";
    const out = readableMail(old);
    expect(out).toContain("\nNavn: Olivia\nEmail: o@example.com\nTelefon: 30722279\nBeskrivelse:");
    expect(out).not.toMatch(/Ingen|Instagram|Filopbevarin|PR-materiale/);
  });

  // Requested: "Der skal være MAX 1-2 linjers preview af mailen" - "du skal huske at tilføje linjeskift i mailsene".
  it("breaks a long block into paragraphs, puts the greeting alone, and makes a short preview", () => {
    const block = "Kære Lisbeth Det var hyggeligt at møde dig. Så er jeg klar med teksten til næste arrangement den 28 oktober kl. 19.00. Jeg håber der er tid nok til at få deltagere nok. Vi skal have min. 6 deltagere. I november vil jeg hellere have tirsdag den 27/11. Jeg venter med at sætte det hele op til du har bekræftet datoen. Kender du det med mange krav og udfordringer i hverdagen? Kender du det, at når der er mange ting, der skal nås, begynder du at prioritere dig selv ned i rækken?";
    const out = readableMail(block);
    expect(out.startsWith("Kære Lisbeth\n\nDet var hyggeligt")).toBe(true);
    expect(out.split("\n\n").length).toBeGreaterThan(2);
    expect(out.split("\n\n").every(p => p.length <= 300)).toBe(true);
    expect(readableMail("Security notification ------------------- Note: login")).toMatch(/^Security notification\n+Note: login$/);
    const snip = mailSnippet(block);
    expect(snip.startsWith("Det var hyggeligt at møde dig.")).toBe(true);
    expect(snip.length).toBeLessThanOrEqual(182);
    expect(snip.endsWith("…")).toBe(true);
  });
});
