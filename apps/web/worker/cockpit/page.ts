import { markdownToHtml } from "../saga/markdown.js";
import { recorderCard } from "./recorder.js";
import type { BoardPicture } from "../saga/picture.js";
import { personChip, WHO_CHIP_STYLE } from "./todosPage.js";
import { APPROVED_BADGE, HANDSHAKE, laurel, VOTES_STYLE, type VoteBlocks } from "./votes.js";
import { DRAWER_STYLE, postDrawer, type PostKind } from "./postDrawer.js";
import { agendaAuthors, agreedLabel, DEFAULT_PLACE, guessKind, rolesLine, sagaRoom, tasksByPerson, type ApprovedMinutes, type Decision, type GroupNow, type Meeting, type Task } from "./data.js";
import { LYS_CSS } from "../../lys.js";

/** The admin's own typeface (the blue design from before 3 October): Bricolage Grotesque. */
const BRICOLAGE_FONT_URL = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..700&display=swap";

/** The board cockpit's pages, written on the server as plain HTML: quick on a phone, nothing to
 * install, and nothing of the board's in a script. Every value from the database is escaped. */

export const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const DANISH_DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const DANISH_SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "torsdag den 8. oktober 2026" - the weekday from the date itself, never guessed. */
export const longDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_DAY.format(new Date(`${iso}T12:00:00Z`)) : iso;
export const shortDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DANISH_SHORT.format(new Date(`${iso}T12:00:00Z`)) : iso;

export const COCKPIT_STYLE = `
.meet-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:10px 0 0}
/* Requested: "It still looks like a quite weird and old design, and I don't like the green ... Take a look at my page for inspiration -
   jacobhauge.com" (2 October); "Can you try to revert just the colors and the design styling back to before October 3rd?" - "Just here" (7 October);
   then "the blue is a bit cold ... a little warmer and more yellowish" - "Lad os bruge natblå".
   The system: Bricolage Grotesque, tight bold headings, pill buttons, a glass header and a soft glow, one cobalt accent. By day it sits on warm cream
   paper with a golden glow; at night it is the deep night blue (no brown). */
:root{--bg:#f6f1e7;--card:#fffdf9;--ink:#241f19;--muted:#675e52;--faint:#8b8173;--line:#e8dfcd;--accent:#2c47cf;--accent-2:#1f36a6;--accent-ink:#fff;--soft:#f2ebdc;--tint:#ebe9f7;
--good:#2c47cf;--warn:#a4501a;--warn-soft:#fbe9d6;--shadow:0 1px 2px rgba(60,45,20,.05),0 10px 30px -18px rgba(60,45,20,.22);--radius:20px;--nav-h:66px;
--glow-1:rgb(240 180 60 / .26);--glow-2:rgb(236 128 104 / .16);--glow-3:rgb(255 214 150 / .26);--serif:var(--font);--lys-terra:var(--accent);--lys-clay:var(--tint);--lys-clay-ink:var(--accent);--lys-sage:var(--tint);--lys-sage-ink:var(--accent);--font:"Bricolage Grotesque",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#10151f;--card:#18202c;--ink:#eaeef5;--muted:#a2adbd;--faint:#76849a;--line:#27313f;--accent:#8da0ff;--accent-2:#b0bdff;--accent-ink:#0e1530;--soft:#1f2836;--tint:#1e2848;
--good:#8da0ff;--warn:#f0a86e;--warn-soft:#2e2219;--shadow:none;--glow-1:rgb(240 185 80 / .12);--glow-2:rgb(141 160 255 / .22);--glow-3:rgb(90 190 220 / .10)}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
.lys-art{display:none}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font);font-optical-sizing:auto;-webkit-font-smoothing:antialiased;overflow-x:clip;position:relative;isolation:isolate}
body::before{content:"";position:absolute;z-index:-1;top:-160px;right:0;width:min(980px,100%);height:760px;pointer-events:none;filter:blur(10px);
background:radial-gradient(closest-side at 38% 42%,var(--glow-2),transparent 72%),radial-gradient(closest-side at 64% 36%,var(--glow-1),transparent 70%),radial-gradient(closest-side at 72% 66%,var(--glow-3),transparent 70%)}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:.2em}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
header.bar{position:sticky;top:0;z-index:10}
header.bar::before{content:"";position:absolute;inset:0;z-index:-1;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.top{max-width:1160px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:24px}
.brand{display:flex;align-items:center;gap:11px;text-decoration:none;color:var(--ink);white-space:nowrap;flex:none}
.brand-mark{width:40px;height:40px;display:grid;place-items:center;flex:none}.brand-mark img{width:40px;height:40px;display:block;filter:brightness(0);opacity:.88}
@media (prefers-color-scheme:dark){.brand-mark img{filter:none;opacity:1}}
.brand b{font-weight:700;font-size:18px;letter-spacing:-.01em}.brand .names span{font-size:12.5px;color:var(--muted);font-weight:500}
.brand .names{display:grid;line-height:1.15}
nav.desk{display:flex;gap:4px;flex:1;min-width:0;justify-content:center}nav.desk a{padding:8px 14px;border-radius:999px;text-decoration:none;color:var(--ink);font-weight:500;font-size:15px;white-space:nowrap}
nav.desk a:hover{color:var(--accent)}nav.desk a.on{background:var(--card);box-shadow:var(--shadow);font-weight:600}
.me{display:flex;align-items:center;gap:10px;font-size:14px;margin-left:auto;flex:none}.me .who-name{white-space:nowrap;color:var(--muted)}
.avatar{width:38px;height:38px;border-radius:50%;border:1.5px solid var(--ink);color:var(--ink);display:grid;place-items:center;font-weight:650;font-size:13px;text-decoration:none}
.avatar:hover{border-color:var(--accent);color:var(--accent)}
.logout{margin:0}.logout button{background:none;border:0;box-shadow:none;color:var(--muted);font-size:13.5px;font-weight:500;padding:6px 8px;min-height:0;cursor:pointer}.logout button:hover{color:var(--ink);filter:none}
@media (max-width:1100px){.me .who-name{display:none}}@media (max-width:980px){.brand .names span{display:none}nav.desk a{padding:8px 10px;font-size:14.5px}}
nav.tabs{display:none}
main{max-width:1160px;margin:0 auto;padding:40px 24px 88px;display:grid;gap:20px}
h1,h2,h3{font-family:var(--font)}
h1{font-size:clamp(34px,4.4vw,52px);line-height:1.02;margin:0;letter-spacing:-.03em;font-weight:700}h2{font-size:20px;margin:0 0 14px;font-weight:650;letter-spacing:-.015em;line-height:1.2}
h3{font-size:12px;margin:18px 0 8px;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;font-weight:650}h3:first-child{margin-top:0}
.hero{display:grid;gap:10px;margin-bottom:4px}.hero p{margin:0;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chips a,.chips span{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;background:var(--card);box-shadow:var(--shadow);font-size:14px;font-weight:550;color:var(--ink);text-decoration:none}
.chips .hot{background:var(--warn-soft);color:var(--warn);box-shadow:none}.chips b{font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:20px;align-items:start}.grid.single{grid-template-columns:minmax(0,860px)}
.card{background:var(--card);border-radius:var(--radius);padding:26px 28px;min-width:0;box-shadow:var(--shadow);border:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.muted{color:var(--muted)}.small{font-size:14px}.pill{display:inline-block;font-size:12px;font-weight:650;padding:2px 10px;border-radius:999px;background:var(--soft);color:var(--muted);white-space:nowrap}
ul.plain{list-style:none;margin:0;padding:0;display:grid}ul.plain li{padding:12px 0;border-bottom:1px solid var(--line)}ul.plain li:first-child{padding-top:2px}ul.plain li:last-child{border-bottom:0;padding-bottom:0}
ul.plain li>a:only-child,ul.plain li>a:first-child:last-child{display:flex;justify-content:space-between;align-items:center;text-decoration:none;font-weight:600;min-height:28px;color:var(--ink)}
ul.plain li>a:only-child::after{content:"→";color:var(--faint);font-size:16px;line-height:1;font-weight:400}ul.plain li>a:only-child:hover{color:var(--accent)}
ol.agenda{margin:0;padding-left:22px}ol.agenda li{margin:4px 0}ol.agenda li::marker{color:var(--faint);font-weight:600}
/* Requested: "Indram punkterne så de er klart adskilt fra møde-overskrift og underopskrift" and "Vi skal også benytte samfoldede afsnit på siden generelt": the points of an agenda stand in a frame of their own,
   and what is beyond the first few is folded under a button (details.fold). */
.agenda-box{border:1px solid var(--line);border-radius:12px;background:var(--soft);padding:12px 16px 12px 12px;margin:10px 0 0}.agenda-box ol.agenda{padding-left:26px}
/* Requested: "Record a meeting and Plan a meeting should be quite folded when you enter the page, and bring them up right next to each other vertically": a card that is folded until it is opened. */
details.foldcard{padding:0}details.foldcard>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;padding:20px 28px}details.foldcard>summary::before,details.foldcard[open]>summary::before{content:none}
details.foldcard>summary h2{margin:0}details.foldcard>summary::after{content:"▾";color:var(--faint);font-size:14px}details.foldcard[open]>summary::after{content:"▴"}details.foldcard>summary:hover h2{color:var(--accent)}
details.foldcard>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:var(--radius)}details.foldcard>.fold-body{padding:0 28px 26px}
details.fold{margin:12px 0 0;border-top:0;padding:0}details.fold>summary::before,details.fold[open]>summary::before{content:none}details.fold>summary{display:inline-flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:8px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);font-size:14px;font-weight:600;min-height:38px}
details.fold>summary::-webkit-details-marker{display:none}details.fold>summary::after{content:"▾";color:var(--faint);font-size:12px}details.fold[open]>summary::after{content:"▴"}
details.fold>summary:hover{border-color:var(--accent)}details.fold>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}details.fold>.fold-body{margin-top:12px}
details.fold .fold-less,details.fold[open] .fold-more{display:none}details.fold[open] .fold-less{display:inline}
/* Requested: "oplæg til dagsorden ... i punktform, så man kan oprette et punkt. Der skal altså ikke være fri tekst ... Sagas forslag ... slette hver med et kryds": one row per point, a cross on each. */
ol.agenda.points{padding:0;list-style:none;counter-reset:point;display:grid;gap:6px;margin:0 0 4px}
ol.agenda.points li{counter-increment:point;display:flex;align-items:center;gap:10px;margin:0;padding:7px 8px 7px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
ol.agenda.points li::before{content:counter(point);font-weight:650;color:var(--faint);min-width:1.3em}ol.agenda.points .t{flex:1;min-width:0;overflow-wrap:anywhere}
ol.agenda.points .who{cursor:default;flex:none}.saga-mark{white-space:nowrap;font-size:11.5px;font-weight:700;line-height:1.4;padding:2px 10px;border-radius:999px;background:var(--tint);color:var(--accent)}.saga-mark.inline{margin-left:6px}
ol.agenda.points .saga-mark{flex:none;white-space:nowrap;font-size:11.5px;font-weight:700;line-height:1.4;padding:2px 10px;border-radius:999px;background:var(--tint);color:var(--accent)}
ol.agenda.points li{flex-wrap:wrap}ol.agenda.points .editpoint{display:none;flex:1 1 240px;gap:8px;margin:0;align-items:center}ol.agenda.points .editpoint input[name=text]{flex:1;min-width:0}
ol.agenda.points .editpoint button{flex:none;min-height:40px;padding:8px 16px;font-size:14px}ol.agenda.points li.editing .editpoint{display:flex}ol.agenda.points li.editing .grip,ol.agenda.points li.editing .t,ol.agenda.points li.editing .saga-mark,ol.agenda.points li.editing .pencil,ol.agenda.points li.editing form.cross{display:none}
@media (max-width:560px){ol.agenda.points li{row-gap:8px}ol.agenda.points .t{flex:1 1 calc(100% - 90px)}ol.agenda.points .t+*{margin-left:0}}
button.grip{order:-1;flex:none;width:22px;height:32px;min-height:0;margin-left:-6px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--faint);display:grid;place-items:center;cursor:grab;touch-action:none}
button.grip:hover,button.grip:focus-visible{color:var(--accent);filter:none}ol.agenda.points li.dragging{border-color:var(--accent);box-shadow:0 8px 22px rgb(0 0 0 / .18);background:color-mix(in srgb,var(--accent) 6%,var(--card));position:relative;z-index:2}
ol.agenda.points li.dragging button.grip{cursor:grabbing}
button.pencil{width:32px;height:32px;min-height:0;padding:0;border-radius:50%;background:transparent;color:var(--accent);border:1.5px solid var(--line);display:grid;place-items:center;flex:none}button.pencil:hover{border-color:var(--accent);filter:none}
.editing-banner{display:inline-flex;align-items:center;gap:8px;margin:0 0 6px;padding:5px 14px 5px 11px;border-radius:999px;background:var(--tint);color:var(--accent);font-size:12.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
form.cross{margin:0}form.cross button{width:32px;height:32px;min-height:0;padding:0;border-radius:50%;background:transparent;color:var(--muted);border:1.5px solid var(--line);font-size:22px;font-weight:400;line-height:1;display:grid;place-items:center;padding-bottom:2px}
form.cross button:hover{color:var(--warn);border-color:var(--warn);filter:none}
form.addpoint{display:flex;gap:8px;margin:10px 0 0}form.addpoint input{flex:1;min-width:0}form.addpoint button{flex:none}
.stack-cards{display:grid;gap:14px;align-content:start}.info-note{margin:0;font-size:14px;line-height:1.5}
.suggest-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:14px}.suggest-row form{margin:0}
/* A choice of one (Planlæg et møde, a meeting's kind): round radios in pills - never the wide grey box the page's input style would make of them. */
.picks{display:flex;flex-wrap:wrap;gap:8px}.picks legend{padding:0;margin:0 0 6px;font-size:13.5px;font-weight:600;color:var(--muted)}fieldset.picks-set{border:0;margin:0;padding:0}
label.pick{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);font-size:14.5px;font-weight:600;cursor:pointer}
label.pick input{appearance:auto;-webkit-appearance:radio;width:18px;height:18px;min-height:0;margin:0;padding:0;border:0;background:none;box-shadow:none;accent-color:var(--accent)}
label.pick:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--card))}
.kind-tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;background:var(--soft);color:var(--muted);margin-left:8px;vertical-align:2px}.kind-tag.team{background:var(--tint);color:var(--accent)}
.doc h1{font-size:20px}.doc h2{font-size:16px;margin-top:18px}.doc h3{font-size:12px}.doc ul{padding-left:20px}.doc p{margin:6px 0}
form.stack{display:grid;gap:12px}label{display:grid;gap:6px;font-size:13.5px;font-weight:600;color:var(--muted)}
input,textarea,select{font:inherit;font-size:16px;font-weight:400;color:var(--ink);background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:11px 14px;width:100%;min-height:46px}
input:focus,textarea:focus,select:focus{outline:3px solid color-mix(in srgb,var(--accent) 22%,transparent);border-color:var(--accent);background:var(--card)}
textarea{min-height:130px;resize:vertical}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1 1 160px}
button,.button{font:inherit;font-weight:650;font-size:15px;border:0;border-radius:999px;padding:12px 22px;min-height:46px;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
button:hover,.button:hover{filter:brightness(1.08)}button.ghost,.button.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--line)}button.ghost:hover,.button.ghost:hover{border-color:var(--accent);color:var(--accent);filter:none}
.notice{padding:14px 18px;border-radius:16px;background:var(--tint);color:var(--ink)}.notice.good{color:var(--accent)}.notice.warn{background:var(--warn-soft);color:var(--warn)}
details{border-top:1px solid var(--line);padding:10px 0}details>summary{cursor:pointer;font-weight:600;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"+";display:inline-block;width:18px;color:var(--faint)}details[open]>summary::before{content:"–"}
.center{max-width:440px;margin:12vh auto;padding:0 16px}.mark{width:64px;height:64px;display:grid;place-items:center;margin:0 0 20px}.mark img{width:64px;height:64px;filter:brightness(0);opacity:.88}@media (prefers-color-scheme:dark){.mark img{filter:none;opacity:1}}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);vertical-align:top;font-size:15px}th{font-size:12px;color:var(--faint);font-weight:650;text-transform:uppercase;letter-spacing:.06em}
tr:last-child td{border-bottom:0}
[hidden]{display:none!important}.actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.wide{grid-column:1/-1}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px 30px;align-items:start}.block{min-width:0}
.chip{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 9px;border-radius:999px;background:var(--soft);color:var(--muted);margin-right:4px}
.chip.good{color:var(--accent);background:var(--tint)}.chip.wait{color:var(--warn);background:var(--warn-soft)}.waits,.warn{color:var(--warn);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:4px 0 12px}.stats div{background:var(--soft);border-radius:14px;padding:12px 14px}
.stats b{display:block;font-size:26px;font-weight:700;letter-spacing:-.02em}.stats span{font-size:12.5px;color:var(--muted)}ul.msgs li{white-space:pre-wrap;word-break:break-word}
details summary .pill{margin-left:4px}.card>ul:not(.plain){padding-left:20px;margin:4px 0}
.menu{display:grid}.menu a,.menu button{display:flex;justify-content:space-between;align-items:center;padding:16px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink);font-weight:600;font-size:16px;background:none;border-radius:0;min-height:56px;width:100%}
.menu a::after,.menu button::after{content:"→";color:var(--faint);font-size:16px;font-weight:400}
/* Panels: the front page's blocks, also used on Medlemmer. */
.panel{background:var(--card);border:1px solid color-mix(in srgb,var(--line) 60%,transparent);border-radius:var(--radius);padding:26px 28px;min-width:0;box-shadow:var(--shadow)}
.panel>header{margin:0 0 14px}.panel h2{font-size:21px;font-weight:650;margin:0;letter-spacing:-.015em}.panel header p{margin:3px 0 0;font-size:13.5px;color:var(--faint)}
.panel .more{display:inline-block;margin-top:14px;font-size:14px;font-weight:600;text-decoration:none}
.panel .more-row{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline}.panel .more-row form{margin:0}.panel .more-row button{background:none;border:0;padding:0;min-height:0;margin-top:14px;font:inherit;font-size:14px;font-weight:600;color:var(--faint);cursor:pointer;text-decoration:underline;text-underline-offset:3px}.panel .more-row button:disabled{text-decoration:none;cursor:default}
.items{list-style:none;margin:0;padding:0}.items li{padding:11px 0;border-top:1px solid var(--line)}.items li:first-child{border-top:0;padding-top:0}
.items .ctx{display:block;font-size:12.5px;color:var(--faint);margin-top:2px}
.empty{color:var(--muted);margin:0}
main>h1+p{margin-top:-6px}.ver{margin:18px 0 0;font-size:12px;color:var(--faint);text-align:center}
@media (max-width:760px){
  button,.button{min-height:42px;padding:10px 18px;font-size:14.5px}
  nav.desk,.me .who-name{display:none}.top{padding:10px 16px}.brand-mark{width:34px;height:34px}.brand-mark img{width:34px;height:34px}.avatar{width:34px;height:34px}
  nav.tabs{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;z-index:15;height:calc(var(--nav-h) + env(safe-area-inset-bottom));padding:6px 4px env(safe-area-inset-bottom);
    background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-top:1px solid var(--line)}
  nav.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-decoration:none;color:var(--faint);font-size:11px;font-weight:600;border-radius:12px}
  nav.tabs a svg{width:22px;height:22px}nav.tabs a.on{color:var(--accent)}
  main{padding:22px 16px calc(var(--nav-h) + 96px + env(safe-area-inset-bottom));gap:16px}h1{font-size:34px}
  .grid{grid-template-columns:1fr;gap:16px}.card,.panel{padding:20px;border-radius:18px}.cols{grid-template-columns:1fr}
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
/** Requested: "Sørg også for, at der er et versionsnummer på Hjerterum-cockpittet". Raised with each release. */
export const COCKPIT_VERSION = "1.16.0";
export const COCKPIT_RELEASED = "2026-10-13";
/** Requested: "this footer should change accordingly" - the day and the commit each deploy was built from (vite.config.ts), so the line follows
 * what is live; the hand-set day only stands in where nothing was built (the tests). */
const BUILT = typeof __APP_BUILT__ === "string" && __APP_BUILT__ ? __APP_BUILT__ : COCKPIT_RELEASED;
const COMMIT = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "";
const versionLine = () => `<p class="ver">Hjerterum admin v${COCKPIT_VERSION} · ${shortDay(BUILT)}${COMMIT ? ` · ${COMMIT}` : ""} © Jacob Hauge</p>`;

export function layout(base: string, title: string, body: string, options: { section?: string; who?: string | null; style?: string; post?: { kind?: PostKind; open?: boolean } } = {}): string {
  // The version sits quietly at the end of every page's main column.
  const end = body.lastIndexOf("</main>");
  if (options.section !== undefined && end >= 0) body = `${body.slice(0, end)}${versionLine()}${body.slice(end)}`;
  // Requested: "Er du sikker på, at det er gennemtænkt? ... Jeg synes stadig, det virker rodet." Five places,
  // the same on a computer and a phone; Status and Arkiv are reached from Overblik and Møder, you from your initials.
  const places = [["/", "Overblik"], ["/opgaver", "Opgaver"], ["/moder", "Møder"], ["/opslag", "Opslagstavle"], ["/beslutninger", "Beslutninger"], ["/posthus", "Posthus"], ["/medlemmer", "Medlemmer"], ["/arrangementer", "Events"], ["/statistik", "Statistik"]];
  const parent: Record<string, string> = { "/status": "/", "/arkiv": "/moder" };
  const here = parent[options.section ?? ""] ?? options.section;
  // Requested: "Medlemmer og Statistik skal gemmes i hovedmenuen for nu" - still there under your initials (Profil), and on the phone's Huset.
  const tucked = ["/medlemmer", "/statistik"];
  const desk = places.filter(([path]) => !tucked.includes(path!)).map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
  // On a phone the five labels must fit side by side.
  const short: Record<string, string> = { "/beslutninger": "Besluttet", "/arrangementer": "Events" };
  // The phone's tab bar keeps five places; Posthus, Medlemmer and Statistik are on Overblik and under the initials.
  // The phone keeps five tabs: Opslag is reached from Overblik ("Dine opgaver" and "+ Nyt opslag").
  const tabs = places.filter(([path]) => path !== "/posthus" && path !== "/statistik" && path !== "/medlemmer" && path !== "/opslag").map(([path, label]) => `<a href="${base}${path}"${here === path ? ' class="on" aria-current="page"' : ""}>${icon(path!)}<span>${short[path!] ?? label}</span></a>`).join("");
  // The tab on the right edge on every page, for whoever has said who they are.
  const drawer = options.section !== undefined && Boolean(options.who);
  const initials = (options.who ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f6f1e7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#10151f" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${BRICOLAGE_FONT_URL.replace(/&/g, "&amp;")}">
<title>${esc(title)} · Hjerterum bestyrelse</title><style>${LYS_CSS}${COCKPIT_STYLE}${drawer ? DRAWER_STYLE : ""}${options.style ?? ""}</style></head><body>
${options.section === undefined ? "" : `<header class="bar"><div class="top"><a class="brand" href="${base}/"><span class="brand-mark"><img src="${base}/logo.png?v=${COCKPIT_VERSION}" alt="" width="44" height="44"></span><span class="names"><b>Hjerterum</b><span>Bestyrelsen</span></span></a><nav class="desk" aria-label="Menu">${desk}</nav>
<div class="me">${options.who ? `<span class="who-name">${esc(options.who)}</span>` : ""}<a class="avatar" href="${base}/profil" title="${esc(options.who ? `${options.who} · profil` : "Vælg hvem du er")}">${esc(initials)}</a>
<form method="post" action="${base}/logout" class="logout"><button>Log ud</button></form></div></div></header>
<nav class="tabs" aria-label="Menu">${tabs}</nav>`}
${body}${drawer ? postDrawer(base, options.post) : ""}${options.section === undefined ? "" : sagaChat(base, options.who ?? null)}</body></html>`;
}

/** Requested: "Der bør vær en engelsk oversættelses knap - Douglas taler engelsk" - "Ja byg det sådan": the member's language, chosen once. */
function languageCard(base: string, lang: "da" | "en"): string {
  const choice = (value: "da" | "en", label: string) => `<button name="lang" value="${value}" class="${lang === value ? "" : "ghost"}" aria-pressed="${lang === value}" translate="no">${label}</button>`;
  return `<div class="card"><h2>Sprog / Language</h2><p class="small muted" translate="no">${lang === "en"
    ? "Menus, buttons, Saga's texts and suggestions and the summaries are in English, and Saga answers you in English. Saga writes every summary in both Danish and English - the Danish original is always one click away."
    : "Vælg English, så er menuer, knapper, Sagas tekster og forslag og referaterne på engelsk, og Saga svarer på engelsk. Saga skriver hvert referat på både dansk og engelsk - den danske original er altid et klik væk."}</p>
<form method="post" action="${base}/sprog" style="display:flex;gap:8px;margin:0">${choice("da", "Dansk")}${choice("en", "English")}</form></div>`;
}

/** Requested: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked". The member's own words; on the front page
 * the same form stands until they have written something (home.ts). */
export function responsibilitiesForm(base: string, text: string, back: "/" | "/profil", placeholder = "Fx lokaler og nøgler, økonomi, nyhedsbrev"): string {
  return `<form class="stack" method="post" action="${base}/profil/ansvar"><input type="hidden" name="back" value="${back}">
<label>Mine ansvarsområder<textarea name="text" required maxlength="600" rows="3" placeholder="${esc(placeholder)}">${esc(text)}</textarea></label><button>Gem</button></form>`;
}

function responsibilitiesCard(base: string, text: string, saved: boolean): string {
  return `<div class="card" id="ansvar"><h2>Mine ansvarsområder</h2><p class="small muted">Skriv med dine egne ord, hvad du har ansvar for i Hjerterum. Så ved Saga, hvad hun skal give dig besked om, og hvem hun skal pege på, når noget kommer ind.</p>
${saved ? '<p class="notice">Gemt. Saga kender dem nu.</p>' : ""}${responsibilitiesForm(base, text, "/profil")}</div>`;
}

function memoryCard(base: string): string {
  return `<div class="card"><h2>Det Saga har lært</h2><p class="small muted">Det, I har fortalt Saga i chatten, og som hun husker. Tager hun fejl, så fortæl hende det - eller fjern det her.</p>
<p style="margin:0"><a href="${base}/hukommelse">Se, hvad Saga husker →</a></p></div>`;
}

/** The chair's way to the board members' details - whether each has activated their login, what they are responsible for and what they asked Saga. */
function adminsCard(base: string): string {
  return `<div class="card"><h2>Bestyrelsens medlemmer</h2><p class="small muted">Hvem der har aktiveret deres login, hvad de har ansvar for, og hvad de har spurgt Saga om. Kun for formanden.</p>
<p style="margin:0;display:flex;gap:18px;flex-wrap:wrap"><a href="${base}/administratorer">Administratorer →</a><a href="${base}/samtaler">Samtaler med Saga →</a><a href="${base}/formand/log">Formandens log →</a></p></div>`;
}

/** The phone's "Mere": the pages that do not fit the tab bar, and who you are. */
export function morePage(base: string, who: string | null, options: { lang?: "da" | "en"; locked?: boolean; members?: string[]; done?: string | null; responsibilities?: string; saved?: boolean; chair?: boolean } = {}): string {
  // Logged in with Saga's personal link you are who you are; the chair can close a member's access.
  // Requested: "Once you have logged in, you can't change to another person." No switching - log out to be someone else.
  const me = who ? `<span class="muted" style="padding:12px 0;display:block">Logget ind som ${esc(who)}</span>` : `<a href="${base}/hvem">Vælg hvem du er</a>`;
  const access = options.members?.length ? `<div class="card"><h2>Adgang</h2><p class="small muted">Luk et medlems adgang: deres login på alle enheder ophører, og de skal bede Saga om et nyt link.</p>
${options.done ? `<p class="notice">${esc(options.done)}s adgang er lukket.</p>` : ""}<ul class="plain">${options.members.map(m => `<li style="display:flex;justify-content:space-between;align-items:center;gap:12px">${esc(m)}
<form method="post" action="${base}/adgang" style="margin:0"><input type="hidden" name="member" value="${esc(m)}"><button class="ghost">Luk adgang</button></form></li>`).join("")}</ul></div>` : "";
  return layout(base, "Profil", `<main><h1>${esc(who ?? "Profil")}</h1><div class="card"><div class="menu">
<a href="${base}/posthus">Posthus</a><a href="${base}/statistik">Statistik</a><a href="${base}/medlemmer">Medlemmer</a><a href="${base}/status">Sagas fulde overblik</a><a href="${base}/arkiv">Ældre referater</a>${me}
<form method="post" action="${base}/logout" style="margin:0"><button class="ghost" style="border:0">Log ud</button></form></div></div>${who ? responsibilitiesCard(base, options.responsibilities ?? "", Boolean(options.saved)) : ""}${who ? memoryCard(base) : ""}${options.chair ? adminsCard(base) : ""}${who ? languageCard(base, options.lang ?? "da") : ""}${access}</main>`, { section: "/profil", who });
}

/* Requested: "der er rigtig meget blåt på siden, så jeg tænker, om du ikke kan finde en alternativ farve til chatwidgetten, som passer til temaet": Saga has her own warm
   coral, from the glow of the page (--glow-2). Only her tokens change - the buttons, the messages and the links inside her panel follow. */
const SAGA_STYLE = `
.saga,.saga-fab{--accent:#c4523a;--accent-2:#a8412c;--accent-ink:#fff;--tint:#fbe6df}
@media (prefers-color-scheme:dark){.saga,.saga-fab{--accent:#f2a58e;--accent-2:#f7bba8;--accent-ink:#2a140d;--tint:#33211c}}
.saga-fab{position:fixed;right:18px;bottom:18px;z-index:20;border-radius:999px;padding:12px 18px;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;gap:8px;align-items:center}
.saga-fab::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent-ink);opacity:.85}
.saga{position:fixed;right:18px;bottom:18px;z-index:45;width:min(400px,calc(100vw - 24px));height:min(600px,calc(100vh - 36px));background:var(--card);border:1px solid var(--line);
border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
.saga[hidden]{display:none!important}.saga-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}.saga-top div{flex:1;line-height:1.25}
.saga-hint{margin:0;padding:8px 14px 0;font-size:12.5px;line-height:1.4}.saga-top strong{font-size:13px;letter-spacing:.14em;text-transform:uppercase}.saga-top button{padding:4px 10px}.saga-log{flex:1;overflow-y:auto;padding:14px;display:grid;gap:10px;align-content:start}
.saga-msg{padding:9px 12px;border-radius:12px;max-width:92%;word-break:break-word}.saga-msg p{margin:0 0 6px}.saga-msg p:last-child{margin:0}.saga-msg ul{margin:4px 0;padding-left:18px}
.saga-msg h1,.saga-msg h2,.saga-msg h3{font-size:14px;margin:6px 0 4px}.saga-a{background:var(--soft)}.saga-u{background:var(--accent);color:var(--accent-ink);justify-self:end;white-space:pre-wrap}
.saga-wait{color:var(--muted);font-style:italic}.saga-err{color:var(--warn)}.saga-ideas{display:flex;flex-wrap:wrap;gap:6px}
.saga-ideas button{background:transparent;color:var(--accent);border:1px solid var(--line);font-weight:500;font-size:13px;padding:6px 10px;text-align:left}
.saga form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}.saga textarea{min-height:44px;max-height:140px;resize:none;flex:1}
@media (max-width:760px){.saga{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0;z-index:46}.saga-fab{right:14px;bottom:calc(var(--nav-h) + 14px + env(safe-area-inset-bottom));padding:11px 16px}}
@media print{.saga,.saga-fab{display:none!important}}`;

// Requested: "Presets" - Jacob's five.
const IDEAS = ["Hjælp mig med at opsætte event", "Hvad er mine to-do's?", "Hvilke beslutninger har vi truffet om medlemskab?", "Hvilke sager hænger lige nu?", "Hvilke arrangementer er der de næste to uger?"];

/** Saga in the bottom-right corner of every page. The conversation lives in this tab only. */
function sagaChat(base: string, who: string | null): string {
  // Requested: "Hej \"navn\"🙂 Jeg er Saga. Spørg mig f. eks. om vedtægter, beslutninger, sager, møder, arrangementer og medlemsskab."
  const first = who?.trim().split(/\s+/)[0] ?? "";
  return `<style>${SAGA_STYLE}</style><button type="button" class="saga-fab" id="saga-open" aria-expanded="false" aria-controls="saga">Spørg Saga</button>
<section class="saga" id="saga" hidden aria-label="Spørg Saga"><div class="saga-top"><div><strong>Chat med Saga</strong></div>
<button type="button" class="ghost" id="saga-new" title="Start en ny samtale">Ny samtale</button><button type="button" class="ghost" id="saga-close" aria-label="Luk">Luk</button></div>
<div class="saga-log" id="saga-log" aria-live="polite"><div class="saga-msg saga-a">Hej${first ? ` ${esc(first)}` : ""} 🙂 Jeg er Saga. Spørg mig f.eks. om vedtægter, beslutninger, sager, møder, arrangementer og medlemskab.</div>
<div class="saga-ideas">${IDEAS.map(idea => `<button type="button">${esc(idea)}</button>`).join("")}</div></div>
<p class="saga-hint small muted">Hvis Saga tager fejl, så fortæl hende det - på den måde får vi bygget en klog og nyttig assistent med tiden.</p>
<form id="saga-form"><textarea id="saga-q" rows="1" maxlength="1500" placeholder="Skriv dit spørgsmål" aria-label="Dit spørgsmål"></textarea><button>Send</button></form></section>
<script>(()=>{const url=${JSON.stringify(`${base}/saga`)},box=document.getElementById("saga"),fab=document.getElementById("saga-open"),log=document.getElementById("saga-log"),form=document.getElementById("saga-form"),q=document.getElementById("saga-q");
// Requested: "Sørg også for, at chatten med Saga nulstilles inden for normale standarder": after 30 minutes
// without a question the conversation starts over, and "Ny samtale" starts one at once.
const IDLE=30*60*1000;let history=[];try{const kept=JSON.parse(sessionStorage.getItem("saga-chat")||"null");if(kept&&Array.isArray(kept.h)&&Date.now()-Number(kept.t||0)<IDLE)history=kept.h}catch(e){}
const save=()=>{try{sessionStorage.setItem("saga-chat",JSON.stringify({t:Date.now(),h:history.slice(-12)}))}catch(e){}};
document.getElementById("saga-new").onclick=()=>{history=[];try{sessionStorage.removeItem("saga-chat")}catch(e){}log.querySelectorAll(".saga-msg:not(:first-child)").forEach(m=>m.remove());q.focus()};
const add=(cls,content,isHtml)=>{const d=document.createElement("div");d.className="saga-msg "+cls;if(isHtml)d.innerHTML=content;else d.textContent=content;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
for(const t of history)add(t.role==="user"?"saga-u":"saga-a",t.role==="user"?t.content:t.html||t.content,t.role!=="user");
const open=(v,quiet)=>{box.hidden=!v;fab.hidden=v;fab.setAttribute("aria-expanded",String(v));if(v){try{sessionStorage.setItem("saga-popped","1")}catch(e){}if(!quiet)q.focus()}};
fab.onclick=()=>open(true);document.getElementById("saga-close").onclick=()=>open(false);
// Requested: "Lad Saga poppe op efter et minut". Once per browser session, a minute after the page opens, the chat opens by itself -
// without taking the cursor, and not while someone is writing in a field or has already used Saga.
// Requested: "Chat skal ikke poppe op på mobiler": on a phone the chat fills the whole screen, so there it only opens when someone presses "Spørg Saga".
try{if(!sessionStorage.getItem("saga-popped")&&!matchMedia("(max-width:760px)").matches)setTimeout(()=>{const a=document.activeElement,typing=a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a!==q;
if(!box.hidden||history.length||typing||sessionStorage.getItem("saga-popped"))return;open(true,true)},60000)}catch(e){}
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
<p class="small muted">Saga sender dig et personligt link og en kode. Begge virker én gang inden for 15 minutter. Du kan også skrive /login til hende.</p>
<form class="stack" method="post" action="${base}/login/kode"><label>Har du en kode fra Saga?<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="0000 0000" required></label>
<button class="ghost">Log ind med kode</button></form>
<p class="small muted">Åbner linket i Telegrams egen browser, bliver du kun logget ind dér. Skriv i stedet koden her, i den browser du plejer at bruge til admin.</p>` : "";
  const password = configured ? `<form class="stack" method="post" action="${base}/login"><label>Fælles adgangskode<input type="password" name="password" autocomplete="current-password" required${personal ? "" : " autofocus"}></label>
<button${personal ? ' class="ghost"' : ""}>Log ind</button></form>` : "";
  return layout(base, "Log ind", `<div class="center"><div class="card"><div class="mark"><img src="${base}/logo.png?v=${COCKPIT_VERSION}" alt="Hjerterum"></div><h1>Hjerterum bestyrelse</h1>
<p class="muted">Bestyrelsens admin med møder, referater og beslutninger.</p>
${message ? `<p class="notice warn">${esc(message)}</p>` : ""}${personal}${personal && password ? `<p class="small muted" style="margin:18px 0 6px">Eller med den fælles adgangskode</p>` : ""}${password}
${personal || password ? "" : `<p class="notice warn">Admin er ikke sat op endnu: formanden mangler at vælge den fælles adgangskode.</p>`}</div></div>`);
}

/** Saga's personal link: one press logs in, so a link preview in Telegram never does. */
export function linkPage(base: string, member: string | null, token: string): string {
  return layout(base, "Log ind", `<div class="center"><div class="card"><div class="mark"><img src="${base}/logo.png?v=${COCKPIT_VERSION}" alt="Hjerterum"></div><h1>Hjerterum bestyrelse</h1>
${member ? `<p>Du logger ind som <strong>${esc(member)}</strong>.</p><form method="post" action="${base}/login/link/${esc(token)}"><button>Log ind</button></form>
<p class="small muted">Står du i Telegrams egen browser? Så bliver du kun logget ind her. Vil du være det i din almindelige browser, så tryk ikke - gå til admin-siden dér, og skriv koden fra Saga.</p>`
    : `<p class="notice warn">Linket er brugt eller udløbet. Skriv /login til Saga på Telegram for et nyt.</p><p><a href="${base}/">Til login</a></p>`}</div></div>`);
}

export function whoPage(base: string, names: string[], current: string | null): string {
  return layout(base, "Hvem er du?", `<main><div class="card" style="max-width:520px"><h1>Hvem er du?</h1>
<p class="muted">Så viser overblikket dine egne opgaver. Du vælger én gang: valget gælder, til du logger ud.</p>
<form class="stack" method="post" action="${base}/hvem">${names.length ? names.map(name => `<label style="flex-direction:row;display:flex;align-items:center;gap:8px;font-weight:500">
<input type="radio" name="who" value="${esc(name)}" style="width:auto"${name === current ? " checked" : ""} required> ${esc(name)}</label>`).join("")
    : `<label>Dit navn<input name="who" required maxlength="60" value="${esc(current ?? "")}"></label>`}
<button>Fortsæt</button></form></div></main>`, { section: "", who: current });
}

const taskLine = (task: Task) => `<li>${task.who ? `<strong>${esc(task.who)}</strong> · ` : ""}${esc(task.what)}${task.due ? ` <span class="pill">${esc(task.due)}</span>` : ""}
${task.meeting ? `<div class="small muted">${esc(agreedLabel(task.meeting))}</div>` : ""}</li>`;

/** Requested: "Der skal i øvrigt kunne vælges en Mødeleder og Ordstyrer.": two choices among the board - a name that has left the group stays in the list while it is chosen. */
function roleSelects(members: string[], m: Pick<Meeting, "leader" | "moderator"> | null): string {
  const one = (name: string, label: string, chosen: string | null | undefined) => {
    const names = [...members, ...(chosen && !members.includes(chosen) ? [chosen] : [])];
    return `<label>${label}<select name="${name}"><option value="">Ikke valgt</option>${names.map(n => `<option value="${esc(n)}"${n === chosen ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
  };
  return `<div class="row">${one("leader", "Mødeleder", m?.leader)}${one("moderator", "Ordstyrer", m?.moderator)}</div>`;
}

/** The pencil beside the cross of an agenda point: a small blue pencil that opens the point for editing in place. */
const PENCIL = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16l-3.8.8L4 13z"/><path d="M11.5 5.5l3 3"/></svg>`;
/** The grip at the left of an agenda point: six dots - take hold here to move the point. */
const GRIP = `<svg viewBox="0 0 12 18" width="12" height="18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg>`;
const KIND_TAG: Record<string, string> = { team: `<span class="kind-tag team">Teammøde</span>` };
/** Requested: "Lad der kun blive vist fem punkter og sæt en knap: Klik her for detaljer" and "Vi skal også benytte samfoldede afsnit på siden generelt, ellers bliver det for voldsomt":
 * the first five lines of a long list stand open, the rest is folded under a button that says how many there are. */
export const SHOWN = 5;
export function fold(open: string, close: string, body: string, count?: number): string {
  return `<details class="fold"><summary><span class="fold-more">${open}</span><span class="fold-less">${close}</span>${count ? ` <span class="pill">${count}</span>` : ""}</summary><div class="fold-body">${body}</div></details>`;
}

/** A card that stays folded - its title is the button - until it is opened (or a link to its id is followed). */
function foldCard(id: string, title: string, body: string, open: boolean): string {
  return `<details class="card foldcard" id="${id}"${open ? " open" : ""}><summary><h2>${title}</h2></summary><div class="fold-body">${body}</div></details>`;
}

function meetingSummary(base: string, m: Meeting, members: string[] = [], coming?: string[]): string {
  // Requested: "I do not want Sagas suggestions here in the overview": only the board's own points are shown; hers are on the meeting's page, under Rediger møde.
  const saga = new Set((m.agenda_saga ?? "").split("\n").filter(Boolean)), authors = agendaAuthors(m.agenda_authors);
  const all = m.agenda.split("\n").filter(Boolean), items = all.filter(item => !saga.has(item));
  const point = (item: string) => `<li>${esc(item)}${saga.has(item) ? ` <span class="saga-mark inline">Sagas forslag</span>` : authors[item] && members.length ? ` ${personChip(members, authors[item]!)}` : ""}</li>`;
  return `<p><strong>${esc(longDay(m.meeting_date))}</strong>${m.start_time ? ` kl. ${esc(m.start_time)}` : ""}${m.place ? ` · ${esc(m.place)}` : ""}${m.kind ? KIND_TAG[m.kind] : ""}</p>
${rolesLine(m) ? `<p class="small muted" style="margin:-6px 0 8px">${esc(rolesLine(m))}</p>` : ""}
${items.length ? `<div class="agenda-box"><ol class="agenda">${items.slice(0, SHOWN).map(item => point(item)).join("")}</ol>${items.length > SHOWN ? fold("Klik her for detaljer", "Skjul detaljer", `<ol class="agenda" start="${SHOWN + 1}">${items.slice(SHOWN).map(item => point(item)).join("")}</ol>`, items.length - SHOWN) : ""}</div>` : `<p class="muted small">${all.length ? "Kun Sagas forslag endnu - du finder dem under Rediger møde." : "Ingen dagsorden endnu."}</p>`}
<p class="meet-actions"><a class="button ghost" href="${base}/moder/${m.id}">Rediger møde</a>${coming === undefined ? "" : `<span class="small muted">${coming.length
    // Requested: "Der skal så stå deltagere diskret til højre for Rediger møde-knappen" - who pressed "Jeg kommer" (assocEvents.ts).
    ? `Deltagere: ${esc(coming.map(n => n.trim().split(/\s+/)[0] ?? n).join(", "))} (${coming.length})` : "Ingen har meldt sig endnu"}</span>`}</p>`;
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
export type MinutesState = "working" | "waiting" | "failed";
const STATE_TEXT: Record<MinutesState, string> = { working: "Saga skriver referatet", waiting: "Lægges op om lidt", failed: "Referatet kunne ikke laves - upload igen" };

export type OverviewData = { who: string | null; isChair: boolean; toSign: ApprovedMinutes[]; mine: Task[]; ownTodos?: Array<{ text: string; due: string | null; created_by: string }>; everyone: Task[]; forChair: BoardPicture["forJacob"]; next: Meeting | null;
  found: Array<{ date: string; what: string }>; picture: BoardPicture | null; summary: string | null; at: number | null; progress: { working: number; waiting: number }; today: string;
  group: GroupNow | null; weekly: { text: string; created_at_ms: number } | null; recent: Array<{ id: number; date: string; decisions: string[]; tasks: number }>; docUrl: string | null };

function foundMeetings(base: string, found: OverviewData["found"], today: string): string {
  return found.length ? `<h3>Fundet af Saga</h3><ul class="plain">${found.map(f => `<li><strong>${esc(longDay(f.date))}</strong> <span class="pill">${inDays(daysUntil(f.date, today))}</span>
<div class="small muted">${esc(f.what)}</div><a class="small" href="${base}/moder?dato=${esc(f.date)}${guessKind(f.what) ? `&amp;art=${guessKind(f.what)}` : ""}#nyt">Sæt i kalenderen</a></li>`).join("")}</ul>` : "";
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
  // Requested: the bar under the header is "den eneste notifikation om godkendelsen" (signReminder.ts) - no list of minutes to approve here.
  const forChair = data.isChair && data.forChair.length ? `<h3>Til dig som formand</h3><ul class="plain">${data.forChair.slice(0, 5).map(f => `<li>${esc(f.text)}<div class="small muted">${esc(f.kind)} · ${esc(SOURCE[f.source] ?? f.source)}${f.from ? ` · ${esc(f.from)}` : ""}</div></li>`).join("")}</ul>
${data.forChair.length > 5 ? `<p class="small"><a href="${base}/status#formand">${data.forChair.length - 5} mere</a></p>` : ""}` : "";
  // Your open items first (your own, or written to you), then the minutes' tasks not yet checked off.
  const own = data.ownTodos ?? [], open = own.length + data.mine.length;
  const lines = [...own.map(t => `<li>${esc(t.text)}${t.due ? ` <span class="pill">${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due) ? shortDay(t.due) : t.due)}</span>` : ""}${t.created_by !== data.who ? `<div class="small muted">Fra ${esc(t.created_by)}</div>` : ""}</li>`), ...data.mine.map(taskLine)];
  const tasks = open ? `<h3>Dine opgaver</h3><ul class="plain">${lines.slice(0, 5).join("")}</ul><p class="small"><a href="${base}/opgaver">${open > 5 ? `Alle ${open} opgaver` : "Kryds af eller skriv en opgave"} →</a></p>` : "";
  const mine = `<div class="card"><h2>Dine opgaver</h2>${forChair}${tasks}
${forChair || tasks ? "" : `<p class="muted">${data.who ? `Intet venter på dig lige nu. <a href="${base}/opgaver">Skriv en opgave</a>` : `<a href="${base}/hvem">Vælg hvem du er</a> for at se dine opgaver.`}</p>`}</div>`;
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
<p style="margin:14px 0 0"><a class="button" href="${base}/referat/${latest.id}">Læs referatet</a></p></div>` : "";
  const chips = [
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
<p class="small muted">Marker dem som klaret under Opgaver.</p></div>` : "";
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
<button>Upload og lav referat</button><p class="small muted">Saga skriver referatet ud fra optagelsen og lægger det op her. Bestyrelsen godkender det, og hvert medlem kan rette de enkelte punkter.</p><p class="small muted">Lydfilen slettes 14 dage efter, at referatet er lagt op. Referatet og transskriptionen beholdes.</p></form>
<script>document.querySelectorAll("[data-other]").forEach(s=>s.addEventListener("change",()=>{s.form.querySelector("[data-other-date]").hidden=s.value!=="anden"}))</script>`;
}

export function meetingsPage(base: string, data: { members: string[]; upcoming: Meeting[]; past: PastMeeting[]; found: Array<{ date: string; what: string }>; suggestion: string[];
  prefill: { date: string; kind: "" | "team" | "andet" }; today: string; who: string | null; notice: string; uploads: boolean; coming?: Map<string, string[]> }): string {
  const form = `<form class="stack" method="post" action="${base}/moder"><div class="row"><label>Dato<input type="date" name="meeting_date" required min="${esc(data.today)}" value="${esc(data.prefill.date)}"></label>
<label>Tid<input type="time" name="start_time"></label><label>Sted<input name="place" maxlength="200" value="${esc(DEFAULT_PLACE)}"></label></div>
${roleSelects(data.members, null)}
<div><label class="pick"><input type="checkbox" name="kind" value="team"${data.prefill.kind === "team" ? " checked" : ""}> Teammøde</label><input type="hidden" name="kind_sent" value="1">
<p class="small muted" style="margin:6px 0 0">Sæt kryd, hvis det er et teammøde - så kan Saga foreslå punkter, når du beder hende om det på mødets side.</p></div>
<p class="small muted" style="margin:0">Dagsordenens punkter tilføjes ét ad gangen på mødets side.</p>
<div class="actions"><button>Gem møde</button></div></form>`;
  const status = (row: PastMeeting) => row.minutes ? `<a href="${base}/referat/${row.minutes.id}">Læs referat</a>` : row.state ? `<span class="${row.state === "failed" ? "warn" : "muted"}">${STATE_TEXT[row.state]}</span>`
    : row.inDocument ? `<a href="${base}/arkiv#${esc(row.date)}">I referatdokumentet</a>` : row.meeting ? `<a href="${base}/moder/${row.meeting.id}#upload">Upload optagelse</a>` : `<span class="muted">Mangler</span>`;
  const pastTable = (rows: PastMeeting[]) => `<table class="rows"><tr><th>Dato</th><th>Dagsorden</th><th>Referat</th></tr>${rows.map(row => `<tr><td data-label="Dato"><strong>${esc(shortDay(row.date))}</strong></td>
<td data-label="Dagsorden">${row.meeting ? `<a href="${base}/moder/${row.meeting.id}">${row.meeting.agenda.split("\n").filter(Boolean).length} punkter</a>` : `<span class="muted">-</span>`}</td>
<td data-label="Referat">${status(row)}</td></tr>`).join("")}</table>`;
  return layout(base, "Møder", `<main><h1>Møder</h1>${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}
<div class="grid"><div class="card"><h2>Kommende møder</h2>${data.upcoming.length ? data.upcoming.map(m => `<div style="margin-bottom:14px">${meetingSummary(base, m, data.members, data.coming?.get(`moede:${m.id}`) ?? [])}<p class="small muted">${inDays(daysUntil(m.meeting_date, data.today))}</p></div>`).join("") : `<p class="muted">Ingen møder planlagt.</p>`}
${foundMeetings(base, data.found, data.today)}</div>
<div class="stack-cards">${foldCard("nyt", "Planlæg et møde", form, Boolean(data.prefill.date || data.prefill.kind))}
${foldCard("upload", "Optag et møde", data.uploads ? `${recorderCard(base, { date: data.today, meetingId: data.upcoming.find(m => m.meeting_date === data.today)?.id ?? null })}${uploadForm(base, data.past, data.today)}` : `<p class="muted">Upload er ikke sat op endnu (lageret til optagelser mangler).</p>`, false)}
<p class="notice info-note"><strong>Påmindelse om mødet:</strong> Om morgenen på mødedagen (fra kl. 8) skriver Saga i gruppen, at dagsordenen er klar, med punkterne, hvornår I ses og et link til dagsordenen. Det sker for teammøder, der har punkter på dagsordenen.</p></div></div>
<div class="grid"><div class="card"><h2>Holdte møder</h2>${data.past.length ? `${pastTable(data.past.slice(0, SHOWN))}${data.past.length > SHOWN ? fold("Klik her for at se alle møder", "Skjul de ældre møder", pastTable(data.past.slice(SHOWN)), data.past.length - SHOWN) : ""}` : `<p class="muted">Ingen holdte møder endnu.</p>`}</div></div>
<script>{const open=()=>{const h=location.hash&&document.querySelector(location.hash.replace(/[^#\w-]/g,""));if(h&&h.tagName==="DETAILS"){h.open=true;h.scrollIntoView()}};open();addEventListener("hashchange",open)}</script></main>`, { section: "/moder", who: data.who, style: WHO_CHIP_STYLE });
}

export function meetingPage(base: string, m: Meeting, data: { members: string[]; minutes: ApprovedMinutes | null; state: MinutesState | null; suggestion: string[]; today: string; uploads: boolean; aiReady?: boolean },
  who: string | null, notice: string): string {
  const held = m.meeting_date <= data.today;
  const authors = agendaAuthors(m.agenda_authors);
  const points = m.agenda.split("\n").map(l => l.trim()).filter(Boolean), saga = new Set((m.agenda_saga ?? "").split("\n").map(l => l.trim()).filter(Boolean));
  // The document's suggestion that is not on the agenda yet - and only as many as Saga has room for (five of hers at a time).
  const offered = Math.min(data.suggestion.filter(p => !points.includes(p)).length, sagaRoom(m));
  // Requested: "Det giver ikke mening, at hele halvdelen af skærmen bruges til et referat, der selvfølgelig ikke er lavet, fordi man er ved at planlægge et møde":
  // a meeting still to come has the whole width for its agenda; the minutes card comes when the meeting is held (or minutes are on their way).
  const showMinutes = held || Boolean(data.minutes) || Boolean(data.state);
  const minutesCard = data.minutes ? `<p><a class="button" href="${base}/referat/${data.minutes.id}">Læs referatet</a></p>`
    : `${data.state ? `<p class="notice${data.state === "failed" ? " warn" : ""}">${STATE_TEXT[data.state]}.</p>` : `<p class="muted">Intet godkendt referat endnu.</p>`}
${held && data.uploads && data.state !== "working" && data.state !== "waiting" ? `${recorderCard(base, { date: m.meeting_date, meetingId: m.id })}<form class="stack" id="upload" method="post" action="${base}/upload" enctype="multipart/form-data"><input type="hidden" name="meeting_choice" value="${esc(m.meeting_date)}"><input type="hidden" name="meeting_id" value="${m.id}">
<label>Optagelse af dette møde (mp3, m4a, wav, ogg - højst 60 MB)<input type="file" name="recording" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" required></label>
<button>Upload og lav referat</button><p class="small muted">Saga skriver referatet ud fra optagelsen og dagsordenen og lægger det op her til bestyrelsens godkendelse.</p><p class="small muted">Lydfilen slettes 14 dage efter, at referatet er lagt op. Referatet og transskriptionen beholdes.</p></form>` : ""}`;
  return layout(base, `Rediger møde ${shortDay(m.meeting_date)}`, `<main><p class="small"><a href="${base}/moder">← Møder</a></p><p class="editing-banner">${PENCIL}Rediger møde</p><h1>${esc(longDay(m.meeting_date))}</h1>
${notice ? `<p class="notice good">${esc(notice)}</p>` : ""}<div class="grid${showMinutes ? "" : " single"}"><div class="card" id="dagsorden"><h2>Dagsorden${m.kind ? KIND_TAG[m.kind] : ""}</h2>
${rolesLine(m) ? `<p class="small muted" style="margin:-6px 0 10px">${esc(rolesLine(m))}</p>` : ""}
${points.length ? `<ol class="agenda points" data-order="${base}/moder/${m.id}/punkt/raekkefolge">${points.map(p => `<li data-point="${esc(p)}">${points.length > 1 ? `<button type="button" class="grip" aria-label="Flyt punktet: ${esc(p)}" title="Træk for at flytte punktet - eller brug pil op og ned">${GRIP}</button>` : ""}<span class="t">${esc(p)}</span>${saga.has(p) ? `<span class="saga-mark">Sagas forslag</span>` : authors[p] ? personChip(data.members, authors[p]!) : ""}<button type="button" class="pencil" data-edit aria-label="Ret punktet: ${esc(p)}" title="Ret punktet">${PENCIL}</button><form class="cross" method="post" action="${base}/moder/${m.id}/punkt/slet"><input type="hidden" name="text" value="${esc(p)}"><button aria-label="Fjern punktet: ${esc(p)}" title="Fjern punktet">×</button></form>
<form class="editpoint" method="post" action="${base}/moder/${m.id}/punkt/ret"><input type="hidden" name="old" value="${esc(p)}"><input name="text" value="${esc(p)}" required maxlength="200" autocomplete="off" aria-label="Ret punktet"><button>Gem</button><button type="button" class="ghost" data-cancel>Annullér</button></form></li>`).join("")}</ol>`
    : `<p class="muted small">Ingen punkter endnu.</p>`}
<script>(()=>{const list=document.querySelector("ol.agenda.points[data-order]");if(!list)return;
const items=()=>[...list.querySelectorAll("li[data-point]")],order=()=>items().map(li=>li.dataset.point).join("\\n");
const save=()=>{const f=new FormData();items().forEach(li=>f.append("p",li.dataset.point));fetch(list.dataset.order,{method:"POST",body:f,headers:{"x-requested-with":"fetch"},credentials:"same-origin"}).then(r=>{if(!r.ok)location.reload()}).catch(()=>location.reload())};
list.querySelectorAll(".grip").forEach(g=>{
g.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"&&e.button!==0)return;e.preventDefault();const li=g.closest("li"),was=order();li.classList.add("dragging");
const move=ev=>{let before=null;for(const x of items()){if(x===li)continue;const r=x.getBoundingClientRect();if(ev.clientY<r.top+r.height/2){before=x;break}}
if(before){if(li.nextElementSibling!==before)list.insertBefore(li,before)}else if(list.lastElementChild!==li)list.appendChild(li)};
const done=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",done);document.removeEventListener("pointercancel",done);li.classList.remove("dragging");if(order()!==was)save()};
document.addEventListener("pointermove",move);document.addEventListener("pointerup",done);document.addEventListener("pointercancel",done)});
g.addEventListener("keydown",e=>{if(e.key!=="ArrowUp"&&e.key!=="ArrowDown")return;e.preventDefault();const li=g.closest("li"),other=e.key==="ArrowUp"?li.previousElementSibling:li.nextElementSibling;if(!other)return;
if(e.key==="ArrowUp")list.insertBefore(li,other);else list.insertBefore(other,li);g.focus();save()})})})();
document.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{const li=b.closest("li");li.classList.add("editing");const i=li.querySelector(".editpoint input[name=text]");i.focus();i.select()}));
document.querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>b.closest("li").classList.remove("editing")))</script><noscript><style>ol.agenda.points .editpoint{display:flex}ol.agenda.points .pencil{display:none}</style></noscript>
<form class="addpoint" method="post" action="${base}/moder/${m.id}/punkt"><input name="text" required maxlength="200" autocomplete="off" placeholder="Nyt punkt, fx Økonomi" aria-label="Nyt punkt"><button>Tilføj punkt</button></form>
${!held && m.kind === "team" && (offered || data.aiReady) ? `<div class="suggest-row">${offered ? `<form method="post" action="${base}/moder/${m.id}/forslag/dokument"><button class="ghost">Tilføj Sagas forslag fra dokumentet (${offered} ${offered === 1 ? "punkt" : "punkter"})</button></form>` : ""}
${data.aiReady ? `<form method="post" action="${base}/moder/${m.id}/forslag" id="agenda-ask"><button class="ghost">Bed Saga om forslag til dagsorden</button></form>` : ""}</div>
${data.aiReady ? `<p class="small muted">Saga laver kun forslag, når du beder hende om det - de står nederst som punkter. Slet dem, du ikke vil have, med krydset - det koster ingen AI.</p>
<script>document.getElementById("agenda-ask").addEventListener("submit",e=>{const b=e.currentTarget.querySelector("button");setTimeout(()=>{b.disabled=true},0);b.textContent="Saga læser …"})</script>` : ""}` : ""}
<h3 style="margin:18px 0 8px" id="detaljer">Dato, tid, sted og roller</h3>
<form class="stack" method="post" action="${base}/moder/${m.id}"><div class="row"><label>Dato<input type="date" name="meeting_date" required value="${esc(m.meeting_date)}"></label>
<label>Tid<input type="time" name="start_time" value="${esc(m.start_time ?? "")}"></label><label>Sted<input name="place" maxlength="200" value="${esc(m.place || DEFAULT_PLACE)}"></label></div>
${roleSelects(data.members, m)}
<div><label class="pick"><input type="checkbox" name="kind" value="team"${m.kind === "team" ? " checked" : ""}> Teammøde</label><input type="hidden" name="kind_sent" value="1">
<p class="small muted" style="margin:6px 0 0">Sæt kryd, hvis det er et teammøde - så kan Saga foreslå punkter, når du beder hende om det på mødets side.</p></div>
<div class="actions"><button class="ghost">Gem ændringer</button></div></form>
${m.updated_by ? `<p class="small muted">Sidst rettet af ${esc(m.updated_by)}.</p>` : ""}
<form method="post" action="${base}/moder/${m.id}/slet" onsubmit="return confirm('Slette mødet og dets dagsorden?')"><button class="ghost">Slet møde</button></form></div>
${showMinutes ? `<div class="card"><h2>Referat</h2>${minutesCard}</div>` : ""}</div></main>`, { section: "/moder", who, style: WHO_CHIP_STYLE });
}

/** Every decision on the list wears the laurel: a decision is valid when it is taken - whether the minutes have been approved by the whole board is another matter, and never
 * changes how the decision is shown. For minutes made in the admin that are still waiting, the source column says so on its own line (`approvals`: how many have approved, per minutes -
 * one entry for each minutes made in the admin; the minutes document's have none).
 * Requested: "bare fordi referatet ikke er godkendt, betyder det jo ikke, at vi ikke har truffet gyldige beslutninger. Så det skal vi være meget opmærksomme på."
 * Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling": the points
 * that are not decisions - informal agreements and recommendations (`kind: "aftale"`, decisionKinds.ts) - stand in a card of their own - no laurel - and each point can be moved to the other list by a board member. */
export function decisionsPage(base: string, decisions: Decision[], who: string | null, votes?: VoteBlocks & { notice: string }, approvals?: { members: number; approved: Map<number, number> }, sorting = false): string {
  const pending = (d: Decision) => { const n = d.minutesId !== null ? approvals?.approved.get(d.minutesId) : undefined; return n !== undefined && approvals !== undefined && !(approvals.members > 0 && n >= approvals.members) ? n : null; };
  const decided = decisions.filter(d => d.kind !== "aftale"), agreed = decisions.filter(d => d.kind === "aftale");
  // The buttons that move a point stay hidden until "Ret sortering" is pressed: next to every laurel they would read as a verdict on the decision.
  const sortToggle = who ? `<button type="button" class="linkbtn sort-toggle" data-sorting aria-pressed="false"><span class="off">Ret sortering</span><span class="on">Færdig med at rette</span></button>` : "";
  const source = (d: Decision) => d.source === "afstemning" ? `<a href="#p${d.voteId ?? ""}">${d.atMeeting ? "Møde" : "Afstemning"}</a>` : d.minutesId ? `<a href="${base}/referat/${d.minutesId}">Referat</a>` : `<span class="muted">Dokumentet</span>`;
  const move = (d: Decision, to: "aftale" | "beslutning") => who && d.source !== "afstemning"
    ? `<form class="move" method="post" action="${base}/beslutninger/art"><input type="hidden" name="text" value="${esc(d.text)}"><input type="hidden" name="kind" value="${to}"><button class="linkbtn">${to === "aftale" ? "Flyt til aftaler" : "Flyt til beslutninger"}</button></form>` : "";
  const row = (d: Decision) => `<tr><td data-label="Dato">${esc(/^\d{4}-/.test(d.date) ? shortDay(d.date) : d.date || "-")}</td>
<td data-label="Beslutning"><div class="dec"><span class="seal">${laurel(34)}</span><div class="said">${d.source === "afstemning" ? APPROVED_BADGE : ""}${d.topic ? `<strong>${esc(d.topic)}:</strong> ` : ""}${esc(d.text)}</div></div></td><td data-label="Kilde">${source(d)}${approvals && pending(d) !== null ? `<div class="small muted">Referatet: ${pending(d)} af ${approvals.members} har godkendt</div>` : ""}</td><td class="act">${move(d, "aftale")}</td></tr>`;
  const agreement = (d: Decision) => `<tr><td data-label="Dato">${esc(/^\d{4}-/.test(d.date) ? shortDay(d.date) : d.date || "-")}</td>
<td data-label="Aftale"><div class="dec"><span class="handshake" aria-hidden="true">${HANDSHAKE}</span><div class="said">${d.topic ? `<strong>${esc(d.topic)}:</strong> ` : ""}${esc(d.text)}</div></div></td><td data-label="Kilde">${source(d)}${d.kindBy ? `<div class="small muted">Sorteret af ${esc(d.kindBy)}</div>` : ""}</td><td class="act">${move(d, "beslutning")}</td></tr>`;
  // Requested: "Lav lignende oprydning på /beslutninger": the latest five of each stand open, the older ones are folded under a button - a search opens them.
  const decisionTable = (id: string, what: string, rows: string[]) => `<table id="${id}" class="rows decisions"><tr><th>Dato</th><th>${what}</th><th>Kilde</th><th class="act"></th></tr>${rows.join("")}</table>`;
  return layout(base, "Beslutninger", `<main class="sortable"><h1>Beslutninger og aftaler</h1>${votes ? `<p class="muted">Bestyrelsens beslutninger fra referaterne og de digitale afstemninger. ${votes.intro}</p>
${votes.notice ? `<p class="notice">${esc(votes.notice)}</p>` : ""}${votes.create}${votes.open}` : ""}${sorting ? `<p class="notice">Saga sorterer beslutninger og aftaler - genindlæs siden om lidt.</p>` : ""}<div class="card"><div class="cardhead"><h2>Besluttet</h2>${sortToggle}</div><label>Søg<input id="q" type="search" placeholder="Fx medlemskab, budget, Open"></label>
${decided.length ? `${decisionTable("list", "Beslutning", decided.slice(0, SHOWN).map(row))}${decided.length > SHOWN ? fold("Klik her for at se alle beslutninger", "Skjul de ældre beslutninger", decisionTable("list-rest", "Beslutning", decided.slice(SHOWN).map(row)), decided.length - SHOWN) : ""}`
    : `<p class="muted">Ingen beslutninger endnu.</p>`}</div>${agreed.length ? `<div class="card" id="aftaler"><div class="cardhead"><h2>Uformelle aftaler <span class="pill">${agreed.length}</span></h2>${sortToggle}</div>
<p class="small muted" style="margin:2px 0 14px">Aftaler mellem enkelte personer, anbefalinger, forslag og noter - alt det, der ikke er afgjort som en beslutning i bestyrelsen, og derfor uden laurbær. Er en af dem i virkeligheden en beslutning, så tryk <em>Ret sortering</em>.</p>
${decisionTable("agreements", "Aftale", agreed.slice(0, SHOWN).map(agreement))}${agreed.length > SHOWN ? fold("Klik her for at se alle aftaler", "Skjul de ældre aftaler", decisionTable("agreements-rest", "Aftale", agreed.slice(SHOWN).map(agreement)), agreed.length - SHOWN) : ""}</div>` : ""}${votes ? votes.closed : ""}</main>
<script>{const h=location.hash&&document.querySelector(location.hash.replace(/[^#\w-]/g,""));const d=h&&h.closest("details");if(d){d.open=true;h.scrollIntoView()}}
{const m=document.querySelector("main.sortable"),set=on=>{m.classList.toggle("sorting",on);document.querySelectorAll("[data-sorting]").forEach(b=>b.setAttribute("aria-pressed",String(on)));try{sessionStorage.setItem("sorting",on?"1":"")}catch(e){}};
document.querySelectorAll("[data-sorting]").forEach(b=>b.addEventListener("click",()=>set(!m.classList.contains("sorting"))));try{if(sessionStorage.getItem("sorting"))set(true)}catch(e){}}
document.getElementById("q").addEventListener("input",e=>{const q=e.target.value.toLowerCase();if(q)document.querySelectorAll("main details.fold").forEach(d=>{d.open=true});document.querySelectorAll("table.decisions tr").forEach(r=>{if(r.querySelector("th"))return;r.hidden=q&&!r.textContent.toLowerCase().includes(q)})})</script>`, { section: "/beslutninger", who, style: VOTES_STYLE, post: { kind: "afstemning" } });
}

/** Requested: "Lav lignende oprydning på de resterende": the five newest minutes and days stand open, the older ones are folded under a button. */
const minutesLineOf = (base: string) => (m: ApprovedMinutes) => `<li><a href="${base}/referat/${m.id}">Referat ${esc(m.meeting_date ? longDay(m.meeting_date) : "")}</a></li>`;
const historyDay = (h: { day: string; text: string }) => `<details id="${esc(h.day)}"><summary>${esc(longDay(h.day))}</summary><div style="white-space:pre-wrap" class="small">${esc(h.text)}</div></details>`;

export function archivePage(base: string, data: { minutes: ApprovedMinutes[]; history: Array<{ day: string; label: string; text: string }>; docUrl: string | null; docError: string | null; who: string | null }): string {
  return layout(base, "Arkiv", `<main><h1>Arkiv</h1><div class="grid"><div class="card"><h2>Referater fra Saga</h2>
${data.minutes.length ? `<ul class="plain">${data.minutes.slice(0, SHOWN).map(minutesLineOf(base)).join("")}</ul>${data.minutes.length > SHOWN ? fold("Klik her for at se alle referater", "Skjul de ældre referater", `<ul class="plain">${data.minutes.slice(SHOWN).map(minutesLineOf(base)).join("")}</ul>`, data.minutes.length - SHOWN) : ""}` : `<p class="muted">Ingen endnu.</p>`}</div>
<div class="card"><h2>Tidligere referater</h2>${data.docUrl ? `<p class="small"><a href="${esc(data.docUrl)}" target="_blank" rel="noopener">Åbn referatdokumentet</a></p>` : ""}
${data.docError ? `<p class="muted">${esc(data.docError)}</p>` : data.history.length ? `${data.history.slice(0, SHOWN).map(historyDay).join("")}${data.history.length > SHOWN ? fold("Klik her for at se alle tidligere referater", "Skjul de ældre", data.history.slice(SHOWN).map(historyDay).join(""), data.history.length - SHOWN) : ""}`
    : `<p class="muted">Ingen referater fundet i dokumentet.</p>`}</div></div></main>
<script>const d=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(d&&d.tagName==="DETAILS"){d.open=true;d.scrollIntoView()}</script>`, { section: "/arkiv", who: data.who });
}
