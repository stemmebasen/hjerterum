import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { letter, mailSiteUrl, sendMail, type SendResult } from "../mail.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "./pages.js";

/** Informationsmødet (Jake 2026-11-24): we tell about Flokken, and you can join the steering group. After it, more
 * initiatives start, so Flokken can really unfold in 2027. A page (/informationsmoede) with a sign-up form (name and
 * e-mail, kept in info_meeting_signups), a confirmation e-mail, a box on the front page and a list in /admin.
 *
 * The time is set here. Leave `start`/`end` as null while it is not known: the page then says "tidspunkt følger". */
export const INFO_MEETING = {
  /** The day, in Aarhus time. */
  date: "2027-01-12",
  dateLabel: "tirsdag den 12. januar 2027",
  shortDate: "12. januar",
  /** "19.30" style, or null when the time is not known yet. */
  start: "19.30" as string | null,
  end: "20.45" as string | null,
  place: "Guldsmedgade 26B",
  city: "8000 Aarhus C"
};
export const INFO_PATH = "/informationsmoede";

/** When the meeting starts and ends (ms). Without a time: the whole day. */
export function meetingTimes(m = INFO_MEETING): { start: number; end: number } {
  const at = (hm: string | null, fallback: string) => Date.parse(`${m.date}T${(hm ?? fallback).replace(".", ":")}:00+01:00`);
  return { start: at(m.start, "00.00"), end: m.end ? at(m.end, "23.59") : at(null, "23.59") };
}

/** "kl. 19.30–20.45", or "tidspunkt følger" until the time is set. */
export function timeLabel(m = INFO_MEETING): string {
  if (!m.start) return "tidspunkt følger";
  return m.end ? `kl. ${m.start}–${m.end}` : `kl. ${m.start}`;
}

/** Shown on the front page and open for sign-up until the meeting starts. */
export const signupOpen = (now: number): boolean => now < meetingTimes().start;
/** The page itself says "the meeting has been held" from when it ends. */
export const meetingOver = (now: number): boolean => now >= meetingTimes().end;

// ————————————————————————————————————————— the sign-up

export type InfoForm = { name: string; email: string; steering: boolean };
export type InfoErrors = Partial<Record<"name" | "email" | "form", string>>;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
/** At most this many confirmation e-mails a day, so the form cannot use up the mail plan. */
export const MAILS_PER_DAY = 60;

export const emptyInfo = (): InfoForm => ({ name: "", email: "", steering: false });

export function readInfo(data: FormData): InfoForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return { name: s("navn"), email: s("email"), steering: s("styregruppe") === "ja" };
}

export function validateInfo(f: InfoForm): InfoErrors {
  const e: InfoErrors = {};
  if (f.name.length < 2 || f.name.length > 80) e.name = "Skriv dit navn.";
  if (!EMAIL.test(f.email) || f.email.length > 160) e.email = "Skriv din e-mail, fx navn@eksempel.dk.";
  return e;
}

export function confirmationMail(env: Env, f: InfoForm) {
  const site = mailSiteUrl(env);
  return { ...letter({
    to: f.email,
    subject: `Du er tilmeldt informationsmødet ${INFO_MEETING.shortDate}`,
    greeting: `Kære ${f.name}`,
    paragraphs: [
      `Tak for din tilmelding! Vi glæder os til at se dig til informationsmødet ${INFO_MEETING.dateLabel}${INFO_MEETING.start ? `, ${timeLabel()}` : ""} på ${INFO_MEETING.place}, ${INFO_MEETING.city}.`,
      ...(INFO_MEETING.start ? [] : ["Vi skriver til dig, så snart tidspunktet er på plads."]),
      "Vi fortæller om Socialklubben, og du kan høre, hvordan du kan komme med i styregruppen. Derefter sætter vi flere initiativer i gang, så Socialklubben for alvor kan folde sig ud i løbet af 2027.",
      ...(f.steering ? ["Du har skrevet, at du måske kunne have lyst til at være med i styregruppen. Det er vi rigtig glade for. Det forpligter dig ikke til noget – vi snakker om det på mødet."] : []),
      "Det er helt uforpligtende at komme. Kan du alligevel ikke, så svar bare på denne mail."
    ],
    button: { label: "Se informationsmødet", url: `${site}${INFO_PATH}` }
  }), kind: "informationsmoede" };
}

/** Saves the sign-up and sends the confirmation. Signing up again with the same e-mail updates the name and the
 * steering-group wish, and sends no new mail. Returns false when the e-mail was already signed up. */
export async function saveInfo(db: D1Database, env: Env, f: InfoForm, now: number, send: typeof sendMail = sendMail): Promise<boolean> {
  const existing = await db.prepare("SELECT id FROM info_meeting_signups WHERE lower(email) = lower(?)").bind(f.email).first<{ id: string }>();
  if (existing) {
    await db.prepare("UPDATE info_meeting_signups SET name = ?, steering = MAX(steering, ?) WHERE id = ?").bind(f.name, f.steering ? 1 : 0, existing.id).run();
    return false;
  }
  const today = await db.prepare("SELECT COUNT(*) AS n FROM info_meeting_signups WHERE created_at > ? AND mail IN ('sent', 'failed')").bind(now - 86_400_000).first<{ n: number }>();
  let result: SendResult | null = null;
  if ((today?.n ?? 0) < MAILS_PER_DAY) result = await send(env, confirmationMail(env, f), fetch, now);
  const mail = !result ? "held" : result.ok ? "sent" : result.error === "off" ? "off" : "failed";
  const error = result && !result.ok && mail === "failed" ? result.error.slice(0, 300) : null;
  if (error) console.error(JSON.stringify({ event: "mail_failed", kind: "info_meeting", error }));
  await db.prepare("INSERT INTO info_meeting_signups (id, name, email, steering, mail, mail_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), f.name, f.email, f.steering ? 1 : 0, mail, error, now).run();
  return true;
}

export type InfoSignup = { id: string; name: string; email: string; steering: number; mail: string; created_at: number };

export async function listInfo(db: D1Database): Promise<InfoSignup[]> {
  const { results } = await db.prepare("SELECT id, name, email, steering, mail, created_at FROM info_meeting_signups ORDER BY created_at DESC LIMIT 1000").all<InfoSignup>();
  return results;
}

export async function deleteInfo(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM info_meeting_signups WHERE id = ?").bind(id).first<{ name: string }>();
  if (!row) return null;
  await db.prepare("DELETE FROM info_meeting_signups WHERE id = ?").bind(id).run();
  return row.name;
}

// ————————————————————————————————————————— the front page's box and the page

/** The front page's box, until the meeting starts. */
export function infoMeetingTeaser(now: number): SafeHtml | "" {
  if (!signupOpen(now)) return "";
  return html`<aside class="info-teaser" aria-labelledby="h-info">
    <div><p class="hero-kicker">Kom og vær med</p><h2 id="h-info">Informationsmøde ${INFO_MEETING.shortDate}</h2>
    <p class="info-when"><strong>${capital(INFO_MEETING.dateLabel)}, ${timeLabel()}</strong><br>${INFO_MEETING.place}, Aarhus</p>
    <p>Vi fortæller om Flokken, og du kan komme med i styregruppen. Derefter sætter vi flere initiativer i gang, så Flokken for alvor kan folde sig ud i 2027. Alle er velkomne, og det er helt uforpligtende.</p></div>
    <p><a class="button" href="${INFO_PATH}">Tilmeld dig</a></p>
  </aside>`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function infoMeetingPage(ctx: PageContext, state: { form?: InfoForm; errors?: InfoErrors; sent?: boolean; status?: number } = {}): View {
  const f = state.form ?? emptyInfo();
  const errors = state.errors ?? {};
  const err = (k: "name" | "email") => errors[k] ? html`<span class="field-error" id="err-i-${k}">${errors[k]}</span>` : "";
  const invalid = (k: "name" | "email") => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-i-${k}"`) : "";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Informationsmøde", path: INFO_PATH }];
  const open = signupOpen(ctx.now), over = meetingOver(ctx.now);
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${INFO_MEETING.place}, ${INFO_MEETING.city}`)}`;
  const form = html`
  ${errors.form ? html`<p class="flash flash-error" role="alert">${errors.form}</p>` : Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="${INFO_PATH}#tilmelding" novalidate>
    <div class="field"><label for="i-name">Dit navn</label><input id="i-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.name}"${invalid("name")}>${err("name")}</div>
    <div class="field"><label for="i-email">Din e-mail</label><input id="i-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid("email")}>
      <span class="hint">Vi sender en bekræftelse og skriver kun til dig om mødet.</span>${err("email")}</div>
    <div class="field-check"><label><input type="checkbox" name="styregruppe" value="ja"${f.steering ? raw(" checked") : ""}> Jeg kunne måske have lyst til at være med i styregruppen</label></div>
    <p class="hint">Det forpligter dig ikke til noget. Det hjælper os bare at vide det på forhånd.</p>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Tilmeld mig</button></div>
  </form>`;
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">Informationsmøde</p>
    <h1>Kom til informationsmøde om Flokken</h1>
    <p class="standfirst">Vi fortæller om Flokken, og der er mulighed for at komme med i styregruppen. Herefter sætter vi flere initiativer i gang, så Flokken for alvor kan folde sig ud i løbet af 2027.</p>
  </header>
  <dl class="info-facts">
    <dt>Hvornår</dt><dd>${capital(INFO_MEETING.dateLabel)}, ${timeLabel()}</dd>
    <dt>Hvor</dt><dd>${INFO_MEETING.place}, ${INFO_MEETING.city} · <a href="${map}" rel="noopener" target="_blank">Find vej</a></dd>
    <dt>Pris</dt><dd>Det koster ikke noget at komme, og du behøver ikke være medlem.</dd>
  </dl>
  <h2>Hvad sker der på mødet?</h2>
  <ul>
    <li>Vi fortæller, hvorfor Flokken findes, og hvad vi har sat i gang indtil nu.</li>
    <li>Du hører, hvordan du kan komme med i styregruppen og være med til at forme foreningen.</li>
    <li>Vi snakker om, hvilke initiativer vi skal sætte i gang i 2027 – og du er velkommen med dine idéer.</li>
  </ul>
  <p>Alle er velkomne. Du er aldrig forpligtet til noget: du kan bare komme og lytte.</p>
  <h2 id="tilmelding">Tilmeld dig</h2>
  ${over
    ? html`<p class="notice">Mødet er holdt. Tak til alle, der kom! Vil du stadig være med, så <a href="/kontakt">skriv til os</a> eller <a href="/bliv-medlem">bliv medlem</a>.</p>`
    : state.sent
      ? html`<div class="form-card contact-thanks" role="status"><h2>Tak, du er tilmeldt!</h2><p>Vi har sendt en bekræftelse til din e-mail. Vi glæder os til at se dig ${INFO_MEETING.shortDate}.</p><p><a href="/">Tilbage til forsiden</a> · <a href="/kalender">Se hvad der sker</a></p></div>`
      : open
        ? html`<p>Skriv dit navn og din e-mail, så ved vi, hvor mange vi bliver. Kan du alligevel ikke komme, så svar bare på bekræftelsen.</p>${form}`
        : html`<p class="notice">Tilmeldingen er lukket, men du er stadig velkommen.</p>`}
</div>`;
  const quiet = state.sent || state.errors;
  return {
    status: state.status ?? 200,
    ...(quiet ? { headers: { "cache-control": "no-store" } } : {}),
    body: page(ctx, { title: `Informationsmøde ${INFO_MEETING.shortDate} – Flokken`, description: `Kom til informationsmøde om Flokken ${INFO_MEETING.dateLabel} på ${INFO_MEETING.place} i Aarhus. Hør om foreningen, og kom med i styregruppen.`, canonical: INFO_PATH, breadcrumbs: crumbs, ...(quiet ? { noindex: true } : {}) }, body)
  };
}
