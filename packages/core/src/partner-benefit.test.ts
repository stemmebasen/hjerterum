import { describe, expect, it } from "vitest";
import { extractPriceMinor, formatKrMinor, partnerDiscountLabel, partnerMemberPriceMinor, validPartnerDiscount } from "./partner-benefit.js";

describe("partner member discount", () => {
  it("gives the member price from the partner's own normal price", () => {
    expect(partnerMemberPriceMinor(25_000, { kind: "percent", value: 20 })).toBe(20_000);
    expect(partnerMemberPriceMinor(33_300, { kind: "percent", value: 10 })).toBe(29_970);
    expect(partnerMemberPriceMinor(25_000, { kind: "amount", value: 5_000 })).toBe(20_000);
    expect(partnerMemberPriceMinor(3_000, { kind: "amount", value: 5_000 })).toBe(0);
    expect(partnerMemberPriceMinor(0, { kind: "percent", value: 10 })).toBe(0);
  });

  it("never guesses a member price when the normal price is unknown", () => {
    expect(partnerMemberPriceMinor(null, { kind: "percent", value: 10 })).toBeNull();
    expect(partnerMemberPriceMinor(25_000, { kind: "percent", value: 95 })).toBeNull();
  });

  it("only accepts a sensible discount", () => {
    expect(validPartnerDiscount({ kind: "percent", value: 10 })).toBe(true);
    expect(validPartnerDiscount({ kind: "percent", value: 0 })).toBe(false);
    expect(validPartnerDiscount({ kind: "percent", value: 91 })).toBe(false);
    expect(validPartnerDiscount({ kind: "percent", value: 12.5 })).toBe(false);
    expect(validPartnerDiscount({ kind: "amount", value: 5_000 })).toBe(true);
  });

  it("writes prices and discounts the Danish way", () => {
    expect(formatKrMinor(25_000)).toBe("250 kr.");
    expect(formatKrMinor(125_000)).toBe("1.250 kr.");
    expect(formatKrMinor(29_970)).toBe("299,70 kr.");
    expect(partnerDiscountLabel({ kind: "percent", value: 10 })).toBe("10 % rabat");
    expect(partnerDiscountLabel({ kind: "amount", value: 5_000 })).toBe("50 kr. rabat");
  });
});

describe("normal price from a partner's event text", () => {
  it("reads a price stated plainly next to a label and a currency", () => {
    expect(extractPriceMinor("Pris: 250 kr.")).toBe(25_000);
    expect(extractPriceMinor("Kom og vær med.\nPris 250,-\nTilmelding via linket.")).toBe(25_000);
    expect(extractPriceMinor("Billetpris: kr. 1.250")).toBe(125_000);
    expect(extractPriceMinor("Entré: 299,50 kr")).toBe(29_950);
    expect(extractPriceMinor("Prisen er 180 kroner pr. gang")).toBe(18_000);
    expect(extractPriceMinor("Pris pr. person: 450 DKK")).toBe(45_000);
    expect(extractPriceMinor("Pris: 250 kr. / 150 kr. for studerende")).toBe(25_000);
  });

  it("reads free events", () => {
    expect(extractPriceMinor("Gratis entré - alle er velkomne")).toBe(0);
    expect(extractPriceMinor("Pris: Gratis")).toBe(0);
  });

  it("gives up rather than guess", () => {
    expect(extractPriceMinor(null)).toBeNull();
    expect(extractPriceMinor("Tag 250 kr. med til te")).toBeNull();
    expect(extractPriceMinor("Pris for medlemmer: 200 kr.")).toBeNull();
    expect(extractPriceMinor("Pris: 250")).toBeNull();
    expect(extractPriceMinor("Billetter købes i døren")).toBeNull();
    expect(extractPriceMinor("Overraskelsespris 100 kr.")).toBeNull();
  });
});
