import { esc, layout } from "./page.js";
import { MAX_UPLOAD_BYTES, type Copy, type FolderView } from "../archive.js";

/** Filarkiv (archive.ts): the board's files in folders, and the nightly copies of the database. The chair's alone for now (archive.manage). */

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", year: "numeric" });
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("da-DK", { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("da-DK", { maximumFractionDigits: 1 })} MB`;
}
const q = (folder: string) => folder ? `?mappe=${encodeURIComponent(folder)}` : "";

function tabs(base: string, on: "filer" | "kopier"): string {
  return `<nav class="fa-tabs"><a href="${base}/filarkiv" ${on === "filer" ? 'class="on" aria-current="page"' : ""}>Filer</a><a href="${base}/filarkiv?vis=kopier" ${on === "kopier" ? 'class="on" aria-current="page"' : ""}>Sikkerhedskopier</a></nav>`;
}

export function fileArchivePage(base: string, who: string | null, view: FolderView, data: { ready: boolean; notice: string; error: string }): string {
  const parts = view.folder ? view.folder.split("/") : [];
  const crumbs = [`<a href="${base}/filarkiv">Filarkiv</a>`, ...parts.map((p, i) => i === parts.length - 1 ? `<b>${esc(p)}</b>` : `<a href="${base}/filarkiv${q(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`)].join(" / ");
  const folders = view.folders.map(f => `<li class="fa-folder"><a href="${base}/filarkiv${q(view.folder ? `${view.folder}/${f}` : f)}"><span class="fa-icon" aria-hidden="true">📁</span>${esc(f)}</a></li>`).join("");
  const files = view.files.map(f => `<li class="fa-file"><a href="${base}/filarkiv/fil?k=${encodeURIComponent(f.key)}"><span class="fa-icon" aria-hidden="true">📄</span>${esc(f.name)}</a>
<span class="small muted">${size(f.size)} · ${esc(WHEN.format(f.uploaded))}${f.by ? ` · ${esc(f.by)}` : ""}</span>
<form method="post" action="${base}/filarkiv/slet" onsubmit="return confirm(${esc(JSON.stringify(`Slet "${f.name}"? Den kan ikke hentes tilbage.`))})"><input type="hidden" name="k" value="${esc(f.key)}"><input type="hidden" name="mappe" value="${esc(view.folder)}"><button class="ghost danger small">Slet</button></form></li>`).join("");
  const empty = !view.folders.length && !view.files.length;
  const body = `<main class="fa"><h1>Filarkiv</h1>
<p class="muted">Bestyrelsens filer, samlet ét sted i Hjerterums eget lager hos Cloudflare (R2): vedtægter, regnskaber, aftaler, billeder og andet, der skal gemmes.</p>
${tabs(base, "filer")}
${data.ready ? "" : `<p class="notice bad">Filarkivet er ikke koblet på endnu (lageret ARCHIVE mangler).</p>`}
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${data.error ? `<p class="notice bad">${esc(data.error)}</p>` : ""}
<p class="fa-crumbs">${crumbs}</p>
<section class="card fa-list">${empty ? `<p class="muted">Mappen er tom.</p>${view.folder ? `<form method="post" action="${base}/filarkiv/slet-mappe"><input type="hidden" name="mappe" value="${esc(view.folder)}"><button class="ghost small">Slet den tomme mappe</button></form>` : ""}` : `<ul class="plain">${folders}${files}</ul>`}</section>
${data.ready ? `<div class="fa-actions">
<form method="post" action="${base}/filarkiv/upload" enctype="multipart/form-data" class="card"><input type="hidden" name="mappe" value="${esc(view.folder)}">
<label for="fa-files"><b>Læg filer op${view.folder ? ` i ${esc(parts[parts.length - 1]!)}` : ""}</b></label><input id="fa-files" type="file" name="filer" multiple required>
<small class="muted">Højst ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB ad gangen.</small><button>Læg op</button></form>
<form method="post" action="${base}/filarkiv/mappe" class="card"><input type="hidden" name="mappe" value="${esc(view.folder)}">
<label for="fa-new"><b>Ny mappe</b></label><input id="fa-new" name="navn" required maxlength="120" placeholder="Fx Regnskaber"><button class="ghost">Opret mappen</button></form></div>` : ""}
</main>`;
  return layout(base, "Filarkiv", body, { section: "/profil", who, style: STYLE });
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
<p class="small muted">Kopien er en SQL-fil (pakket med gzip). Den kan lægges tilbage i en ny database med Cloudflares eget værktøj (wrangler d1 execute).</p></main>`, { section: "/profil", who, style: STYLE });
}

const STYLE = `.fa-tabs{display:flex;gap:8px;margin:14px 0 18px}.fa-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);text-decoration:none}.fa-tabs a.on{background:var(--ink,#2a2622);color:#fff;border-color:var(--ink,#2a2622)}
.fa-crumbs{margin:0 0 10px}.fa-list ul li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 14px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.fa-list ul li:first-child{border-top:0}
.fa-list li.fa-folder{grid-template-columns:1fr}.fa-list a{display:inline-flex;gap:8px;align-items:center;min-width:0;overflow-wrap:anywhere}.fa-icon{flex:none}.fa-list form{margin:0}
.fa-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:16px}.fa-actions form{display:grid;gap:8px;align-content:start}
.fa-actions input[type=text],.fa-actions input:not([type]){font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit}
.fa-copies li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.fa-copies li:first-child{border-top:0}
button.danger{color:var(--danger,#b3261e);border-color:currentColor}button.small{padding:4px 10px;font-size:13px}.notice.bad{color:#b3261e;border-color:#b3261e}
@media(max-width:640px){.fa-list ul li{grid-template-columns:1fr auto}.fa-list li .small{grid-column:1/-1;order:3}}`;
