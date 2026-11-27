import { membershipPlan, membershipPrice } from "../membership.js";
import { TEAM_MAIL } from "../site/mail.js";
import { hjerterumMail } from "./mail-template.js";
import type { Welcome } from "./members.js";

/** Douglas (17 Nov 2026), for the board: "Signup email". The mail one who joins here gets: welcome, what they chose, the trial, where things are,
 * and the terms they accepted. Sent through the same sender as the login mails; nothing is sent when it is not set up. */
export async function sendWelcome(env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string }, fetcher: typeof fetch, w: Welcome, site = "https://www.hjerterum.info"): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const plan = membershipPlan(w.tier);
  const price = plan ? `${membershipPrice(w.interval === "year" ? plan.year : plan.month)} ${w.interval === "year" ? "pr. år" : "pr. måned"}` : "";
  const first = w.fullName.split(/\s+/)[0] ?? w.fullName;
  const trial = w.trialDays > 0 ? `De første ${w.trialDays} dage er gratis. ` : "";
  const member = "https://medlem.hjerterum.info/member-portal";
  const chosen = `${plan?.name ?? w.tier}${price ? `, ${price}` : ""}. ${trial}Betalingen trækkes automatisk, og du kan se og ændre den under Min profil.`;
  const area = " finder du kalenderen, dine tilmeldinger, CIRKLER og din profil - og du kan oprette dine egne events.";
  // Douglas (forslag #5, 27 Nov 2026): the welcome in Hjerterum's mail template (mail-template.ts), the member area as a button.
  const { text, html } = hjerterumMail({ title: "Velkommen i Hjerterum", preheader: "Hvor er det dejligt, at du er blevet en del af fællesskabet.", blocks: [
    { p: `Kære ${first}` },
    { p: "Velkommen i Hjerterum - hvor er det dejligt, at du er blevet en del af fællesskabet." },
    { p: [{ text: "Dit medlemskab:", bold: true }, ` ${chosen}`] },
    { p: ["I ", { text: "medlemsområdet", href: member }, area], text: `I medlemsområdet (${member})${area}` },
    { button: "Gå til medlemsområdet", url: member, text: null },
    { small: [{ text: "Vilkår for medlemskab", href: `${site}/medlemskab/vilkaar` }, " · ", { text: "Handelsbetingelser", href: `${site}/handelsbetingelser` }],
      text: `Vilkår for medlemskab: ${site}/medlemskab/vilkaar · Handelsbetingelser: ${site}/handelsbetingelser` },
    { p: ["Har du spørgsmål, så skriv til ", { text: TEAM_MAIL, href: `mailto:${TEAM_MAIL}` }, "."] }
  ] });
  const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json",
    "idempotency-key": `welcome/${w.email.toLowerCase()}` },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [w.email], reply_to: TEAM_MAIL, subject: "Velkommen i Hjerterum", text, html }) }).catch(() => null);
  if (!sent?.ok) console.warn("welcome_mail_failed", sent?.status ?? "network");
}
