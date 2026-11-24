import type { D1Database } from "./db.js";
import type { Env } from "./env.js";
import { escapeHtml } from "./web/html.js";
import { ORGANISER_EMAIL } from "./web/layout.js";

/** Sending e-mail. Two ways, whichever is set up on the Worker:
 * - Resend (resend.com): the secret RESEND_API_KEY. Works on the Workers Free plan.
 * - Cloudflare Email Service: a `send_email` binding named EMAIL (needs Workers Paid).
 * Without either, nothing is sent and the site works as before (the notices stay under Mine flokke). */

/** `replyTo` takes the place of the contact address as the mail's reply-to (the contact form: the sender). */
/** `kind` and `memberId` are only for "Sendt post" in /admin (sent_mails): what sort of mail it is, and whose. */
export type Mail = { to: string; subject: string; text: string; html: string; replyTo?: string; kind?: string; memberId?: string | null };
export type MailKind = "login" | "invitation" | "reminder";
export type SendResult = { ok: true } | { ok: false; error: string };

/** The part of Cloudflare's send_email binding used here. */
export interface EmailBinding {
  send(message: { to: string; from: string | { email: string; name: string }; subject: string; html: string; text: string; replyTo?: string }): Promise<unknown>;
}

const DEFAULT_FROM = "besked@socialklubben.dk";
const FROM_NAME = "Socialklubben";
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

/** CONTACT_EMAIL when it is a Socialklubben address; anything else (a private address) is never shown or used as
 * reply-to. */
export const publicContactEmail = (env: Pick<Env, "CONTACT_EMAIL">): string | null => {
  const e = env.CONTACT_EMAIL?.trim().toLowerCase();
  return e && EMAIL.test(e) && e.endsWith("@socialklubben.dk") ? e : null;
};

/** Where the contact form's messages are delivered: the secret CONTACT_INBOX, else the public address (which Cloudflare
 * Email Routing forwards). Kept out of the code so no private address is in the public repository. */
export const contactInbox = (env: Pick<Env, "CONTACT_INBOX" | "CONTACT_EMAIL">): string => {
  const e = env.CONTACT_INBOX?.trim();
  return e && EMAIL.test(e) ? e : publicContactEmail(env) ?? ORGANISER_EMAIL;
};

/** The public address used in links in mails sent by the cron (no request to take it from). */
export const mailSiteUrl = (env: Env): string => {
  const u = (env.MAIL_SITE_URL ?? "").replace(/\/$/, "");
  return /^https:\/\/[a-z0-9.-]+(\/[a-z0-9-]+)?$/i.test(u) ? u : "https://socialklubben.dk";
};

export const mailConfigured = (env: Env): boolean => !!env.EMAIL || !!env.RESEND_API_KEY;

export async function sendMail(env: Env, mail: Mail, fetcher: typeof fetch = fetch, now = Date.now()): Promise<SendResult> {
  const result = await deliver(env, mail, fetcher);
  if (env.DB) await keepSent(env.DB, mail, result, now);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function deliver(env: Env, mail: Mail, fetcher: typeof fetch): Promise<SendResult & { id?: string }> {
  const fromEmail = env.MAIL_FROM && EMAIL.test(env.MAIL_FROM) ? env.MAIL_FROM : DEFAULT_FROM;
  const replyTo = mail.replyTo && EMAIL.test(mail.replyTo) ? mail.replyTo : publicContactEmail(env) ?? ORGANISER_EMAIL;
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ to: mail.to, from: { email: fromEmail, name: FROM_NAME }, subject: mail.subject, html: mail.html, text: mail.text, ...(replyTo ? { replyTo } : {}) });
      return { ok: true };
    }
    if (env.RESEND_API_KEY) {
      const r = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: `${FROM_NAME} <${fromEmail}>`, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, ...(replyTo ? { reply_to: replyTo } : {}) })
      });
      if (r.ok) {
        const id = ((await r.json().catch(() => null)) as { id?: unknown } | null)?.id;
        return typeof id === "string" ? { ok: true, id } : { ok: true };
      }
      return { ok: false, error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
    }
    return { ok: false, error: "off" };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { ok: false, error: `${e.code ?? "error"}: ${e.message ?? String(error)}`.slice(0, 300) };
  }
}

/** Login links (…?t=<token>) are hidden before a mail is kept, so "Sendt post" can never be used to log in as someone. */
export const hideSecrets = (s: string): string => s.replace(/([?&]t=)[A-Za-z0-9_-]{16,}/g, "$1skjult");

/** Keeps a copy of a sent mail in sent_mails for "Sendt post" in /admin. Never stops the mail itself. */
export async function keepSent(db: D1Database, mail: Mail, result: SendResult & { id?: string }, now: number, opts: { source?: "app" | "resend"; providerId?: string } = {}): Promise<void> {
  const status = result.ok ? "sent" : result.error === "off" ? "off" : "failed";
  try {
    await db.prepare(`INSERT INTO sent_mails (id, kind, member_id, to_email, subject, html, text, reply_to, status, error, provider_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(crypto.randomUUID(), (mail.kind ?? "anden").slice(0, 40), mail.memberId ?? null, mail.to.slice(0, 320), mail.subject.slice(0, 300),
        mail.html ? hideSecrets(mail.html).slice(0, 200_000) : null, mail.text ? hideSecrets(mail.text).slice(0, 100_000) : null,
        mail.replyTo?.slice(0, 320) ?? null, status, result.ok ? null : result.error.slice(0, 300), opts.providerId ?? (result.ok ? result.id ?? null : null), opts.source ?? "app", now)
      .run();
  } catch (error) {
    console.error(JSON.stringify({ event: "sent_mail_not_kept", error: String(error).slice(0, 200) }));
  }
}

/** Sends and notes it in mail_log. */
export async function sendLogged(db: D1Database, env: Env, kind: MailKind, memberId: string | null, mail: Mail, now: number): Promise<SendResult> {
  const result = await sendMail(env, { ...mail, kind, memberId: mail.memberId ?? memberId }, fetch, now);
  const status = result.ok ? "sent" : result.error === "off" ? "off" : "failed";
  await db.prepare("INSERT INTO mail_log (id, kind, member_id, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), kind, memberId, status, result.ok ? null : result.error, now).run();
  if (!result.ok && status === "failed") console.error(JSON.stringify({ event: "mail_failed", kind, error: result.error }));
  return result;
}

/** A plain, friendly mail: greeting, paragraphs, one button, and a closing line. Both an HTML and a text version. */
export function letter(opts: { to: string; subject: string; greeting: string; paragraphs: string[]; button: { label: string; url: string }; after?: string[] }): Mail {
  const after = opts.after ?? [];
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1d1d1b">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f1e7">
<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Helvetica,Arial,sans-serif">
<p style="margin:0 0 20px;font-size:20px;font-weight:bold;color:#1d1d1b">Socialklubben</p>
${p(opts.greeting)}
${opts.paragraphs.map(p).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:#1d1d1b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${escapeHtml(opts.button.label)}</a></p>
${after.map(p).join("\n")}
<p style="margin:24px 0 0;font-size:16px;line-height:1.5;color:#1d1d1b">Kærlig hilsen<br>Socialklubben</p>
</div></body></html>`;
  const text = [opts.greeting, ...opts.paragraphs, `${opts.button.label}: ${opts.button.url}`, ...after, "Kærlig hilsen\nSocialklubben"].join("\n\n");
  return { to: opts.to, subject: opts.subject, html, text };
}

/** Keeps the tables small: login links after a day, the log after 90 days, sent mails after a year. Clears the contact form's sender hashes
 * after a day. */
export async function purgeMailData(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM login_links WHERE expires_at < ?").bind(now - 86_400_000),
    db.prepare("DELETE FROM mail_log WHERE created_at < ?").bind(now - 90 * 86_400_000),
    db.prepare("DELETE FROM sent_mails WHERE created_at < ?").bind(now - 365 * 86_400_000),
    db.prepare("UPDATE contact_messages SET sender = NULL WHERE sender IS NOT NULL AND created_at < ?").bind(now - 86_400_000)
  ]);
}
