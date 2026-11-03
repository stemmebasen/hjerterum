import type { D1Database } from "../db.js";
import { getIssue, monthName, monthOf, nextMonth, sendTime, DRAFT_FROM_DAY } from "../newsletter.js";
import { prReadyNames } from "./prMaterial.js";
import { facebookEvents, FB_EVENTS_PERSON, missingSoon } from "./fbEvents.js";
import { esc } from "./page.js";
import { nextMonday, planDue, weekKey, at, mondayOf } from "../social/plan.js";
import type { SocialAccount } from "../social/social.js";

/** Requested (the chair, 3 Nov 2026), after the plan for the year: "Ja til det hele. Og lav det i cockpittet så klokkeklart hvad planen er og hvad der
 * lige nu kræves af mig, hvad der mangler, hvad der er next." The top of PR og SoMe (/pr): what the chair must do now (worked out from the data),
 * what is not there yet (the plan's own list, kept here as each part is built), what comes next, and the plan itself - the week's rhythm and the year. */

const TZ = "Europe/Copenhagen";
const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const DAY = 86_400_000;

export type Todo = { text: string; href?: string; urgent?: boolean };
export type PlanStatus = "klar" | "bygges" | "venter-paa-dig";
/** The plan's parts and where each stands. Changed here when a part is built or decided. */
export const ROADMAP: Array<{ title: string; status: PlanStatus; note: string }> = [
  { title: "Opslag kl. 15-17", status: "klar", note: "Gittas erfaring: eftermiddagen virker bedst. Eventopslag kl. 15 og 16.30 dagen før, Ugens events mandag kl. 15.30." },
  { title: "PR-materiale, når eventet oprettes", status: "klar", note: "Billeder, citater og samtykke i selve eventformularen og hos Saga, med klar besked: uden billeder ingen PR fra huset." },
  { title: "Undervisere som samarbejdspartner på Instagram", status: "klar", note: "Ugens events inviterer op til tre af ugens undervisere, og et genopslag inviterer den, der lavede det. Underviserne skriver deres Instagram-navn i PR-materialet." },
  { title: "Ugens events som reel", status: "klar", note: "Et job laver hver uge en kort video af ugens events, når Saga har planlagt ugen. Du godkender den med resten af ugen, og den går ud på Instagram mandag kl. 16.30." },
  { title: "Månedlig indsigt", status: "klar", note: "Følgere på Facebook og Instagram og det, der er sendt, måned for måned, nederst på siden. Rækkevidde pr. opslag kræver flere tilladelser fra Meta." },
  { title: "Facebook-begivenhed for hvert event", status: "klar", note: "Hjemmesidens løfte. Meta lader ikke systemet oprette begivenheder, så Lisbeth opretter dem i hånden. Listen står under Events → Facebook-begivenheder, og Saga minder hende mandag og torsdag." },
  { title: "Ny, kortere samtykketekst", status: "venter-paa-dig", note: "Gitta: indholdet er rigtigt, men den skal være enklere. Den skal stadig gælde fremtidige events og fælles opslag." },
  { title: "Påmindelse til undervisere uden billeder", status: "venter-paa-dig", note: "Gittas forslag: en mail efter tre dage. Husets regel er, at Saga aldrig sender mail af sig selv - det kræver dit ja." },
  { title: "Delinger uden godkendelse", status: "venter-paa-dig", note: "Skal opslag fra undervisere med PR-samtykke kunne deles uden dit tryk? Lige nu kræver alt dit ja." }
];

/** The year: four campaigns on top of the weekly rhythm, each with a few extra posts and the newsletter's highlighted events. */
export const YEAR: Array<{ months: number[]; title: string; about: string }> = [
  { months: [1], title: "Nyt år og medlemskab", about: "Medlemskab og årets første hold." },
  { months: [3, 4, 5], title: "Forårets workshops", about: "Forårets workshops og kurser." },
  { months: [8, 9], title: "Sæsonstart", about: "Årets største: nye hold, nye undervisere, åbent hus." },
  { months: [11, 12], title: "Årets afslutning og jul", about: "Julens og årsskiftets events." }
];

export const RHYTHM: Array<[string, string]> = [
  ["Hele tiden", "Saga finder opslag, Hjerterum er tagget i, og skriver et par ord. De deles, når du har godkendt dem."],
  ["Torsdag kl. 10", "Saga planlægger næste uge og giver dig besked på Telegram."],
  ["Torsdag-søndag", "Du læser ugens opslag og trykker «Godkend hele ugen» (20-30 minutter)."],
  ["Torsdag-søndag", "Et job laver Ugens events som reel af ugens billeder og lægger den her."],
  ["Mandag kl. 15.30", "Ugens events på Facebook og som karrusel på Instagram."],
  ["Mandag kl. 16.30", "Ugens events som reel på Instagram."],
  ["Dagen før hvert event", "7-10 events får hvert sit lille opslag på Facebook, kl. 15 eller 16.30."],
  ["Mandag og torsdag kl. 9", "Saga minder Lisbeth om events, der mangler en begivenhed på Facebook."],
  ["Den 20.", "Saga skriver næste måneds nyhedsbrev. Du godkender det, og det går ud den 1. kl. 19."],
  ["Hver måned", "Kig på Indsigt nederst på siden, og justér hvert kvartal."]
];

export type PlanData = { todo: Todo[]; next: Array<{ at: number; text: string }>; campaign: { now: (typeof YEAR)[number] | null; next: (typeof YEAR)[number] } };

const month = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "numeric" }).format(ms));
const dayOfMonth = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric" }).format(ms));

/** The teachers of the next two weeks' events who have not given Hjerterum their PR material (consent and three photos). */
async function teachersWithoutMaterial(db: D1Database, nowMs: number): Promise<string[]> {
  const until = nowMs + 14 * DAY;
  const rows = await db.prepare(`SELECT host AS name FROM house_events WHERE starts_at_ms >= ? AND starts_at_ms < ? AND removed_at_ms IS NULL AND host IS NOT NULL
      AND NOT (COALESCE(location, '') LIKE '%hjerteland%' OR COALESCE(category, '') LIKE '%hjerteland%' OR title LIKE '%hjerteland%')
    UNION SELECT teacher_name FROM room_bookings WHERE status = 'scheduled' AND COALESCE(review_status, 'approved') = 'approved' AND cirkler_meeting_id IS NULL
      AND clerk_user_id NOT LIKE 'cockpit:%' AND starts_at_ms >= ? AND starts_at_ms < ?`).bind(nowMs, until, nowMs, until)
    .all<{ name: string | null }>().then(r => r.results ?? []).catch(() => []);
  const ready = await prReadyNames(db);
  const seen = new Map<string, string>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (name && !ready.has(name.toLowerCase()) && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "da"));
}

export async function prPlanData(db: D1Database, input: { ready: boolean; account: SocialAccount | null; nowMs: number }): Promise<PlanData> {
  const { nowMs } = input;
  const todo: Todo[] = [];
  if (!input.ready) todo.push({ text: "Meta-appens nøgler mangler på serveren (META_APP_ID og META_APP_SECRET i GitHub).", urgent: true });
  else if (!input.account) todo.push({ text: "Forbind Facebook og Instagram.", href: "/pr/forbind", urgent: true });
  else if (!input.account.ig_user_id) todo.push({ text: "Instagram er ikke koblet til Facebook-siden. Forbind igen, og vælg @hjerterum_aarhus, når Facebook spørger." , href: "/pr/forbind" });
  const count = async (where: string, ...values: unknown[]) =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM social_posts WHERE ${where}`).bind(...values).first<{ n: number }>().catch(() => null))?.n ?? 0;
  const shares = await count("kind = 'share' AND status = 'draft'");
  if (shares) todo.push({ text: `${shares === 1 ? "Ét opslag" : `${shares} opslag`}, Hjerterum er tagget i, venter på dig.`, href: "/pr#tagget", urgent: true });
  const failed = await count("status = 'failed'");
  if (failed) todo.push({ text: `${failed === 1 ? "Ét opslag" : `${failed} opslag`} kunne ikke komme ud. Se fejlen, og godkend det igen.`, href: "/pr#sendt", urgent: true });
  // The week to approve: next week from Thursday, else this week's drafts that have not gone out.
  for (const monday of [mondayOf(nowMs), nextMonday(nowMs)]) {
    const week = weekKey(monday);
    const drafts = await count("week = ? AND status = 'draft' AND (publish_at_ms IS NULL OR publish_at_ms > ?)", week, nowMs);
    if (drafts) todo.push({ text: `Uge ${Number(week.slice(6))}: ${drafts} opslag venter på din godkendelse.`, href: `/pr?uge=${monday}#uge`, urgent: true });
  }
  if (input.account && planDue(nowMs) && !(await count("source_key = ?", `week:${weekKey(nextMonday(nowMs))}`)))
    todo.push({ text: `Uge ${Number(weekKey(nextMonday(nowMs)).slice(6))} er ikke planlagt endnu. Saga prøver hver time; du kan også lade hende gøre det nu.`, href: `/pr?uge=${nextMonday(nowMs)}#uge` });
  // The newsletter: next month's issue from the 20th, until it is approved.
  const coming = nextMonth(monthOf(nowMs));
  if (dayOfMonth(nowMs) >= DRAFT_FROM_DAY) {
    const issue = await getIssue(db, coming).catch(() => null);
    if (!issue || issue.status === "draft") todo.push({ text: `Nyhedsbrevet for ${monthName(coming)} ${issue ? "venter på din godkendelse" : "er ikke skrevet endnu"}.`, href: `/arrangementer/nyhedsbrev?m=${coming}` });
  }
  const missing = await teachersWithoutMaterial(db, nowMs);
  if (missing.length) todo.push({ text: `${missing.length === 1 ? "Én underviser" : `${missing.length} undervisere`} med events de næste to uger har ikke delt PR-materiale: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " …" : ""}. Uden billeder kan vi kun dele deres coverfoto.`, href: "/arrangementer/undervisere" });
  // The website's promise of every event on the Facebook page, made by hand (fbEvents.ts): what is missing in the next two weeks.
  const noFacebook = missingSoon(await facebookEvents(db, nowMs, 14), nowMs, 14);
  if (noFacebook.length) todo.push({ text: `${noFacebook.length === 1 ? "Ét event" : `${noFacebook.length} events`} de næste to uger mangler en begivenhed på Facebook. ${FB_EVENTS_PERSON} opretter dem; Saga minder hende om det.`, href: "/arrangementer/facebook" });
  for (const r of ROADMAP.filter(r => r.status === "venter-paa-dig")) todo.push({ text: `Beslut: ${r.title.toLowerCase()}. ${r.note}` });

  // What comes next: the next few posts that will go out, the next planning and the next newsletter.
  const next: Array<{ at: number; text: string }> = [];
  const posts = await db.prepare(`SELECT kind, publish_at_ms, source FROM social_posts WHERE status = 'approved' AND publish_at_ms > ? ORDER BY publish_at_ms LIMIT 3`).bind(nowMs)
    .all<{ kind: string; publish_at_ms: number; source: string }>().then(r => r.results ?? []).catch(() => []);
  for (const p of posts) {
    let title = "";
    try { title = (JSON.parse(p.source) as { title?: string }).title ?? ""; } catch { title = ""; }
    next.push({ at: p.publish_at_ms, text: p.kind === "week" ? "Ugens events går ud" : p.kind === "share" ? "En deling går ud" : `Opslag om ${title || "et event"} går ud` });
  }
  const thursday = (() => { const monday = nextMonday(nowMs); const ms = at(new Date(Date.parse(`${monday}T12:00:00Z`) - 4 * DAY).toISOString().slice(0, 10), 10); return ms > nowMs ? ms : ms + 7 * DAY; })();
  next.push({ at: thursday, text: "Saga planlægger næste uges opslag" });
  const issue = await getIssue(db, monthOf(nowMs)).catch(() => null);
  const send = issue?.status === "approved" && sendTime(monthOf(nowMs)) > nowMs ? sendTime(monthOf(nowMs)) : sendTime(coming);
  next.push({ at: send, text: "Nyhedsbrevet Månedens events går ud" });
  next.sort((a, b) => a.at - b.at);

  const m = month(nowMs);
  const nowCampaign = YEAR.find(c => c.months.includes(m)) ?? null;
  const later = [...YEAR].sort((a, b) => ((a.months[0]! - m + 12) % 12 || 12) - ((b.months[0]! - m + 12) % 12 || 12));
  const nextCampaign = later.find(c => c !== nowCampaign) ?? YEAR[0]!;
  return { todo, next, campaign: { now: nowCampaign, next: nextCampaign } };
}

const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const months = (list: number[]) => list.length === 1 ? MONTHS[list[0]! - 1]! : `${MONTHS[list[0]! - 1]}-${MONTHS[list[list.length - 1]! - 1]}`;
const STATUS: Record<PlanStatus, [string, string]> = { klar: ["Klar", "good"], bygges: ["Bygges", ""], "venter-paa-dig": ["Venter på dig", "wait"] };

export function prPlanSection(base: string, d: PlanData): string {
  const link = (t: Todo) => t.href ? `<a href="${base}${t.href}">${esc(t.text)}</a>` : esc(t.text);
  const todo = d.todo.length ? `<ul class="plan-list">${d.todo.map(t => `<li class="${t.urgent ? "is-urgent" : ""}">${link(t)}</li>`).join("")}</ul>` : `<p class="good">Intet lige nu. Alt kører.</p>`;
  const next = `<ul class="plan-next">${d.next.map(n => `<li><span class="at">${esc(WHEN.format(n.at))}</span><span>${esc(n.text)}</span></li>`).join("")}</ul>`;
  const missing = `<ul class="plan-road">${ROADMAP.map(r => { const [label, tone] = STATUS[r.status]; return `<li><span class="chip ${tone}">${label}</span><span><b>${esc(r.title)}</b><small>${esc(r.note)}</small></span></li>`; }).join("")}</ul>`;
  const rhythm = `<ul class="plan-next">${RHYTHM.map(([when, what]) => `<li><span class="at">${esc(when)}</span><span>${esc(what)}</span></li>`).join("")}</ul>`;
  const year = `<ul class="plan-year">${YEAR.map(c => `<li class="${c === d.campaign.now ? "is-now" : c === d.campaign.next ? "is-next" : ""}"><b>${esc(months(c.months))}</b><span>${esc(c.title)}</span><small>${esc(c.about)}${c === d.campaign.now ? " · nu" : c === d.campaign.next ? " · næste" : ""}</small></li>`).join("")}</ul>`;
  return `<section class="panel plan-now" id="plan"><header><h2>Det kræver dig lige nu</h2></header>${todo}</section>
<div class="plan-grid">
<section class="panel"><header><h2>Det næste</h2></header>${next}</section>
<section class="panel"><header><h2>Det mangler</h2><p>Planens dele, og hvor langt de er.</p></header>${missing}</section>
</div>
<details class="panel plan-plan"><summary><h2>Planen</h2><span class="small muted">Ugens rytme og årets fire kampagner</span></summary>
<p>Maskinen klarer rytmen, menneskerne det, kun mennesker kan: dit ja i cockpittet, Lisbeths coverbilleder og events, Lisbeth og Frederik på beskederne. Underviserne er Hjerterums største medie, så deres billeder og deres deling betyder mest.</p>
<div class="plan-grid"><div><h3>Ugens rytme</h3>${rhythm}</div><div><h3>Året</h3>${year}<p class="small muted">Generalforsamling og fundraising lægges ind, når datoerne kendes.</p></div></div></details>`;
}

export const PLAN_STYLE = `.plan-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.plan-list li{padding:10px 14px;border-radius:12px;background:var(--soft);font-size:15px}
.plan-list li.is-urgent{background:var(--warn-soft);font-weight:600}.plan-list a{color:inherit}
.plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:20px}
.plan-next,.plan-road,.plan-year{list-style:none;margin:0;padding:0}.plan-next li,.plan-road li{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:14.5px}
.plan-next li:first-child,.plan-road li:first-child{border-top:0}.plan-next .at{color:var(--muted);font-size:13.5px}.plan-road li{grid-template-columns:120px 1fr;align-items:start}.plan-road .chip{justify-self:start;align-self:start;margin:2px 0 0}.plan-road small,.plan-year small{display:block;color:var(--faint);font-size:12.5px}
.plan-year li{padding:9px 12px;border-radius:12px;display:grid;gap:2px;font-size:14.5px}.plan-year li.is-now{background:var(--tint)}.plan-year li.is-next{background:var(--soft)}
.plan-plan summary{cursor:pointer;display:flex;align-items:baseline;gap:12px;list-style:none}.plan-plan summary h2{margin:0}.plan-plan h3{font-size:15px;margin:16px 0 8px}
@media (max-width:760px){.plan-next li,.plan-road li{grid-template-columns:1fr;gap:2px}}`;
