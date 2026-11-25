import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { letter, mailConfigured, mailSiteUrl, sendLogged, type LetterPart, type Mail } from "../mail.js";
import { eventPath } from "../web/components.js";
import { eventBySlug, relatedEvents, type EventRow } from "../web/queries.js";
import { GATHER_AT, KICKOFF_PATH } from "./kickoff.js";
import { FREE_MEMBERSHIP_DATE, freeMembership } from "./profile.js";
import { dayLabel, hhmm } from "../time.js";
import { createLoginLink, linkPath } from "./loginLink.js";
import { mailPref, withdrawUrl } from "../mailPrefs.js";

/** Mails about flock places from the interest list (kickoff.ts): when a member is offered a place in a flock, and a
 * reminder when the 48 hours are nearly up and they have not answered. The button in the mail logs them in (a login
 * link valid until the deadline) and opens Mine flokke, where they say yes or no thanks. Run by the cron, and right
 * after a request that may have invited someone. */

/** The reminder goes out when this little time is left … */
const REMIND_LEFT_MS = 12 * 3600_000;
/** … and at least this long after the first mail. */
const REMIND_AFTER_MS = 6 * 3600_000;
const BATCH = 40;

type Due = {
  member_id: string; event_id: string; respond_by: number; first_name: string; email: string;
  title: string; starts_at: number; meeting_at: number | null; meeting_place: string | null; invited_count: number;
};

const SELECT = `SELECT i.member_id, i.event_id, i.respond_by, m.first_name, m.email, e.title, e.starts_at, f.meeting_at, f.meeting_place,
    (SELECT COUNT(*) FROM event_interests o WHERE o.flock_id = i.flock_id AND o.status IN ('invited', 'confirmed')) AS invited_count
  FROM event_interests i JOIN members m ON m.id = i.member_id JOIN events e ON e.id = i.event_id LEFT JOIN flocks f ON f.id = i.flock_id
  WHERE i.status = 'invited' AND i.respond_by > ?1 AND m.email IS NOT NULL AND e.status = 'scheduled'`;

const when = (ms: number, now: number) => `${dayLabel(ms, now)} kl. ${hhmm(ms)}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function invitationMail(d: Due, url: string, now: number): Mail {
  const others = Math.max(0, d.invited_count - 1);
  return letter({
    to: d.email,
    subject: `Der er en plads til dig: ${d.title}`,
    greeting: `Hej ${d.first_name}`,
    paragraphs: [
      `Godt nyt! ${others ? `Du og ${others} ${others === 1 ? "anden" : "andre"} vil gerne med til ${d.title}` : `Der er nu en flok til ${d.title}`} ${when(d.starts_at, now)}, og vi har en plads til dig i flokken.`,
      `Forslag: I mødes ${d.meeting_at ? `kl. ${hhmm(d.meeting_at)}` : "før arrangementet"}${d.meeting_place ? ` ${lowerFirst(d.meeting_place)}` : ""}. Herfra kan I finde en café i nærheden og tage en kop kaffe sammen, inden I går til arrangementet. Resten aftaler I i flokkens lille chat.`,
      `Svar senest ${when(d.respond_by, now)}. Siger du ikke ja inden da, går pladsen videre til den næste.`
    ],
    button: { label: "Se pladsen og svar", url },
    after: ["Husk, at du selv køber billet.", "Du får denne mail, fordi du har sagt, at du gerne vil med. Har du ikke lyst alligevel, så tryk bare Nej tak, så går pladsen videre."]
  });
}

export function reminderMail(d: Due, url: string, now: number): Mail {
  return letter({
    to: d.email,
    subject: `Husk at svare: din plads til ${d.title}`,
    greeting: `Hej ${d.first_name}`,
    paragraphs: [
      `Du har stadig en plads i flokken til ${d.title} ${when(d.starts_at, now)}.`,
      `Fristen for at svare er ${when(d.respond_by, now)}. Derefter går pladsen videre til den næste.`
    ],
    button: { label: "Se pladsen og svar", url },
    after: ["Har du ikke lyst alligevel, så tryk bare Nej tak."]
  });
}

async function send(db: D1Database, env: Env, kind: "invitation" | "reminder", d: Due, now: number): Promise<boolean> {
  const column = kind === "invitation" ? "notified_at" : "reminded_at";
  // Claim the row first, so the cron and a request never both send it.
  const claimed = await db.prepare(`UPDATE event_interests SET ${column} = ? WHERE member_id = ? AND event_id = ? AND status = 'invited' AND ${column} IS NULL`)
    .bind(now, d.member_id, d.event_id).run();
  if ((claimed.meta?.changes ?? 0) !== 1) return false;
  const token = await createLoginLink(db, d.email, d.member_id, "/flokke", d.respond_by, now);
  const url = mailSiteUrl(env) + linkPath(token);
  const mail = kind === "invitation" ? invitationMail(d, url, now) : reminderMail(d, url, now);
  const result = await sendLogged(db, env, kind, d.member_id, mail, now);
  if (!result.ok) {
    // Try again on the next run.
    await db.prepare(`UPDATE event_interests SET ${column} = NULL WHERE member_id = ? AND event_id = ?`).bind(d.member_id, d.event_id).run();
    return false;
  }
  return true;
}

/** Sends the mails that are due. Does nothing (and reads nothing) when no mail service is set up. */
export async function sendDueMails(db: D1Database, env: Env, now: number): Promise<{ invitations: number; reminders: number }> {
  const out = { invitations: 0, reminders: 0 };
  if (!mailConfigured(env)) return out;
  const { results: fresh } = await db.prepare(`${SELECT} AND i.notified_at IS NULL ORDER BY i.invited_at LIMIT ${BATCH}`).bind(now).all<Due>();
  for (const d of fresh) if (await send(db, env, "invitation", d, now)) out.invitations++;
  const { results: due } = await db.prepare(`${SELECT} AND i.notified_at IS NOT NULL AND i.reminded_at IS NULL AND i.respond_by <= ?2 AND i.notified_at <= ?3 LIMIT ${BATCH}`)
    .bind(now, now + REMIND_LEFT_MS, now - REMIND_AFTER_MS).all<Due>();
  for (const d of due) if (await send(db, env, "reminder", d, now)) out.reminders++;
  return out;
}

// ————————————————————————————————————————— Status before the arrangement

/** Status mails to those still waiting for a flock (Jake 2026-11-24): 7 days, 3 days and 1 day before. The day before
 * is the final status, since no flock is gathered after that (LAST_CALL_MS in kickoff.ts). */
export const STATUS_STAGES = [7, 3, 1] as const;
export type StatusStage = (typeof STATUS_STAGES)[number];
const DAY_MS = 86_400_000;

type StatusDue = {
  member_id: string; event_id: string; created_at: number; status_stage: number | null; due: StatusStage;
  first_name: string; email: string; is_member: number; slug: string; title: string; starts_at: number;
};

const STATUS_SELECT = `SELECT * FROM (SELECT i.member_id, i.event_id, i.created_at, i.status_stage, m.first_name, m.email, e.slug, e.title, e.starts_at,
    CASE WHEN e.starts_at - ?1 <= ${DAY_MS} THEN 1 WHEN e.starts_at - ?1 <= ${3 * DAY_MS} THEN 3 ELSE 7 END AS due,
    EXISTS (SELECT 1 FROM membership_signups s WHERE lower(s.email) = lower(m.email)) AS is_member
  FROM event_interests i JOIN members m ON m.id = i.member_id JOIN events e ON e.id = i.event_id
  WHERE i.status = 'waiting' AND m.email IS NOT NULL AND e.status = 'scheduled' AND e.starts_at > ?1 AND e.starts_at <= ?1 + ${7 * DAY_MS})
  WHERE status_stage IS NULL OR status_stage > due ORDER BY starts_at LIMIT ${BATCH}`;

/** "Husk, at din interesse er helt uforpligtende" (Jake 2026-11-24: never obliged to take part or to stay a member). */
const NO_OBLIGATION = "Husk, at din interesse er helt uforpligtende. Også hvis vi samler en flok, bestemmer du selv, om du vil med.";

/** The closing part: why becoming a member matters (Jake's choice, variant B), or a thank-you to those who already are. */
export function memberPart(isMember: boolean, siteUrl: string, now: number): LetterPart[] {
  if (isMember) {
    return [{ text: "Tak fordi du er medlem af Socialklubben. Kender du nogen, der kunne have lyst til at være med, så send dem gerne et link. Jo flere vi er, jo flere flokke kan vi samle.", link: { label: "socialklubben.dk", url: siteUrl + "/" } }];
  }
  const free = freeMembership(now) ? ` Det koster ikke noget i opstarten frem til ${FREE_MEMBERSHIP_DATE}, og hvert eneste medlem giver os mod på at sætte endnu flere aktiviteter i gang.` : " Hvert eneste medlem giver os mod på at sætte endnu flere aktiviteter i gang.";
  return [{
    text: `En lille ting til sidst: Socialklubben er en helt ny forening, og vi bygger den op sammen med jer. Et godt fællesskab kræver et solidt fundament, og det fundament er medlemmerne. Derfor vil vi gerne opfordre dig til at blive medlem.${free} Medlemskabet forpligter dig ikke til noget: du bestemmer selv, om og hvornår du vil med, og du kan melde dig ud, når du vil.`,
    link: { label: "Bliv medlem", url: siteUrl + "/bliv-medlem" }
  }];
}

/** "Har du ikke lyst alligevel?" with the link that takes the interest off the list in one press (Jake 2026-11-25). */
const withdrawPart = (url: string): LetterPart => ({ before: "Har du ikke lyst alligevel, kan du ", link: { label: "fjerne dig fra listen", url }, after: " her. Så får du ikke flere mails om dette arrangement." });

export function statusMail(d: Omit<StatusDue, "member_id" | "event_id" | "created_at" | "status_stage">, siteUrl: string, related: EventRow[], now: number, withdraw?: string): Mail {
  const at = when(d.starts_at, now);
  const leave = withdraw ? [withdrawPart(withdraw)] : [];
  const greeting = `Hej ${d.first_name}`;
  const after = memberPart(!!d.is_member, siteUrl, now);
  if (d.due === 7) {
    return letter({
      to: d.email, subject: `Status på ${d.title} ${dayLabel(d.starts_at, now)}`, greeting,
      paragraphs: [
        `Tak fordi du har vist interesse for ${d.title} ${at}. Lige nu er vi ikke helt nok endnu til at samle en flok. Vi skal være mindst ${GATHER_AT}, og der er stadig en uge til. Vi giver dig besked igen 3 dage før.`,
        NO_OBLIGATION,
        "Kender du nogen, der også kunne have lyst? Del gerne arrangementet.",
        ...leave
      ],
      button: { label: "Se arrangementet", url: siteUrl + eventPath(d) }, after
    });
  }
  if (d.due === 3) {
    return letter({
      to: d.email, subject: `Stadig på vej: ${d.title}`, greeting,
      paragraphs: [
        `Der er 3 dage til ${d.title} ${at}, og vi mangler stadig et par stykker, før vi kan samle en flok. Vi prøver frem til dagen før, og så får du en endelig besked.`,
        NO_OBLIGATION,
        "Vil du være sikker på at komme afsted sammen med andre, kan du også kigge på andre arrangementer, hvor andre allerede har vist interesse.",
        ...leave
      ],
      button: { label: "Se andre arrangementer", url: siteUrl + KICKOFF_PATH }, after
    });
  }
  return letter({
    to: d.email, subject: `Det blev ikke til en flok denne gang: ${d.title}`, greeting,
    paragraphs: [
      `Vi må desværre sige, at det ikke blev til en flok til ${d.title} ${at}. Der var ikke nok, der havde meldt sig. Du er selvfølgelig stadig velkommen til at tage afsted på egen hånd.`,
      "Du står ikke længere på listen til dette arrangement, og du skal ikke gøre noget.",
      ...(related.length ? ["Her er nogle lignende arrangementer, som måske er noget for dig:"] : [])
    ],
    links: related.map(e => ({ label: `${e.title}, ${when(e.starts_at, now)}`, url: siteUrl + eventPath(e) })),
    button: { label: "Find et andet arrangement", url: siteUrl + KICKOFF_PATH },
    after: ["Tak for din tålmodighed. Vi håber at se dig i en flok en anden gang.", ...after]
  });
}

/** Sends the status mails that are due, one per stage. Someone who put themselves on the list after a stage's moment
 * skips that stage without a mail (no "a week to go" to someone who ticked yesterday). Run by the cron after the
 * gathering, so whoever just got a place is no longer waiting. */
export async function sendStatusMails(db: D1Database, env: Env, regions: string[], now: number): Promise<{ status: number }> {
  const out = { status: 0 };
  if (!mailConfigured(env)) return out;
  const { results } = await db.prepare(STATUS_SELECT).bind(now).all<StatusDue>();
  const siteUrl = mailSiteUrl(env);
  for (const d of results) {
    // Claim the stage first, so two runs never both send it.
    const claimed = await db.prepare(`UPDATE event_interests SET status_stage = ?1 WHERE member_id = ?2 AND event_id = ?3 AND status = 'waiting' AND (status_stage IS NULL OR status_stage > ?1)`)
      .bind(d.due, d.member_id, d.event_id).run();
    if ((claimed.meta?.changes ?? 0) !== 1) continue;
    if (d.created_at > d.starts_at - d.due * DAY_MS) continue;
    let related: EventRow[] = [];
    if (d.due === 1) {
      const e = await eventBySlug(db, d.slug);
      if (e) related = await relatedEvents(db, e, regions, now, 3);
    }
    const withdraw = d.due === 1 ? undefined : withdrawUrl(siteUrl, (await mailPref(db, d.email, now)).token, d.slug);
    const result = await sendLogged(db, env, "status", d.member_id, statusMail(d, siteUrl, related, now, withdraw), now);
    if (!result.ok) {
      // Try again on the next run.
      await db.prepare("UPDATE event_interests SET status_stage = ? WHERE member_id = ? AND event_id = ?").bind(d.status_stage, d.member_id, d.event_id).run();
      continue;
    }
    out.status++;
  }
  return out;
}
