import type { D1Database } from "./db.js";
import { listMailHtml } from "./newsletter.js";
import { mailchimp, MAILCHIMP_LIST_ID, type NewsletterEnv } from "./newsletter-send.js";
import { completeAs } from "./saga/ai.js";
import type { SagaDeps } from "./saga/env.js";

/** Requested: "Så jeg bliver i stand til at sende mails ud fra Board Admin til modtagerne?" - "Ja". A single mail to Hjerterum's one Mailchimp list
 * (everyone who said yes, mailchimp-sync.ts), from admin → Events → Mail til listen: written by the chair or drafted by Saga, tried on one's own
 * address, and sent only when the chair presses Send - to all, or to the members only (the tag "Medlem"). The chair's alone for now
 * (power listmail.send, docs/decisions/0007). */

export type ListMail = { id: number; subject: string; preheader: string; heading: string; body: string; audience: "alle" | "medlemmer"; status: "draft" | "sent" | "failed";
  campaign_id: string | null; recipients: number | null; error: string | null; created_by: string; sent_by: string | null; created_at_ms: number; updated_at_ms: number; sent_at_ms: number | null };

export const AUDIENCES = { alle: { label: "Alle i listen", tag: null }, medlemmer: { label: "Kun medlemmer", tag: "Medlem" } } as const;

export async function listMails(db: D1Database): Promise<ListMail[]> {
  return (await db.prepare("SELECT * FROM list_mails ORDER BY created_at_ms DESC LIMIT 50").all<ListMail>()).results ?? [];
}
export const listMail = (db: D1Database, id: number) => db.prepare("SELECT * FROM list_mails WHERE id = ?").bind(id).first<ListMail>();

export async function newListMail(db: D1Database, by: string, nowMs: number): Promise<number> {
  const result = await db.prepare("INSERT INTO list_mails (created_by, created_at_ms, updated_at_ms) VALUES (?, ?, ?)").bind(by, nowMs, nowMs).run();
  return Number(result.meta?.last_row_id);
}

export function readListMailForm(form: FormData | null): Pick<ListMail, "subject" | "preheader" | "heading" | "body" | "audience"> {
  const text = (name: string, max: number) => String(form?.get(name) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
  return { subject: text("subject", 150), preheader: text("preheader", 150), heading: text("heading", 120), body: text("body", 8000), audience: text("audience", 20) === "medlemmer" ? "medlemmer" : "alle" };
}

export async function saveListMail(db: D1Database, id: number, mail: Pick<ListMail, "subject" | "preheader" | "heading" | "body" | "audience">, nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE list_mails SET subject = ?, preheader = ?, heading = ?, body = ?, audience = ?, updated_at_ms = ? WHERE id = ? AND status <> 'sent'")
    .bind(mail.subject, mail.preheader, mail.heading, mail.body, mail.audience, nowMs, id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

const SYSTEM = `Du skriver en mail fra Hjerterum (en forening og et hus i Aarhus for meditation, yoga, personlig udvikling og fællesskab) til dem, der har sagt ja til nyheder.
Skriv på dansk, varmt, klart og kort - som Hjerterum selv skriver: personligt, uden salgssprog, uden emojis i teksten. Opfind intet: ingen datoer, priser, navne eller løfter,
der ikke står i oplægget. Links skrives [tekst](https://...) og kun dem, der står i oplægget.
Svar KUN med JSON: {"subject": emnelinje (højst 70 tegn), "preheader": forhåndstekst (højst 110 tegn), "heading": en kort overskrift i mailen eller "", "body": teksten med tomme linjer mellem afsnittene, begynd med en hilsen og slut med "Kærlig hilsen\\nHjerterum"}.`;

/** Saga's draft from the chair's notes; null when her answer could not be read. */
export async function draftListMail(env: NewsletterEnv, deps: SagaDeps, notes: string): Promise<Pick<ListMail, "subject" | "preheader" | "heading" | "body"> | null> {
  const answer = await completeAs("mail-til-listen", false, 4000)(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: `OPLÆG:\n${notes.slice(0, 4000)}` }]);
  try {
    const raw = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const s = (key: string, max: number) => typeof raw[key] === "string" ? (raw[key] as string).trim().slice(0, max) : "";
    const draft = { subject: s("subject", 150), preheader: s("preheader", 150), heading: s("heading", 120), body: s("body", 8000) };
    return draft.subject && draft.body ? draft : null;
  } catch { return null; }
}

export const listMailReady = (mail: ListMail) => Boolean(mail.subject && mail.body);

/** The campaign in Mailchimp, made once and reused (a test and the send go through the same one), with the words as they are now. */
async function campaignFor(env: NewsletterEnv, deps: SagaDeps, db: D1Database, mail: ListMail): Promise<{ id: string; count: number }> {
  const mc = mailchimp(env.MAILCHIMP_API_KEY!, deps.fetcher);
  const audience = await mc.audience(MAILCHIMP_LIST_ID, AUDIENCES[mail.audience].tag);
  if (mail.audience === "medlemmer" && audience.segment === null) throw new Error("mailchimp_tag_missing: mærket \"Medlem\" findes ikke i Mailchimp endnu");
  const recipients = { list_id: MAILCHIMP_LIST_ID, ...(audience.segment !== null ? { segment_opts: { saved_segment_id: audience.segment } } : {}) };
  let id = mail.campaign_id;
  if (!id) {
    const from = await mc.defaults(MAILCHIMP_LIST_ID);
    id = (await mc.createCampaign({ type: "regular", recipients,
      settings: { subject_line: mail.subject, preview_text: mail.preheader, title: `Mail til listen ${mail.id}: ${mail.subject}`.slice(0, 100), from_name: from.from_name || "Hjerterum", reply_to: from.from_email } })).id;
    await db.prepare("UPDATE list_mails SET campaign_id = ? WHERE id = ?").bind(id, mail.id).run();
  } else {
    await mc.updateCampaign(id, { recipients, settings: { subject_line: mail.subject, preview_text: mail.preheader } });
  }
  await mc.setContent(id, listMailHtml(mail));
  return { id, count: audience.count };
}

export async function testListMail(env: NewsletterEnv, deps: SagaDeps, db: D1Database, mail: ListMail, email: string): Promise<void> {
  if (!env.MAILCHIMP_API_KEY) throw new Error("mailchimp_not_configured");
  const { id } = await campaignFor(env, deps, db, mail);
  await mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher).test(id, [email]);
}

/** How many it would go to now (null when Mailchimp cannot say). */
export async function audienceCount(env: NewsletterEnv, deps: SagaDeps, audience: ListMail["audience"]): Promise<number | null> {
  if (!env.MAILCHIMP_API_KEY) return null;
  return (await mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher).audience(MAILCHIMP_LIST_ID, AUDIENCES[audience].tag).catch(() => null))?.count ?? null;
}

export async function sendListMail(env: NewsletterEnv, deps: SagaDeps, db: D1Database, mail: ListMail, by: string): Promise<number> {
  if (!env.MAILCHIMP_API_KEY) throw new Error("mailchimp_not_configured");
  if (mail.status === "sent") throw new Error("already_sent");
  if (!listMailReady(mail)) throw new Error("not_ready");
  // Claimed first, so a double press never sends twice.
  const claim = await db.prepare("UPDATE list_mails SET status = 'sent', sent_by = ?, sent_at_ms = ?, error = NULL WHERE id = ? AND status <> 'sent'").bind(by, deps.now(), mail.id).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) throw new Error("already_sent");
  try {
    const { id, count } = await campaignFor(env, deps, db, mail);
    await mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher).send(id);
    await db.prepare("UPDATE list_mails SET recipients = ? WHERE id = ?").bind(count, mail.id).run();
    return count;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare("UPDATE list_mails SET status = 'failed', sent_at_ms = NULL, error = ?, updated_at_ms = ? WHERE id = ?").bind(message.slice(0, 400), deps.now(), mail.id).run();
    throw error;
  }
}
