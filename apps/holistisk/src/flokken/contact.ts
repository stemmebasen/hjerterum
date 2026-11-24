import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { sendMail, type Mail, type SendResult } from "../mail.js";
import { escapeHtml, html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, organiserEmail, page, type Crumb, type PageContext } from "../web/layout.js";
import { sha256 } from "./auth.js";
import type { View } from "./pages.js";

/** The contact form (/kontakt, and the same form on /samarbejde): questions, ideas, faults and organisers who want to
 * be on the site. A message is saved, and mailed to the contact address with the sender as reply-to, so answering is
 * just pressing "Svar".
 *
 * Against robots and abuse:
 * - a field people do not see (filled in = a robot; it is told "tak" and nothing is saved),
 * - the time the form was shown (sent within a few seconds = a robot; the person is asked to send again),
 * - at most 3 links in a message,
 * - at most 3 messages an hour and 6 a day from one sender (a hash of the IP address, cleared after a day),
 * - at most 40 mails a day from the form, so it cannot use up the mail plan; messages beyond that are kept and shown
 *   in the admin overview. No receipt is mailed to the sender, so the form cannot be used to send mail to others. */

export const TOPICS = {
  spoergsmaal: "Et spørgsmål",
  arrangoer: "Vi er arrangør",
  ide: "En idé eller et forslag",
  fejl: "Noget virker ikke på siden",
  andet: "Noget andet"
} as const;
export type Topic = keyof typeof TOPICS;
const isTopic = (t: string): t is Topic => Object.hasOwn(TOPICS, t);

export type ContactForm = { topic: Topic; name: string; email: string; organisation: string; website: string; message: string };
export type ContactErrors = Partial<Record<keyof ContactForm | "form", string>>;

/** Sent sooner than this after the form was shown: a robot. */
export const MIN_FILL_MS = 3000;
export const PER_HOUR = 3;
export const PER_DAY = 6;
export const MAILS_PER_DAY = 40;
const MAX_LINKS = 3;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export const emptyContact = (topic: Topic = "spoergsmaal"): ContactForm => ({ topic, name: "", email: "", organisation: "", website: "", message: "" });
export const topicFrom = (t: string | null): Topic => t && isTopic(t) ? t : "spoergsmaal";

export function readContact(data: FormData): ContactForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  const topic = s("emne");
  return { topic: isTopic(topic) ? topic : "spoergsmaal", name: s("navn"), email: s("email"), organisation: s("organisation"), website: s("hjemmeside"), message: s("besked").replace(/\r\n/g, "\n") };
}

export function validateContact(f: ContactForm): ContactErrors {
  const e: ContactErrors = {};
  if (f.name.length < 2 || f.name.length > 80) e.name = "Skriv dit navn.";
  if (!EMAIL.test(f.email) || f.email.length > 160) e.email = "Skriv din e-mail, så vi kan svare dig, fx navn@eksempel.dk.";
  if (f.topic === "arrangoer" && f.organisation.length < 2) e.organisation = "Skriv foreningens eller stedets navn.";
  if (f.organisation.length > 120) e.organisation = "Højst 120 tegn.";
  if (f.website && (!/^https?:\/\/\S+$/i.test(f.website) || f.website.length > 200)) e.website = "Skriv hele adressen, fx https://eksempel.dk";
  if (f.message.length < 2) e.message = "Skriv din besked.";
  else if (f.message.length > 3000) e.message = "Højst 3000 tegn.";
  else if ((f.message.match(/https?:\/\/|www\./gi) ?? []).length > MAX_LINKS) e.message = `Højst ${MAX_LINKS} links i en besked.`;
  return e;
}

/** The sender, for the limits: a hash of the IP address (never the address itself). */
export async function senderOf(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return (await sha256(`kontakt|${ip}`)).slice(0, 32);
}

/** Whether the form was shown long enough ago (the hidden field `t`, the time it was shown). */
export const filledByPerson = (shownAt: string, now: number): boolean => {
  const t = Number(shownAt);
  return Number.isFinite(t) && t > 0 && now - t >= MIN_FILL_MS && now - t < 7 * 86_400_000;
};

export async function tooMany(db: D1Database, sender: string, now: number): Promise<boolean> {
  const r = await db.prepare("SELECT SUM(created_at > ?) AS hour, COUNT(*) AS day FROM contact_messages WHERE sender = ? AND created_at > ?")
    .bind(now - 3600_000, sender, now - 86_400_000).first<{ hour: number | null; day: number }>();
  return (r?.hour ?? 0) >= PER_HOUR || (r?.day ?? 0) >= PER_DAY;
}

export function contactMail(f: ContactForm, to: string): Mail & { replyTo: string } {
  const rows: Array<[string, string]> = [["Emne", TOPICS[f.topic]], ["Navn", f.name], ["E-mail", f.email],
    ...(f.organisation ? [["Forening eller sted", f.organisation] as [string, string]] : []),
    ...(f.website ? [["Hjemmeside", f.website] as [string, string]] : [])];
  const who = f.organisation ? `${f.name} (${f.organisation})` : f.name;
  const subject = `${f.topic === "arrangoer" ? "Arrangør" : "Kontakt"}: ${who}`.replace(/[\r\n]+/g, " ").slice(0, 150);
  const text = [`Ny besked fra kontaktformularen på Socialklubben.`, rows.map(([k, v]) => `${k}: ${v}`).join("\n"), f.message,
    `Svar på denne mail, så går svaret direkte til ${f.name}.`].join("\n\n");
  const cell = "padding:4px 12px 4px 0;font-size:15px;vertical-align:top;color:#1d1d1b";
  const body = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f1e7"><div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:Helvetica,Arial,sans-serif">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#1d1d1b">Ny besked fra kontaktformularen</p>
<table style="border-collapse:collapse;margin:0 0 18px">${rows.map(([k, v]) => `<tr><td style="${cell};font-weight:bold">${escapeHtml(k)}</td><td style="${cell}">${escapeHtml(v)}</td></tr>`).join("")}</table>
<div style="background:#fffdf8;border:1px solid #d9d2c3;border-radius:8px;padding:14px 16px;font-size:16px;line-height:1.5;color:#1d1d1b;white-space:pre-wrap">${escapeHtml(f.message)}</div>
<p style="margin:18px 0 0;font-size:14px;color:#5b5b55">Svar på denne mail, så går svaret direkte til ${escapeHtml(f.name)}.</p>
</div></body></html>`;
  return { to, subject, text, html: body, replyTo: f.email, kind: "kontakt" };
}

/** Saves the message and mails it (unless the day's mail budget is used). */
export async function sendContact(db: D1Database, env: Env, f: ContactForm, sender: string, to: string, now: number, send: typeof sendMail = sendMail): Promise<void> {
  const today = await db.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE created_at > ? AND mail IN ('sent', 'failed')").bind(now - 86_400_000).first<{ n: number }>();
  let result: SendResult | null = null;
  if ((today?.n ?? 0) < MAILS_PER_DAY) result = await send(env, contactMail(f, to), fetch, now);
  const mail = !result ? "held" : result.ok ? "sent" : result.error === "off" ? "off" : "failed";
  const error = result && !result.ok && mail === "failed" ? result.error.slice(0, 300) : null;
  if (error) console.error(JSON.stringify({ event: "mail_failed", kind: "contact", error }));
  await db.prepare("INSERT INTO contact_messages (id, topic, name, email, organisation, website, message, sender, mail, mail_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), f.topic, f.name, f.email, f.organisation || null, f.website || null, f.message, sender, mail, error, now).run();
}

export async function listContacts(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare("SELECT id, topic, name, email, organisation, website, message, mail, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 500").all();
  return results;
}

// ————————————————————————————————————————— the form and the page

export function contactFormBlock(ctx: PageContext, state: { form?: ContactForm; errors?: ContactErrors; now: number }): SafeHtml {
  const f = state.form ?? emptyContact();
  const errors = state.errors ?? {};
  const err = (k: keyof ContactErrors) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
  const invalid = (k: keyof ContactErrors) => errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : "";
  return html`
  ${errors.form ? html`<p class="flash flash-error" role="alert">${errors.form}</p>` : Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card contact-form" method="post" action="/kontakt" novalidate>
    <div class="field"><label for="k-topic">Hvad drejer det sig om?</label>
      <select id="k-topic" name="emne">${(Object.keys(TOPICS) as Topic[]).map(t => html`<option value="${t}"${t === f.topic ? raw(" selected") : ""}>${TOPICS[t]}</option>`)}</select></div>
    <div class="field"><label for="k-name">Dit navn</label><input id="k-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.name}"${invalid("name")}>${err("name")}</div>
    <div class="field"><label for="k-email">Din e-mail</label><input id="k-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}"${invalid("email")}>${err("email")}</div>
    <div class="field"><label for="k-org">Forening eller sted <span class="meta-muted">(hvis du skriver for en)</span></label><input id="k-org" name="organisation" type="text" maxlength="120" autocomplete="organization" value="${f.organisation}"${invalid("organisation")}>${err("organisation")}</div>
    <div class="field"><label for="k-web">Hjemmeside <span class="meta-muted">(valgfrit)</span></label><input id="k-web" name="hjemmeside" type="url" maxlength="200" placeholder="https://" value="${f.website}"${invalid("website")}>${err("website")}</div>
    <div class="field"><label for="k-msg">Din besked</label><textarea id="k-msg" name="besked" rows="6" maxlength="3000" required${invalid("message")}>${f.message}</textarea>${err("message")}</div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <input type="hidden" name="t" value="${String(state.now)}">
    <div class="form-actions"><button type="submit">Send besked</button></div>
    <p class="small meta-muted">Vi bruger kun det, du skriver her, til at svare dig. Du kan også skrive direkte til <a href="mailto:${organiserEmail(ctx)}">${organiserEmail(ctx)}</a>.</p>
  </form>`;
}

export function contactPage(ctx: PageContext, state: { form?: ContactForm; errors?: ContactErrors; sent?: boolean; status?: number; now: number }): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Kontakt", path: "/kontakt" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">Kontakt</p>
    <h1>Skriv til os</h1>
    <p class="standfirst">Har du et spørgsmål, en idé til Flokken – eller vil I gerne have jeres arrangementer med på siden? Skriv til os her, så vender vi tilbage til dig.</p>
  </header>
  <div id="formular">
  ${state.sent
    ? html`<div class="form-card contact-thanks" role="status"><h2>Tak for din besked</h2><p>Vi har fået den og vender tilbage til dig på e-mail, så snart vi kan.</p><p><a href="/">Tilbage til forsiden</a> · <a href="/kalender">Se hvad der sker</a></p></div>`
    : contactFormBlock(ctx, state)}
  </div>
  ${state.sent ? "" : html`<h2>Er du arrangør?</h2>
  <p>Vælg „${TOPICS.arrangoer}“ og fortæl lidt om jer og jeres arrangementer. <a href="/samarbejde">Læs her</a>, hvordan jeres arrangementer kommer med på siden.</p>`}
</div>`;
  const quiet = state.sent || state.errors;
  return { status: state.status ?? 200, ...(quiet ? { headers: { "cache-control": "no-store" } } : {}), body: page(ctx, { title: "Kontakt – Flokken", description: "Skriv til Flokken: spørgsmål, idéer, eller hvis I er arrangør og gerne vil have jeres arrangementer med på siden.", canonical: "/kontakt", breadcrumbs: crumbs, ...(quiet ? { noindex: true } : {}) }, body) };
}
