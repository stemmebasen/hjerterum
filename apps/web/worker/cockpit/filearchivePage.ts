import { esc, layout } from "./page.js";
import { MAX_UPLOAD_BYTES, type Copy, type FolderView } from "../archive.js";
import { EVENT_ARCHIVE_STYLE, TEACHERS_FOLDER } from "./eventArchive.js";

/** Filarkiv (archive.ts): the board's files in folders, and the nightly copies of the database. The chair's alone for now (archive.manage). */

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", year: "numeric" });
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("da-DK", { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("da-DK", { maximumFractionDigits: 1 })} MB`;
}
const q = (folder: string) => folder ? `?mappe=${encodeURIComponent(folder)}` : "";

function tabs(base: string, on: "filer" | "kopier", copies = true): string {
  return copies ? `<nav class="fa-tabs"><a href="${base}/filarkiv" ${on === "filer" ? 'class="on" aria-current="page"' : ""}>Filer</a><a href="${base}/filarkiv?vis=kopier" ${on === "kopier" ? 'class="on" aria-current="page"' : ""}>Sikkerhedskopier</a></nav>` : "";
}

/** Requested: "Du må også gerne diskret nævne vores backupfrekvens på samme side" - the nightly copy (.github/workflows/natlig-kopi.yml, 02:23 UTC). */
const BACKUP_LINE = "Sikkerhedskopi: hver nat ved 3-4-tiden gemmes en kopi af databasen. De seneste 30 nætter og én pr. måned et år tilbage gemmes.";

/** Requested: "Vi skal have drag and drop i filarkivet". Files dropped anywhere on the page are put in the upload form and sent at once;
 * the form itself still works without the script. */
function dropScript(): string {
  // "zip-filer på ca. 600 MB": what is bigger than one request may be goes up in parts (archive.ts startBigUpload) - with how far it has come.
  return `<script>(()=>{const form=document.getElementById("fa-upload"),input=document.getElementById("fa-files"),over=document.getElementById("fa-over"),status=document.getElementById("fa-status");
if(!form||!input||!over)return;const max=${MAX_UPLOAD_BYTES},root=form.getAttribute("action").replace(/[/]upload$/,""),folder=form.querySelector("input[name=mappe]").value;let depth=0;
const hasFiles=e=>Array.from(e.dataTransfer?.types||[]).includes("Files");
const say=(t,bad)=>{status.textContent=t;status.classList.toggle("bad",Boolean(bad))};
const mb=n=>Math.round(n/1048576).toLocaleString("da-DK");
async function big(files){const b=form.querySelector("button");if(b){b.disabled=true;b.textContent="Lægger op …"}form.classList.add("busy");
for(const [i,f] of Array.from(files).entries()){const label=(files.length>1?(i+1)+" af "+files.length+": ":"")+"”"+f.name+"”";
const r=await fetch(root+"/stor/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mappe:folder,navn:f.name,type:f.type,size:f.size})}).catch(()=>null);
const s=r&&r.ok?await r.json():null;if(!s){say("Kunne ikke begynde på "+label+". Prøv igen.",1);return false}
const parts=[];const size=s.partBytes;const count=Math.max(1,Math.ceil(f.size/size));
for(let n=0;n<count;n++){say("Lægger "+label+" op … "+Math.round(n/count*100)+" % ("+mb(n*size)+" af "+mb(f.size)+" MB)");let p=null;
for(let tries=0;tries<3&&!p;tries++){const q=await fetch(root+"/stor/del?k="+encodeURIComponent(s.key)+"&id="+encodeURIComponent(s.uploadId)+"&nr="+(n+1),{method:"PUT",body:f.slice(n*size,Math.min(f.size,(n+1)*size))}).catch(()=>null);p=q&&q.ok?await q.json():null}
if(!p){await fetch(root+"/stor/slut",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({k:s.key,id:s.uploadId,afbryd:true})}).catch(()=>null);say(label+" blev afbrudt undervejs. Prøv igen.",1);return false}
parts.push(p)}
const d=await fetch(root+"/stor/slut",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({k:s.key,id:s.uploadId,parts})}).catch(()=>null);
if(!d||!d.ok){say(label+" kunne ikke samles. Prøv igen.",1);return false}}
location.href=root+"?"+(folder?"mappe="+encodeURIComponent(folder)+"&":"")+"besked=oppe";return true}
const send=files=>{let total=0,biggest=0;for(const f of files){total+=f.size;biggest=Math.max(biggest,f.size)}
if(total<=max){input.files=files;say("Lægger "+(files.length===1?"”"+files[0].name+"”":files.length+" filer")+" op …");form.classList.add("busy");form.requestSubmit();return}
void big(files)};
addEventListener("dragenter",e=>{if(!hasFiles(e))return;e.preventDefault();depth++;over.hidden=false});
addEventListener("dragover",e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect="copy"});
addEventListener("dragleave",e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth)over.hidden=true});
addEventListener("drop",e=>{if(!hasFiles(e))return;e.preventDefault();depth=0;over.hidden=true;const files=e.dataTransfer.files;if(files.length)send(files)});
form.addEventListener("submit",e=>{let total=0;for(const f of input.files)total+=f.size;if(total>max){e.preventDefault();void big(input.files);return}
const b=form.querySelector("button");if(b){b.disabled=true;b.textContent="Lægger op …"}});})()</script>`;
}

/** canManage: the chair (archive.manage) - deleting, and the database's nightly copies. The board sees, adds and fetches files (the chair, 6 Nov 2026). */
export function fileArchivePage(base: string, who: string | null, view: FolderView, data: { ready: boolean; notice: string; error: string; canManage?: boolean }): string {
  const manage = data.canManage ?? true;
  const parts = view.folder ? view.folder.split("/") : [];
  const crumbs = [`<a href="${base}/filarkiv">Filarkiv</a>`, ...parts.map((p, i) => i === parts.length - 1 ? `<b>${esc(p)}</b>` : `<a href="${base}/filarkiv${q(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`)].join(" / ");
  // "Underviser -> Dato/Event" - the teachers and their events' material, first at the top (eventArchive.ts).
  const eventsFolder = view.folder ? "" : `<li class="fa-folder"><a href="${base}/filarkiv?mappe=${TEACHERS_FOLDER}"><span class="fa-icon" aria-hidden="true">📁</span>${TEACHERS_FOLDER}</a><span class="small muted">Underviser → dato · event</span></li>`;
  const folders = eventsFolder + view.folders.filter(f => f !== TEACHERS_FOLDER).map(f => `<li class="fa-folder"><a href="${base}/filarkiv${q(view.folder ? `${view.folder}/${f}` : f)}"><span class="fa-icon" aria-hidden="true">📁</span>${esc(f)}</a></li>`).join("");
  const files = view.files.map(f => `<li class="fa-file"><a href="${base}/filarkiv/fil?k=${encodeURIComponent(f.key)}"><span class="fa-icon" aria-hidden="true">📄</span>${esc(f.name)}</a>
<span class="small muted">${size(f.size)} · ${esc(WHEN.format(f.uploaded))}${f.by ? ` · ${esc(f.by)}` : ""}</span>
${manage ? `<form method="post" action="${base}/filarkiv/slet" onsubmit="return confirm(${esc(JSON.stringify(`Slet "${f.name}"? Den kan ikke hentes tilbage.`))})"><input type="hidden" name="k" value="${esc(f.key)}"><input type="hidden" name="mappe" value="${esc(view.folder)}"><button class="ghost danger small">Slet</button></form>` : ""}</li>`).join("");
  const empty = Boolean(view.folder) && !view.folders.length && !view.files.length;
  const body = `<main class="fa"><h1>Filarkiv</h1>
<p class="muted">Bestyrelsens filer, samlet ét sted i Hjerterums eget lager hos Cloudflare (R2): vedtægter, regnskaber, aftaler, billeder og andet, der skal gemmes.</p>
${tabs(base, "filer", manage)}
${data.ready ? "" : `<p class="notice bad">Filarkivet er ikke koblet på endnu (lageret ARCHIVE mangler).</p>`}
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${data.error ? `<p class="notice bad">${esc(data.error)}</p>` : ""}
<p class="fa-crumbs">${crumbs}</p>
<section class="card fa-list">${empty ? `<p class="muted">Mappen er tom.</p>${view.folder && manage ? `<form method="post" action="${base}/filarkiv/slet-mappe"><input type="hidden" name="mappe" value="${esc(view.folder)}"><button class="ghost small">Slet den tomme mappe</button></form>` : ""}` : `<ul class="plain">${folders}${files}</ul>`}</section>
${data.ready ? `<div class="fa-actions">
<form method="post" action="${base}/filarkiv/upload" enctype="multipart/form-data" class="card fa-drop" id="fa-upload"><input type="hidden" name="mappe" value="${esc(view.folder)}">
<label for="fa-files"><b>Læg filer op${view.folder ? ` i ${esc(parts[parts.length - 1]!)}` : ""}</b></label>
<p class="fa-hint">Træk filerne hertil - eller vælg dem herunder.</p><input id="fa-files" type="file" name="filer" multiple required>
<small class="muted" id="fa-status">Også store filer, fx zip-filer på flere GB: de lægges op i bidder, og siden viser, hvor langt den er.</small><button>Læg op</button></form>
<form method="post" action="${base}/filarkiv/mappe" class="card"><input type="hidden" name="mappe" value="${esc(view.folder)}">
<label for="fa-new"><b>Ny mappe</b></label><input id="fa-new" name="navn" required maxlength="120" placeholder="Fx Regnskaber"><button class="ghost">Opret mappen</button></form></div>
<div class="fa-over" id="fa-over" hidden><p>Slip filerne for at lægge dem op${view.folder ? ` i ${esc(parts[parts.length - 1]!)}` : ""}</p></div>${dropScript()}` : ""}
${manage ? `<p class="small muted fa-backup">${BACKUP_LINE} <a href="${base}/filarkiv?vis=kopier">Se kopierne</a></p>` : ""}
</main>`;
  return layout(base, "Filarkiv", body, { section: "/filarkiv", who, style: STYLE });
}

/** Filarkiv → Undervisere (eventArchive.ts), in the archive's own page. */
export function eventMaterialPage(base: string, who: string | null, inner: string, data: { notice: string; error: string; canManage: boolean }): string {
  const body = `<main class="fa"><h1>Filarkiv</h1>
${tabs(base, "filer", data.canManage)}
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${data.error ? `<p class="notice bad">${esc(data.error)}</p>` : ""}
${inner}</main>`;
  return layout(base, "Filarkiv", body, { section: "/filarkiv", who, style: STYLE + EVENT_ARCHIVE_STYLE });
}

export function copiesPage(base: string, who: string | null, list: Copy[], data: { ready: boolean }): string {
  const newest = list[0];
  const stale = !newest || Date.now() - newest.uploaded > 36 * 3_600_000;
  const rows = list.map(c => `<li><a href="${base}/filarkiv/kopi?k=${encodeURIComponent(c.key)}">${esc(DAY.format(Date.parse(`${c.day}T12:00:00Z`)))}</a><span class="small muted">${size(c.size)}</span></li>`).join("");
  return layout(base, "Sikkerhedskopier", `<main class="fa"><h1>Filarkiv</h1>
${tabs(base, "kopier")}
<p class="muted">Hver nat gemmes en fuld kopi af Hjerterums database (medlemmer, events, referater, beslutninger, opgaver, Sagas viden ...) her i arkivet. De seneste 30 nætter og den første kopi i hver måned et år tilbage gemmes.</p>
<p class="notice"><b>Hent én kopi om måneden</b> og gem den et sikkert sted uden for Cloudflare (fx på din computer eller en krypteret USB). Så findes Hjerterums data også, hvis noget skulle gå galt hos Cloudflare. Du får en påmindelse den 1. i hver måned. Filen indeholder medlemmernes persondata - behandl den som det.</p>
${!data.ready ? `<p class="notice bad">Arkivet er ikke koblet på endnu (lageret ARCHIVE mangler).</p>` : stale ? `<p class="notice bad">${newest ? `Den nyeste kopi er fra ${esc(DAY.format(Date.parse(`${newest.day}T12:00:00Z`)))} - nattens kopi mangler.` : "Der er ingen kopier endnu. Den første laves i nat."}</p>` : ""}
<section class="card">${list.length ? `<ul class="plain fa-copies">${rows}</ul>` : `<p class="muted">Ingen kopier endnu.</p>`}</section>
<p class="small muted">Kopien er en SQL-fil (pakket med gzip). Den kan lægges tilbage i en ny database med Cloudflares eget værktøj (wrangler d1 execute).</p></main>`, { section: "/filarkiv", who, style: STYLE });
}

const STYLE = `.fa-tabs{display:flex;gap:8px;margin:14px 0 18px}.fa-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);text-decoration:none}.fa-tabs a.on{background:var(--ink,#2a2622);color:#fff;border-color:var(--ink,#2a2622)}
.fa-crumbs{margin:0 0 10px}.fa-list ul li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 14px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.fa-list ul li:first-child{border-top:0}
.fa-list li.fa-folder{grid-template-columns:1fr}.fa-list a{display:inline-flex;gap:8px;align-items:center;min-width:0;overflow-wrap:anywhere}.fa-icon{flex:none}.fa-list form{margin:0}
.fa-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:16px}.fa-actions form{display:grid;gap:8px;align-content:start}
.fa-actions input[type=text],.fa-actions input:not([type]){font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit}
.fa-copies li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.fa-copies li:first-child{border-top:0}
.fa-drop{border:1.5px dashed color-mix(in srgb,var(--accent) 45%,var(--line))}.fa-drop.busy{opacity:.7}.fa-hint{margin:0;color:var(--muted);font-size:14px}#fa-status.bad{color:#b3261e}
.fa-over{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:blur(3px);pointer-events:none}
.fa-over p{margin:0;padding:28px 36px;border:2px dashed var(--accent);border-radius:20px;background:var(--card);font-size:19px;font-weight:600;color:var(--accent)}.fa-over[hidden]{display:none}
.fa-backup{margin:18px 0 0}
button.danger{color:var(--danger,#b3261e);border-color:currentColor}button.small{padding:4px 10px;font-size:13px}.notice.bad{color:#b3261e;border-color:#b3261e}
@media(max-width:640px){.fa-list ul li{grid-template-columns:1fr auto}.fa-list li .small{grid-column:1/-1;order:3}}`;
