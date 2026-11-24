import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { englishPath } from "../i18n/paths.js";
import { letter, mailConfigured, sendLogged, type Mail, type Paragraph } from "../mail.js";
import { html } from "../web/html.js";
import { crumbsNav, page, ORGANISER_EMAIL, type Crumb, type PageContext } from "../web/layout.js";
import { sha256 } from "./auth.js";
import { saveSignup } from "./membership.js";
import { freeMembership } from "./profile.js";
import type { View } from "./pages.js";
import { INFO_MEETING, sendWelcome } from "./welcome.js";

/** "Vil du være medlem?" (Jake 2026-11-24): one mail to each person who has pressed "Jeg vil gerne med!" (a profile
 * with an e-mail and an interest) but is not a member, with a link that makes them a member without a form. Sent right
 * after their first tick, and once to those who ticked before this existed (the cron, a few a day). Never twice: one
 * row per profile in join_invites. The link opens a page with one button, because mail programs open links to check
 * them; only pressing it makes anyone a member. */

export const JOIN_PATH = "/bliv-medlem/ja";
/** The link works this long. */
export const JOIN_DAYS = 60;
/** At most this many invitations a day in all, so the mail service's daily allowance is kept for flock mails. */
export const JOIN_PER_DAY = 40;
/** The cron sends at most this many per run to those who ticked before. */
const BACKFILL_BATCH = 5;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const validToken = (t: string | null | undefined): t is string => !!t && /^[A-Za-z0-9_-]{40,60}$/.test(t);

export function joinMail(to: string, firstName: string, link: string, origin: string, lang: "da" | "en", now: number): Mail {
  const url = (path: string) => origin + (lang === "en" ? englishPath(path) : path);
  const free = freeMembership(now);
  const meeting = now < INFO_MEETING.endsAt;
  const first = firstName.trim().slice(0, 40);
  if (lang === "en") {
    return letter({
      lang,
      to,
      subject: "Would you like to be a member of Socialklubben?",
      greeting: first ? `Hi ${first}` : "Hi",
      paragraphs: [
        "Thank you for showing interest in an activity with Socialklubben. We're so glad you'd like to come along!",
        "Socialklubben is a newly started association in Aarhus, and we're just getting going. Our members are the foundation of it all: the more of us there are, the more we can get started together. That's why we'd love to have you with us as a member.",
        (free ? "Membership costs nothing while we're starting up, until 1 March 2027. " : "") +
          "And you're never obliged to anything: not to take part, and not to stay a member. You can leave whenever you like.",
        "Press the button and then \"Yes\" on the page that opens, and you're a member. There's nothing to fill in."
      ],
      button: { label: "Yes, I'd like to be a member", url: link },
      after: [
        "You're also welcome to keep showing interest in activities without being a member. When 3 to 6 of us want to go, we become a small group, meet in front of a landmark in town and have a cup of coffee together first.",
        ...(meeting ? [{ before: "And you're warmly invited to our information meeting on Tuesday 12 January 2027, 19.30–20.45, at Guldsmedgade 26B in Aarhus, where you can also hear about joining the steering group. ", link: { label: "Sign up here", url: url(INFO_MEETING.path) }, after: "." } satisfies Paragraph] : []),
        { before: "Questions? Just reply to this e-mail or write to us at ", link: { label: ORGANISER_EMAIL, url: `mailto:${ORGANISER_EMAIL}` }, after: "." }
      ]
    });
  }
  return letter({
    to,
    subject: "Vil du være medlem af Socialklubben?",
    greeting: first ? `Hej ${first}` : "Hej",
    paragraphs: [
      "Tak, fordi du har vist interesse for et arrangement hos Socialklubben. Hvor er det dejligt, at du vil med!",
      "Socialklubben er en nystartet forening i Aarhus, og vi er lige gået i gang. Medlemmerne er fundamentet for det hele: Jo flere vi er, jo flere initiativer kan vi sætte i gang sammen. Derfor vil vi rigtig gerne have dig med som medlem.",
      (free ? "Medlemskabet koster ikke noget, mens vi er under opstart, frem til 1. marts 2027. " : "") +
        "Og du er aldrig forpligtet til noget, hverken til at deltage eller til at blive ved med at være medlem. Du kan melde dig ud, når du vil.",
      "Tryk på knappen og derefter \"Ja\" på siden, der åbner, så er du medlem. Du skal ikke udfylde noget."
    ],
    button: { label: "Ja, jeg vil gerne være medlem", url: link },
    after: [
      "Du kan også sagtens blive ved med at vise interesse for arrangementer uden at være medlem. Når I er 3 til 6, der vil med, bliver I en lille flok, mødes foran et kendt sted i byen og får en kop kaffe sammen først.",
      ...(meeting ? [{ before: "Og du er meget velkommen til vores informationsmøde tirsdag den 12. januar 2027 kl. 19.30–20.45 i Guldsmedgade 26B, Aarhus, hvor du også kan høre om at komme med i styregruppen. ", link: { label: "Tilmeld dig her", url: url(INFO_MEETING.path) }, after: "." } satisfies Paragraph] : []),
      { before: "Har du spørgsmål, så svar bare på denne mail eller skriv til os på ", link: { label: ORGANISER_EMAIL, url: `mailto:${ORGANISER_EMAIL}` }, after: "." }
    ]
  });
}

type Candidate = { id: string; first_name: string; email: string };

/** Profiles with an e-mail and an interest, who are not members and have had no invitation. */
const CANDIDATES = `SELECT m.id, m.first_name, m.email FROM members m
  WHERE m.email IS NOT NULL
    AND EXISTS (SELECT 1 FROM event_interests i WHERE i.member_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM membership_signups s WHERE lower(s.email) = lower(m.email))
    AND NOT EXISTS (SELECT 1 FROM join_invites j WHERE j.member_id = m.id)`;

async function underDailyCap(db: D1Database, now: number): Promise<boolean> {
  const sent = await db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind = 'join' AND created_at > ?").bind(now - 86_400_000).first<{ n: number }>();
  return (sent?.n ?? 0) < JOIN_PER_DAY;
}

async function invite(db: D1Database, env: Env, c: Candidate, origin: string, lang: "da" | "en", now: number): Promise<boolean> {
  const token = newToken();
  // The row first: if two runs race, only one of them gets to send.
  const claimed = await db.prepare("INSERT OR IGNORE INTO join_invites (member_id, email, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(c.id, c.email.toLowerCase(), await sha256(token), now, now + JOIN_DAYS * 86_400_000).run();
  if ((claimed.meta?.changes ?? 0) !== 1) return false;
  const link = origin + (lang === "en" ? englishPath(JOIN_PATH) : JOIN_PATH) + `?t=${token}`;
  const result = await sendLogged(db, env, "join", c.id, joinMail(c.email, c.first_name, link, origin, lang, now), now);
  return result.ok;
}

/** Right after a tick: the invitation to that one person, in the language of the page they ticked on. */
export async function inviteToJoin(db: D1Database, env: Env, memberId: string, origin: string, lang: "da" | "en", now: number): Promise<void> {
  if (!mailConfigured(env) || !(await underDailyCap(db, now))) return;
  const c = await db.prepare(`${CANDIDATES} AND m.id = ?`).bind(memberId).first<Candidate>();
  if (c) await invite(db, env, c, origin, lang, now);
}

/** The cron: a few at a time to those who ticked before (or on the interest list, which has no single page). */
export async function sendJoinInvites(db: D1Database, env: Env, origin: string, now: number): Promise<number> {
  if (!mailConfigured(env)) return 0;
  let sent = 0;
  const { results } = await db.prepare(`${CANDIDATES} ORDER BY m.created_at LIMIT ${BACKFILL_BATCH}`).all<Candidate>();
  for (const c of results) {
    if (!(await underDailyCap(db, now))) break;
    if (await invite(db, env, c, origin, "da", now)) sent++;
  }
  return sent;
}

type JoinState = { ok: true; memberId: string; email: string; firstName: string } | { error: "member" | "expired" | "unknown" };

async function joinState(db: D1Database, token: string, now: number): Promise<JoinState> {
  const row = await db.prepare(`SELECT j.member_id, j.email, j.expires_at, m.first_name FROM join_invites j JOIN members m ON m.id = j.member_id WHERE j.token_hash = ?`)
    .bind(await sha256(token)).first<{ member_id: string; email: string; expires_at: number; first_name: string }>();
  if (!row) return { error: "unknown" };
  const already = await db.prepare("SELECT 1 AS y FROM membership_signups WHERE lower(email) = ? LIMIT 1").bind(row.email).first<{ y: number }>();
  if (already) return { error: "member" };
  if (row.expires_at < now) return { error: "expired" };
  return { ok: true, memberId: row.member_id, email: row.email, firstName: row.first_name };
}

/** GET /bliv-medlem/ja?t=… shows the button; POST makes them a member and sends the welcome mail. */
export async function joinRoute(request: Request, env: Env, db: D1Database, pc: PageContext, url: URL, now: number): Promise<View> {
  const post = request.method === "POST";
  const raw = post ? String((await request.formData().catch(() => null))?.get("t") ?? "") : url.searchParams.get("t");
  if (!validToken(raw)) return joinPage(pc, { error: "unknown" });
  const state = await joinState(db, raw, now);
  if ("error" in state) return joinPage(pc, { error: state.error });
  if (!post) return joinPage(pc, { token: raw });
  const isNew = await saveSignup(db, { name: state.firstName, email: state.email }, now);
  await db.prepare("UPDATE join_invites SET used_at = ? WHERE member_id = ?").bind(now, state.memberId).run();
  if (isNew) await sendWelcome(db, env, state.email, state.firstName, pc.origin, pc.lang ?? "da", now);
  return joinPage(pc, { done: true });
}

const PRIVATE = { "cache-control": "private, no-store" };

function joinPage(ctx: PageContext, state: { token?: string; done?: boolean; error?: "member" | "expired" | "unknown" }): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Bliv medlem", path: "/bliv-medlem" }];
  const free = freeMembership(ctx.now);
  const title = state.done ? "Velkommen som medlem!"
    : state.token ? "Vil du være medlem af Socialklubben?"
    : state.error === "member" ? "Du er allerede medlem"
    : state.error === "expired" ? "Linket er udløbet" : "Linket virker ikke";
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${title}</h1>
  </header>
  ${state.done
    ? html`<p>Tak, du er nu medlem af Socialklubben. Vi har sendt dig en velkomstmail. Du er aldrig forpligtet til noget, og du kan melde dig ud, når du vil.</p>
    <p class="more-line"><a class="button" href="/kalender">Se kalenderen</a></p>`
    : state.token
      ? html`<form class="form-card" method="post" action="${JOIN_PATH}">
      <input type="hidden" name="t" value="${state.token}">
      <p>Tryk på knappen, så er du medlem. Du skal ikke udfylde noget.</p>
      ${free ? html`<p>Medlemskabet koster ikke noget, mens vi er under opstart, frem til 1. marts 2027.</p>` : ""}
      <p>Du er aldrig forpligtet til noget, hverken til at deltage eller til at blive ved med at være medlem. Du kan melde dig ud, når du vil.</p>
      <div class="form-actions"><button type="submit">Ja, jeg vil gerne være medlem</button></div>
    </form>`
      : state.error === "member"
        ? html`<p>Tak, du er allerede medlem af Socialklubben.</p><p class="more-line"><a class="button" href="/kalender">Se kalenderen</a></p>`
        : html`<p>Du kan stadig blive medlem med dit navn og din e-mail.</p><p class="more-line"><a class="button" href="/bliv-medlem#meld-ind">Bliv medlem</a></p>`}
</div>`;
  return { status: state.token || state.done || state.error === "member" ? 200 : 400, headers: PRIVATE, body: page(ctx, { title: "Bliv medlem – Socialklubben", description: "Bliv medlem af Socialklubben.", canonical: "/bliv-medlem", noindex: true, breadcrumbs: crumbs }, body) };
}
