import { describe, expect, it, vi } from "vitest";
import { readDonation, recordDonation } from "./donations.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (13 Nov 2026), for the board: "a donation page ... Plus an email that gets sent as a receipt for their donation."
describe("a donation", () => {
  it("asks for a name, an e-mail and an amount from 20 kr.", () => {
    expect(readDonation({ name: " Bo ", email: "BO@x.dk", amountKr: "250" })).toEqual({ name: "Bo", email: "bo@x.dk", amountKr: 250, message: "" });
    expect(readDonation({ name: "Bo", email: "nope", amountKr: 250 })).toEqual({ error: "missing_fields" });
    expect(readDonation({ name: "Bo", email: "bo@x.dk", amountKr: 5 })).toEqual({ error: "invalid_amount" });
  });

  it("is kept once when paid, and its receipt goes out once", async () => {
    const db = testDatabase();
    const sent: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_u: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("{}"); }) as unknown as typeof fetch;
    const env = { RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "Hjerterum <login@hjerterum.info>" };
    const session = { id: "cs_test_123456789012", payment_status: "paid", amount_total: 25000, customer_details: { email: "bo@x.dk" }, metadata: { kind: "donation", name: "Bo" } };
    await recordDonation(db, env, fetcher, session, Date.parse("2026-11-18T12:00:00Z"));
    await recordDonation(db, env, fetcher, session, Date.parse("2026-11-18T12:01:00Z"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["bo@x.dk"], subject: "Tak for din donation til Hjerterum" });
    expect(String(sent[0]!.text)).toContain("Beløb: 250 kr.");
    expect(String(sent[0]!.text)).toContain("CVR 40827692");
    // Douglas (forslag #5, 27 Nov 2026): the receipt in the common mail template, with the logo and the footer.
    expect(String(sent[0]!.html)).toContain('alt="Hjerterum"');
    expect(String(sent[0]!.html)).toContain("Kvittering for donation");
    expect(String(sent[0]!.text)).toContain("Hjerterum · Guldsmedgade 26B, 8000 Aarhus C");
    expect((await db.prepare("SELECT amount_minor, receipt_sent_at_ms IS NOT NULL AS sent FROM donations").first())).toEqual({ amount_minor: 25000, sent: 1 });
  });
});
