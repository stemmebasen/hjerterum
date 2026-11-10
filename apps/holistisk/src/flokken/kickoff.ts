import type { D1Database } from "../db.js";
import { priceLabel } from "../price.js";
import { capitalize, dayLabel, timeRangeLabel } from "../time.js";
import { eventPath, placeLine, seats } from "../web/components.js";
import { html, raw } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import { eventBySlug, flockRoom, kickoffEvents, type EventRow } from "../web/queries.js";
import { defaultFlockForm, validateFlockForm } from "./forms.js";
import { flash, type View } from "./pages.js";
import { createFlock, eventOver, flocksForEvent, isFull, joinFlock, memberFlockForEvent, memberFlocks } from "./store.js";

/** "Lad os komme godt i gang": a newcomer flicks through the coming events (a pop-up on the first visit, site.js, or
 * the page /kom-godt-i-gang without JavaScript), marks the ones they would like to go to with others, and is put in a
 * flock for each: the one furthest along that has room, or a new one that others can join. */

export const KICKOFF_PATH = "/kom-godt-i-gang";
/** At most this many events in one go. */
export const MAX_CHOICES = 20;
const SLUG = /^[a-z0-9-]{1,90}$/;

/** The choices are kept in a short-lived cookie while the newcomer becomes a member and fills in their profile. */
const CHOICE_COOKIE = "sk_valg";
export const choiceCookie = (slugs: string[]): string => `${CHOICE_COOKIE}=${slugs.join(".")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`;
export const clearChoiceCookie = (): string => `${CHOICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function readChoices(request: Request): string[] {
  const m = new RegExp(`(?:^|;\\s*)${CHOICE_COOKIE}=([a-z0-9.-]{1,2000})`).exec(request.headers.get("cookie") ?? "");
  return cleanChoices(m?.[1]?.split(".") ?? []);
}
export const cleanChoices = (values: string[]): string[] => [...new Set(values.filter(v => SLUG.test(v)))].slice(0, MAX_CHOICES);

const when = (e: EventRow, now: number) => `${capitalize(dayLabel(e.starts_at, now))} · ${timeRangeLabel(e.starts_at, e.ends_at, e.all_day === 1, now)}`;
const flockLine = (e: EventRow): string => {
  const room = flockRoom(e);
  if (!room) return "Ingen flok endnu – du kan starte den første";
  return `${room.members} er allerede med – bliv nr. ${room.members + 1}`;
};

/** The events of the coming weeks, minus those the member is already going to with a flock. */
async function candidates(db: D1Database, regions: string[], memberId: string | null, now: number): Promise<{ events: EventRow[]; inFlock: boolean }> {
  const mine = memberId ? (await memberFlocks(db, memberId)).filter(f => !eventOver(f, now)) : [];
  return { events: await kickoffEvents(db, regions, now, mine.map(f => f.event_slug)), inFlock: mine.length > 0 };
}

/** For the pop-up: the cards, and whether the visitor is a member and has told the others about themselves. */
export async function kickoffJson(db: D1Database, regions: string[], member: { id: string } | null, ready: boolean, now: number) {
  const { events, inFlock } = await candidates(db, regions, member?.id ?? null, now);
  return {
    member: !!member, ready, inFlock,
    events: events.map(e => ({
      slug: e.slug, title: e.title, when: when(e, now), place: placeLine(e), price: priceLabel(e),
      image: e.image_url && /^https:\/\//.test(e.image_url) ? e.image_url : null,
      flock: flockRoom(e), flockLine: flockLine(e), url: eventPath(e)
    }))
  };
}

export type KickoffOutcome = { joined: number; started: number; already: number; failed: number };

/** Puts the member in a flock for each chosen event: the open flock with room that has the most members (closest to
 * five), or else a new flock that meets at the entrance a quarter of an hour before. Events that have started, are
 * cancelled or not shown here count as failed, and so do new flocks over the daily limit. */
export async function joinOrStart(db: D1Database, slugs: string[], regions: string[], memberId: string, now: number): Promise<KickoffOutcome> {
  const out: KickoffOutcome = { joined: 0, started: 0, already: 0, failed: 0 };
  for (const slug of cleanChoices(slugs)) {
    const e = await eventBySlug(db, slug);
    if (!e || !e.region || !regions.includes(e.region) || e.status !== "scheduled" || e.starts_at <= now) { out.failed++; continue; }
    if (await memberFlockForEvent(db, e.id, memberId)) { out.already++; continue; }
    const open = (await flocksForEvent(db, e.id, memberId)).filter(f => !isFull(f)).sort((a, b) => b.member_count - a.member_count || a.meeting_at - b.meeting_at);
    let joined = false;
    for (const f of open) {
      if (!("error" in await joinFlock(db, f, memberId, now))) { joined = true; break; }
    }
    if (joined) { out.joined++; continue; }
    const checked = validateFlockForm({ ...defaultFlockForm(e, now), publicPlace: true }, e, now, { allowedFollows: [] });
    if ("errors" in checked) { out.failed++; continue; }
    const created = await createFlock(db, e, memberId, checked.input, now);
    if ("error" in created) out.failed++; else out.started++;
  }
  return out;
}

/** The ?besked= code after joining: all went well, some did, or none. */
export const outcomeCode = (o: KickoffOutcome): string =>
  !o.failed ? "kom_i_gang" : o.joined + o.started + o.already ? "kom_i_gang_delvis" : "kom_i_gang_ingen";

/** The page itself: the same events as the pop-up, as a list to tick. Works without JavaScript. */
export async function kickoffPage(db: D1Database, ctx: PageContext, regions: string[], state: { memberId: string | null; ready: boolean; chosen: string[]; message: string | null }): Promise<View> {
  const { events } = await candidates(db, regions, state.memberId, ctx.now);
  // Chosen events that are no longer among the first ones are still shown, at the top.
  const missing = state.chosen.filter(s => !events.some(e => e.slug === s));
  const extra = (await Promise.all(missing.map(s => eventBySlug(db, s))))
    .filter((e): e is EventRow => !!e && !!e.region && regions.includes(e.region) && e.status === "scheduled" && e.starts_at > ctx.now);
  const all = [...extra, ...events];
  const picked = new Set(state.chosen);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Kom godt i gang", path: KICKOFF_PATH }];
  const almost = state.memberId && state.ready && state.chosen.length > 0;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>Lad os komme godt i gang</h1>
    ${flash(state.message)}
    <p class="standfirst">${almost ? "Du er næsten færdig. Se dine valg igennem, og tryk på knappen nederst."
      : "Sæt flueben ved de events, du gerne vil følges med andre til. Er der allerede en flok, kommer du med i den. Ellers starter vi en, som andre kan hoppe med i."}</p>
  </header>
  ${all.length ? html`<form method="post" action="${KICKOFF_PATH}" class="kickoff-form">
    <ul class="kickoff-list">${all.map(e => {
      const room = flockRoom(e);
      return html`<li class="kickoff-item"><label>
        <input type="checkbox" name="event" value="${e.slug}"${picked.has(e.slug) ? raw(" checked") : ""}>
        <span class="kickoff-text"><span class="kickoff-when">${when(e, ctx.now)}</span>
          <strong class="kickoff-title">${e.title}</strong>
          <span class="kickoff-place">${[placeLine(e), priceLabel(e)].filter(Boolean).join(" · ")}</span>
          <span class="kickoff-flock${room ? " has-flock" : ""}">${room ? seats(room.members, room.size) : ""} ${flockLine(e)}</span></span>
      </label> <a class="kickoff-more" href="${eventPath(e)}">Om eventet</a></li>`;
    })}</ul>
    <p class="small meta-muted">En ny flok mødes ved indgangen et kvarter før, og den, der starter den, kan rette mødested og tidspunkt bagefter. Du kan altid forlade en flok igen.</p>
    <div class="form-actions"><button type="submit">Find mine flokke</button></div>
    ${state.memberId ? "" : html`<p class="small meta-muted">Du bliver bedt om dit fornavn, din aldersgruppe og en linje om dig selv – ingen e-mail eller telefonnummer.</p>`}
  </form>` : html`<p class="empty">Der er ingen events de næste uger lige nu. Kig i <a href="/kalender">kalenderen</a>.</p>`}
</div>`;
  return { status: 200, headers: { "cache-control": "private, no-store" }, body: page(ctx, { title: "Lad os komme godt i gang", description: "Vælg de events, du gerne vil følges med andre til, og kom med i en flok.", canonical: KICKOFF_PATH, noindex: true, breadcrumbs: crumbs }, body) };
}
