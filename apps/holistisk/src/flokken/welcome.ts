import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { englishPath } from "../i18n/paths.js";
import { letter, mailConfigured, sendLogged, type Mail, type Paragraph } from "../mail.js";
import { ORGANISER_EMAIL } from "../web/layout.js";
import { freeMembership } from "./profile.js";

/** "Velkommen som medlem" (Jake 2026-11-24): one mail to everyone who signs up as a member on /bliv-medlem, the first
 * time only. In English when they signed up on /en/membership. */

/** The informationsmøde (Jake 2026-11-24). The invitation is left out of the mail once it has ended. `path` is the
 * sign-up page. */
export const INFO_MEETING = {
  endsAt: Date.parse("2027-01-12T20:45:00+01:00"),
  path: "/informationsmoede"
};

/** At most this many welcome mails per hour in all, so the form cannot be used to send mail to many addresses. */
export const WELCOME_PER_HOUR = 30;

const firstName = (name: string): string => (name.trim().split(/\s+/)[0] ?? "").slice(0, 40);

export function welcomeMail(to: string, name: string, origin: string, lang: "da" | "en", now: number): Mail {
  const url = (path: string) => origin + (lang === "en" ? englishPath(path) : path);
  const first = firstName(name);
  const free = freeMembership(now);
  const meeting = now < INFO_MEETING.endsAt;
  const contact: Paragraph = lang === "en"
    ? { before: "Questions or ideas? Just reply to this e-mail or write to us at ", link: { label: ORGANISER_EMAIL, url: `mailto:${ORGANISER_EMAIL}` }, after: ". We look forward to meeting you." }
    : { before: "Har du spørgsmål eller idéer, så svar bare på denne mail eller skriv til os på ", link: { label: ORGANISER_EMAIL, url: `mailto:${ORGANISER_EMAIL}` }, after: ". Vi glæder os til at møde dig." };
  if (lang === "en") {
    return letter({
      lang,
      to,
      subject: "Welcome as a member of Socialklubben",
      greeting: first ? `Hi ${first}` : "Hi",
      paragraphs: [
        "Thank you for becoming a member of Socialklubben. We're so glad to have you with us!",
        "Socialklubben is a newly started association in Aarhus, and we're just getting going. Our members are the foundation of it all: the more of us there are, the more we can get started together.",
        (free ? "Membership costs nothing while we're starting up, until 1 March 2027. " : "") +
          "And you're never obliged to anything: not to take part, and not to stay a member. You can leave whenever you like.",
        "This is how it works: find an activity in the calendar that you'd like to go to, and press \"I'd like to come along!\". When 3 to 6 of us want to go, we become a small group. You meet outdoors in front of a landmark in town, sit down somewhere first for a cup of coffee to say hello, and then go to the activity together.",
        ...(meeting ? [
          "You're also warmly invited to our information meeting on Tuesday 12 January 2027, 19.30–20.45, at Guldsmedgade 26B in Aarhus. We'll tell you more about Socialklubben, and you can hear about joining the steering group and helping shape the association.",
          { before: "", link: { label: "Sign up for the information meeting", url: url(INFO_MEETING.path) } } satisfies Paragraph
        ] : [])
      ],
      button: { label: "See the calendar", url: url("/kalender") },
      after: [contact]
    });
  }
  return letter({
    to,
    subject: "Velkommen som medlem af Socialklubben",
    greeting: first ? `Hej ${first}` : "Hej",
    paragraphs: [
      "Tak, fordi du er blevet medlem af Socialklubben. Hvor er det dejligt at have dig med!",
      "Socialklubben er en nystartet forening i Aarhus, og vi er lige gået i gang. Medlemmerne er fundamentet for det hele: Jo flere vi er, jo flere initiativer kan vi sætte i gang sammen.",
      (free ? "Medlemskabet koster ikke noget, mens vi er under opstart, frem til 1. marts 2027. " : "") +
        "Og du er aldrig forpligtet til noget, hverken til at deltage eller til at blive ved med at være medlem. Du kan melde dig ud, når du vil.",
      "Sådan virker det: Find et arrangement i kalenderen, som du har lyst til, og tryk på \"Jeg vil gerne med!\". Når vi er 3 til 6, der vil med, bliver I en lille flok. I mødes udenfor foran et kendt sted i byen, sætter jer først et sted og får en kop kaffe og hilser på hinanden, og så går I sammen til arrangementet.",
      ...(meeting ? [
        "Du er også meget velkommen til vores informationsmøde tirsdag den 12. januar 2027 kl. 19.30–20.45 i Guldsmedgade 26B, Aarhus. Her fortæller vi mere om Socialklubben, og du kan høre om muligheden for at komme med i styregruppen og være med til at forme foreningen.",
        { before: "", link: { label: "Tilmeld dig informationsmødet", url: url(INFO_MEETING.path) } } satisfies Paragraph
      ] : [])
    ],
    button: { label: "Se kalenderen", url: url("/kalender") },
    after: [contact]
  });
}

/** Sends the welcome mail. Called only when the sign-up was new, so an address gets it once. */
export async function sendWelcome(db: D1Database, env: Env, to: string, name: string, origin: string, lang: "da" | "en", now: number): Promise<void> {
  if (!mailConfigured(env)) return;
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind = 'welcome' AND created_at > ?").bind(now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= WELCOME_PER_HOUR) return;
  await sendLogged(db, env, "welcome", null, welcomeMail(to, name, origin, lang, now), now);
}
