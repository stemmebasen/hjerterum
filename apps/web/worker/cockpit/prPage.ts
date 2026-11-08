import { esc, layout } from "./page.js";
import type { Channel, SocialAccount, SocialPost } from "../social/social.js";
import { at, clock, dateOf, dayName, weekNumber } from "../social/plan.js";
import { PLAN_STYLE, prPlanSection, type PlanData } from "./prPlan.js";
import { INSIGHT_STYLE, insightSection, type MonthInsight } from "./prInsight.js";
import { PR_EVENTS_STYLE, prEventsSection, type PrEventRow } from "./prEvents.js";
import { messengerSection, PR_MESSENGER_STYLE, replyLeft } from "./prMessenger.js";
import type { MessengerThread } from "../social/meta.js";
import { studioIdOf } from "./posterStudio.js";
import { PR_CALENDAR_STYLE, prCalendarSection, type CalendarData } from "./prCalendar.js";
import { PR_MAIL_STYLE, prMailSection, type PrMail } from "./prMail.js";

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
  /** The coming events, for "Kobl til event" on PR og SoMe → Mails. */
  mailEvents?: import("./mailMaterial.js").UpcomingEvent[];
  messenger?: { threads: MessengerThread[]; error: string | null };
  plan: PlanData;
  insight: MonthInsight[];
  /** The Events tab's rows (prEvents.ts) - loaded only for that tab. */
  events?: PrEventRow[];
  /** The Kalender tab (prCalendar.ts) - loaded only for that tab. */
  calendar?: CalendarData;
  /** The Mails tab (prMail.ts) - loaded only for that tab. */
  mails?: PrMail[];
  nowMs: number;
  /** Whether the posts and the newsletter link to the new website yet (public-site.ts). */
  siteLive?: boolean;
  shareEvent?: boolean;
  deleteOld?: boolean;
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

/** Requested (the chair, 5 Nov 2026): "en mulighed for, at AI kan komme med et forslag til delingsteksten ... på nye spændende og kærlige måder - ikke
 * kliche" - Saga's writer (social/writer.ts) fills the fields; nothing is saved until the chair saves or approves. */
function writerRow(p: SocialPost, locked: boolean, ai: boolean): string {
  if (locked || !ai) return "";
  return `<div class="pr-writer"><input name="onske" maxlength="300" placeholder="Ønske til teksten, fx mere legende (valgfrit)" aria-label="Ønske til teksten"><button type="button" class="ghost" data-forslag="${p.id}">✨ Nyt forslag fra Saga</button><span class="small muted" role="status"></span></div>`;
}

const WRITER_SCRIPT = (base: string) => `<script>(()=>{const url=${JSON.stringify(`${base}/pr/opslag/`)};
document.addEventListener("click",async e=>{const b=e.target.closest&&e.target.closest("[data-forslag]");if(!b)return;const f=b.form,s=b.parentNode.querySelector("[role=status]");
b.disabled=true;s.textContent="Saga skriver …";const d=new FormData();d.append("onske",(f.elements.onske&&f.elements.onske.value)||"");
const r=await fetch(url+b.dataset.forslag+"/forslag",{method:"POST",body:d,headers:{accept:"application/json"}}).catch(()=>null);const j=r&&r.ok?await r.json().catch(()=>null):null;b.disabled=false;
if(!j){s.textContent="Saga kunne ikke skrive et forslag lige nu. Prøv igen.";return}
if(f.elements.text)f.elements.text.value=j.text;if(f.elements.instagram_text)f.elements.instagram_text.value=j.instagramText;s.textContent="Forslaget står i felterne. Ret det, og gem eller godkend.";})})()</script>`;

function shareCard(base: string, p: SocialPost, account: SocialAccount | null, ai = false): string {
  const s = p.source;
  const instagramOk = Boolean(account?.ig_user_id) && (s.media === "image" || s.media === "carousel") && p.images.length > 0;
  const allowed: Channel[] = instagramOk ? ["facebook", "instagram"] : ["facebook"];
  const locked = !open(p) || p.status === "approved";
  return `<article class="pr-post">
<header><span class="chip">${NETWORK[s.network ?? "facebook"]}</span>${s.via === "messenger" ? `<span class="chip">Sendt i Messenger</span>` : ""}${status(p)}${s.sharedAt ? `<span class="chip good">Delt d. ${esc(SHARED_DAY.format(s.sharedAt))}</span>` : ""}${s.consent ? `<span class="chip good">PR-samtykke givet</span>` : ""}
<b>${esc(s.author ?? "Ukendt afsender")}</b> <span class="small muted">${esc(when(s.createdMs ?? null))}</span>${s.permalink ? ` · <a href="${esc(s.permalink)}" target="_blank" rel="noopener">Se opslaget</a>` : ""}</header>
<div class="pr-orig">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<p>${esc((s.text ?? "").slice(0, 500))}${(s.text ?? "").length > 500 ? " …" : ""}</p></div>
${s.sharedAt ? `<p class="small muted">Hjerterum har allerede delt det d. ${esc(SHARED_DAY.format(s.sharedAt))}. Du kan springe det over.</p>` : ""}
${s.network === "instagram" && s.media === "video" ? `<p class="small muted">Videoer kan ikke lægges op igen på Instagram herfra. Del den på Facebook som link, eller del den selv i appen.</p>` : ""}
${instagramOk ? `<p class="small muted">Du skal ikke selv gøre noget i Instagram. Trykker du "Del nu" med Instagram valgt, lægger Saga billedet op på Hjerterums Instagram med teksten nedenfor og "Foto: @${esc((s.author ?? "").replace(/^@/, ""))}".${s.consent ? "" : " Gør det kun, når afsenderen er med på det."}</p>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>Hjerterums ord over delingen${instagramOk ? " (Facebook)" : ""}</span><textarea name="text" rows="3"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
${instagramOk ? `<label class="pr-field"><span>Teksten på Instagram</span><textarea name="instagram_text" rows="6"${locked ? " disabled" : ""}>${esc(s.instagramText ?? "")}</textarea></label>
<label class="pr-field"><span>Vis også opslaget på deres Instagram (samarbejde)</span>${COLLAB_HELP}<input name="collaborators" value="${esc((s.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>` : ""}
${writerRow(p, locked, ai)}
${channelBoxes(p, allowed, locked)}
${actions(base, p, "Del nu")}</form></article>`;
}

/** Asked (the chair, 5 Nov 2026): "Jeg forstår heller ikke, hvad der sker, når jeg inviterer ... Hvad er det, jeg inviterer til?" - Instagram's "collab". */
const COLLAB_HELP = `<small class="pr-help">Instagram sender en invitation til dem, du skriver her. Siger de ja, står opslaget på både Hjerterums og deres profil med begge navne, så både vores og deres følgere ser det. Siger de nej eller svarer ikke, står det kun hos Hjerterum. Højst 3, adskilt med komma.</small>`;

/** "Ugens events" as a reel, made by the weekly job (.github/workflows/ugens-reel.yml): the video, its words and its time; Instagram only. */
function reelCard(base: string, p: SocialPost): string {
  const locked = !open(p) || p.status === "approved";
  return `<article class="pr-post">
<header>${status(p)}<b>Ugens events som reel</b> <span class="small muted">Instagram</span></header>
${p.source.video ? `<video class="pr-reel" src="${esc(p.source.video)}" controls muted playsinline preload="metadata"></video>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>Teksten på Instagram</span><textarea name="text" rows="8"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
<label class="pr-field"><span>Vis også opslaget på deres Instagram (samarbejde)</span>${COLLAB_HELP}<input name="collaborators" value="${esc((p.source.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>
<div class="pr-row"><label class="pr-field pr-time"><span>Sendes</span><input type="datetime-local" name="at" value="${localInput(p.publish_at_ms)}"${locked ? " disabled" : ""}></label></div>
${actions(base, p, "Godkend")}</form></article>`;
}

/** Asked (the chair, 5 Nov 2026): "Dette opslag, der vises, er det her programsat eller skeduleret til et bestemt tidspunkt? Hvis det er det, kan det så ikke også
 * vises her?" - when the post goes out on each medium, whether it is planned (approved) or Saga's proposal, and a word when the time has passed. */
function timeLine(p: SocialPost, nowMs: number): string {
  if (!open(p) || !p.channels.length) return "";
  const fb = p.channels.includes("facebook") ? p.publish_at_ms : null;
  const ig = p.channels.includes("instagram") ? p.source.instagramAtMs ?? p.publish_at_ms : null;
  const parts = [fb ? `Facebook ${when(fb)}` : "", ig ? `Instagram ${when(ig)}` : ""].filter(Boolean);
  if (!parts.length) return "";
  const passed = [fb, ig].some(t => t && t < nowMs);
  const lead = p.status === "approved" ? "Planlagt" : "Saga foreslår";
  return `<p class="pr-when${passed ? " is-late" : ""}"><b>${lead}:</b> ${esc(fb && ig && fb === ig ? `Facebook og Instagram ${when(fb)}` : parts.join(" · "))}${passed
    ? `<span> Tidspunktet er passeret. ${p.status === "approved" ? "Saga sender det i næste runde." : "Godkender du, sendes det med det samme - eller vælg et nyt tidspunkt nedenfor."}</span>` : p.status === "approved" ? "" : `<span> Sendes først, når du har godkendt.${p.kind === "event" && p.source.shouts === 2 ? " Du godkender begge eventets opslag på én gang." : ""}</span>`}</p>`;
}

function weekCard(base: string, p: SocialPost, account: SocialAccount | null, monday: string, ai = false, nowMs = Date.now()): string {
  if (p.source.format === "reel") return reelCard(base, p);
  const locked = !open(p) || p.status === "approved";
  const head = p.kind === "week" ? `<b>Ugens events</b>` : `<b>${esc(p.source.title ?? "")}</b> <span class="small muted">${esc(p.source.startsMs ? `${dayName(p.source.startsMs)} ${Number(dateOf(p.source.startsMs).slice(8))}/${Number(dateOf(p.source.startsMs).slice(5, 7))} kl. ${clock(p.source.startsMs)}` : "")}${p.source.host ? ` · ${esc(p.source.host)}` : ""}</span>`;
  const allowed: Channel[] = account?.ig_user_id && p.images.length ? ["facebook", "instagram"] : ["facebook"];
  return `<article class="pr-post" id="opslag-${p.id}">
<header>${status(p)}${p.source.shout === 2 ? `<span class="chip">2. opslag · ugen før</span>` : p.kind === "event" && p.source.shouts === 2 ? `<span class="chip">1. opslag · to uger før</span>` : ""}${head}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">Link</a>` : ""}</header>
${timeLine(p, nowMs)}
${p.kind === "week" && p.images.length ? `<div class="pr-strip">${p.images.map(src => `<img src="${esc(src)}" alt="" loading="lazy">`).join("")}</div>` : ""}
${p.kind === "event" ? (() => { const studio = p.source.key ? studioIdOf(p.source.key) : null;
  return `<div class="pr-design">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="small muted">Intet billede</span>`}<span class="small muted">${p.source.design ? "Dit design" : "Eventets billede"}</span>
${studio && open(p) ? `<a class="button ghost" href="${base}/plakater/${esc(studio)}?fra=${encodeURIComponent(`/pr/uge?uge=${monday}#opslag-${p.id}`)}">${p.source.design ? "Skift design" : "Lav design"}</a>` : ""}</div>`; })() : ""}
${p.kind === "event" && p.source.video ? `<div class="pr-video"><video src="${esc(p.source.video)}" controls muted playsinline preload="metadata"></video><span class="small muted">Videoen til Instagram (reel)</span></div>` : ""}
<form method="post" action="${base}/pr/opslag/${p.id}">
<label class="pr-field"><span>${p.kind === "week" ? "Teksten på Facebook" : "Opslaget på Facebook"}</span><textarea name="text" rows="${p.kind === "week" ? 10 : 4}"${locked ? " disabled" : ""}>${esc(p.text)}</textarea></label>
${p.kind === "event" && allowed.includes("instagram") && p.channels.includes("instagram") ? `<label class="pr-field"><span>Teksten på Instagram</span><textarea name="instagram_text" rows="6"${locked ? " disabled" : ""}>${esc(p.source.instagramText ?? "")}</textarea></label>` : ""}
${p.kind === "event" ? writerRow(p, locked, ai) : ""}
${p.kind === "week" && allowed.includes("instagram") ? `<label class="pr-field"><span>Teksten på Instagram (billederne som karrusel)</span><textarea name="instagram_text" rows="10"${locked ? " disabled" : ""}>${esc(p.source.instagramText ?? "")}</textarea></label>
<label class="pr-field"><span>Vis også opslaget på deres Instagram (samarbejde)</span>${COLLAB_HELP}<input name="collaborators" value="${esc((p.source.collaborators ?? []).map(n => "@" + n).join(", "))}"${locked ? " disabled" : ""}></label>` : ""}
<div class="pr-row"><label class="pr-field pr-time"><span>${p.kind === "event" && allowed.includes("instagram") ? "Facebook sendes" : "Sendes"}</span><input type="datetime-local" name="at" value="${localInput(p.publish_at_ms)}"${locked ? " disabled" : ""}></label>
${p.kind === "event" && allowed.includes("instagram") ? `<label class="pr-field pr-time"><span>Instagram sendes (tomt: samtidig)</span><input type="datetime-local" name="instagram_at" value="${p.source.instagramAtMs ? localInput(p.source.instagramAtMs) : ""}"${locked ? " disabled" : ""}></label>` : ""}
${channelBoxes(p, allowed, locked)}</div>
${p.kind === "event" && p.source.video ? `<div class="pr-channels"><input type="hidden" name="video_box" value="1"><label><input type="checkbox" name="facebook_video" value="1"${p.source.noFacebookVideo ? "" : " checked"}${locked ? " disabled" : ""}> Video på Facebook (ellers billedet)</label><label><input type="checkbox" name="video" value="1"${p.source.noVideo ? "" : " checked"}${locked ? " disabled" : ""}> Video på Instagram (ellers billedet)</label></div>` : ""}
${actions(base, p, "Godkend")}</form></article>`;
}

/** Requested: "Jeg synes, at siden bliver ret rodet, når der er så meget indhold. Kan du ikke dele det op i underpunkter?" - PR og SoMe in tabs. */
export type PrTab = "overblik" | "kalender" | "events" | "tagget" | "beskeder" | "mails" | "uge" | "sendt";
export const PR_TABS: Array<[PrTab, string, string]> = [["overblik", "/pr", "Overblik"], ["kalender", "/pr/kalender", "Kalender"], ["events", "/pr/events", "Events"], ["tagget", "/pr/tagget", "Tagget i"], ["beskeder", "/pr/beskeder", "Beskeder"], ["mails", "/pr/mails", "Mails"], ["uge", "/pr/uge", "Ugens opslag"], ["sendt", "/pr/sendt", "Publiceret og indsigt"]];

/** Requested: "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside." Which website the posts and the newsletter link to. */
/** "Can we automatically delete reels that are outdated the day after the event has ended?" (social.ts deleteOldEventPosts): the chair's own yes, given here once. */
function deleteOldCard(base: string, on: boolean): string {
  return `<section class="panel"><header><h2>Opslag om events, der er forbi</h2></header>${on
    ? `<p><b>Slået til.</b> Dagen efter et event er slut (fra kl. 10), sletter Saga eventets opslag på Facebook og Instagram - reels, billeder og delte begivenheder. Det mest populære om hvert event (flest likes og kommentarer) bliver stående på hvert medie. "Ugens events" og delinger af andres opslag bliver stående. Du får besked på Telegram, og kalenderen viser, hvad der er slettet.</p>
<form method="post" action="${base}/pr/slet-gamle"><input type="hidden" name="on" value="0"><button class="ghost">Slå fra</button></form>`
    : `<p>Slår du dette til, sletter Saga dagen efter et event eventets opslag på Facebook og Instagram, så kun det mest populære om eventet bliver stående på hvert medie. En sletning kan ikke fortrydes, og likes og kommentarer forsvinder med opslaget.</p>
<form method="post" action="${base}/pr/slet-gamle" onsubmit="return confirm('Skal Saga slette et events opslag dagen efter eventet, så kun det mest populære bliver stående? Det kan ikke fortrydes.')"><input type="hidden" name="on" value="1"><button>Slet gamle eventopslag</button></form>`}</section>`;
}

/** "Når der ikke er godkendt et opslag, så deles selve eventet bare" (social.ts shareEventInstead): the chair's own yes, given here once. */
function shareEventCard(base: string, on: boolean): string {
  return `<section class="panel"><header><h2>Når et opslag ikke bliver godkendt</h2></header>${on
    ? `<p><b>Slået til.</b> Bliver et events opslag (14 eller 7 dage før) ikke godkendt i tide, udgiver Saga eventet selv på opslagets tid: eventets billede eller video med en kort indledning fra Saga og faste linjer (titel, tid, vært og tilmelding) på Facebook og Instagram. Du får besked på Telegram, og du kan stoppe det i kalenderen.</p>
<form method="post" action="${base}/pr/del-begivenhed"><input type="hidden" name="on" value="0"><button class="ghost">Slå fra</button></form>`
    : `<p>Bliver et events opslag ikke godkendt i tide, lægges det til side. Slår du dette til, udgiver Saga i stedet eventet selv ved både 14 og 7 dage før: eventets billede eller video med en kort indledning fra Saga og faste linjer - titel, tid, vært og tilmelding.</p>
<form method="post" action="${base}/pr/del-begivenhed" onsubmit="return confirm('Skal Saga udgive eventet selv (billede og fast tekst), når et events opslag ikke bliver godkendt i tide?')"><input type="hidden" name="on" value="1"><button>Udgiv eventet selv</button></form>`}</section>`;
}

function siteCard(base: string, live: boolean): string {
  return `<section class="panel"><header><h2>Hjemmesiden i opslagene</h2></header>${live
    ? `<p>Opslag og nyhedsbrev linker til den nye hjemmeside, <b>hjerterum.info</b>.</p>
<form method="post" action="${base}/pr/hjemmeside"><input type="hidden" name="live" value="0"><button class="ghost">Link til den gamle side igen</button></form>`
    : `<p>Opslag og nyhedsbrev linker til den gamle hjemmeside, <b>holistisk.org</b>, indtil I er begyndt at bruge den nye.</p>
<form method="post" action="${base}/pr/hjemmeside" onsubmit="return confirm('Er den nye hjemmeside i brug? Fra nu af linker opslag og nyhedsbrev til hjerterum.info.')"><input type="hidden" name="live" value="1"><button>Den nye hjemmeside er i brug</button></form>`}</section>`;
}

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

  const shares = d.shares.length ? d.shares.map(p => shareCard(base, p, a, d.aiReady)).join("") : `<p class="empty">Intet nyt. Saga kigger efter nye opslag, der tagger Hjerterum, hver halve time.</p>`;

  const tabs = d.weeks.map(w => `<a class="${w.monday === d.week.monday ? "on" : ""}" href="${base}/pr/uge?uge=${w.monday}">${esc(w.label)}</a>`).join("");
  const drafts = d.week.posts.filter(p => p.status === "draft" && p.channels.length && (p.publish_at_ms ?? Infinity) > d.nowMs).length;
  const eventCount = d.week.posts.filter(p => p.kind === "event").length;
  const week = d.week.posts.length
    ? `<div class="pr-acts">${drafts ? `<form method="post" action="${base}/pr/uge/godkend"><input type="hidden" name="uge" value="${d.week.monday}"><button>Godkend hele ugen (${drafts})</button></form>` : ""}
<form method="post" action="${base}/pr/uge/planlaeg"><input type="hidden" name="uge" value="${d.week.monday}"><button class="ghost">Tilføj nye events fra kalenderen</button></form></div>
<p class="small muted">"Ugens events" og ${eventCount} events med hvert sit opslag på Facebook. Et godkendt opslag går ud på sit tidspunkt; et event, der er begyndt, får ikke sit opslag bagefter.</p>
${d.week.posts.map(p => weekCard(base, p, a, d.week.monday, d.aiReady, d.nowMs)).join("")}`
    : `<p class="empty">Ugen er ikke planlagt endnu. Saga planlægger næste uge torsdag fra kl. 10.</p>
${a ? `<form method="post" action="${base}/pr/uge/planlaeg"><input type="hidden" name="uge" value="${d.week.monday}"><button>Lad Saga planlægge uge ${weekNumber(d.week.key)} nu</button></form>` : ""}`;

  const recent = d.recent.length ? `<ul class="pr-log">${d.recent.map(p => `<li><span class="at">${esc(when(p.published_at_ms ?? p.updated_at_ms))}</span><span>${status(p)} ${p.kind === "share" ? `Deling fra ${esc(p.source.author ?? "?")}` : p.kind === "week" ? "Ugens events" : esc(p.source.title ?? "Event")}
${p.source.removed ? `<small class="muted">Slettet igen: ${esc(p.source.removed.note)}</small>` : p.status === "published" ? `<small>${sentLinks(p)}</small>` : p.error ? `<small class="warn">${esc(p.error)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="empty">Intet publiceret endnu.</p>`;

  const waiting = d.shares.filter(p => !p.source.sharedAt).length;
  const count = (n: number) => n ? ` <span class="pr-count">${n}</span>` : "";
  const nav = `<nav class="pr-nav" aria-label="PR og SoMe">${PR_TABS.map(([key, path, label]) => `<a href="${base}${path}"${key === tab ? ' class="on" aria-current="page"' : ""}>${label}${key === "tagget" ? count(waiting) : key === "uge" ? count(drafts) : key === "kalender" && d.calendar ? count(d.calendar.posts.filter(p => p.status === "draft").length) : key === "mails" && d.mails ? count(d.mails.filter(m => !m.answered_at_ms && !m.handled_at_ms).length) : key === "beskeder" && d.messenger ? count(d.messenger.threads.filter(t => t.messages.length && !t.messages[t.messages.length - 1]!.fromPage && replyLeft(t, d.nowMs) > 0).length) : ""}</a>`).join("")}</nav>`;
  const sections: Record<PrTab, string> = {
    overblik: `${prPlanSection(base, d.plan)}
<section class="panel"><header><h2>Forbindelse</h2></header>${connection}</section>
${siteCard(base, Boolean(d.siteLive))}
${shareEventCard(base, Boolean(d.shareEvent))}
${deleteOldCard(base, Boolean(d.deleteOld))}`,
    kalender: d.calendar ? prCalendarSection(base, d.calendar) : "",
    mails: prMailSection(base, d.mails ?? [], d.mailEvents ?? [], d.nowMs),
    events: prEventsSection(base, d.events ?? [], d.nowMs),
    beskeder: messengerSection(base, { threads: d.messenger?.threads ?? [], error: d.messenger?.error ?? null, nowMs: d.nowMs }),
    tagget: `<section class="panel" id="tagget"><header><h2>Tagget i${d.shares.length ? ` (${d.shares.length})` : ""}</h2><p>Opslag, som undervisere og andre har tagget Hjerterum i. Del dem videre med et par ord fra Hjerterum.</p></header>${shares}</section>`,
    uge: `<section class="panel" id="uge"><header><h2>Ugens opslag</h2><p>${d.aiReady ? "Saga skriver ordene; du kan rette dem." : "Saga er ikke sat op, så teksterne er simple skabeloner, du kan rette."}</p></header><nav class="pr-tabs">${tabs}</nav>${week}</section>`,
    sendt: `<section class="panel" id="sendt"><header><h2>Publiceret og fejlet</h2></header>${recent}</section>
${insightSection(d.insight)}`
  };
  const body = `<main class="pr"><div class="hero"><h1>PR og sociale medier</h1>
${tab === "overblik" ? `<p>Saga gør alle opslag klar - delinger af det, Hjerterum er tagget i, et opslag for hvert event, Ugens events og ugens reel - og du godkender. Intet sendes uden dit ja. Kun for formanden indtil videre.</p>` : ""}</div>
${nav}
${d.notice ? `<p class="notice good">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice warn">${esc(d.error)}</p>` : ""}
${sections[tab]}</main>${tab === "uge" || tab === "tagget" ? WRITER_SCRIPT(base) : ""}`;
  return layout(base, "PR og sociale medier", body, { section: "/pr", who, style: STYLE + PLAN_STYLE + INSIGHT_STYLE + PR_EVENTS_STYLE + PR_CALENDAR_STYLE + PR_MAIL_STYLE + PR_MESSENGER_STYLE });
}

const STYLE = `.pr{display:grid;gap:20px}.pr-nav{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:0 0 12px}.pr-nav a{padding:8px 16px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14.5px;color:var(--ink);background:var(--card);box-shadow:var(--shadow)}.pr-nav a.on{background:var(--ink);color:var(--card)}.pr-count{display:inline-block;min-width:20px;padding:0 6px;margin-left:4px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:12px;text-align:center}.pr-tabs{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap}.pr-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-size:14px}.pr-tabs a.on{background:var(--ink);color:var(--card)}
/* "Her mangler jeg en klar adskillelse mellem eventsene. Det kan være en svag forskel i baggrundsfarven." */.pr-post{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 14px;scroll-margin-top:90px}.pr-post:nth-of-type(even){background:var(--card)}.pr-post header{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin:0 0 10px}
.pr-orig{display:flex;gap:14px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:12px;margin:0 0 12px}.pr-orig img{width:96px;height:96px;object-fit:cover;border-radius:10px;flex:none}.pr-orig p{margin:0;font-size:14px;white-space:pre-line}
.pr-design{display:flex;align-items:center;gap:12px;margin:0 0 12px}.pr-video{display:flex;align-items:flex-end;gap:12px;margin:0 0 12px}.pr-video video{width:160px;aspect-ratio:9/16;border-radius:12px;background:#000}.pr-design img{width:72px;height:90px;object-fit:cover;border-radius:10px}.pr-reel{display:block;width:100%;max-width:270px;aspect-ratio:9/16;border-radius:14px;background:#000;margin:0 0 12px}.pr-strip{display:flex;gap:6px;overflow-x:auto;margin:0 0 12px}.pr-strip img{height:72px;border-radius:8px}
.pr-when{margin:0 0 12px;padding:8px 12px;border-radius:10px;background:var(--tint);font-size:14.5px}.pr-when span{color:var(--muted)}.pr-when.is-late{background:var(--warn-soft)}.pr-when.is-late span{color:var(--warn)}
.pr-writer{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.pr-writer input{flex:1 1 220px;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}.pr-writer [role=status]{flex-basis:100%}
/* Requested (the chair, 5 Nov 2026): "Her bør det aktuelle felt highlightes alt efter, hvilket social medie der er valgt. Hvis det kun er Instagram, skal der være en
 guldmarkering omkring tekstfeltet og vice versa." The text that goes out has a gold frame; the one for a medium that is not chosen fades. */
.pr-post form:has(input[name=channel][value=facebook]:checked) textarea[name=text],.pr-post form:has(input[name=channel][value=instagram]:checked) textarea[name=instagram_text]{border:2px solid #c9a14a;box-shadow:0 0 0 3px rgba(201,161,74,.18)}
.pr-post form:has(textarea[name=instagram_text]):not(:has(input[name=channel][value=facebook]:checked)) .pr-field:has(textarea[name=text]),.pr-post form:not(:has(input[name=channel][value=instagram]:checked)) .pr-field:has(textarea[name=instagram_text]){opacity:.5}
.pr-post form:has(textarea[name=instagram_text]):not(:has(input[name=channel][value=facebook]:checked)) .pr-field:has(textarea[name=text])>span::after,.pr-post form:not(:has(input[name=channel][value=instagram]:checked)) .pr-field:has(textarea[name=instagram_text])>span::after{content:" · sendes ikke"}
.pr-field{display:block;margin:0 0 10px}.pr-help{display:block;font-size:12.5px;color:var(--muted);margin:0 0 6px}.pr-field span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}.pr-field textarea,.pr-field input{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
.pr-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end}.pr-time{max-width:260px}.pr-channels{display:flex;gap:18px;margin:0 0 10px}.pr-channels label{display:inline-flex;align-items:center;gap:7px;font-size:14px;cursor:pointer}.pr-channels input{width:18px;height:18px;min-height:0;margin:0;padding:0;accent-color:var(--accent);flex:none}
.pr-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}.pr-acts form{margin:0}
.pr-log{list-style:none;margin:0;padding:0}.pr-log li{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}.pr-log li:first-child{border-top:0}.pr-log .at{color:var(--muted);font-size:13px}.pr-log small{display:block}
@media (max-width:760px){.pr-log li{grid-template-columns:1fr;gap:2px}.pr-orig img{width:64px;height:64px}}`;
