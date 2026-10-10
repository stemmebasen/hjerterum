import type { BoardPicture } from "../saga/picture.js";
import { guessKind, rolesLine, TASKS_SINCE, taskDay, type ApprovedMinutes, type Meeting, type Task, type Todo } from "./data.js";
import type { HouseEvent } from "./events.js";
import { membersTile, MEMBERS_STYLE, type MemberStats } from "./members.js";
import { lysArt } from "../../lys.js";
import { frontVotes, VOTES_STYLE, voteTodo, type Proposal, type ProposalView } from "./votes.js";
import { esc, layout, longDay, responsibilitiesForm, shortDay } from "./page.js";
import { openLines, TODOS_STYLE } from "./todosPage.js";

/** Requested: "det er vigtigt, at vi får et meget veltænkt og gennemtænkt overblik på forsiden, gerne med en
 * lille følgebeskrivelse" - "lav en moderne og pæn forside, som giver overblik over det vigtigste på alle de
 * vigtige områder" - and "Hav kontakt med tribes / indsamle billeder ... giver ikke rigtig mening i sig selv.
 * Desuden er de også gamle". The front page answers five questions, each block with one line saying what it
 * is: what waits on me, when do we meet next, what did we decide last, how is the board doing, and what
 * happens in the house. Every item carries where it comes from; nothing from before 1 October 2026. */

export type HomeData = {
  who: string | null; isChair: boolean; today: string;
  /** Requested: "Du må gerne bruge samme tekst pænt og diskret på admins forside" - Saga's words about the next two events (program.ts). */
  speaker?: string | null;
  toSign: ApprovedMinutes[];
  tasks: Task[]; todos: Todo[];
  /** What Saga has for this member: the chair's own list (chair only) and what she wrote to them or to all. */
  forMe: BoardPicture["forJacob"];
  /** Requested: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked" - asked on the front page until it is written. */
  needsResponsibilities?: boolean;
  next: Meeting | null; nextTeam?: Meeting | null; found: Array<{ date: string; what: string }>;
  latest: { id: number; date: string; decisions: string[]; approved: number; members: number } | null;
  picture: BoardPicture | null; summary: string | null; at: number | null;
  events: HouseEvent[]; eventsMonth: number;
  /** Requested: "Vidste du at Hjerterum har afholdt over xxx arrangementer siden vi startede?" - every event in the calendar that has taken place. */
  eventsHeld?: number;
  /** When the first of them took place. */
  eventsSince?: number | null;
  progress: { working: number; waiting: number };
  memberStats?: MemberStats[];
  newEnquiries?: number;
  eventsToReview?: number;
  boardNow?: { text: string; at: number } | null;
  /** Requested: "Når et forslag er stillet, skal hvert bestyrelsesmedlem have punktet på sin to do." */
  votes?: Proposal[];
  /** Every open proposal, for the card on everyone's front page (cockpit/votes.ts). */
  proposals?: ProposalView[];
  nowMs?: number;
  /** Requested: "Douglas taler engelsk" - Saga's own texts in English when she has translated them (cockpit/translate.ts). */
  tr?: ((danish: string) => string) | undefined;
};

/** "over 3.600": rounded down to the hundred below (to the ten below under a hundred), so "over" is always true. */
export function heldOver(held: number): number {
  const step = held >= 100 ? 100 : 10;
  return Math.floor((held - 1) / step) * step;
}

/** Requested: "Vidste du at Hjerterum har afholdt over xxx arrangementer siden vi startede?" - then a band of its own, then
 * "Læg den et andet sted og lad den fylde meget mindre - måske som en kvadratisk kasse", and finally the wording
 * "Hjerterum har haft over 3600 events siden start" - "Glem Vidste du". A small square at the end of the key figures; the
 * number is rounded down so "over" is always true. */
export function heldFact(held: number, base = ""): string {
  if (held < 20) return "";
  const over = heldOver(held).toLocaleString("da-DK");
  const sentence = `Hjerterum har haft over ${over} events siden start.`;
  return `<a class="tile fact" href="${base}/arrangementer" title="${esc(sentence)}" aria-label="${esc(sentence)}"><span class="label">Hjerterum har haft over</span>
<b>${over}</b><span class="sub">events siden start</span></a>`;
}

export const HOME_STYLE = `
.tile.fact{background:var(--lys-clay);border-color:transparent;box-shadow:none}.tile.fact:hover{filter:brightness(.98)}
.tile.fact .label{color:var(--lys-terra)}.tile.fact b{font:400 36px/1.1 var(--serif);letter-spacing:-.02em;color:var(--lys-terra);font-variant-numeric:tabular-nums}
.tile.fact .sub{color:var(--muted)}.tile.fact .label{white-space:nowrap}
@media (max-width:1180px){.tile.fact .label{font-size:11px;letter-spacing:-.01em}}
.tiles.with-fact,.tiles.with-members{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}.tile .sub.wrap{white-space:normal}.tile .more-link{text-decoration:underline;color:var(--accent);white-space:nowrap}
.home{gap:26px}
.items.hearts li{position:relative;padding-left:26px}.items.hearts li:first-child::before{top:calc(.62em - 4px)}.items.hearts li::before{content:"";position:absolute;left:0;top:calc(11px + .62em - 4px);width:14px;height:13px;background:var(--accent);
-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 22'%3E%3Cpath d='M12 21.6 10.3 20C4.2 14.5 0 10.8 0 6.3 0 2.7 2.8 0 6.4 0c2 0 4 1 5.6 2.5C13.6 1 15.6 0 17.6 0 21.2 0 24 2.7 24 6.3c0 4.5-4.2 8.2-10.3 13.7z'/%3E%3C/svg%3E") center/contain no-repeat;
mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 22'%3E%3Cpath d='M12 21.6 10.3 20C4.2 14.5 0 10.8 0 6.3 0 2.7 2.8 0 6.4 0c2 0 4 1 5.6 2.5C13.6 1 15.6 0 17.6 0 21.2 0 24 2.7 24 6.3c0 4.5-4.2 8.2-10.3 13.7z'/%3E%3C/svg%3E") center/contain no-repeat}
.now{margin:0;font-size:16.5px;line-height:1.6}
.welcome{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding:6px 0 2px}.welcome>div{display:grid;gap:8px;min-width:0}
.welcome .eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--lys-terra);margin:0}
.welcome .propose-btn{flex:none;align-self:flex-end;margin-bottom:6px}
.welcome h1{font-size:clamp(40px,5.6vw,68px)}.welcome .lead{font-size:18px;line-height:1.55;color:var(--muted);max-width:68ch;margin:4px 0 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.tile{display:grid;gap:4px;padding:18px 20px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);text-decoration:none;color:var(--ink);min-width:0}
.tile:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}.tile .label{font-size:12.5px;font-weight:650;color:var(--muted)}
.tile b{font-size:32px;font-weight:600;line-height:1.1;letter-spacing:-.03em}.tile .sub{font-size:13px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.hot{background:var(--warn-soft);border-color:transparent}.tile.hot b,.tile.hot .label{color:var(--warn)}
.panels{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;align-items:start}.panels>div{display:grid;gap:18px;min-width:0}
.when{display:flex;gap:16px;align-items:center}.date{flex:none;width:58px;height:62px;border-radius:14px;background:var(--tint);display:grid;place-items:center;text-align:center;line-height:1}
.date b{font-size:26px;font-weight:700;color:var(--accent);letter-spacing:-.02em}.date span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.meter{height:6px;border-radius:999px;background:var(--soft);overflow:hidden;margin:6px 0 2px}.meter i{display:block;height:100%;background:var(--accent);border-radius:999px}
.mood{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:650;padding:4px 11px;border-radius:999px;background:var(--tint);color:var(--accent);margin-bottom:10px}
.event{display:grid;grid-template-columns:52px 1fr;gap:12px;align-items:center}.event img{width:52px;height:52px;border-radius:12px;object-fit:cover;background:var(--soft)}
.event .t{font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (max-width:900px){.tiles,.tiles.with-fact,.tiles.with-members{grid-template-columns:repeat(2,1fr);grid-auto-flow:row;grid-auto-columns:auto}.tiles.with-members .tile:last-child:nth-child(odd){grid-column:1/-1}.panels{grid-template-columns:1fr}.tile.fact{grid-column:1/-1}}
@media (max-width:760px){.welcome{flex-direction:column;align-items:flex-start}.welcome .propose-btn{align-self:flex-start;margin-top:4px}.welcome h1{font-size:40px}.welcome .lead{font-size:16px}.panel{padding:20px}.tile{padding:15px 16px}.tile b{font-size:26px}.tile.fact b{font-size:30px}}
`;

const MONTH = new Intl.DateTimeFormat("da-DK", { month: "short", timeZone: "UTC" });
const EVENT_TIME = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
const inDays = (n: number) => n <= 0 ? "i dag" : n === 1 ? "i morgen" : `om ${n} dage`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
const inline = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** A meeting's formalities - approving its agenda or the minutes before it. */
const FORMALITY = /^(?:godkendelse af (?:dagsorden|referat)|(?:dagsorden(?:en)?|referat(?:et)?)(?: fra [^.]*)? (?:godkendes|godkendt|blev godkendt|er godkendt|vedtages|vedtaget))/i;
const capital = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);

/** The last meeting's points as the front page shows them: no formalities, at most three, each a sentence. */
export const frontPagePoints = (decisions: string[]) => decisions.filter(d => !FORMALITY.test(d)).slice(0, 3).map(d => sentence(d));

const NOW_TIME = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", minute: "2-digit" });

/** Saga's summary in a sentence or two: its first lines, without headings. */
export function lead(summary: string | null): string {
  // Only the running text: the bullet points are shown under "Bestyrelsen lige nu". Reported: the front page said
  // "Bestyrelsen Medlemmer" - Saga's overview writes its section headings in bold ("**Bestyrelsen**"), and those were
  // taken for text. A line that is only a bold heading is a heading.
  const lines = (summary ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#/.test(l) && !/^temperatur:/i.test(l) && !/^[-*]\s+/.test(l)
    && !/^(\*\*|__)[^*_]+(\*\*|__):?$/.test(l));
  const text = lines.slice(0, 2).join(" ");
  return text.length > 280 ? `${text.slice(0, 277).replace(/\s+\S*$/, "")} …` : text;
}

/** What waits on the chair from Saga's picture - only what is current: from the group (it covers the last
 * weeks), or dated from 1 October on. Old, context-less lines from the minutes document stay out. */
export function currentForChair(items: BoardPicture["forJacob"]): BoardPicture["forJacob"] {
  return items.filter(item => {
    const day = taskDay({ who: "", what: "", due: "", meeting: item.since, source: "dokument" });
    return day ? day >= TASKS_SINCE : item.source !== "dokument";
  });
}

export function homePage(base: string, data: HomeData): string {
  const first = data.who?.split(/\s+/)[0];
  const open = data.todos.length + data.tasks.length + data.forMe.length + (data.votes?.length ?? 0);
  const tr = data.tr ?? ((text: string) => text);
  const summary = tr(lead(data.summary));
  const welcome = `<section class="welcome"><div><p class="eyebrow">${esc(longDay(data.today))}</p><h1>${first ? `Hej ${esc(first)}` : "Overblik"}</h1>
${summary ? `<p class="lead">${inline(summary)}</p>` : `<p class="lead">Her er det vigtigste i bestyrelsen lige nu.</p>`}${data.speaker ? `<p class="speaker" style="margin:10px 0 0;font:italic 15px/1.55 Georgia,'Times New Roman',serif;color:var(--muted);max-width:68ch">${esc(data.speaker)}</p>` : ""}</div>
${data.who ? `<a class="button propose-btn" href="${base}/beslutninger#nyt">+ Stil et forslag</a>` : ""}${lysArt("mini")}</section>`;

  const days = data.next ? daysUntil(data.next.meeting_date, data.today) : null;
  // Requested: back to the first Lys design (3 Oct), which has four boxes and no event-count box. The box stays built - set this to true to bring it back.
  const SHOW_HELD_FACT = false;
  const fact = SHOW_HELD_FACT ? heldFact(data.eventsHeld ?? 0, base) : "";
  const tiles = `<section class="tiles with-members${fact ? " with-fact" : ""}" aria-label="Kort fortalt">
<a class="tile" href="${base}/moder${data.next ? `/${data.next.id}` : ""}"><span class="label">Næste møde</span><b>${data.next ? esc(shortDay(data.next.meeting_date).replace(/\s\d{4}$/, "")) : "Ikke sat"}</b><span class="sub">${data.next ? `${inDays(days!)}${data.next.start_time ? ` · kl. ${esc(data.next.start_time)}` : ""}` : "Planlæg det under Møder"}</span></a>
<a class="tile" href="${base}/opgaver"><span class="label">Dine opgaver</span><b>${open}</b><span class="sub">${open ? "venter på dig" : "intet venter"}</span></a>
${data.toSign.length ? `<a class="tile hot" href="${base}/referat/${data.toSign[0]!.id}"><span class="label">Til godkendelse</span><b>${data.toSign.length}</b><span class="sub">${plural(data.toSign.length, "referat", "referater")}</span></a>` : ""}
<a class="tile" href="${base}/arrangementer"><span class="label">Arrangementer</span><b>${data.eventsMonth}</b><span class="sub">de næste 30 dage</span></a>${membersTile(base, data.memberStats ?? [])}${fact}</section>`;

  // What waits on me: minutes to approve, my own and written-to-me items, my tasks from the minutes, and (for the chair) Saga's list.
  const mine = [
    ...(data.votes ?? []).map(p => voteTodo(base, p)),
    ...data.toSign.map(m => `<li><a href="${base}/referat/${m.id}"><strong>Godkend referatet</strong></a><span class="ctx">Møde ${esc(shortDay(m.meeting_date ?? ""))}</span></li>`),
    // The same lines as on Opgaver, with the same checkbox to the left ("helt samme styling som på opgavesiden"): the same task from the minutes,
    // the minutes document, Saga's list and your own items is one line (data.ts sameTask), and checking it takes the page back here.
    ...(data.who ? openLines(base, { who: data.who, tasks: data.tasks, todos: data.todos, saga: data.forMe, back: "forside" }) : [])
  ];
  const yours = `<article class="panel" id="dine-opgaver"><header><h2>Dine opgaver</h2><p>Det, der venter på dig - fra referaterne, bestyrelsen og Saga.</p></header>
${!data.who ? `<p class="empty"><a href="${base}/hvem">Vælg hvem du er</a> for at se dine opgaver.</p>` : mine.length ? `<ul class="plain">${mine.slice(0, 6).join("")}</ul>` : `<p class="empty">Intet venter på dig lige nu.</p>`}
<a class="more" href="${base}/opgaver">${mine.length > 6 ? `Se alle ${mine.length}` : "Åbn dine opgaver"} →</a>
<a class="more" href="${base}/beslutninger#nyt">Stil et forslag til afstemning →</a></article>`;

  const m = data.nextTeam !== undefined ? data.nextTeam : data.next;
  // Requested: "On the front page, we don't show any items for the coming meeting, but simply just tell about the meeting": when, where and who leads it - the agenda is on the meeting's page.
  const meeting = `<article class="panel"><header><h2>Næste teammøde</h2><p>Hvornår og hvor.</p></header>
${m ? `<div class="when"><div class="date"><span>${esc(MONTH.format(new Date(`${m.meeting_date}T12:00:00Z`)).replace(".", ""))}</span><b>${Number(m.meeting_date.slice(8))}</b></div>
<div><strong>${esc(longDay(m.meeting_date).replace(/\s\d{4}$/, ""))}</strong><div class="muted small">${[m.start_time ? `kl. ${esc(m.start_time)}` : "", m.place ? esc(m.place) : "", inDays(daysUntil(m.meeting_date, data.today))].filter(Boolean).join(" · ")}</div></div></div>
${rolesLine(m) ? `<p class="small muted" style="margin:10px 0 0">${esc(rolesLine(m))}</p>` : ""}
<a class="more" href="${base}/moder/${m.id}">Åbn mødet og dagsordenen →</a>`
    : data.found.length ? `<p class="empty">Intet møde er sat i kalenderen, men Saga har set <strong>${esc(longDay(data.found[0]!.date))}</strong> nævnt${data.found[0]!.what ? ` (${esc(data.found[0]!.what)})` : ""}.</p>
<a class="more" href="${base}/moder?dato=${esc(data.found[0]!.date)}${guessKind(data.found[0]!.what) ? `&amp;art=${guessKind(data.found[0]!.what)}` : ""}#nyt">Sæt det i kalenderen →</a>`
    : `<p class="empty">Intet møde er sat i kalenderen.</p><a class="more" href="${base}/moder#nyt">Planlæg et møde →</a>`}</article>`;

  // Requested: "\"Referatet godkendes med bemærkning om fejl i tidligere referat.\" er ikke vigtigt nok til at stå på
  // forsiden. Overskriften bør være sådan: Vigtigste punkter fra sidste møde / Torsdag den 1. oktober 2026 (Husk at
  // godkende referatet)". The meeting's formalities (approving the agenda or the minutes) stay in the minutes.
  const l = data.latest;
  const important = l ? l.decisions.filter(d => !FORMALITY.test(d)) : [];
  const unsigned = l ? data.toSign.some(m2 => m2.id === l.id) : false;
  const minutes = l ? `<article class="panel"><header><h2>Vigtigste punkter fra sidste møde</h2><p>${esc(capital(longDay(l.date)))}${unsigned ? ` · <a href="${base}/referat/${l.id}">Husk at godkende referatet</a>` : ""}</p></header>
${important.length ? `<ul class="items hearts">${frontPagePoints(important).map(d => `<li>${esc(tr(d))}</li>`).join("")}</ul>${important.length > 3 ? `<p class="small muted">og ${plural(important.length - 3, "punkt", "punkter")} mere</p>` : ""}` : `<p class="empty">Ingen beslutninger i referatet.</p>`}
${l.members ? `<div style="margin-top:14px"><div class="small"><strong>${l.approved} af ${l.members}</strong> har godkendt</div><div class="meter"><i style="width:${Math.round(100 * Math.min(l.approved, l.members) / l.members)}%"></i></div></div>` : ""}
<a class="more" href="${base}/referat/${l.id}">${unsigned ? "Læs og godkend" : "Læs referatet"} →</a></article>` : "";

  // Requested: "Her skal Saga en gang i timen lave et resume og overblik over hvad der rører sig netop nu" - "et uformelt
  // resume på under halvtreds ord om, hvad der rører sig. Bare det vigtigste og det nyeste." - "Så det fulde resumé og
  // statusoverblik kommer først, når man klikker ind på status." Only Saga's short text here: no temperature, no
  // waiting topics from the six-hour picture (they went stale: a meeting "i dag" the day after, a case already done).
  const now = data.boardNow?.text ? data.boardNow : null;
  const board = `<article class="panel"><header><h2>Bestyrelsen lige nu</h2><p>${now ? `Saga · ${esc(NOW_TIME.format(now.at))}` : "Sagas korte resumé af, hvad der rører sig."}</p></header>
${now ? `<p class="now">${esc(tr(now.text))}</p>` : `<p class="empty">Saga skriver det første korte resumé inden for en time (på hverdage).</p>`}
<a class="more" href="${base}/status">Mere i Status →</a></article>`;

  const events = `<article class="panel"><header><h2>Lige om lidt i Hjerterum</h2><p>De næste arrangementer i Hjerterum.</p></header>
${data.events.length ? `<ul class="items">${data.events.map(e => `<li class="event">${e.image_url ? `<img src="${esc(e.image_url)}" alt="" loading="lazy">` : `<span class="date" style="width:52px;height:52px"><b style="font-size:20px">${new Date(e.starts_at_ms).getDate()}</b></span>`}
<div><span class="t">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</span><span class="ctx">${esc(EVENT_TIME.format(e.starts_at_ms))}${e.host ? ` · ${esc(e.host)}` : ""}</span></div></li>`).join("")}</ul>` : `<p class="empty">Ingen arrangementer de næste dage.</p>`}
<a class="more" href="${base}/arrangementer">Alle arrangementer →</a></article>`;

  const working = data.progress.working || data.progress.waiting ? `<p class="notice">${[data.progress.working ? `${plural(data.progress.working, "optagelse", "optagelser")} bliver til referat` : "",
    data.progress.waiting ? `${plural(data.progress.waiting, "referat", "referater")} lægges op om lidt` : ""].filter(Boolean).join(" · ")}.</p>` : "";

  const enquiryNote = data.newEnquiries ? `<p class="notice"><a href="${base}/posthus"><strong>${plural(data.newEnquiries, "vigtig mail", "vigtige mails")}</strong> venter på svar i team@ →</a></p>` : "";
  const reviewNote = data.eventsToReview ? `<p class="notice"><a href="${base}/arrangementer"><strong>${plural(data.eventsToReview, "medlems-event", "medlems-events")}</strong> venter på godkendelse →</a></p>` : "";
  // Requested: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked" - until the member has written them.
  const ask = data.needsResponsibilities ? `<section class="panel ask-ansvar" id="ansvar"><header><h2>Hvad har du ansvar for?</h2><p>Skriv det med dine egne ord, så ved Saga, hvad hun skal give dig besked om, og hvem hun skal pege på, når noget kommer ind. Du kan altid rette det under din profil.</p></header>${responsibilitiesForm(base, "", "/")}</section>` : "";
  return layout(base, "Overblik", `<main class="home">${welcome}${tiles}${ask}${enquiryNote}${reviewNote}${working}
<div class="panels"><div>${yours}${minutes}${frontVotes(base, data.proposals ?? [], data.who, data.nowMs, data.next?.meeting_date)}</div><div>${meeting}${board}${events}</div></div></main>`, { section: "/", who: data.who, style: TODOS_STYLE + VOTES_STYLE + HOME_STYLE + MEMBERS_STYLE });
}
