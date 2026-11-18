import { membershipPlan, membershipPrice } from "../membership.js";
import { TEAM_MAIL } from "../site/mail.js";
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
  const lines = [
    `Kære ${first}`,
    `Velkommen i Hjerterum - hvor er det dejligt, at du er blevet en del af fællesskabet.`,
    `Dit medlemskab: ${plan?.name ?? w.tier}${price ? `, ${price}` : ""}. ${trial}Betalingen trækkes automatisk, og du kan se og ændre den under Min profil.`,
    `I medlemsområdet (${member}) finder du kalenderen, dine tilmeldinger, CIRKLER og din profil - og du kan oprette dine egne events.`,
    `Vilkår for medlemskab: ${site}/medlemskab/vilkaar · Handelsbetingelser: ${site}/handelsbetingelser`,
    `Har du spørgsmål, så skriv til ${TEAM_MAIL}.`,
    `Varme hilsner\nHjerterum`
  ];
  const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<p>Kære ${esc(first)}</p><p>Velkommen i Hjerterum - hvor er det dejligt, at du er blevet en del af fællesskabet.</p>`
    + `<p><b>Dit medlemskab:</b> ${esc(plan?.name ?? w.tier)}${price ? `, ${esc(price)}` : ""}. ${esc(trial)}Betalingen trækkes automatisk, og du kan se og ændre den under Min profil.</p>`
    + `<p>I <a href="${member}">medlemsområdet</a> finder du kalenderen, dine tilmeldinger, CIRKLER og din profil - og du kan oprette dine egne events.</p>`
    + `<p><a href="${site}/medlemskab/vilkaar">Vilkår for medlemskab</a> · <a href="${site}/handelsbetingelser">Handelsbetingelser</a></p>`
    + `<p>Har du spørgsmål, så skriv til <a href="mailto:${TEAM_MAIL}">${TEAM_MAIL}</a>.</p><p>Varme hilsner<br>Hjerterum</p>`;
  const sent = await fetcher("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json",
    "idempotency-key": `welcome/${w.email.toLowerCase()}` },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [w.email], reply_to: TEAM_MAIL, subject: "Velkommen i Hjerterum", text: lines.join("\n\n"), html }) }).catch(() => null);
  if (!sent?.ok) console.warn("welcome_mail_failed", sent?.status ?? "network");
}
