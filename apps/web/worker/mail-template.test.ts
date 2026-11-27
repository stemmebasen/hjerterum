import { describe, expect, it, vi } from "vitest";
import { hjerterumMail, MAIL_LOGO_PATH, MAIL_LOGO_URL } from "./mail-template.js";
import { guestReceipt, type PublicEventRow } from "./guest-signup.js";
import { sendWelcome } from "./member-welcome.js";
import { recordDonation } from "./donations.js";
import { composeMail } from "./login-mail.js";
import { siteClosedResponse } from "./site-closed.js";
import { testDatabase } from "./saga/test-support.js";
import { TEAM_MAIL } from "../site/mail.js";
import { withKl } from "../site/when.js";

// Douglas (forslag #5, 27 Nov 2026): "Can it be made to look a bit more attractive and professional, at least with our logo." - one mail template
// for all the system's mails: the round logo, the house colours, link buttons, a footer; readable with images blocked, on a phone and in dark mode;
// still a plain-text version. And the sign-up confirmation said "kl. kl. 10.00".
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Hjerterum <login@hjerterum.info>" };
const mails = () => {
  const sent: Array<{ html: string; text: string; subject: string }> = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("{}"); }) as unknown as typeof fetch;
  return { sent, fetcher };
};
/** What every mail in the template has. */
function inTemplate(mail: { html: string; text: string }) {
  expect(mail.html).toContain(`<img class="hr-ink" src="${MAIL_LOGO_URL}"`);
  expect(mail.html).toContain('alt="Hjerterum"');
  expect(mail.html).toContain('<meta name="color-scheme" content="light dark">');
  expect(mail.html).toContain("@media (prefers-color-scheme:dark)");
  expect(mail.html).toContain("max-width:600px");
  expect(mail.html).toContain("Guldsmedgade 26B, 8000 Aarhus C");
  expect(mail.html).toContain(`href="mailto:${TEAM_MAIL}"`);
  expect(mail.html).toContain('href="https://www.hjerterum.info"');
  expect(mail.text).toContain(`--\nHjerterum · Guldsmedgade 26B, 8000 Aarhus C\n${TEAM_MAIL} · www.hjerterum.info`);
  expect(mail.text).not.toMatch(/<(?:p|br|a|strong|table|td|img|div)\b/);
}

describe("Hjerterum's mail template", () => {
  it("lays the words in one column with the logo, the house colours, buttons and the footer - and the same words as plain text", () => {
    const mail = hjerterumMail({ title: "Ny besked", preheader: "Et kig ind", blocks: [
      { p: "Kære Bo" },
      { p: ["Se ", { text: "kalenderen", href: "https://www.hjerterum.info/events" }, " og skriv til ", { text: TEAM_MAIL, href: `mailto:${TEAM_MAIL}` }, "."] },
      { box: ["Linje 1", "Linje 2"], title: "Kvittering" },
      { button: "Læs mere", url: "https://www.hjerterum.info/events/h1" },
      { small: "Lille note." }
    ] });
    inTemplate(mail);
    expect(mail.html).toContain('<html lang="da"');
    expect(mail.html).toContain("<title>Ny besked</title>");
    expect(mail.html).toContain("Et kig ind");
    // The house colours (Hjerterum Lys): terra links, the brown button, the light paper - and their dark twins.
    expect(mail.html).toContain("#94503f");
    expect(mail.html).toContain("background:#5b4a3f");
    expect(mail.html).toContain("#fbfaf8");
    expect(mail.html).toContain(".hr-card{background:#282521!important");
    expect(mail.html).toContain('href="https://www.hjerterum.info/events/h1"');
    expect(mail.text).toBe(`Kære Bo\n\nSe kalenderen (https://www.hjerterum.info/events) og skriv til ${TEAM_MAIL}.\n\nKvittering\nLinje 1\nLinje 2\n\n`
      + `Læs mere: https://www.hjerterum.info/events/h1\n\nLille note.\n\nVarme hilsner\nHjerterum\n\n--\nHjerterum · Guldsmedgade 26B, 8000 Aarhus C\n${TEAM_MAIL} · www.hjerterum.info`);
  });

  it("escapes what people wrote, and makes no link of anything but web and mail addresses", () => {
    const mail = hjerterumMail({ title: "<b>x</b>", blocks: [{ p: ["<script>alert(1)</script> & \"Bo\"\nny linje", { text: "klik", href: "javascript:alert(1)" }] },
      { box: ["<img src=x onerror=alert(1)>"] }, { button: "Gå", url: "javascript:alert(1)" }] });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Bo&quot;<br>ny linje");
    expect(mail.html).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>");
  });

  it("speaks English when asked, and leaves out the closing words when told", () => {
    const mail = hjerterumMail({ title: "Hello", lang: "en", blocks: [{ p: "Dear Bo" }] });
    expect(mail.html).toContain('<html lang="en"');
    expect(mail.text).toContain("Warm regards\nHjerterum");
    expect(hjerterumMail({ title: "x", signoff: null, blocks: [{ p: "Hej" }] }).text).not.toContain("Varme hilsner");
  });

  it("shows its logo while the website is closed", async () => {
    expect(MAIL_LOGO_URL).toBe(`https://www.hjerterum.info${MAIL_LOGO_PATH}`);
    expect(await siteClosedResponse(new Request(MAIL_LOGO_URL), { SITE_CLOSED: "1", SAGA_TELEGRAM_BOT_TOKEN: "x" }, Date.now())).toBeNull();
    expect(await siteClosedResponse(new Request("https://www.hjerterum.info/brand/hjerterum-stempel.png"), { SITE_CLOSED: "1", SAGA_TELEGRAM_BOT_TOKEN: "x" }, Date.now())).not.toBeNull();
  });
});

describe("the system's mails in the template", () => {
  it("the sign-up confirmation: the logo, the footer, a button to the event - and \"kl. 10.00\", not \"kl. kl. 10.00\"", async () => {
    // Douglas saw it with an event "Test 3", 2 people, at 10.00.
    const event: PublicEventRow = { id: 3, title: "Test 3", description: null, teacher_name: "Anna Ananda", teacher_email: "anna@x.dk", starts_at_ms: Date.parse("2026-11-28T09:00:00Z"),
      ends_at_ms: Date.parse("2026-11-28T11:00:00Z"), max_attendees: 10, ticket_price_minor: 0, non_member_price_minor: null, taken: 2, confirmation_note: null };
    const { sent, fetcher } = mails();
    await guestReceipt(ENV, fetcher, event, { name: "Bo <Bent>", email: "bo@x.dk", seats: 2 }, "https://www.hjerterum.info/events/h3");
    const mail = sent[0]!;
    inTemplate(mail);
    expect(mail.text).toContain('Du er tilmeldt (2 personer) "Test 3" lørdag 28. november kl. 10.00 i Hjerterum');
    expect(mail.html).toContain("lørdag 28. november kl. 10.00");
    for (const part of [mail.text, mail.html]) expect(part).not.toContain("kl. kl.");
    expect(mail.text).toContain("Læs om eventet: https://www.hjerterum.info/events/h3");
    expect(mail.html).toContain('class="hr-btn-a" href="https://www.hjerterum.info/events/h3"');
    expect(mail.html).toContain("Kære Bo &lt;Bent&gt;");
  });

  it("the welcome", async () => {
    const { sent, fetcher } = mails();
    await sendWelcome(ENV, fetcher, { email: "eva@example.dk", fullName: "Eva Lund", tier: "reduceret", interval: "year", trialDays: 0 });
    const mail = sent[0]!;
    inTemplate(mail);
    expect(mail.text).toContain("Kære Eva\n\nVelkommen i Hjerterum - hvor er det dejligt, at du er blevet en del af fællesskabet.");
    expect(mail.text).toContain("I medlemsområdet (https://medlem.hjerterum.info/member-portal) finder du kalenderen");
    expect(mail.text).toContain("Vilkår for medlemskab: https://www.hjerterum.info/medlemskab/vilkaar · Handelsbetingelser: https://www.hjerterum.info/handelsbetingelser");
    expect(mail.html).toContain('class="hr-btn-a" href="https://medlem.hjerterum.info/member-portal"');
  });

  it("the donation receipt", async () => {
    const { sent, fetcher } = mails();
    await recordDonation(testDatabase(), ENV, fetcher, { id: "cs_test_123456789012", payment_status: "paid", amount_total: 25000, customer_details: { email: "bo@x.dk" }, metadata: { name: "Bo" } },
      Date.parse("2026-11-18T12:00:00Z"));
    inTemplate(sent[0]!);
    expect(sent[0]!.text).toContain("Kvittering\nModtager: Hjerterum F.M.B.A., CVR 40827692, Guldsmedgade 26B, 8000 Aarhus C\nBeløb: 250 kr.");
  });

  it("the login code", () => {
    const mail = composeMail({ slug: "verification_code", data: { otp_code: "123456" } })!;
    inTemplate(mail);
    expect(mail.text.startsWith("Din kode til at logge ind hos Hjerterum er 123456.")).toBe(true);
  });

  it("writes the time with one \"kl.\", whatever the date formatter wrote", () => {
    expect(withKl("lørdag 28. november kl. 10.00")).toBe("lørdag 28. november kl. 10.00");
    expect(withKl("lørdag 28. november 10.00")).toBe("lørdag 28. november kl. 10.00");
    expect(withKl("lørdag 28. november kl. 10:00")).toBe("lørdag 28. november kl. 10.00");
  });
  // Douglas (forslag #7, 27 Nov 2026): "please make the logo in the emails a bit bigger".
  it("shows the logo a third bigger", () => {
    expect(hjerterumMail({ title: "Test", blocks: [{ p: "Hej" }] }).html).toContain('width="128" height="128"');
  });
});
