import { markdownToHtml } from "../saga/markdown.js";
import type { BoardPicture } from "../saga/picture.js";
import { tasksByPerson, type ApprovedMinutes, type Decision, type GroupNow, type Meeting, type Task } from "./data.js";

/** The board cockpit's pages, written on the server as plain HTML: quick on a phone, nothing to
 * install, and nothing of the board's in a script. Every value from the database is escaped. */

export const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const DANISH_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const DANISH_SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "torsdag den 8. oktober 2026" - the weekday from the date itself, never guessed. */
export const longDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_DAY.format(new Date(`${iso}T12:00:00Z`)) : iso;
export const shortDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_SHORT.format(new Date(`${iso}T12:00:00Z`)) : iso;

const STYLE = `
:root{--bg:#f4f2ec;--card:#fffdf8;--ink:#1b1e1c;--muted:#5c635f;--faint:#8a908c;--line:#e6e1d6;--accent:#1f4d42;--accent-2:#2e6a5a;--accent-ink:#fff;--soft:#efebe2;--tint:#e4ece7;
--good:#2c6e50;--warn:#9c4f17;--warn-soft:#f8ecdf;--shadow:0 1px 0 rgba(20,24,22,.03);--radius:18px;--nav-h:66px;--bar:#1d443a;--bar-ink:#f4f1e9;--serif:"Fraunces",Georgia,"Times New Roman",serif}
@media (prefers-color-scheme:dark){:root{--bg:#0e1110;--card:#151a18;--ink:#eceeec;--muted:#a3aba7;--faint:#7c8481;--line:#242b28;--accent:#93cdb8;--accent-2:#6fb39d;--accent-ink:#0c1311;--soft:#1c2220;--tint:#1a2924;
--good:#91d3ab;--warn:#eaa46b;--warn-soft:#2d221a;--shadow:none;--bar:#142b25;--bar-ink:#eef0ec}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.6 "Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}
/* Requested: "Og brug gerne vores hvide logo" and a calmer, more considered design: a deep green bar with
   Hjerterum's white logo, five fixed places, and nothing in the bar that shrinks or wraps. */
header.bar{position:sticky;top:0;z-index:10;background:var(--bar);color:var(--bar-ink);box-shadow:0 1px 0 rgba(0,0,0,.08)}
.top{max-width:1120px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:22px}
.brand{display:flex;align-items:center;gap:11px;text-decoration:none;color:var(--bar-ink);white-space:nowrap;flex:none}
.brand img{width:38px;height:38px;flex:none;display:block}
.brand b{font-family:var(--serif);font-weight:600;font-size:20px;letter-spacing:-.01em}.brand .names span{font-size:11px;opacity:.7;letter-spacing:.1em;text-transform:uppercase;font-weight:600}
.brand .names{display:grid;line-height:1.1}
nav.desk{display:flex;gap:2px;flex:1;min-width:0}nav.desk a{padding:8px 13px;border-radius:999px;text-decoration:none;color:color-mix(in srgb,var(--bar-ink) 78%,transparent);font-weight:550;font-size:14px;white-space:nowrap}
nav.desk a:hover{color:var(--bar-ink);background:rgba(255,255,255,.08)}nav.desk a.on{background:var(--bar-ink);color:var(--bar)}
.me{display:flex;align-items:center;gap:10px;font-size:13px;margin-left:auto;flex:none}.me .who-name{white-space:nowrap;opacity:.8}
.avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.14);color:var(--bar-ink);display:grid;place-items:center;font-weight:700;font-size:13px;text-decoration:none}
@media (max-width:1100px){.me .who-name{display:none}}@media (max-width:920px){.brand .names span{display:none}nav.desk a{padding:8px 10px}}
nav.tabs{display:none}
main{max-width:1120px;margin:0 auto;padding:28px 20px 72px;display:grid;gap:18px}
h1{font-family:var(--serif);font-size:36px;line-height:1.1;margin:0;letter-spacing:-.015em;font-weight:600}h2{font-family:var(--serif);font-size:21px;margin:0 0 14px;font-weight:600;letter-spacing:-.005em}
h3{font-size:11.5px;margin:18px 0 8px;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;font-weight:650}h3:first-child{margin-top:0}
.hero{display:grid;gap:10px;margin-bottom:4px}.hero p{margin:0;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chips a,.chips span{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--card);box-shadow:var(--shadow);font-size:13.5px;font-weight:550;color:var(--ink);text-decoration:none}
.chips .hot{background:var(--warn-soft);color:var(--warn);box-shadow:none}.chips b{font-weight:750}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:18px;align-items:start}
.card{background:var(--card);border-radius:var(--radius);padding:24px 26px;min-width:0;box-shadow:var(--shadow);border:1px solid var(--line)}
.muted{color:var(--muted)}.small{font-size:13.5px}.pill{display:inline-block;font-size:12px;font-weight:650;padding:2px 9px;border-radius:999px;background:var(--soft);color:var(--muted);white-space:nowrap}
ul.plain{list-style:none;margin:0;padding:0;display:grid}ul.plain li{padding:12px 0;border-bottom:1px solid var(--line)}ul.plain li:first-child{padding-top:2px}ul.plain li:last-child{border-bottom:0;padding-bottom:0}
ul.plain li>a:only-child,ul.plain li>a:first-child:last-child{display:flex;justify-content:space-between;align-items:center;text-decoration:none;font-weight:600;min-height:28px}
ul.plain li>a:only-child::after{content:"›";color:var(--faint);font-size:22px;line-height:1;font-weight:400}
ol.agenda{margin:0;padding-left:22px}ol.agenda li{margin:4px 0}ol.agenda li::marker{color:var(--faint);font-weight:600}
.doc h1{font-size:20px}.doc h2{font-size:16px;margin-top:18px}.doc h3{font-size:11.5px}.doc ul{padding-left:20px}.doc p{margin:6px 0}
form.stack{display:grid;gap:12px}label{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--muted)}
input,textarea,select{font:inherit;font-size:16px;font-weight:400;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:11px 13px;width:100%;min-height:46px}
input:focus,textarea:focus,select:focus{outline:3px solid color-mix(in srgb,var(--accent) 25%,transparent);border-color:var(--accent);background:var(--card)}
textarea{min-height:130px;resize:vertical}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1 1 160px}
button,.button{font:inherit;font-weight:650;font-size:14.5px;border:0;border-radius:12px;padding:12px 18px;min-height:46px;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
button:hover,.button:hover{filter:brightness(1.07)}button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}button.ghost:hover{background:var(--soft);filter:none}
.notice{padding:13px 16px;border-radius:14px;background:var(--tint);color:var(--ink)}.notice.good{color:var(--good)}.notice.warn{background:var(--warn-soft);color:var(--warn)}
details{border-top:1px solid var(--line);padding:10px 0}details>summary{cursor:pointer;font-weight:600;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"+";display:inline-block;width:18px;color:var(--faint)}details[open]>summary::before{content:"–"}
.center{max-width:420px;margin:12vh auto;padding:0 16px}.mark{width:64px;height:64px;border-radius:50%;background:var(--bar);display:grid;place-items:center;margin:0 0 18px}.mark img{width:48px;height:48px}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14.5px}th{font-size:11.5px;color:var(--faint);font-weight:650;text-transform:uppercase;letter-spacing:.06em}
tr:last-child td{border-bottom:0}
[hidden]{display:none!important}.actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.wide{grid-column:1/-1}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px 30px;align-items:start}.block{min-width:0}
.chip{display:inline-block;font-size:10.5px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px;background:var(--soft);color:var(--muted);margin-right:4px}
.chip.good{color:var(--good);background:var(--tint)}.chip.wait{color:var(--warn);background:var(--warn-soft)}.waits,.warn{color:var(--warn);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:4px 0 12px}.stats div{background:var(--soft);border-radius:14px;padding:12px 14px}
.stats b{display:block;font-size:24px;letter-spacing:-.02em}.stats span{font-size:12px;color:var(--muted)}ul.msgs li{white-space:pre-wrap;word-break:break-word}
details summary .pill{margin-left:4px}.card>ul:not(.plain){padding-left:20px;margin:4px 0}
.menu{display:grid}.menu a,.menu button{display:flex;justify-content:space-between;align-items:center;padding:16px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink);font-weight:600;font-size:16px;background:none;border-radius:0;min-height:56px;width:100%}
.menu a::after,.menu button::after{content:"›";color:var(--faint);font-size:22px;font-weight:400}
@media (max-width:760px){
  nav.desk,.me .who-name{display:none}.top{padding:9px 16px}.brand img{width:34px;height:34px}h1{font-size:30px}
  nav.tabs{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;z-index:15;height:calc(var(--nav-h) + env(safe-area-inset-bottom));padding:6px 4px env(safe-area-inset-bottom);
    background:color-mix(in srgb,var(--card) 90%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-top:1px solid var(--line)}
  nav.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-decoration:none;color:var(--faint);font-size:11px;font-weight:600;border-radius:12px}
  nav.tabs a svg{width:22px;height:22px}nav.tabs a.on{color:var(--accent)}
  main{padding:18px 14px calc(var(--nav-h) + 96px + env(safe-area-inset-bottom));gap:14px}h1{font-size:27px}
  .grid{grid-template-columns:1fr;gap:14px}.card{padding:18px;border-radius:18px}.cols{grid-template-columns:1fr}
  table.rows tr:first-child{display:none}table.rows tr{display:block;padding:12px 0;border-bottom:1px solid var(--line)}table.rows tr:last-child{border-bottom:0}
  table.rows td{display:block;border:0;padding:2px 0}table.rows td[data-label]::before{content:attr(data-label);display:block;font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .actions{justify-content:stretch}.actions>*{flex:1}
}
`;

const ICONS: Record<string, string> = {
  "/": '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  "/moder": '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  "/status": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  "/beslutninger": '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14l2 2 4-4"/>',
  "/opgaver": '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  "/arrangementer": '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  "/mere": '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
const icon = (key: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] ?? ""}</svg>`;

/** Requested: "Lav et mere moderne layout og som er mobilvenligt". A top bar on a computer; on a phone
 * a fixed tab bar at the bottom (Overblik, Møder, Status, Arrangementer, Mere), large touch targets
 * and tables that become stacked rows. */
export function layout(base: string, title: string, body: string, options: { section?: string; who?: string | null; style?: string } = {}): string {
  // Requested: "Er du sikker på, at det er gennemtænkt? ... Jeg synes stadig, det virker rodet." Five places,
  // the same on a computer and a phone; Status and Arkiv are reached from Overblik and Møder, you from your initials.
  const places = [["/", "Overblik"], ["/opgaver", "Opgaver"], ["/moder", "Møder"], ["/beslutninger", "Beslutninger"], ["/arrangementer", "Arrangementer"]];
  const parent: Record<string, string> = { "/status": "/", "/arkiv": "/moder" };
  const here = parent[options.section ?? ""] ?? options.section;
  const desk = places.map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
  // On a phone the five labels must fit side by side.
  const short: Record<string, string> = { "/beslutninger": "Besluttet", "/arrangementer": "Huset" };
  const tabs = places.map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}>${icon(path!)}<span>${short[path!] ?? label}</span></a>`).join("");
  const initials = (options.who ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f3f4f1" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0f1211" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=Fraunces:opsz,wght@9..144,500..700&display=swap">
<title>${esc(title)} · Hjerterum bestyrelse</title><style>${STYLE}${options.style ?? ""}</style></head><body>
${options.section === undefined ? "" : `<header class="bar"><div class="top"><a class="brand" href="${base}/"><img src="${base}/logo.png" alt="" width="38" height="38"><span class="names"><b>Hjerterum</b><span>Bestyrelsen</span></span></a><nav class="desk" aria-label="Menu">${desk}</nav>
<div class="me">${options.who ? `<span class="who-name">${esc(options.who)}</span>` : ""}<a class="avatar" href="${base}/profil" title="${esc(options.who ? `${options.who} · profil og log ud` : "Vælg hvem du er")}">${esc(initials)}</a></div></div></header>
<nav class="tabs" aria-label="Menu">${tabs}</nav>`}
${body}${options.section === undefined ? "" : sagaChat(base)}</body></html>`;
}

/** The phone's "Mere": the pages that do not fit the tab bar, and who you are. */
export function morePage(base: string, who: string | null, options: { locked?: boolean; members?: string[]; done?: string | null } = {}): string {
  // Logged in with Saga's personal link you are who you are; the chair can close a member's access.
  const me = options.locked ? `<span class="muted" style="padding:12px 0;display:block">Logget ind som ${esc(who ?? "")}</span>`
    : `<a href="${base}/hvem">${who ? `Du er ${esc(who)} · skift` : "Vælg hvem du er"}</a>`;
  const access = options.members?.length ? `<div class="card"><h2>Adgang</h2><p class="small muted">Luk et medlems adgang: deres login på alle enheder ophører, og de skal bede Saga om et nyt link.</p>
${options.done ? `<p class="notice">${esc(options.done)}s adgang er lukket.</p>` : ""}<ul class="plain">${options.members.map(m => `<li style="display:flex;justify-content:space-between;align-items:center;gap:12px">${esc(m)}
<form method="post" action="${base}/adgang" style="margin:0"><input type="hidden" name="member" value="${esc(m)}"><button class="ghost">Luk adgang</button></form></li>`).join("")}</ul></div>` : "";
  return layout(base, "Profil", `<main><h1>${esc(who ?? "Profil")}</h1><div class="card"><div class="menu">
<a href="${base}/status">Sagas fulde overblik</a><a href="${base}/arkiv">Ældre referater</a>${me}
<form method="post" action="${base}/logout" style="margin:0"><button class="ghost" style="border:0">Log ud</button></form></div></div>${access}</main>`, { section: "/profil", who });
}

const SAGA_STYLE = `
.saga-fab{position:fixed;right:18px;bottom:18px;z-index:20;border-radius:999px;padding:12px 18px;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;gap:8px;align-items:center}
.saga-fab::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent-ink);opacity:.85}
.saga{position:fixed;right:18px;bottom:18px;z-index:21;width:min(400px,calc(100vw - 24px));height:min(600px,calc(100vh - 36px));background:var(--card);border:1px solid var(--line);
border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
.saga[hidden]{display:none!important}.saga-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}.saga-top div{flex:1;line-height:1.25}
.saga-top button{padding:4px 10px}.saga-log{flex:1;overflow-y:auto;padding:14px;display:grid;gap:10px;align-content:start}
.saga-msg{padding:9px 12px;border-radius:12px;max-width:92%;word-break:break-word}.saga-msg p{margin:0 0 6px}.saga-msg p:last-child{margin:0}.saga-msg ul{margin:4px 0;padding-left:18px}
.saga-msg h1,.saga-msg h2,.saga-msg h3{font-size:14px;margin:6px 0 4px}.saga-a{background:var(--soft)}.saga-u{background:var(--accent);color:var(--accent-ink);justify-self:end;white-space:pre-wrap}
.saga-wait{color:var(--muted);font-style:italic}.saga-err{color:var(--warn)}.saga-ideas{display:flex;flex-wrap:wrap;gap:6px}
.saga-ideas button{background:transparent;color:var(--accent);border:1px solid var(--line);font-weight:500;font-size:13px;padding:6px 10px;text-align:left}
.saga form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}.saga textarea{min-height:44px;max-height:140px;resize:none;flex:1}
@media (max-width:760px){.saga{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0;z-index:30}.saga-fab{right:14px;bottom:calc(var(--nav-h) + 14px + env(safe-area-inset-bottom));padding:11px 16px}}
@media print{.saga,.saga-fab{display:none!important}}`;

const IDEAS = ["Hvad siger vedtægterne om forslag til generalforsamlingen?", "Hvilke beslutninger har vi truffet om medlemskab?", "Hvilke sager hænger lige nu?", "Hvilke arrangementer er der de næste to uger?", "Hvor mange medlemmer har vi?"];

/** Saga in the bottom-right corner of every page. The conversation lives in this tab only. */
function sagaChat(base: string): string {
  return `<style>${SAGA_STYLE}</style><button type="button" class="saga-fab" id="saga-open" aria-expanded="false" aria-controls="saga">Spørg Saga</button>
<section class="saga" id="saga" hidden aria-label="Spørg Saga"><div class="saga-top"><div><strong>Saga</strong><br><span class="small muted">Bestyrelsens assistent · svaret ses kun af dig</span></div>
<button type="button" class="ghost" id="saga-new" title="Start en ny samtale">Ny samtale</button><button type="button" class="ghost" id="saga-close" aria-label="Luk">Luk</button></div>
<div class="saga-log" id="saga-log" aria-live="polite"><div class="saga-msg saga-a">Hej, jeg er Saga. Spørg mig om vedtægterne, beslutninger, sager, møder, arrangementer og medlemstal.</div>
<div class="saga-ideas">${IDEAS.map(idea => `<button type="button">${esc(idea)}</button>`).join("")}</div></div>
<form id="saga-form"><textarea id="saga-q" rows="1" maxlength="1500" placeholder="Skriv dit spørgsmål" aria-label="Dit spørgsmål"></textarea><button>Send</button></form></section>
<script>(()=>{const url=${JSON.stringify(`${base}/saga`)},box=document.getElementById("saga"),fab=document.getElementById("saga-open"),log=document.getElementById("saga-log"),form=document.getElementById("saga-form"),q=document.getElementById("saga-q");
// Requested: "Sørg også for, at chatten med Saga nulstilles inden for normale standarder": after 30 minutes
// without a question the conversation starts over, and "Ny samtale" starts one at once.
const IDLE=30*60*1000;let history=[];try{const kept=JSON.parse(sessionStorage.getItem("saga-chat")||"null");if(kept&&Array.isArray(kept.h)&&Date.now()-Number(kept.t||0)<IDLE)history=kept.h}catch(e){}
const save=()=>{try{sessionStorage.setItem("saga-chat",JSON.stringify({t:Date.now(),h:history.slice(-12)}))}catch(e){}};
document.getElementById("saga-new").onclick=()=>{history=[];try{sessionStorage.removeItem("saga-chat")}catch(e){}log.querySelectorAll(".saga-msg:not(:first-child)").forEach(m=>m.remove());q.focus()};
const add=(cls,content,isHtml)=>{const d=document.createElement("div");d.className="saga-msg "+cls;if(isHtml)d.innerHTML=content;else d.textContent=content;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
for(const t of history)add(t.role==="user"?"saga-u":"saga-a",t.role==="user"?t.content:t.html||t.content,t.role!=="user");
const open=v=>{box.hidden=!v;fab.hidden=v;fab.setAttribute("aria-expanded",String(v));if(v)q.focus()};
fab.onclick=()=>open(true);document.getElementById("saga-close").onclick=()=>open(false);
let busy=false;
async function ask(text){if(busy||!text.trim())return;busy=true;log.querySelector(".saga-ideas")?.remove();add("saga-u",text);q.value="";const wait=add("saga-a saga-wait","Saga tænker …");
const sent=history.slice(-6).map(t=>({role:t.role,content:t.content}));
try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:text,history:sent})});const data=await r.json().catch(()=>({}));
if(r.ok&&data.html){wait.className="saga-msg saga-a";wait.innerHTML=data.html;history.push({role:"user",content:text},{role:"assistant",content:wait.textContent,html:data.html});save()}
else{wait.className="saga-msg saga-a saga-err";wait.textContent=data.error||(r.status===401?"Du er logget ud. Genindlæs siden.":"Saga kunne ikke svare lige nu.")}}
catch(e){wait.className="saga-msg saga-a saga-err";wait.textContent="Ingen forbindelse. Prøv igen."}
busy=false;log.scrollTop=log.scrollHeight}
form.onsubmit=e=>{e.preventDefault();ask(q.value)};q.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask(q.value)}};
log.querySelectorAll(".saga-ideas button").forEach(b=>b.onclick=()=>{ask(b.textContent)});
if(history.length)log.querySelector(".saga-ideas")?.remove();})()</script>`;
}

export function loginPage(base: string, message: string, configured: boolean, telegram: string | null = null): string {
  // Requested: the account locked to the member - "1.": Saga's personal link first, the shared password (while it lasts) below.
  const personal = telegram ? `<a class="button" href="${esc(telegram)}" target="_blank" rel="noopener">Få dit login fra Saga på Telegram</a>
<p class="small muted">Saga sender dig et personligt link, der logger dig ind som dig. Det virker én gang inden for 15 minutter. Du kan også skrive /login til hende.</p>` : "";
  const password = configured ? `<form class="stack" method="post" action="${base}/login"><label>Fælles adgangskode<input type="password" name="password" autocomplete="current-password" required${personal ? "" : " autofocus"}></label>
<button${personal ? ' class="ghost"' : ""}>Log ind</button></form>` : "";
  return layout(base, "Log ind", `<div class="center"><div class="card"><div class="mark"><img src="${base}/logo.png" alt="Hjerterum"></div><h1>Hjerterum bestyrelse</h1>
<p class="muted">Bestyrelsens cockpit med møder, referater og beslutninger.</p>
${message ? `<p class="notice warn">${esc(message)}</p>` : ""}${personal}${personal && password ? `<p class="small muted" style="margin:18px 0 6px">Eller med den fælles adgangskode</p>` : ""}${password}
${personal || password ? "" : `<p class="notice warn">Cockpittet er ikke sat op endnu: formanden mangler at vælge den fælles adgangskode.</p>`}</div></div>`);
}

/** Saga's personal link: one press logs in, so a link preview in Telegram never does. */
export function linkPage(base: string, member: string | null, token: string): string {
  return layout(base, "Log ind", `<div class="center"><div class="card"><div class="mark"><img src="${base}/logo.png" alt="Hjerterum"></div><h1>Hjerterum bestyrelse</h1>
${member ? `<p>Du logger ind som <strong>${esc(member)}</strong>.</p><form method="post" action="${base}/login/link/${esc(token)}"><button>Log ind</button></form>`
    : `<p class="notice warn">Linket er brugt eller udløbet. Skriv /login til Saga på Telegram for et nyt.</p><p><a href="${base}/">Til login</a></p>`}</div></div>`);
}

export function whoPage(base: string, names: string[], current: string | null): string {
  return layout(base, "Hvem er du?", `<main><div class="card" style="max-width:520px"><h1>Hvem er du?</h1>
<p class="muted">Så viser overblikket dine egne opgaver. Valget huskes på denne enhed.</p>
<form class="stack" method="post" action="${base}/hvem">${names.length ? names.map(name => `<label style="flex-direction:row;display:flex;align-items:center;gap:8px;font-weight:500">
<input type="radio" name="who" value="${esc(name)}" style="width:auto"${name === current ? " checked" : ""} required> ${esc(name)}</label>`).join("")
    : `<label>Dit navn<input name="who" required maxlength="60" value="${esc(current ?? "")}"></label>`}
<button>Fortsæt</button></form></div></main>`, { section: "", who: current });
}

const taskLine = (task: Task) => `<li>${task.who ? `<strong>${esc(task.who)}</strong> · ` : ""}${esc(task.what)}${task.due ? ` <span class="pill">${esc(task.due)}</span>` : ""}
${task.meeting ? `<div class="small muted">${task.source === "referat" ? "Fra referatet" : "Fra referatdokumentet"} ${esc(/^\d{4}-/.test(task.meeting) ? shortDay(task.meeting) : task.meeting)}</div>` : ""}</li>`;

function meetingSummary(base: string, m: Meeting): string {
  const items = m.agenda.split("\n").filter(Boolean);
  return `<p><strong>${esc(longDay(m.meeting_date))}</strong>${m.start_time ? ` kl. ${esc(m.start_time)}` : ""}${m.place ? ` · ${esc(m.place)}` : ""}</p>
${items.length ? `<ol class="agenda">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ol>` : `<p class="muted small">Ingen dagsorden endnu.</p>`}
<p class="small"><a href="${base}/moder/${m.id}">Ret dagsorden</a></p>`;
}

const md = (text: string) => /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(text))?.[1] ?? "";
const day = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) ? shortDay(text) : text;
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
const inDays = (n: number) => n <= 0 ? "i dag" : n === 1 ? "i morgen" : `om ${n} dage`;
const clock = (ms: number) => new Date(ms).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const SOURCE: Record<string, string> = { telegram: "gruppen", dokument: "referatdokumentet", mail: "team@" };
const STATUS_CLASS: Record<string, string> = { besluttet: "good", "på vej": "good", afventer: "wait", udsat: "wait", "ingen opfølgning": "wait" };
const chip = (status: string) => `<span class="chip ${STATUS_CLASS[status] ?? ""}">${esc(status)}</span>`;
const block = <T>(title: string, items: T[], line: (item: T) => string, empty = "") => items.length || empty
  ? `<div class="block"><h3>${title}</h3>${items.length ? `<ul class="plain">${items.map(item => `<li>${line(item)}</li>`).join("")}</ul>` : `<p class="muted small">${empty}</p>`}</div>` : "";
const agendaFill = (items: string[]) => items.length
  ? `<button type="button" class="ghost" data-fill="${esc(JSON.stringify(items))}">Indsæt Sagas forslag (${items.length} punkt${items.length === 1 ? "" : "er"})</button>` : "";
const FILL_SCRIPT = `<script>document.querySelectorAll("[data-fill]").forEach(b=>b.addEventListener("click",()=>{const t=b.form.querySelector("textarea");const add=JSON.parse(b.dataset.fill).filter(x=>!t.value.includes(x));t.value=(t.value.trim()?t.value.trim()+"\\n":"")+add.join("\\n");t.focus()}))</script>`;

export type MinutesState = "working" | "waiting" | "failed";
const STATE_TEXT: Record<MinutesState, string> = { working: "Saga skriver referatet", waiting: "Lægges op om lidt", failed: "Referatet kunne ikke laves - upload igen" };

export type OverviewData = { who: string | null; isChair: boolean; toSign: ApprovedMinutes[]; mine: Task[]; ownTodos?: Array<{ text: string; due: string | null; created_by: string }>; everyone: Task[]; forChair: BoardPicture["forJacob"]; next: Meeting | null;
  found: Array<{ date: string; what: string }>; picture: BoardPicture | null; summary: string | null; at: number | null; progress: { working: number; waiting: number }; today: string;
  group: GroupNow | null; weekly: { text: string; created_at_ms: number } | null; recent: Array<{ id: number; date: string; decisions: string[]; tasks: number }>; docUrl: string | null };

function foundMeetings(base: string, found: OverviewData["found"], today: string): string {
  return found.length ? `<h3>Fundet af Saga</h3><ul class="plain">${found.map(f => `<li><strong>${esc(longDay(f.date))}</strong> <span class="pill">${inDays(daysUntil(f.date, today))}</span>
<div class="small muted">${esc(f.what)}</div><a class="small" href="${base}/moder?dato=${esc(f.date)}&amp;forslag=1#nyt">Sæt i kalenderen</a></li>`).join("")}</ul>` : "";
}

function groupCard(g: GroupNow | null, p: BoardPicture | null, isChair: boolean): string {
  if (!g && !p) return "";
  const a = g?.activity;
  const stats = a ? `<div class="stats"><div><b>${a.thisWeek}</b><span>beskeder denne uge</span></div><div><b>${a.lastWeek}</b><span>ugen før</span></div><div><b>${a.members.length}</b><span>har skrevet i ugen</span></div></div>
${a.members.length ? `<p class="small muted">Aktive: ${a.members.map(m => `${esc(m.name.split(/\s+/)[0])} (${m.count})`).join(", ")}</p>` : ""}` : "";
  const topics = p?.topics.length ? `<ul class="plain">${p.topics.map(t => `<li>${chip(t.status)} <strong>${esc(t.title)}</strong>${t.waitsOnJacob ? ` <span class="waits">· venter på ${isChair ? "dig" : "formanden"}</span>` : ""}
${t.note || t.who.length ? `<div class="small muted">${esc(t.note)}${t.note && t.who.length ? " · " : ""}${esc(t.who.join(", "))}</div>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted small">Ingen emner i gruppen de seneste to uger.</p>`;
  const recent = g?.recent.length ? `<details><summary>Seneste beskeder (${g.recent.length})</summary><ul class="plain msgs">${g.recent.map(m => `<li><div class="small muted">${esc(m.author)} · ${esc(clock(m.at))}${m.link ? ` · <a href="${esc(m.link)}" target="_blank" rel="noopener">åbn</a>` : ""}</div>${esc(m.text)}</li>`).join("")}</ul></details>` : "";
  return `<div class="card"><h2>Gruppen lige nu</h2>${stats}${topics}${recent}
${g?.link ? `<p class="small"><a href="${esc(g.link)}" target="_blank" rel="noopener">Åbn gruppen i Telegram</a></p>` : ""}</div>`;
}

function documentCard(base: string, p: BoardPicture | null, everyone: Task[], docUrl: string | null, today: string): string {
  if (!p) return "";
  const d = p.document;
  const head = [d.latestMeeting ? `Seneste referat: <strong>${esc(day(d.latestMeeting))}</strong>` : "", d.missingMinutes.length ? `<span class="warn">Referat mangler: ${esc(d.missingMinutes.map(day).join(", "))}</span>` : ""].filter(Boolean).join(" · ");
  const dates = d.dates.filter(x => x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const people = tasksByPerson(everyone);
  const blocks = [
    block("Kommende datoer", dates, x => `<strong>${esc(shortDay(x.date))}</strong> <span class="pill">${inDays(daysUntil(x.date, today))}</span><div class="small">${esc(x.what)}</div>`),
    block("Nøgletal", d.figures, x => `${esc(x.label)}: <strong>${esc(x.value)}</strong><div class="small muted">${esc([x.date ? day(x.date) : "", x.previous ? `før: ${x.previous}` : ""].filter(Boolean).join(" · "))}</div>`),
    block("Gældende beslutninger", d.decisions, x => `${x.topic ? `<strong>${esc(x.topic)}:</strong> ` : ""}${esc(x.text)}${x.date ? ` <span class="small muted">${esc(day(x.date))}</span>` : ""}${x.replaces ? `<div class="small muted">Afløser: ${esc(x.replaces)}</div>` : ""}`),
    block("Hængepartier", d.openThreads, x => `${chip(x.status)} ${esc(x.text)}${x.since ? `<div class="small muted">Siden ${esc(day(x.since))}</div>` : ""}`),
    people.length ? `<div class="block"><h3>Hvem har hvad</h3>${people.map(g => `<details${people.length <= 4 ? " open" : ""}><summary>${esc(g.who)} <span class="pill">${g.tasks.length}</span></summary>
<ul class="plain">${g.tasks.map(t => `<li>${esc(t.what)}${t.due ? ` <span class="pill">${esc(t.due)}</span>` : ""}${t.meeting ? `<div class="small muted">${t.source === "referat" ? "Referat" : "Dokumentet"} ${esc(day(t.meeting))}</div>` : ""}</li>`).join("")}</ul></details>`).join("")}</div>` : "",
    block("Forslag på bordet", d.proposals, x => `${esc(x.text)}${x.by ? `<div class="small muted">${esc(x.by)}</div>` : ""}`),
    d.nextAgenda.length ? `<div class="block"><h3>Forslag til næste dagsorden</h3><ol class="agenda">${d.nextAgenda.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
<p><a class="button" href="${base}/moder?forslag=1#nyt">Lav et møde med denne dagsorden</a></p></div>` : ""
  ].filter(Boolean);
  return `<div class="card wide"><h2>Referatdokumentet</h2>${head ? `<p>${head}</p>` : ""}<div class="cols">${blocks.join("")}</div>
${docUrl ? `<p class="small"><a href="${esc(docUrl)}" target="_blank" rel="noopener">Åbn referatdokumentet</a></p>` : ""}</div>`;
}

/** The few most important lines of Saga's summary: its bullet points, else its first sentences. */
function keyPoints(summary: string | null, max = 3): string[] {
  const lines = (summary ?? "").split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^#/.test(line) && !/^temperatur:/i.test(line));
  const bullets = lines.filter(line => /^[-*]\s+/.test(line)).map(line => line.replace(/^[-*]\s+/, ""));
  return (bullets.length ? bullets : lines).slice(0, max);
}
const inline = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** Requested: "Der er rigtig mange informationer på forsiden ... Er det muligt at vise det der er vigtigst
 * og relevant lige nu, og så gemme de 'tunge tabeller' i en undermenu". The front page holds what is
 * yours and what matters now; the full picture is under Status. */
export function overviewPage(base: string, data: OverviewData): string {
  const p = data.picture;
  const sign = data.toSign.length ? `<h3>Referater du mangler at godkende</h3><ul class="plain">${data.toSign.map(m => `<li><a href="${base}/referat/${m.id}">Referat ${esc(m.meeting_date ? longDay(m.meeting_date) : "")}</a></li>`).join("")}</ul>` : "";
  const forChair = data.isChair && data.forChair.length ? `<h3>Til dig som formand</h3><ul class="plain">${data.forChair.slice(0, 5).map(f => `<li>${esc(f.text)}<div class="small muted">${esc(f.kind)} · ${esc(SOURCE[f.source] ?? f.source)}${f.from ? ` · ${esc(f.from)}` : ""}</div></li>`).join("")}</ul>
${data.forChair.length > 5 ? `<p class="small"><a href="${base}/status#formand">${data.forChair.length - 5} mere</a></p>` : ""}` : "";
  // Your open items first (your own, or written to you), then the minutes' tasks not yet checked off.
  const own = data.ownTodos ?? [], open = own.length + data.mine.length;
  const lines = [...own.map(t => `<li>${esc(t.text)}${t.due ? ` <span class="pill">${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due) ? shortDay(t.due) : t.due)}</span>` : ""}${t.created_by !== data.who ? `<div class="small muted">Fra ${esc(t.created_by)}</div>` : ""}</li>`), ...data.mine.map(taskLine)];
  const tasks = open ? `<h3>Dine opgaver</h3><ul class="plain">${lines.slice(0, 5).join("")}</ul><p class="small"><a href="${base}/opgaver">${open > 5 ? `Alle ${open} opgaver` : "Kryds af eller skriv en opgave"} →</a></p>` : "";
  const mine = `<div class="card"><h2>Til dig</h2>${sign}${forChair}${tasks}
${sign || forChair || tasks ? "" : `<p class="muted">${data.who ? `Intet venter på dig lige nu. <a href="${base}/opgaver">Skriv en opgave</a>` : `<a href="${base}/hvem">Vælg hvem du er</a> for at se dine opgaver.`}</p>`}</div>`;
  const next = `<div class="card"><h2>Næste møde</h2>${data.next ? `${meetingSummary(base, data.next)}<p class="small muted">${inDays(daysUntil(data.next.meeting_date, data.today))}</p>`
    : `<p class="muted">Intet møde er sat i kalenderen.</p>${data.found.length ? "" : `<p><a class="button" href="${base}/moder#nyt">Planlæg et møde</a></p>`}`}${foundMeetings(base, data.found, data.today)}</div>`;
  const points = keyPoints(data.summary);
  const waiting = (p?.topics ?? []).filter(t => t.waitsOnJacob || t.status === "afventer").slice(0, 3);
  const dates = (p?.document.dates ?? []).filter(d => d.date >= data.today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const now = `<div class="card${data.recent.length ? "" : " wide"}"><h2>Lige nu</h2>${p?.temperature ? `<p><span class="pill">${esc(p.temperature.level)}</span> ${esc(p.temperature.why)}</p>` : ""}
<div class="cols">${points.length ? `<div class="block"><h3>Det vigtigste</h3><ul class="plain">${points.map(x => `<li>${inline(x)}</li>`).join("")}</ul></div>` : `<div class="block"><p class="muted">Saga har ikke lavet et overblik endnu.</p></div>`}
${waiting.length ? `<div class="block"><h3>Venter på svar</h3><ul class="plain">${waiting.map(t => `<li><strong>${esc(t.title)}</strong>${t.waitsOnJacob ? ` <span class="waits">· ${data.isChair ? "venter på dig" : "venter på formanden"}</span>` : ""}${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ""}</li>`).join("")}</ul></div>` : ""}
${dates.length ? `<div class="block"><h3>Kommende datoer</h3><ul class="plain">${dates.map(d => `<li><strong>${esc(shortDay(d.date))}</strong> <span class="pill">${inDays(daysUntil(d.date, data.today))}</span><div class="small">${esc(d.what)}</div></li>`).join("")}</ul></div>` : ""}</div>
<p class="small" style="margin:14px 0 0"><a href="${base}/status">Se hele status →</a>${data.at ? ` <span class="muted">· Sagas overblik fra ${esc(clock(data.at))}</span>` : ""}</p></div>`;
  const minutesNote = data.progress.working || data.progress.waiting ? `<p class="notice">${[data.progress.working ? `${data.progress.working} optagelse${data.progress.working === 1 ? "" : "r"} bliver til referat` : "",
    data.progress.waiting ? `${data.progress.waiting} referat${data.progress.waiting === 1 ? "" : "er"} lægges op om lidt` : ""].filter(Boolean).join(" · ")}.</p>` : "";
  // Requested: "Referatet er ikke endnu gengivet/inkluderet på forsiden".
  const latest = data.recent[0];
  const latestCard = latest ? `<div class="card"><h2>Seneste referat</h2><p><a href="${base}/referat/${latest.id}"><strong>${esc(longDay(latest.date))}</strong></a></p>
${latest.decisions.length ? `<h3>Beslutninger</h3><ul class="plain">${latest.decisions.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join("")}</ul>${latest.decisions.length > 4 ? `<p class="small muted">og ${latest.decisions.length - 4} mere</p>` : ""}` : `<p class="small muted">Ingen beslutninger i referatet.</p>`}
<p style="margin:14px 0 0"><a class="button" href="${base}/referat/${latest.id}">${data.toSign.some(m => m.id === latest.id) ? "Læs og godkend" : "Læs referatet"}</a></p></div>` : "";
  const chips = [data.toSign.length ? `<a class="hot" href="${base}/referat/${data.toSign[0]!.id}"><b>${data.toSign.length}</b> referat${data.toSign.length === 1 ? "" : "er"} at godkende</a>` : "",
    data.next ? `<a href="${base}/moder/${data.next.id}">Møde ${inDays(daysUntil(data.next.meeting_date, data.today))}</a>` : "",
    data.mine.length + (data.ownTodos?.length ?? 0) ? `<a href="${base}/opgaver"><b>${data.mine.length + (data.ownTodos?.length ?? 0)}</b> opgave${data.mine.length + (data.ownTodos?.length ?? 0) === 1 ? "" : "r"} til dig</a>` : "",
    p?.temperature ? `<span>Stemning: ${esc(p.temperature.level)}</span>` : ""].filter(Boolean).join("");
  return layout(base, "Overblik", `<main><div class="hero"><h1>${data.who ? `Hej ${esc(data.who.split(/\s+/)[0])}` : "Overblik"}</h1>
<p>${esc(longDay(data.today).replace(/^./, c => c.toUpperCase()))}</p>${chips ? `<div class="chips">${chips}</div>` : ""}</div>${minutesNote}
<div class="grid">${mine}${next}</div><div class="grid">${latestCard}${now}</div></main>`, { section: "/", who: data.who });
}

/** Everything else, for when you want the whole picture: Saga's overview, the group, the minutes
 * document's figures, decisions, open threads, who has what and proposals, and the latest minutes. */
export function statusPage(base: string, data: OverviewData): string {
  const p = data.picture;
  const saga = `<div class="card"><h2>Sagas overblik</h2>${p?.temperature ? `<p><span class="pill">${esc(p.temperature.level)}</span> ${esc(p.temperature.why)}</p>` : ""}
${data.summary ? `<div class="doc">${md(data.summary)}</div>` : `<p class="muted">Saga har ikke lavet et overblik endnu.</p>`}
${data.at ? `<p class="small muted">Fra ${esc(clock(data.at))}</p>` : ""}</div>`;
  const forChair = data.isChair && data.forChair.length ? `<div class="card" id="formand"><h2>Til dig som formand</h2><ul class="plain">${data.forChair.map(f => `<li>${esc(f.text)}<div class="small muted">${esc(f.kind)} · ${esc(SOURCE[f.source] ?? f.source)}${f.from ? ` · ${esc(f.from)}` : ""}${f.since ? ` · ${esc(day(f.since))}` : ""}</div></li>`).join("")}</ul>
<p class="small muted">Marker dem som klaret på din Hjerterum-side i Matrix.</p></div>` : "";
  const mine = data.mine.length ? `<div class="card" id="opgaver"><h2>Dine opgaver</h2><ul class="plain">${data.mine.map(taskLine).join("")}</ul></div>` : "";
  const weekly = data.weekly ? `<div class="card"><h2>Ugeopsummering</h2><div class="doc">${md(data.weekly.text)}</div><p class="small muted">${esc(clock(data.weekly.created_at_ms))}</p></div>` : "";
  const recent = data.recent.length ? `<div class="card"><h2>Seneste referater</h2>${data.recent.map(r => `<h3><a href="${base}/referat/${r.id}">${esc(longDay(r.date))}</a></h3>
${r.decisions.length ? `<ul>${r.decisions.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="small muted">Ingen beslutninger.</p>`}${r.tasks ? `<p class="small muted">${r.tasks} opgave${r.tasks === 1 ? "" : "r"}</p>` : ""}`).join("")}</div>` : "";
  return layout(base, "Status", `<main><h1>Status</h1><p class="muted" style="margin:-6px 0 0">Hele billedet af bestyrelsens arbejde: gruppen, referatdokumentet og de seneste referater.</p>
<div class="grid">${saga}${groupCard(data.group, p, data.isChair)}</div>${forChair || mine ? `<div class="grid">${forChair}${mine}</div>` : ""}
${documentCard(base, p, data.everyone, data.docUrl, data.today)}${weekly || recent ? `<div class="grid">${weekly}${recent}</div>` : ""}</main>`, { section: "/status", who: data.who });
}

export type PastMeeting = { date: string; meeting: Meeting | null; minutes: ApprovedMinutes | null; state: MinutesState | null; inDocument: boolean };


// Reported: a recording of the meeting 1 October went up as 17 September - the form had chosen that
// meeting itself. Now nothing is chosen until the member picks the meeting.
function uploadForm(base: string, past: PastMeeting[], today: string): string {
  const choices = past.slice(0, 15);
  const pick = choices.length ? `<label>Hvilket møde er optagelsen fra?<select name="meeting_choice" data-other required><option value="" disabled selected>Vælg mødet …</option>${choices.map(row => `<option value="${esc(row.date)}">${esc(longDay(row.date))}${row.minutes ? " · har referat" : row.state ? ` · ${STATE_TEXT[row.state].toLowerCase()}` : ""}</option>`).join("")}
<option value="anden">Et andet møde …</option></select></label>` : "";
  return `<form class="stack" method="post" action="${base}/upload" enctype="multipart/form-data">
<label>Optagelse (mp3, m4a, wav, ogg - højst 60 MB)<input type="file" name="recording" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" required></label>
${pick}<label data-other-date${pick ? " hidden" : ""}>Mødedato<input type="date" name="meeting_date" max="${esc(today)}" value="${esc(today)}"></label>
<button>Upload og lav referat</button><p class="small muted">Saga skriver referatet ud fra optagelsen og lægger det op her. Bestyrelsen godkender det, og hvert medlem kan rette de enkelte punkter.</p></form>
<script>document.querySelectorAll("[data-other]").forEach(s=>s.addEventListener("change",()=>{s.form.querySelector("[data-other-date]").hidden=s.value!=="anden"}))</script>`;
}

export function meetingsPage(base: string, data: { upcoming: Meeting[]; past: PastMeeting[]; found: Array<{ date: string; what: string }>; suggestion: string[];
  prefill: { date: string; agenda: boolean }; today: string; who: string | null; notice: string; uploads: boolean }): string {
  const form = `<form class="stack" method="post" action="${base}/moder"><div class="row"><label>Dato<input type="date" name="meeting_date" required min="${esc(data.today)}" value="${esc(data.prefill.date)}"></label>
<label>Tid<input type="time" name="start_time"></label><label>Sted<input name="place" maxlength="200" placeholder="Fx Hjerterum, Valby"></label></div>
<label>Dagsorden (ét punkt pr. linje)<textarea name="agenda" placeholder="Godkendelse af referat&#10;Økonomi&#10;Eventuelt">${data.prefill.agenda ? esc(data.suggestion.join("\n")) : ""}</textarea></label>
<div class="actions">${data.prefill.agenda ? "" : agendaFill(data.suggestion)}<button>Gem møde</button></div></form>`;
  const status = (row: PastMeeting) => row.minutes ? `<a href="${base}/referat/${row.minutes.id}">Læs referat</a>` : row.state ? `<span class="${row.state === "failed" ? "warn" : "muted"}">${STATE_TEXT[row.state]}</span>`
    : row.inDocument ? `<a href="${base}/arkiv#${esc(row.date)}">I referatdokumentet</a>` : row.meeting ? `<a href="${base}/moder/${row.meeting.id}#upload">Upload optagelse</a>` : `<span class="muted">Mangler</span>`;
  return layout(base, "Møder", `<main><h1>Møder</h1>${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}
<div class="grid"><div class="card"><h2>Kommende møder</h2>${data.upcoming.length ? data.upcoming.map(m => `<div style="margin-bottom:14px">${meetingSummary(base, m)}<p class="small muted">${inDays(daysUntil(m.meeting_date, data.today))}</p></div>`).join("") : `<p class="muted">Ingen møder planlagt.</p>`}
${foundMeetings(base, data.found, data.today)}</div>
<div class="card" id="nyt"><h2>Planlæg et møde</h2>${form}</div></div>
<div class="grid"><div class="card"><h2>Holdte møder</h2>${data.past.length ? `<table class="rows"><tr><th>Dato</th><th>Dagsorden</th><th>Referat</th></tr>${data.past.map(row => `<tr><td data-label="Dato"><strong>${esc(shortDay(row.date))}</strong></td>
<td data-label="Dagsorden">${row.meeting ? `<a href="${base}/moder/${row.meeting.id}">${row.meeting.agenda.split("\n").filter(Boolean).length} punkter</a>` : `<span class="muted">-</span>`}</td>
<td data-label="Referat">${status(row)}</td></tr>`).join("")}</table>` : `<p class="muted">Ingen holdte møder endnu.</p>`}</div>
<div class="card" id="upload"><h2>Upload mødeoptagelse</h2>${data.uploads ? uploadForm(base, data.past, data.today) : `<p class="muted">Upload er ikke sat op endnu (lageret til optagelser mangler).</p>`}</div></div></main>${FILL_SCRIPT}`, { section: "/moder", who: data.who });
}

export function meetingPage(base: string, m: Meeting, data: { minutes: ApprovedMinutes | null; state: MinutesState | null; suggestion: string[]; today: string; uploads: boolean },
  who: string | null, notice: string): string {
  const held = m.meeting_date <= data.today;
  const minutesCard = data.minutes ? `<p><a class="button" href="${base}/referat/${data.minutes.id}">Læs referatet</a></p>`
    : `${data.state ? `<p class="notice${data.state === "failed" ? " warn" : ""}">${STATE_TEXT[data.state]}.</p>` : `<p class="muted">Intet godkendt referat endnu.</p>`}
${held && data.uploads && data.state !== "working" && data.state !== "waiting" ? `<form class="stack" id="upload" method="post" action="${base}/upload" enctype="multipart/form-data"><input type="hidden" name="meeting_choice" value="${esc(m.meeting_date)}"><input type="hidden" name="meeting_id" value="${m.id}">
<label>Optagelse af dette møde (mp3, m4a, wav, ogg - højst 60 MB)<input type="file" name="recording" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" required></label>
<button>Upload og lav referat</button><p class="small muted">Saga skriver referatet ud fra optagelsen og dagsordenen og lægger det op her til bestyrelsens godkendelse.</p></form>` : ""}`;
  return layout(base, `Møde ${shortDay(m.meeting_date)}`, `<main><p class="small"><a href="${base}/moder">← Møder</a></p><h1>${esc(longDay(m.meeting_date))}</h1>
${notice ? `<p class="notice good">${esc(notice)}</p>` : ""}<div class="grid"><div class="card"><h2>Dagsorden</h2>
<form class="stack" method="post" action="${base}/moder/${m.id}"><div class="row"><label>Dato<input type="date" name="meeting_date" required value="${esc(m.meeting_date)}"></label>
<label>Tid<input type="time" name="start_time" value="${esc(m.start_time ?? "")}"></label><label>Sted<input name="place" maxlength="200" value="${esc(m.place ?? "")}"></label></div>
<label>Dagsorden (ét punkt pr. linje)<textarea name="agenda">${esc(m.agenda)}</textarea></label><div class="actions">${held ? "" : agendaFill(data.suggestion)}<button>Gem</button></div></form>
${m.updated_by ? `<p class="small muted">Sidst rettet af ${esc(m.updated_by)}.</p>` : ""}
<form method="post" action="${base}/moder/${m.id}/slet" onsubmit="return confirm('Slette mødet og dets dagsorden?')"><button class="ghost">Slet møde</button></form></div>
<div class="card"><h2>Referat</h2>${minutesCard}</div></div></main>${FILL_SCRIPT}`, { section: "/moder", who });
}

export function decisionsPage(base: string, decisions: Decision[], who: string | null): string {
  return layout(base, "Beslutninger", `<main><h1>Beslutninger</h1><div class="card"><label>Søg<input id="q" type="search" placeholder="Fx medlemskab, budget, Open"></label>
${decisions.length ? `<table id="list" class="rows"><tr><th>Dato</th><th>Beslutning</th><th>Kilde</th></tr>${decisions.map(d => `<tr><td data-label="Dato">${esc(/^\d{4}-/.test(d.date) ? shortDay(d.date) : d.date || "-")}</td>
<td data-label="Beslutning">${d.topic ? `<strong>${esc(d.topic)}:</strong> ` : ""}${esc(d.text)}</td><td data-label="Kilde">${d.minutesId ? `<a href="${base}/referat/${d.minutesId}">Referat</a>` : `<span class="muted">Dokumentet</span>`}</td></tr>`).join("")}</table>`
    : `<p class="muted">Ingen beslutninger endnu.</p>`}</div></main>
<script>document.getElementById("q").addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("#list tr").forEach((r,i)=>{if(i)r.hidden=q&&!r.textContent.toLowerCase().includes(q)})})</script>`, { section: "/beslutninger", who });
}

export function archivePage(base: string, data: { minutes: ApprovedMinutes[]; history: Array<{ day: string; label: string; text: string }>; docUrl: string | null; docError: string | null; who: string | null }): string {
  return layout(base, "Arkiv", `<main><h1>Arkiv</h1><div class="grid"><div class="card"><h2>Referater fra Saga</h2>
${data.minutes.length ? `<ul class="plain">${data.minutes.map(m => `<li><a href="${base}/referat/${m.id}">Referat ${esc(m.meeting_date ? longDay(m.meeting_date) : "")}</a></li>`).join("")}</ul>` : `<p class="muted">Ingen endnu.</p>`}</div>
<div class="card"><h2>Tidligere referater</h2>${data.docUrl ? `<p class="small"><a href="${esc(data.docUrl)}" target="_blank" rel="noopener">Åbn referatdokumentet</a></p>` : ""}
${data.docError ? `<p class="muted">${esc(data.docError)}</p>` : data.history.length ? data.history.map(h => `<details id="${esc(h.day)}"><summary>${esc(longDay(h.day))}</summary><div style="white-space:pre-wrap" class="small">${esc(h.text)}</div></details>`).join("")
    : `<p class="muted">Ingen referater fundet i dokumentet.</p>`}</div></div></main>
<script>const d=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(d&&d.tagName==="DETAILS"){d.open=true;d.scrollIntoView()}</script>`, { section: "/arkiv", who: data.who });
}
