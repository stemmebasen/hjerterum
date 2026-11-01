import type { D1Database } from "./db.js";
import { DRAFT_FROM_DAY, getIssue, monthEvents, monthOf, monthName, newsletterHtml, nextMonth, sendTime, writeIssue, type Issue } from "./newsletter.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { claimJob } from "./saga/store.js";
import { telegramClient } from "./saga/telegram.js";

/** The monthly mail through Mailchimp (newsletter.ts), and the job that drafts and sends it.
 * Mailchimp's audience is the one the website's sign-up form uses; the mail goes only to those who ticked "Månedens events"
 * (an interest group in that audience). The key is the secret MAILCHIMP_API_KEY ("...-us6"). */

export const MAILCHIMP_LIST_ID = "0070dc72a9";
export type NewsletterEnv = SagaEnv & { MAILCHIMP_API_KEY?: string };

export function mailchimp(apiKey: string, fetcher: SagaDeps["fetcher"]) {
  const dc = /-([a-z]+\d+)$/.exec(apiKey)?.[1];
  if (!dc) throw new Error("mailchimp_key_invalid");
  const base = `https://${dc}.api.mailchimp.com/3.0`;
  const auth = `Basic ${btoa(`hjerterum:${apiKey}`)}`;
  async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${base}${path}`, { method, headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null) as (T & { detail?: string; title?: string }) | null;
    if (!response.ok) throw new Error(`mailchimp_${response.status}: ${data?.detail ?? data?.title ?? ""}`.trim());
    return data as T;
  }
  return {
    /** The "Månedens events" group: its category and its id. */
    async monthlyInterest(listId: string): Promise<{ category: string; interest: string }> {
      const cats = await call<{ categories: Array<{ id: string; title: string }> }>("GET", `/lists/${listId}/interest-categories?count=100`);
      for (const cat of cats.categories ?? []) {
        const found = await call<{ interests: Array<{ id: string; name: string }> }>("GET", `/lists/${listId}/interest-categories/${cat.id}/interests?count=100`);
        const hit = (found.interests ?? []).find(i => /måned/i.test(i.name));
        if (hit) return { category: cat.id, interest: hit.id };
      }
      throw new Error("mailchimp_group_missing: gruppen \"Månedens events\" findes ikke i Mailchimp");
    },
    defaults: (listId: string) => call<{ campaign_defaults: { from_name: string; from_email: string } }>("GET", `/lists/${listId}`).then(l => l.campaign_defaults),
    createCampaign: (body: unknown) => call<{ id: string }>("POST", "/campaigns", body),
    setContent: (id: string, html: string) => call<unknown>("PUT", `/campaigns/${id}/content`, { html }),
    send: (id: string) => call<unknown>("POST", `/campaigns/${id}/actions/send`)
  };
}

/** Sends an approved issue: a campaign to the "Månedens events" group, with the list read from the calendar now. */
export async function sendIssue(env: NewsletterEnv, deps: SagaDeps, db: D1Database, issue: Issue): Promise<void> {
  if (!env.MAILCHIMP_API_KEY) throw new Error("mailchimp_not_configured");
  const mc = mailchimp(env.MAILCHIMP_API_KEY, deps.fetcher);
  const html = newsletterHtml(issue, await monthEvents(db, issue.month, deps.fetcher));
  let id = issue.campaign_id;
  if (!id) {
    const [group, from] = await Promise.all([mc.monthlyInterest(MAILCHIMP_LIST_ID), mc.defaults(MAILCHIMP_LIST_ID)]);
    id = (await mc.createCampaign({
      type: "regular",
      recipients: { list_id: MAILCHIMP_LIST_ID, segment_opts: { match: "any", conditions: [{ condition_type: "Interests", field: `interests-${group.category}`, op: "interestcontains", value: [group.interest] }] } },
      settings: { subject_line: issue.subject, preview_text: issue.preheader, title: `Månedens events ${issue.month}`, from_name: from.from_name || "Hjerterum", reply_to: from.from_email }
    })).id;
    // Kept at once: a retry uses the same campaign and never makes a second one.
    await db.prepare("UPDATE newsletter_issues SET campaign_id = ?, updated_at_ms = ? WHERE month = ?").bind(id, deps.now(), issue.month).run();
  }
  await mc.setContent(id, html);
  await mc.send(id);
  await db.prepare("UPDATE newsletter_issues SET status = 'sent', sent_at_ms = ?, error = NULL, updated_at_ms = ? WHERE month = ?").bind(deps.now(), deps.now(), issue.month).run();
}

/** Every five minutes: from the 20th, next month's draft (once, then the board is told); on the 1st from 19.00, an approved issue is sent. */
export async function runNewsletterJob(env: NewsletterEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db) return;
  const now = deps.now();
  const month = monthOf(now);
  const day = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", day: "2-digit" }).format(now));
  // Sending: this month's approved issue, once its time has come (once per approval; approving again after a failure tries again).
  const due = await getIssue(db, month);
  if (due?.status === "approved" && now >= sendTime(month) && await claimJob(db, "newsletter_send", due.approved_at_ms ?? sendTime(month), now)) {
    await sendIssue(env, deps, db, due).catch(async error => {
      const message = error instanceof Error ? error.message : String(error);
      await db.prepare("UPDATE newsletter_issues SET status = 'failed', error = ?, updated_at_ms = ? WHERE month = ?").bind(message.slice(0, 500), now, month).run();
      await tellBoard(env, deps, `Nyhedsbrevet for ${monthName(month)} kunne ikke sendes: ${message.slice(0, 200)}. Se https://admin.hjerterum.info/arrangementer/nyhedsbrev`);
    });
  }
  // Drafting: next month's issue from the 20th.
  const coming = nextMonth(month);
  if (day >= DRAFT_FROM_DAY && !(await getIssue(db, coming)) && await claimJob(db, `newsletter_draft:${coming}`, day, now)) {
    const issue = await writeIssue(env, deps, db, coming);
    if (issue) await tellBoard(env, deps, `Nyhedsbrevet for ${monthName(coming)} er klar til gennemsyn: "${issue.subject}". Læs det, ret det og godkend det her, så går det ud den 1. kl. 19.00: https://admin.hjerterum.info/arrangementer/nyhedsbrev`);
  }
}

async function tellBoard(env: SagaEnv, deps: SagaDeps, text: string): Promise<void> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_BOARD_CHAT_ID) return;
  await telegramClient(env, deps).sendMessage(env.SAGA_BOARD_CHAT_ID, text).catch(error => console.warn("newsletter_notice_failed", error instanceof Error ? error.message : error));
}
