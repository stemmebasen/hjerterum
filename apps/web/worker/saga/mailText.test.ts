import { describe, expect, it } from "vitest";
import { cleanMailText } from "./mailText";

describe("cleanMailText", () => {
  it("keeps the words and drops links, tracking and footers", () => {
    const raw = `hej jeg må desværre opsige mit medlemsskab hos jer. de bedste hilsner Kamilla <https://www.avast.com/sig-email?utm_medium=email&utm_source=link&utm_campaign=sig-email&utm_content=webmail> Virus-free.[www.avast.com](https://www.avast.com) <https://www.avast.com/sig-email?utm_medium=email> <#DAB4FAD8-2DD7-40BB-A1B8-4E2AA1F9FDF2> skriv til kamilla@example.dk`;
    const out = cleanMailText(raw);
    expect(out).toBe("hej jeg må desværre opsige mit medlemsskab hos jer. de bedste hilsner Kamilla www.avast.com skriv til kamilla@example.dk".replace(" www.avast.com", ""));
  });
});
