import { esc, layout } from "./page.js";
import type { Channel, SocialAccount, SocialPost } from "../social/social.js";
import { at, clock, dateOf, dayName, weekNumber } from "../social/plan.js";
import { PLAN_STYLE, prPlanSection, type PlanData } from "./prPlan.js";
import { INSIGHT_STYLE, insightSection, type MonthInsight } from "./prInsight.js";
import { PR_EVENTS_STYLE, prEventsSection, type PrEventRow } from "./prEvents.js";
import { studioIdOf } from "./posterStudio.js";
import { PR_CALENDAR_STYLE, prCalendarSection, type CalendarData } from "./prCalendar.js";

/** Kommunikation → PR og SoMe (/pr): the chair's PR cockpit (social.ts). Connect Facebook and Instagram; pass on what Hjerterum is tagged in;
 * read, change and approve the week's posts. Nothing goes out before it is approved here. */

export type PrPageData = {
  ready: boolean;
  account: SocialAccount | null;
  shares: SocialPost[];
  weeks: Array<{ monday: string; key: string; label: string }>;
  week: { monday: string; key: string; posts: SocialPost[] };
  recent: SocialPost[];
  aiReady: boolean;
  plan: PlanData;
  insight: MonthInsight[];
  /** The Events tab's rows (prEvents.ts) - loaded only for that tab. */
  events?: PrEventRow[];
  /** The Kalender tab (prCalendar.ts) - loaded only for that tab. */
  calendar?: CalendarData;
  nowMs: number;
  notice: string;
  error: string;
};

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const when = (ms: number | null) => ms ? WHEN.format(ms) : "";
const SHARED_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });
const NETWORK: Record<Channel, string> = { facebook: "Facebook", instagram: "Instagram" };
const STATUS: Record<SocialPost["status"], [string, string]> = {
  draft: ["Udkast", "wait"], approved: ["Godkendt", "good"], publishing: ["Publiceres nu", "good"], published: ["Publiceret", "good"], failed: ["Fejlede", "wait"], skipped: ["Sprunget over", ""]
};
/** "2026-11-12T10:00" in Danish time, for a datetime-local field. */
export const localInput = (ms: number | null) => ms ? `${dateOf(ms)}T${clock(ms).replace(".", ":")}` : "";
/** The field's value back to ms (Danish time). */
export function fromLocalInput(value: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  return m ? at(m[1]!, Number(m[2]), Number(m[3])) : null;
}

const status = (p: SocialPost) => { const [label, tone] = STATUS[p.status]; return `<span class="chip ${tone}">${label}</span>`; };
const open = (p: SocialPost) => !["published", "publishing"].includes(p.status);
/** Where a sent post can be seen. */
function sentLinks(p: SocialPost): string {
  const links: string[] = [];
  if (p.published.facebook) links.push(`<a href="https://www.facebook.com/${esc(p.published.facebook)}" target="_blank" rel="noopener">Se på Facebook</a>`);
  if (p.published.instagram) links.push(`<span>Ude på Instagram</span>`);
  return links.join(" · ");
}

function channelBoxes(p: SocialPost, allowed: Channel[], disabled: boolean): string {
  // "kanaler": the boxes were on the page, so what is not ticked was taken off (handler.ts).
  return `<div class="pr-channels"><input type="hidden" name="kanaler" value="1">${allowed.map(c => `<label><input type="checkbox" name="channel" value="${c}"${p.channels.includes(c) ? " checked" : ""}${disabled ? " disabled" : ""}> ${NETWORK[c]}</label>`).join("")}</div>`;
}

function actions(base: string, p: SocialPost, approveLabel: string): string {
  if (!open(p)) return `<p class="small muted">${p.status === "published" ? `Publiceret ${esc(when(p.published_at_ms))}. ${sentLinks(p)}` : "Publiceres nu."}</p>`;
  const buttons = p.status === "approved"
    ? `<button name="do" value="fortryd" class="ghost">Fortryd godkendelsen</button>`
    : `<button name="do" value="godkend">${approveLabel}</button><button name="do" value="gem" class="ghost">Gem ændringer</button>${p.status === "skipped" ? "" : `<button name="do" value="spring" class="ghost">Spring over</button>`}`;
  return `<p class="pr-acts">${buttons}</p>${p.error ? `<p class="small warn">${esc(p.error)}</p>` : ""}${p.approved_by && p.status === "approved" ? `<p class="small muted">Godkendt af ${esc(p.approved_by)}.</p>` : ""}`;
}

function shareCard(base: string, p: SocialPost, account: SocialAccount | null): string {
  const s = p.source;
  const instagramOk = Boolean(account?.ig_user_id) && (s.media === "image" || s.media === "carousel") && p.images.length > 0;
  const allowed: Channel[] = instagramOk ? ["facebook", "instagram"] : ["facebook"];
  const locked = !open(p) || p.status === "approved";
  return `<article class="pr-post">
<header><span class="chip">${NETWORK[s.network ?? "facebook"]}</span>${status(p)}${s.sharedAt ? `<span class="chip good">Delt d. ${esc(SHARED_DAY.format(s.sharedAt))}</span>` : ""}${s.consent ? `<span class="chip good">PR-samtykke givet</span>` : ""}
<b>${esc(s.author ?? "Ukendt afsender")}</b> <span class="small muted">${esc(when(s.createdMs ?? null))}</span>${s.permalink ? ` · <a href="${esc(s.permalink)}" target="_blank" rel="noopener">Se opslaget</a>` : ""}</header>
<div class="pr-orig">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<p>${esc((s.text ?? "").slice(0, 500))}${(s.text ?? "").length > 500 ? " …" : ""}</p></div>
${s.sharedAt ? `<p class="small muted">Hjerterum har allerede delt det d. ${esc(SHARED_DAY.format(s.sharedAt))}. Du kan springe det over.</p>` : ""}
${s.network === "instagram" && s.media === "video" ? `<p class="small muted">Videoer kan ikke lægges op igen på Instagram herfra. Del den på Facebook som link, eller del den selv i appen.</p>` : ""}
${instagramOk && !s.consent ? `<p class="small muted">Instagram har ingen "del"-knap for os: opslaget lægges op igen på Hjerterums profil med afsenderen nævnt. Gør det kun, når afsenderen har sagt ja.</p>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>Hjerterums ord over delingen${instagramOk ? " (Facebook)" : ""}</span><textarea name="text" rows="3"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
${instagramOk ? `<label class="pr-field"><span>Teksten på Instagram</span><textarea name="instagram_text" rows="6"${locked ? " disabled" : ""}>${esc(s.instagramText ?? "")}</textarea></label>
<label class="pr-field"><span>Inviter som samarbejdspartner på Instagram (højst 3, adskilt med komma)</span><input name="collaborators" value="${esc((s.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>` : ""}
${channelBoxes(p, allowed, locked)}
${actions(base, p, "Del nu")}</form></article>`;
}

/** "Ugens events" as a reel, made by the weekly job (.github/workflows/ugens-reel.yml): the video, its words and its time; Instagram only. */
function reelCard(base: string, p: SocialPost): string {
  const locked = !open(p) || p.status === "approved";
  return `<article class="pr-post">
<header>${status(p)}<b>Ugens events som reel</b> <span class="small muted">Instagram</span></header>
${p.source.video ? `<video class="pr-reel" src="${esc(p.source.video)}" controls muted playsinline preload="metadata"></video>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>Teksten på Instagram</span><textarea name="text" rows="8"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
<label class="pr-field"><span>Inviter som samarbejdspartner på Instagram (højst 3, adskilt med komma)</span><input name="collaborators" value="${esc((p.source.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>
<div class="pr-row"><label class="pr-field pr-time"><span>Sendes</span><input type="datetime-local" name="at" value="${localInput(p.publish_at_ms)}"${locked ? " disabled" : ""}></label></div>
${actions(base, p, "Godkend")}</form></article>`;
}

function weekCard(base: string, p: SocialPost, account: SocialAccount | null, monday: string): string {
  if (p.source.format === "reel") return reelCard(base, p);
  const locked = !open(p) || p.status === "approved";
  const head = p.kind === "week" ? `<b>Ugens events</b>` : `<b>${esc(p.source.title ?? "")}</b> <span class="small muted">${esc(p.source.startsMs ? `${dayName(p.source.startsMs)} kl. ${clock(p.source.startsMs)}` : "")}${p.source.host ? ` · ${esc(p.source.host)}` : ""}</span>`;
  const allowed: Channel[] = account?.ig_user_id && p.images.length ? ["facebook", "instagram"] : ["facebook"];
  return `<article class="pr-post" id="opslag-${p.id}">
<header>${status(p)}${head}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">Link</a>` : ""}</header>
${p.kind === "week" && p.images.length ? `<div class="pr-strip">${p.images.map(src => `<img src="${esc(src)}" alt="" loading="lazy">`).join("")}</div>` : ""}
${p.kind === "event" ? (() => { const studio = p.source.key ? studioIdOf(p.source.key) : null;
  return `<div class="pr-design">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="small muted">Intet billede</span>`}<span class="small muted">${p.source.design ? "Dit design" : "Eventets billede"}</span>
${studio && open(p) ? `<a class="button ghost" href="${base}/plakater/${esc(studio)}?fra=${encodeURIComponent(`/pr/uge?uge=${monday}#opslag-${p.id}`)}">${p.source.design ? "Skift design" : "Lav design"}</a>` : ""}</div>`; })() : ""}
${p.kind === "event" && p.source.video ? `<div class="pr-video"><video src="${esc(p.source.video)}" controls muted playsinline preload="metadata"></video><span class="small muted">Videoen til Instagram (reel)</span></div>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>${p.kind === "week" ? "Teksten på Facebook" : "Opslaget på Facebook"}</span><textarea name="text" rows="${p.kind === "week" ? 10 : 4}"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
${p.kind === "week" && allowed.includes("instagram") ? `<label class="pr-field"><span>Teksten på Instagram (billederne som karrusel)</span><textarea name="instagram_text" rows="10"${locked ? " disabled" : ""}>${esc(p.source.instagramText ?? "")}</textarea></label>
<label class="pr-field"><span>Inviter som samarbejdspartner på Instagram (højst 3, adskilt med komma)</span><input name="collaborators" value="${esc((p.source.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>` : ""}
<div class="pr-row"><label class="pr-field pr-time"><span>${p.kind === "event" && allowed.includes("instagram") ? "Facebook sendes" : "Sendes"}</span><input type="datetime-local" name="at" value="${localInput(p.publish_at_ms)}"${locked ? " disabled" : ""}></label>
${p.kind === "event" && allowed.includes("instagram") ? `<label class="pr-field pr-time"><span>Instagram sendes (tomt: samtidig)</span><input type="datetime-local" name="instagram_at" value="${p.source.instagramAtMs ? localInput(p.source.instagramAtMs) : ""}"${locked ? " disabled" : ""}></label>` : ""}
${channelBoxes(p, allowed, locked)}</div>
${p.kind === "event" && p.source.video ? `<div class="pr-channels"><input type="hidden" name="video_box" value="1"><label><input type="checkbox" name="video" value="1"${p.source.noVideo ? "" : " checked"}${locked ? " disabled" : ""}> Video på Instagram (ellers billedet)</label></div>` : ""}
${actions(base, p, "Godkend")}</form></article>`;
}

/** Requested: "Jeg synes, at siden bliver ret rodet, når der er så meget indhold. Kan du ikke dele det op i underpunkter?" - PR og SoMe in tabs. */
export type PrTab = "overblik" | "kalender" | "events" | "tagget" | "uge" | "sendt";
export const PR_TABS: Array<[PrTab, string, string]> = [["overblik", "/pr", "Overblik"], ["kalender", "/pr/kalender", "Kalender"], ["events", "/pr/events", "Events"], ["tagget", "/pr/tagget", "Tagget i"], ["uge", "/pr/uge", "Ugens opslag"], ["sendt", "/pr/sendt", "Publiceret og indsigt"]];

export function prPage(base: string, who: string | null, d: PrPageData, tab: PrTab = "overblik"): string {
  const a = d.account;
  const connection = !d.ready
    ? `<p>Meta-appen er ikke sat op endnu: hemmelighederne <code>META_APP_ID</code> og <code>META_APP_SECRET</code> mangler på serveren. Når de er lagt ind, kan du forbinde Facebook og Instagram her.</p>`
    : !a ? `<p>Forbind Hjerterums Facebook-side og den Instagram-konto, der er koblet til den. Du logger ind hos Facebook og giver Hjerterum lov til at læse siden og poste på den.</p>
<p><a class="button" href="${base}/pr/forbind">Forbind Facebook og Instagram</a></p>`
    : `<p><b>Facebook:</b> ${esc(a.page_name)} · <b>Instagram:</b> ${a.ig_username ? `@${esc(a.ig_username)}` : `<span class="warn">ikke koblet til siden</span>`}</p>
<p class="small muted">Forbundet af ${esc(a.connected_by)} ${esc(when(a.connected_at_ms))}.${a.checked_at_ms ? ` Saga kiggede efter tags ${esc(when(a.checked_at_ms))}.` : ""}</p>
${a.check_error ? `<p class="small warn">Sidst: ${esc(a.check_error)}</p>` : ""}
<div class="pr-acts"><form method="post" action="${base}/pr/tags"><button class="ghost">Kig efter nye tags nu</button></form>
<a class="button ghost" href="${base}/pr/forbind">Forbind igen</a>
<form method="post" action="${base}/pr/afbryd" onsubmit="return confirm('Afbryd forbindelsen til Facebook og Instagram? Intet sendes, før du forbinder igen.')"><button class="ghost">Afbryd</button></form></div>`;

  const shares = d.shares.length ? d.shares.map(p => shareCard(base, p, a)).join("") : `<p class="empty">Intet nyt. Saga kigger efter nye opslag, der tagger Hjerterum, hver halve time.</p>`;

  const tabs = d.weeks.map(w => `<a class="${w.monday === d.week.monday ? "on" : ""}" href="${base}/pr/uge?uge=${w.monday}">${esc(w.label)}</a>`).join("");
  const drafts = d.week.posts.filter(p => p.status === "draft" && p.channels.length && (p.publish_at_ms ?? Infinity) > d.nowMs).length;
  const eventCount = d.week.posts.filter(p => p.kind === "event").length;
  const week = d.week.posts.length
    ? `<div class="pr-acts">${drafts ? `<form method="post" action="${base}/pr/uge/godkend"><input type="hidden" name="uge" value="${d.week.monday}"><button>Godkend hele ugen (${drafts})</button></form>` : ""}
<form method="post" action="${base}/pr/uge/planlaeg"><input type="hidden" name="uge" value="${d.week.monday}"><button class="ghost">Tilføj nye events fra kalenderen</button></form></div>
<p class="small muted">"Ugens events" og ${eventCount} events med hvert sit opslag på Facebook. Et godkendt opslag går ud på sit tidspunkt; et event, der er begyndt, får ikke sit opslag bagefter.</p>
${d.week.posts.map(p => weekCard(base, p, a, d.week.monday)).join("")}`
    : `<p class="empty">Ugen er ikke planlagt endnu. Saga planlægger næste uge torsdag fra kl. 10.</p>
${a ? `<form method="post" action="${base}/pr/uge/planlaeg"><input type="hidden" name="uge" value="${d.week.monday}"><button>Lad Saga planlægge uge ${weekNumber(d.week.key)} nu</button></form>` : ""}`;

  const recent = d.recent.length ? `<ul class="pr-log">${d.recent.map(p => `<li><span class="at">${esc(when(p.published_at_ms ?? p.updated_at_ms))}</span><span>${status(p)} ${p.kind === "share" ? `Deling fra ${esc(p.source.author ?? "?")}` : p.kind === "week" ? "Ugens events" : esc(p.source.title ?? "Event")}
${p.source.removed ? `<small class="muted">Slettet igen: ${esc(p.source.removed.note)}</small>` : p.status === "published" ? `<small>${sentLinks(p)}</small>` : p.error ? `<small class="warn">${esc(p.error)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="empty">Intet publiceret endnu.</p>`;

  const waiting = d.shares.filter(p => !p.source.sharedAt).length;
  const count = (n: number) => n ? ` <span class="pr-count">${n}</span>` : "";
  const nav = `<nav class="pr-nav" aria-label="PR og SoMe">${PR_TABS.map(([key, path, label]) => `<a href="${base}${path}"${key === tab ? ' class="on" aria-current="page"' : ""}>${label}${key === "tagget" ? count(waiting) : key === "uge" ? count(drafts) : key === "kalender" && d.calendar ? count(d.calendar.posts.filter(p => p.status === "draft").length) : ""}</a>`).join("")}</nav>`;
  const sections: Record<PrTab, string> = {
    overblik: `${prPlanSection(base, d.plan)}
<section class="panel"><header><h2>Forbindelse</h2></header>${connection}</section>`,
    kalender: d.calendar ? prCalendarSection(base, d.calendar) : "",
    events: prEventsSection(base, d.events ?? [], d.nowMs),
    tagget: `<section class="panel" id="tagget"><header><h2>Tagget i${d.shares.length ? ` (${d.shares.length})` : ""}</h2><p>Opslag, som undervisere og andre har tagget Hjerterum i. Del dem videre med et par ord fra Hjerterum.</p></header>${shares}</section>`,
    uge: `<section class="panel" id="uge"><header><h2>Ugens opslag</h2><p>${d.aiReady ? "Saga skriver ordene; du kan rette dem." : "Saga er ikke sat op, så teksterne er simple skabeloner, du kan rette."}</p></header><nav class="pr-tabs">${tabs}</nav>${week}</section>`,
    sendt: `<section class="panel" id="sendt"><header><h2>Publiceret og fejlet</h2></header>${recent}</section>
${insightSection(d.insight)}`
  };
  const body = `<main class="pr"><div class="hero"><h1>PR og sociale medier</h1>
${tab === "overblik" ? `<p>Saga gør alle opslag klar - delinger af det, Hjerterum er tagget i, et opslag for hvert event, Ugens events og ugens reel - og du godkender. Intet sendes uden dit ja. Kun for formanden indtil videre.</p>` : ""}</div>
${nav}
${d.notice ? `<p class="notice good">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice warn">${esc(d.error)}</p>` : ""}
${sections[tab]}</main>`;
  return layout(base, "PR og sociale medier", body, { section: "/pr", who, style: STYLE + PLAN_STYLE + INSIGHT_STYLE + PR_EVENTS_STYLE + PR_CALENDAR_STYLE });
}

const STYLE = `.pr{display:grid;gap:20px}.pr-nav{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:0 0 12px}.pr-nav a{padding:8px 16px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14.5px;color:var(--ink);background:var(--card);box-shadow:var(--shadow)}.pr-nav a.on{background:var(--ink);color:var(--card)}.pr-count{display:inline-block;min-width:20px;padding:0 6px;margin-left:4px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:12px;text-align:center}.pr-tabs{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap}.pr-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-size:14px}.pr-tabs a.on{background:var(--ink);color:var(--card)}
/* "Her mangler jeg en klar adskillelse mellem eventsene. Det kan være en svag forskel i baggrundsfarven." */.pr-post{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 14px;scroll-margin-top:90px}.pr-post:nth-of-type(even){background:var(--card)}.pr-post header{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin:0 0 10px}
.pr-orig{display:flex;gap:14px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:12px;margin:0 0 12px}.pr-orig img{width:96px;height:96px;object-fit:cover;border-radius:10px;flex:none}.pr-orig p{margin:0;font-size:14px;white-space:pre-line}
.pr-design{display:flex;align-items:center;gap:12px;margin:0 0 12px}.pr-video{display:flex;align-items:flex-end;gap:12px;margin:0 0 12px}.pr-video video{width:160px;aspect-ratio:9/16;border-radius:12px;background:#000}.pr-design img{width:72px;height:90px;object-fit:cover;border-radius:10px}.pr-reel{display:block;width:100%;max-width:270px;aspect-ratio:9/16;border-radius:14px;background:#000;margin:0 0 12px}.pr-strip{display:flex;gap:6px;overflow-x:auto;margin:0 0 12px}.pr-strip img{height:72px;border-radius:8px}
.pr-field{display:block;margin:0 0 10px}.pr-field span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}.pr-field textarea,.pr-field input{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
.pr-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end}.pr-time{max-width:260px}.pr-channels{display:flex;gap:18px;margin:0 0 10px}.pr-channels label{display:inline-flex;align-items:center;gap:7px;font-size:14px;cursor:pointer}.pr-channels input{width:18px;height:18px;min-height:0;margin:0;padding:0;accent-color:var(--accent);flex:none}
.pr-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}.pr-acts form{margin:0}
.pr-log{list-style:none;margin:0;padding:0}.pr-log li{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}.pr-log li:first-child{border-top:0}.pr-log .at{color:var(--muted);font-size:13px}.pr-log small{display:block}
@media (max-width:760px){.pr-log li{grid-template-columns:1fr;gap:2px}.pr-orig img{width:64px;height:64px}}`;
