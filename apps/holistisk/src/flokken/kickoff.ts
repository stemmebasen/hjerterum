import type { D1Database } from "../db.js";
import { priceLabel } from "../price.js";
import { capitalize, dayLabel, hhmm, timeRangeLabel } from "../time.js";
import { eventPath, groupTiles, placeLine } from "../web/components.js";
import { groupBySlug, groupsOf, type Group } from "../groups.js";
import { html, raw, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import { eventBySlug, flockRoom, kickoffEvents, type EventRow } from "../web/queries.js";
import { flash, type View } from "./pages.js";
import { suggestedMeetingPlace } from "./meetingPoints.js";
import { eventOver, flockById, joinFlock, memberFlockForEvent, memberFlocks } from "./store.js";

/** "Lad os komme godt i gang": the interest list. A newcomer ticks the coming events they would like to go to with
 * others (a pop-up on the first visit, site.js, or the page /kom-godt-i-gang), tells the others a little about
 * themselves and gives an e-mail. When a handful are interested in the same event, Socialklubben gathers a flock and
 * invites them; each confirms within 48 hours. The flock gets a suggested meeting time (1½ hours before) outdoors
 * at a landmark near the venue (meetingPoints.ts), and the rest is planned in its chat. */

export const KICKOFF_PATH = "/kom-godt-i-gang";
/** A flock is gathered when this many are waiting for the same event … */
export const GATHER_AT = 3;
/** … and holds at most this many; more interested people make another flock. */
export const GATHER_MAX = 6;
/** How long an invited member has to confirm. */
export const RESPOND_MS = 48 * 3600_000;
/** The suggested meeting time: this long before the event starts. */
export const MEET_BEFORE_MS = 90 * 60_000;
/** No flock is gathered, and no invitation can be confirmed, this close to the start. */
const LAST_CALL_MS = 3 * 3600_000;
/** At most this many events in the list, ten shown at a time. */
export const LIST_SIZE = 40;
export const PAGE_STEP = 10;
export const MAX_CHOICES = 40;
const SLUG = /^[a-z0-9-]{1,90}$/;

// ————————————————————————————————————————— Choices kept while becoming a member

/** The choices are kept in a short-lived cookie while the newcomer becomes a member and fills in their profile. */
const CHOICE_COOKIE = "sk_valg";
export const choiceCookie = (slugs: string[]): string => `${CHOICE_COOKIE}=${slugs.join(".")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`;
export const clearChoiceCookie = (): string => `${CHOICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function readChoices(request: Request): string[] {
  const m = new RegExp(`(?:^|;\\s*)${CHOICE_COOKIE}=([a-z0-9.-]{1,4000})`).exec(request.headers.get("cookie") ?? "");
  return cleanChoices(m?.[1]?.split(".") ?? []);
}
export const cleanChoices = (values: string[]): string[] => [...new Set(values.filter(v => SLUG.test(v)))].slice(0, MAX_CHOICES);

// ————————————————————————————————————————— Interests

export type InterestStatus = "waiting" | "invited" | "confirmed" | "declined" | "expired";
export type InterestRow = {
  event_id: string; status: InterestStatus; flock_id: string | null; created_at: number; invited_at: number | null; respond_by: number | null;
  slug: string; title: string; starts_at: number; ends_at: number | null; event_status: string; venue_name: string | null; city: string | null; area: string | null;
  meeting_at: number | null; meeting_place: string | null;
  /** Everyone else waiting, invited or with a place for the event. */
  others: number;
  /** Invited or confirmed for the same flock, the member included. */
  invited_count: number;
};

const ACTIVE = "('waiting', 'invited', 'confirmed')";

/** How many are interested in each event (waiting, invited or confirmed). */
export async function interestCounts(db: D1Database, eventIds: string[]): Promise<Map<string, number>> {
  if (!eventIds.length) return new Map();
  const { results } = await db.prepare(`SELECT event_id, COUNT(*) AS n FROM event_interests WHERE status IN ${ACTIVE}
    AND event_id IN (${eventIds.map(() => "?").join(",")}) GROUP BY event_id`).bind(...eventIds).all<{ event_id: string; n: number }>();
  return new Map(results.map(r => [r.event_id, r.n]));
}

/** For the event page: how many others are interested in the event, and the member's own standing. */
export async function eventInterest(db: D1Database, eventId: string, memberId: string | null): Promise<{ others: number; mine: InterestStatus | null }> {
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM event_interests WHERE event_id = ?1 AND status IN ${ACTIVE} AND member_id IS NOT ?2) AS others,
      (SELECT status FROM event_interests WHERE event_id = ?1 AND member_id = ?2) AS mine`).bind(eventId, memberId).first<{ others: number; mine: InterestStatus | null }>();
  return { others: row?.others ?? 0, mine: row?.mine ?? null };
}

/** The member's interests, soonest event first. */
export async function memberInterests(db: D1Database, memberId: string): Promise<InterestRow[]> {
  const { results } = await db.prepare(`SELECT i.event_id, i.status, i.flock_id, i.created_at, i.invited_at, i.respond_by,
      e.slug, e.title, e.starts_at, e.ends_at, e.status AS event_status, e.venue_name, e.city, e.area, f.meeting_at, f.meeting_place,
      (SELECT COUNT(*) FROM event_interests o WHERE o.event_id = i.event_id AND o.member_id != i.member_id AND o.status IN ${ACTIVE}) AS others,
      (SELECT COUNT(*) FROM event_interests o WHERE i.flock_id IS NOT NULL AND o.flock_id = i.flock_id AND o.status IN ('invited', 'confirmed')) AS invited_count
    FROM event_interests i JOIN events e ON e.id = i.event_id LEFT JOIN flocks f ON f.id = i.flock_id
    WHERE i.member_id = ? ORDER BY e.starts_at`).bind(memberId).all<InterestRow>();
  return results;
}

/** Saves the member's ticks. `shown` are the events the list showed: one that is not ticked any more is taken off the
 * list while it is still only waiting. Ticking an event again after saying no thanks puts the member back in line. */
export async function saveInterests(db: D1Database, memberId: string, chosen: string[], shown: string[], regions: string[], now: number): Promise<{ added: number }> {
  let added = 0;
  const touched = new Set<string>();
  for (const slug of cleanChoices(chosen)) {
    const e = await eventBySlug(db, slug);
    if (!e || !e.region || !regions.includes(e.region) || e.status !== "scheduled" || e.starts_at <= now) continue;
    if (await memberFlockForEvent(db, e.id, memberId)) continue;
    const r = await db.prepare(`INSERT INTO event_interests (member_id, event_id, status, created_at, updated_at) VALUES (?, ?, 'waiting', ?, ?)
      ON CONFLICT (member_id, event_id) DO UPDATE SET status = 'waiting', flock_id = NULL, invited_at = NULL, respond_by = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at
      WHERE event_interests.status IN ('declined', 'expired')`).bind(memberId, e.id, now, now).run();
    if ((r.meta?.changes ?? 0) > 0) { added++; touched.add(e.id); }
  }
  const unticked = cleanChoices(shown).filter(s => !chosen.includes(s));
  if (unticked.length) {
    await db.prepare(`DELETE FROM event_interests WHERE member_id = ? AND status = 'waiting'
      AND event_id IN (SELECT id FROM events WHERE slug IN (${unticked.map(() => "?").join(",")}))`).bind(memberId, ...unticked).run();
  }
  for (const id of touched) await gather(db, id, now);
  return { added };
}

/** Takes a waiting interest off the list. */
export async function removeInterest(db: D1Database, memberId: string, slug: string): Promise<void> {
  await db.prepare(`DELETE FROM event_interests WHERE member_id = ? AND status = 'waiting' AND event_id = (SELECT id FROM events WHERE slug = ?)`).bind(memberId, slug).run();
}

type Answer = { ok: true; flockId: string } | { error: "not_invited" | "too_late" | "full" | "event_closed" };

/** Says yes to an invitation: the member joins the flock. */
export async function confirmInterest(db: D1Database, memberId: string, slug: string, now: number): Promise<Answer> {
  const row = await db.prepare(`SELECT i.event_id, i.flock_id, i.respond_by, e.starts_at FROM event_interests i JOIN events e ON e.id = i.event_id
    WHERE i.member_id = ? AND e.slug = ? AND i.status = 'invited'`).bind(memberId, slug).first<{ event_id: string; flock_id: string | null; respond_by: number; starts_at: number }>();
  if (!row || !row.flock_id) return { error: "not_invited" };
  if (row.respond_by < now) { await expireDue(db, now); return { error: "too_late" }; }
  const f = await flockById(db, row.flock_id, memberId);
  if (!f) return { error: "not_invited" };
  const joined = await joinFlock(db, f, memberId, now);
  if ("error" in joined) {
    if (joined.error === "already_in_flock") {
      const mine = await memberFlockForEvent(db, row.event_id, memberId);
      await setStatus(db, memberId, row.event_id, "confirmed", mine, now);
      await gather(db, row.event_id, now);
      return { ok: true, flockId: mine! };
    }
    // The place went to someone else meanwhile (the flock is open to others too): back in line.
    await setStatus(db, memberId, row.event_id, "waiting", null, now);
    await gather(db, row.event_id, now);
    return { error: joined.error === "full" ? "full" : "event_closed" };
  }
  await setStatus(db, memberId, row.event_id, "confirmed", f.id, now);
  return { ok: true, flockId: f.id };
}

/** Says no thanks to an invitation; the place goes to the next one waiting. */
export async function declineInterest(db: D1Database, memberId: string, slug: string, now: number): Promise<void> {
  const row = await db.prepare(`SELECT i.event_id FROM event_interests i JOIN events e ON e.id = i.event_id WHERE i.member_id = ? AND e.slug = ? AND i.status = 'invited'`)
    .bind(memberId, slug).first<{ event_id: string }>();
  if (!row) return;
  await setStatus(db, memberId, row.event_id, "declined", null, now);
  await gather(db, row.event_id, now);
}

async function setStatus(db: D1Database, memberId: string, eventId: string, status: InterestStatus, flockId: string | null, now: number): Promise<void> {
  await db.prepare(`UPDATE event_interests SET status = ?, flock_id = ?, updated_at = ?,
    invited_at = CASE WHEN ? = 'waiting' THEN NULL ELSE invited_at END, respond_by = CASE WHEN ? = 'waiting' THEN NULL ELSE respond_by END
    WHERE member_id = ? AND event_id = ?`).bind(status, flockId, now, status, status, memberId, eventId).run();
}

/** Invitations not answered in time lapse, and their places go to the next ones waiting. Returns the events touched. */
export async function expireDue(db: D1Database, now: number): Promise<string[]> {
  const { results } = await db.prepare("SELECT DISTINCT event_id FROM event_interests WHERE status = 'invited' AND respond_by < ?").bind(now).all<{ event_id: string }>();
  if (!results.length) return [];
  await db.prepare("UPDATE event_interests SET status = 'expired', updated_at = ? WHERE status = 'invited' AND respond_by < ?").bind(now, now).run();
  return results.map(r => r.event_id);
}

/** The cron's part: lapse unanswered invitations and gather flocks for every coming event with people waiting. */
export async function gatherAll(db: D1Database, now: number): Promise<number> {
  const expired = await expireDue(db, now);
  const { results } = await db.prepare(`SELECT DISTINCT i.event_id FROM event_interests i JOIN events e ON e.id = i.event_id
    WHERE i.status = 'waiting' AND e.status = 'scheduled' AND e.starts_at > ? LIMIT 200`).bind(now + LAST_CALL_MS).all<{ event_id: string }>();
  const ids = new Set([...expired, ...results.map(r => r.event_id)]);
  let invited = 0;
  for (const id of ids) invited += await gather(db, id, now);
  return invited;
}

/** Gathers flocks for one event: those waiting (first come, first served) are invited into an open flock with room,
 * else, when at least three are waiting, into a new flock of at most six. Returns how many were invited. */
export async function gather(db: D1Database, eventId: string, now: number): Promise<number> {
  const e = await db.prepare("SELECT id, starts_at, ends_at, status, venue_name, lat, lon FROM events WHERE id = ?").bind(eventId)
    .first<{ id: string; starts_at: number; ends_at: number | null; status: string; venue_name: string | null; lat: number | null; lon: number | null }>();
  if (!e || e.status !== "scheduled" || e.starts_at - now < LAST_CALL_MS) return 0;
  const { results: waiting } = await db.prepare(`SELECT member_id FROM event_interests WHERE event_id = ? AND status = 'waiting'
    AND member_id NOT IN (SELECT m.member_id FROM flock_members m JOIN flocks f ON f.id = m.flock_id WHERE f.event_id = ? AND f.status = 'open' AND m.left_at IS NULL)
    ORDER BY created_at, member_id`).bind(eventId, eventId).all<{ member_id: string }>();
  if (!waiting.length) return 0;
  const queue = waiting.map(w => w.member_id);
  const respondBy = Math.min(now + RESPOND_MS, e.starts_at - LAST_CALL_MS);
  let invited = 0;
  const invite = async (flockId: string, members: string[]) => {
    if (!members.length) return;
    await db.batch(members.map(m => db.prepare(`UPDATE event_interests SET status = 'invited', flock_id = ?, invited_at = ?, respond_by = ?, notified_at = NULL, updated_at = ?
      WHERE member_id = ? AND event_id = ? AND status = 'waiting'`).bind(flockId, now, respondBy, now, m, eventId)));
    invited += members.length;
  };
  // Open flocks with people in them (or on their way) and room left: members plus open invitations.
  const { results: open } = await db.prepare(`SELECT f.id, f.max_size,
      (SELECT COUNT(*) FROM flock_members m WHERE m.flock_id = f.id AND m.left_at IS NULL) AS members,
      (SELECT COUNT(*) FROM event_interests i WHERE i.flock_id = f.id AND i.status = 'invited') AS pending
    FROM flocks f WHERE f.event_id = ? AND f.status = 'open' ORDER BY f.created_at`).bind(eventId).all<{ id: string; max_size: number; members: number; pending: number }>();
  for (const f of open) {
    if (!queue.length) break;
    if (f.members + f.pending === 0) continue;
    await invite(f.id, queue.splice(0, Math.max(0, Math.min(f.max_size, GATHER_MAX) - f.members - f.pending)));
  }
  while (queue.length >= GATHER_AT) {
    const members = queue.splice(0, GATHER_MAX);
    const id = crypto.randomUUID();
    const place = suggestedMeetingPlace(e).slice(0, 120);
    const meetAt = Math.max(e.starts_at - MEET_BEFORE_MS, now + 3600_000);
    await db.prepare(`INSERT INTO flocks (id, event_id, created_by, meeting_place, meeting_at, note, max_size, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
      .bind(id, eventId, members[0]!, place, Math.min(meetAt, e.starts_at), "Samlet af Socialklubben. Mødestedet er et forslag – vil I hellere et andet sted, så aftal det i chatten. Og aftal, om I fortsætter bagefter.", GATHER_MAX, now, now).run();
    await invite(id, members);
  }
  return invited;
}

// ————————————————————————————————————————— The list

const when = (e: Pick<EventRow, "starts_at" | "ends_at" | "all_day">, now: number) => `${capitalize(dayLabel(e.starts_at, now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, now)}`;
/** "Ingen endnu – vær den første", "1 interesseret", "4 interesserede", plus a flock with room. */
export function interestLine(n: number, e: Pick<EventRow, "flock_fill">): string {
  const room = flockRoom(e);
  const people = n === 0 ? (room ? "" : "Ingen endnu – vær den første") : `${n} ${n === 1 ? "interesseret" : "interesserede"}`;
  const flock = room ? `flok med ${room.members} af ${room.size}` : "";
  return capitalize([people, flock].filter(Boolean).join(" · "));
}

type Candidate = { event: EventRow; interested: number; mine: boolean };

/** A few lines about the event, to see what it is without leaving the list: its summary, else the start of its text. */
export function blurb(e: Pick<EventRow, "summary" | "description">, max = 320): string {
  const text = (e.summary ?? (e.description ?? "").split(/\n+/).find(p => p.trim().length > 20) ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")} …` : text;
}
const imageOf = (e: Pick<EventRow, "image_url">) => e.image_url && /^https:\/\//.test(e.image_url) ? e.image_url : null;
/** The unfolded part of a row on /kom-godt-i-gang: picture, a few lines and a link to the event's page. */
const details = (e: EventRow) => html`<details class="kickoff-details"><summary>Se mere om eventet</summary>
  ${imageOf(e) ? html`<img class="kickoff-img" src="${imageOf(e)!}" alt="" loading="lazy">` : ""}
  ${blurb(e) ? html`<p>${blurb(e)}</p>` : ""}
  <p><a class="kickoff-more" href="${eventPath(e)}">Åbn eventet</a></p>
</details>`;

/** The events of the coming weeks for the list: those with people already interested or a flock with room first, then
 * the soonest. Events the member already has a flock for are left out; those they are interested in are ticked. */
async function candidates(db: D1Database, regions: string[], memberId: string | null, now: number): Promise<{ list: Candidate[]; inFlock: boolean; interests: InterestRow[] }> {
  const flocks = memberId ? (await memberFlocks(db, memberId)).filter(f => !eventOver(f, now)) : [];
  const interests = memberId ? await memberInterests(db, memberId) : [];
  const events = await kickoffEvents(db, regions, now, flocks.map(f => f.event_slug), LIST_SIZE);
  const counts = await interestCounts(db, events.map(e => e.id));
  const mine = new Set(interests.filter(i => i.status === "waiting" || i.status === "invited").map(i => i.event_id));
  const list = events.map(e => ({ event: e, interested: counts.get(e.id) ?? 0, mine: mine.has(e.id) }));
  const active = (c: Candidate) => c.interested > 0 || !!flockRoom(c.event);
  list.sort((a, b) => Number(active(b)) - Number(active(a)));
  return { list, inFlock: flocks.length > 0, interests };
}

/** For the pop-up: the list, and whether the visitor is a member, has told the others about themselves and has an
 * e-mail, is in a flock or on the list already (then the pop-up is not shown). */
export async function kickoffJson(db: D1Database, regions: string[], member: { id: string } | null, ready: boolean, now: number) {
  const { list, inFlock, interests } = await candidates(db, regions, member?.id ?? null, now);
  return {
    member: !!member, ready, inFlock, onList: interests.some(i => i.status !== "declined" && i.status !== "expired"),
    events: list.map(({ event: e, interested, mine }) => ({
      slug: e.slug, title: e.title, when: when(e, now), place: [placeLine(e), priceLabel(e)].filter(Boolean).join(" · "),
      image: imageOf(e), blurb: blurb(e), groups: groupsOf(e.categories), interested: Math.max(0, interested - (mine ? 1 : 0)), line: interestLine(Math.max(0, interested - (mine ? 1 : 0)), e), mine, url: eventPath(e)
    }))
  };
}

/** The page itself: the same list to tick, ten shown at a time with JavaScript (all without). */
export async function kickoffPage(db: D1Database, ctx: PageContext, regions: string[], state: { memberId: string | null; ready: boolean; chosen: string[]; message: string | null; group?: Group["slug"] | null }): Promise<View> {
  const group = groupBySlug(state.group ?? null)?.slug ?? null;
  const { list: everything } = await candidates(db, regions, state.memberId, ctx.now);
  const list = group ? everything.filter(c => groupsOf(c.event.categories).includes(group)) : everything;
  // Chosen events that are no longer among the first ones are still shown, at the top.
  const missing = state.chosen.filter(s => !list.some(c => c.event.slug === s));
  const extra = (await Promise.all(missing.map(s => eventBySlug(db, s))))
    .filter((e): e is EventRow => !!e && !!e.region && regions.includes(e.region) && e.status === "scheduled" && e.starts_at > ctx.now)
    .map(e => ({ event: e, interested: 0, mine: false }));
  const all = [...extra, ...list];
  const picked = new Set(state.chosen);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Kom godt i gang", path: KICKOFF_PATH }];
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Lad os komme godt i gang</h1>
    ${flash(state.message)}
    <p class="standfirst">Sæt kryds ved de oplevelser, du kunne tænke dig. <strong>Det er helt uforpligtende</strong> – du viser bare interesse. Når vi er en håndfuld (3–6), der vil det samme, samler vi en flok og spørger dig, om du vil med. Først dér siger du ja. Du kan deltage i de første 3 udflugter uden at være medlem.</p>
  </header>
  ${groupTiles(group, null, g => g ? `${KICKOFF_PATH}?gruppe=${g}` : KICKOFF_PATH, { compact: true })}
  ${all.length ? html`<form method="post" action="${KICKOFF_PATH}" class="kickoff-form" data-kickoff-list>
    <ul class="kickoff-list">${all.map(({ event: e, interested, mine }) => {
      const others = Math.max(0, interested - (mine ? 1 : 0));
      return html`<li class="kickoff-item"><label>
        <input type="checkbox" name="event" value="${e.slug}"${picked.has(e.slug) || mine ? raw(" checked") : ""}>
        <span class="kickoff-text"><span class="kickoff-when">${when(e, ctx.now)}</span>
          <strong class="kickoff-title">${e.title}</strong>
          <span class="kickoff-place">${[placeLine(e), priceLabel(e)].filter(Boolean).join(" · ")}</span>
          <span class="kickoff-count${others || flockRoom(e) ? " has-people" : ""}">${interestLine(others, e)}</span></span>
      </label><input type="hidden" name="vist" value="${e.slug}">${details(e)}</li>`;
    })}</ul>
    <p class="kickoff-promise">Du binder dig ikke til noget. Du siger først ja, når flokken er samlet.</p>
    <div class="form-actions"><button type="submit">Vis interesse</button></div>
    ${state.memberId && state.ready ? "" : html`<p class="small meta-muted">Bagefter fortæller du kort om dig selv (fornavn, aldersgruppe og én linje) og giver os din e-mail, så vi kan give besked, når din flok er klar. Ingen andre ser din e-mail.</p>`}
  </form>` : html`<p class="empty">Der er ingen events de næste uger lige nu. Kig i <a href="/kalender">kalenderen</a>.</p>`}
</div>`;
  return { status: 200, headers: { "cache-control": "private, no-store" }, body: page(ctx, { title: "Lad os komme godt i gang", description: "Sæt kryds ved de oplevelser, du er interesseret i, så samler vi en flok.", canonical: KICKOFF_PATH, noindex: true, breadcrumbs: crumbs }, body) };
}

// ————————————————————————————————————————— On Mine flokke

const deadline = (ms: number, now: number) => `${dayLabel(ms, now)} kl. ${hhmm(ms)}`;

/** The member's interests with what happens next: waiting, invited (confirm or no thanks), confirmed, or not this time. */
export function interestsSection(interests: InterestRow[], now: number): SafeHtml {
  const shown = interests.filter(i => i.status !== "confirmed" && i.status !== "declined" && !eventOver({ event_starts_at: i.starts_at, event_ends_at: i.ends_at }, now));
  if (!shown.length) return html``;
  const base = (i: InterestRow) => `/interesser/${i.slug}`;
  const item = (i: InterestRow): SafeHtml => {
    const head = html`<span class="flock-title"><a href="${eventPath(i)}">${i.title}</a></span><span class="flock-when">${capitalize(dayLabel(i.starts_at, now))} kl. ${hhmm(i.starts_at)}${i.venue_name ? ` · ${i.venue_name}` : ""}</span>`;
    const tooLate = i.event_status !== "scheduled" || i.starts_at - now < LAST_CALL_MS;
    if (i.status === "invited" && i.respond_by && i.respond_by > now && !tooLate) {
      return html`<li class="flock-card is-invite">${head}
        <p class="interest-state"><strong>Din flok er klar!</strong> I er ${i.invited_count} inviteret. Forslag: I mødes ${i.meeting_at ? `kl. ${hhmm(i.meeting_at)}` : "før eventet"}${i.meeting_place ? ` ${i.meeting_place.charAt(0).toLowerCase()}${i.meeting_place.slice(1)}` : ""}, og planlægger resten i flokkens chat. Husk selv at købe billet.</p>
        <p class="meta-muted small">Svar senest ${deadline(i.respond_by, now)}.</p>
        <div class="flock-actions"><form method="post" action="${base(i)}/bekraeft"><button type="submit">Bekræft – jeg er med</button></form>
        <form method="post" action="${base(i)}/nej-tak"><button type="submit" class="button-secondary">Nej tak</button></form></div></li>`;
    }
    if (i.status === "waiting" && !tooLate) {
      return html`<li class="flock-card">${head}
        <p class="interest-state">${i.others ? `${i.others} ${i.others === 1 ? "anden" : "andre"} er interesseret.` : "Du er den første."} Vi samler en flok, når I er ${GATHER_AT}, og giver dig besked.</p>
        <form method="post" action="${base(i)}/fjern"><button type="submit" class="button-link">Fjern fra listen</button></form></li>`;
    }
    return html`<li class="flock-card is-past">${head}<p class="interest-state meta-muted">${i.status === "expired" ? "Du nåede ikke at svare, så pladsen gik videre." : "Det blev ikke til en flok denne gang."} <a href="${KICKOFF_PATH}">Find et andet event</a></p></li>`;
  };
  return html`<section class="section" aria-labelledby="h-interests">
    <div class="section-head"><h2 id="h-interests">Dine interesser</h2></div>
    <ul class="flock-list">${shown.map(item)}</ul>
    <p class="small"><a href="${KICKOFF_PATH}">Sæt kryds ved flere oplevelser</a></p>
  </section>`;
}

// ————————————————————————————————————————— When an event is cancelled

/** Cancelled events the member was going to (in a flock or on the list), each with three similar coming events they
 * can put themselves on the list for, so a cancellation does not end it. */
export function cancelledSection(items: Array<{ event: EventRow; similar: EventRow[] }>, now: number): SafeHtml {
  if (!items.length) return html``;
  return html`<section class="section cancelled-box" aria-labelledby="h-cancelled">
    <div class="section-head"><h2 id="h-cancelled">${items.length === 1 ? "Et event er aflyst" : "Nogle events er aflyst"}</h2></div>
    ${items.map(({ event: e, similar }) => html`<div class="cancelled-item">
      <p><strong>${e.title}</strong> ${capitalize(dayLabel(e.starts_at, now))} er desværre aflyst af arrangøren.${similar.length ? " Måske er en af de her noget for dig i stedet?" : ""}</p>
      ${similar.length ? html`<ul class="kickoff-list">${similar.map(o => html`<li class="kickoff-item">
        <span class="kickoff-text"><span class="kickoff-when">${when(o, now)}</span><strong class="kickoff-title"><a href="${eventPath(o)}">${o.title}</a></strong>
        <span class="kickoff-place">${[placeLine(o), priceLabel(o)].filter(Boolean).join(" · ")}</span></span>
        <form method="post" action="${KICKOFF_PATH}"><input type="hidden" name="event" value="${o.slug}"><button type="submit" class="button-secondary">Sæt mig på listen</button></form>
      </li>`)}</ul>` : html`<p><a href="${KICKOFF_PATH}">Find et andet event</a></p>`}
    </div>`)}
  </section>`;
}
