import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { letter, mailConfigured, mailSiteUrl, sendLogged, type Mail } from "../mail.js";
import { dayLabel, hhmm } from "../time.js";
import { createLoginLink, linkPath } from "./loginLink.js";

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
