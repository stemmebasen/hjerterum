import { markdownToHtml, section } from "../saga/markdown.js";
import { minutesTasks, type ApprovedMinutes, type Meeting, type Signoff } from "./data.js";
import { esc, longDay } from "./page.js";
import type { Correction } from "./corrections.js";

/** Requested: "Og så laves der et dokument pr referat - ok? Her skal vi lave et pænt layout og alt med
 * dagsorden i toppen." One page per approved minutes, laid out as a document the board can print or
 * save as PDF: the meeting's facts, the agenda, each point with its discussion and decision, then
 * the decisions, the tasks and the next meeting. Read from Saga's template; minutes that do not
 * follow it are shown as they are. */

export type ParsedMinutes = {
  present: string; absent: string;
  points: Array<{ title: string; lines: Array<{ label: string; text: string }> }>;
  decisions: string[]; next: string;
};

const bullets = (text: string) => text.split(/\r?\n/).map(line => /^\s*[-*]\s+(.*)$/.exec(line)?.[1]?.trim() ?? "").filter(Boolean);
const field = (markdown: string, name: string) => new RegExp(`^\\*\\*${name}:?\\*\\*:?\\s*(.*)$`, "imu").exec(markdown)?.[1]?.trim() ?? "";
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

export function parseMinutes(markdown: string): ParsedMinutes | null {
  const pointsText = section(markdown, /punkter/i);
  const points: ParsedMinutes["points"] = [];
  for (const line of pointsText.split(/\r?\n/)) {
    const heading = /^###\s+(?:\d+[.)]\s*)?(.*)$/.exec(line.trim());
    if (heading) { points.push({ title: plain(heading[1]!.trim()), lines: [] }); continue; }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)?.[1]?.trim();
    if (!bullet || !points.length) continue;
    const labelled = /^\**([A-Za-zÆØÅæøå ]{3,30}?)\**:\**\s*(.*)$/.exec(bullet);
    points.at(-1)!.lines.push(labelled ? { label: labelled[1]!.trim(), text: plain(labelled[2]!.trim()) } : { label: "", text: plain(bullet) });
  }
  if (!points.length) return null;
  return { present: plain(field(markdown, "Til stede")), absent: plain(field(markdown, "Fraværende")), points,
    decisions: bullets(section(markdown, /beslutninger/i)).map(plain).filter(d => !/^ingen beslutning/i.test(d)),
    next: plain(section(markdown, /næste møde/i).replace(/^\s*[-*]\s+/gm, "").trim()) };
}

const DECIDED = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Copenhagen" });

/** Who has approved the minutes, who asked for a correction, who is missing - and the buttons for the one looking. */
export function signoffPanel(base: string, minutes: ApprovedMinutes, data: { members: string[]; signoffs: Signoff[]; who: string | null; notice: string }): string {
  if (minutes.source === "document") return "";
  const by = new Map(data.signoffs.map(s => [s.member, s]));
  const approved = data.signoffs.filter(s => s.status === "approved").map(s => s.member);
  const corrections = data.signoffs.filter(s => s.status === "correction");
  const missing = data.members.filter(m => !by.has(m));
  const mine = data.who ? by.get(data.who) : undefined;
  const action = `${base}/referat/${minutes.id}`;
  return `<section class="card m-sign"><h2>Bestyrelsens godkendelse</h2>${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}
<p>${approved.length ? `<strong>Godkendt af:</strong> ${esc(approved.join(", "))}` : "Ingen har godkendt endnu."}${missing.length ? ` <span class="muted">· Mangler: ${esc(missing.join(", "))}</span>` : ""}</p>
${corrections.length ? `<ul class="plain">${corrections.map(c => `<li><strong>${esc(c.member)}</strong> har en rettelse: ${esc(c.comment ?? "")}</li>`).join("")}</ul>` : ""}
${!data.who ? `<p><a href="${base}/hvem">Vælg hvem du er</a> for at godkende.</p>` : mine?.status === "approved" ? `<p class="muted small">Du har godkendt referatet.</p>`
    : `<div class="m-sign-actions"><form method="post" action="${action}/godkend"><button>Jeg godkender referatet</button></form>
<details${mine?.status === "correction" ? " open" : ""}><summary>Jeg har en rettelse</summary><form class="stack" method="post" action="${action}/rettelse">
<textarea name="comment" required maxlength="2000" placeholder="Hvad skal rettes?">${esc(mine?.comment ?? "")}</textarea><button>Send rettelsen til formanden</button></form></details></div>`}</section>`;
}

/** Requested: "Der skal ved hvert punkt være mulighed for hvert medlem af indsende rettelse - herefter vil
 * Saga omskrive punktet. Hun skal spørge hvis hun er usikker på hvad der menes." Under each point: the
 * corrections sent to it, Saga's question to the one who sent it, and the form to correct it. */
function pointFixes(base: string, minutes: ApprovedMinutes, point: number, fix: { who: string | null; corrections: Correction[] } | undefined): string {
  if (!fix) return "";
  const action = `${base}/referat/${minutes.id}`;
  // One open question per member and point: the newest; while Saga works on a correction, none.
  const here = (fix.corrections ?? []).filter(c => c.point === point);
  const shown = here.filter(c => c.status !== "question" && c.status !== "pending" || here.filter(o => o.member === c.member && (o.status === "question" || o.status === "pending")).every(o => o.id <= c.id));
  // Requested: "Rettelser skal diskret gemmes bag fold-ud" - what has been corrected folds away under the point.
  const made = shown.filter(c => c.status === "applied");
  const history = made.length ? `<details class="m-made"><summary>${made.length === 1 ? "1 rettelse" : `${made.length} rettelser`}</summary>${made.map(c =>
    `<p class="m-fixnote">${esc(c.member)}${c.note ? `: ${esc(c.note)}` : ""}</p>`).join("")}</details>` : "";
  const own = history + shown.filter(c => c.status !== "applied").map(c => {
    if (c.status === "pending") return `<p class="m-fixnote">Saga er ved at rette punktet efter ${esc(c.member)}s rettelse …</p>`;
    if (c.status === "failed") return `<p class="m-fixnote warn">Saga kunne ikke rette punktet efter ${esc(c.member)}s rettelse. Skriv den gerne lidt mere præcist.</p>`;
    return c.member === fix.who ? `<div class="m-ask"><p><strong>Saga spørger dig:</strong> ${esc(c.question ?? "")}</p>
<form class="stack" data-saga method="post" action="${action}/rettelse/${c.id}/svar"><textarea name="answer" required maxlength="2000" rows="2" placeholder="Dit svar til Saga"></textarea><button>Svar Saga</button></form></div>`
      : `<p class="m-fixnote">Saga har spurgt ${esc(c.member)} om rettelsen.</p>`;
  }).join("");
  const form = fix.who ? `<details class="m-fixform"><summary>Ret dette punkt</summary><form class="stack" data-saga method="post" action="${action}/punkt/${point}">
<textarea name="correction" required maxlength="2000" rows="3" placeholder="Hvad skal rettes i punktet? Saga omskriver det - eller spørger dig, hvis hun er i tvivl."></textarea><button>Send rettelsen til Saga</button></form></details>` : "";
  return own || form ? `<div class="m-fix">${own}${form}</div>` : "";
}

export function minutesDocument(base: string, minutes: ApprovedMinutes, meeting: Meeting | null, fallbackHtml: string, fix?: { who: string | null; corrections: Correction[] }): string {
  const parsed = parseMinutes(minutes.draft_markdown ?? "");
  const agenda = meeting?.agenda.split("\n").map(line => line.trim()).filter(Boolean) ?? [];
  const agendaItems = agenda.length ? agenda : parsed?.points.map(p => p.title) ?? [];
  const facts = [["Dato", minutes.meeting_date ? longDay(minutes.meeting_date) : ""], ["Tid", meeting?.start_time ? `kl. ${meeting.start_time}` : ""], ["Sted", meeting?.place ?? ""],
    ["Til stede", parsed?.present ?? ""], ["Fraværende", parsed?.absent && !/^ikke nævnt$/i.test(parsed.absent) ? parsed.absent : ""]].filter(([, value]) => value);
  const tasks = minutesTasks(minutes);
  const body = parsed ? `
${agendaItems.length ? `<section class="m-agenda"><h2>Dagsorden</h2><ol>${agendaItems.map(item => `<li>${esc(item)}</li>`).join("")}</ol></section>` : ""}
<section><h2>Referat</h2>${parsed.points.map((point, i) => `<div class="m-point" id="punkt-${i + 1}"><h3><span class="m-num">${i + 1}</span>${esc(point.title)}</h3>
${point.lines.map(line => /^beslutning/i.test(line.label) ? `<p class="m-decision${/^ingen beslutning/i.test(line.text) ? " m-none" : ""}"><span class="m-label">Beslutning</span>${esc(line.text)}</p>`
    : `<p>${line.label ? `<span class="m-label">${esc(line.label)}</span>` : ""}${esc(line.text)}</p>`).join("")}${pointFixes(base, minutes, i + 1, fix)}</div>`).join("")}</section>
${parsed.decisions.length ? `<section class="m-box"><h2>Beslutninger</h2><ul>${parsed.decisions.map(d => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
${tasks.length ? `<section><h2>Opgaver</h2><table class="m-tasks rows"><tr><th>Hvem</th><th>Hvad</th><th>Frist</th></tr>${tasks.map(t => `<tr><td data-label="Hvem">${esc(t.who || "-")}</td><td data-label="Hvad">${esc(t.what)}</td><td data-label="Frist">${esc(t.due || "-")}</td></tr>`).join("")}</table></section>` : ""}
${parsed.next ? `<section><h2>Næste møde</h2><p>${esc(parsed.next)}</p></section>` : ""}`
    : `${agenda.length ? `<section class="m-agenda"><h2>Dagsorden</h2><ol>${agenda.map(item => `<li>${esc(item)}</li>`).join("")}</ol></section>` : ""}<section class="doc">${fallbackHtml.replace(/<h1>[\s\S]*?<\/h1>/, "")}</section>`;
  return `<div class="m-tools"><a href="${base}/moder">← Møder</a><span>${minutes.drive_document_url && minutes.source !== "document" ? `<a href="${esc(minutes.drive_document_url)}" target="_blank" rel="noopener">Åbn i Google Docs</a> · ` : ""}<button type="button" class="ghost" onclick="print()">Print / gem som PDF</button></span></div>
<article class="minutes"><div class="m-head"><div class="m-org">Hjerterum · Bestyrelsen</div><h1>Referat af bestyrelsesmøde</h1>
${facts.length ? `<dl class="m-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : ""}</div>
${body}
${minutes.source === "document" ? `${minutes.transcript ? `<details class="m-original"><summary>Originalteksten fra referatdokumentet</summary><div>${esc(minutes.transcript)}</div></details>` : ""}
<footer class="m-foot">Bestyrelsens referat, overført fra referatdokumentet og stillet op af Saga${minutes.drive_document_url ? ` · <a href="${esc(minutes.drive_document_url)}" target="_blank" rel="noopener">Åbn dokumentet</a>` : ""}</footer>`
    : `<footer class="m-foot">Lagt op ${esc(DECIDED.format(minutes.created_at_ms))} · Skrevet af Saga ud fra mødeoptagelsen</footer>`}</article>${SAGA_THINKING}`;
}

/** Requested: "Douglas taler engelsk". The minutes in Saga's English translation, with the way back to the Danish original. */
export function englishMinutes(base: string, minutes: ApprovedMinutes, markdown: string): string {
  const body = (/<body>([\s\S]*)<\/body>/.exec(markdownToHtml(markdown))?.[1] ?? "").replace(/<h1>[\s\S]*?<\/h1>/, "");
  return `<div class="m-tools"><a href="${base}/moder">← Møder</a><span><a href="${base}/referat/${minutes.id}?original=1">Vis den danske original</a> · <button type="button" class="ghost" onclick="print()">Print / gem som PDF</button></span></div>
<article class="minutes"><div class="m-head"><div class="m-org">Hjerterum · Bestyrelsen</div><h1>Referat af bestyrelsesmøde</h1>
${minutes.meeting_date ? `<dl class="m-facts"><div><dt>Dato</dt><dd>${esc(longDay(minutes.meeting_date))}</dd></div></dl>` : ""}</div>
<section class="doc" translate="no">${body}</section>
<footer class="m-foot">Translated by Saga from the Danish minutes - the Danish original is the valid version.</footer></article>`;
}

/** Reported: "Det er svært at vide, når Saga er i gang med at tænke" - and a correction sent four times
 * while she worked. A correction or an answer is sent once; the button says that Saga is thinking. */
const SAGA_THINKING = `<script>document.addEventListener("submit",e=>{const f=e.target;if(!(f instanceof HTMLFormElement)||!f.hasAttribute("data-saga"))return;
if(f.dataset.sent){e.preventDefault();return}f.dataset.sent="1";const b=f.querySelector("button");
if(b){b.classList.add("m-thinking");b.setAttribute("aria-busy","true");setTimeout(()=>{b.disabled=true},0);b.innerHTML='<span class="m-dots" aria-hidden="true"><i></i><i></i><i></i></span>Saga tænker …'}
const n=document.createElement("p");n.className="m-fixnote";n.setAttribute("role","status");n.textContent="Saga læser det og retter punktet. Det tager typisk 10-30 sekunder - siden opdaterer sig selv.";f.append(n)});</script>`;

export const MINUTES_STYLE = `
.m-made summary{font-size:12.5px;color:var(--faint);cursor:pointer;list-style:none}.m-made summary::-webkit-details-marker{display:none}
.m-made summary::before{content:"✓ ";color:var(--good)}.m-made[open] summary{margin-bottom:4px}.m-made .m-fixnote{margin:2px 0}
.m-thinking{display:inline-flex;align-items:center;justify-content:center;gap:10px;opacity:.85;cursor:progress}
.m-dots{display:inline-flex;gap:4px}.m-dots i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:m-dot 1.2s infinite ease-in-out}
.m-dots i:nth-child(2){animation-delay:.15s}.m-dots i:nth-child(3){animation-delay:.3s}
@keyframes m-dot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.m-dots i{animation:none;opacity:.7}}
.m-tools{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px}.m-tools button{padding:6px 12px;font-size:13px}
.minutes{background:var(--card);border:1px solid color-mix(in srgb,var(--line) 60%,transparent);box-shadow:var(--shadow);border-radius:var(--radius);padding:40px 48px;max-width:820px;width:100%;margin:0 auto;font-size:15.5px;line-height:1.6}
.m-head{border-bottom:2px solid var(--accent);padding-bottom:18px;margin-bottom:8px}.m-org{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.minutes h1{font-size:28px;margin:6px 0 14px;letter-spacing:-.015em}.minutes h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:28px 0 10px}
.m-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 24px;margin:0}.m-facts div{min-width:0}.m-facts dt{font-size:12px;color:var(--muted);font-weight:600}.m-facts dd{margin:0}
.m-agenda{background:var(--soft);border-radius:12px;padding:4px 20px 12px;margin-top:22px}.m-agenda h2{margin-top:14px}.m-agenda ol{margin:0;padding-left:22px}.m-agenda li{margin:3px 0;font-weight:600}
.m-point{padding:14px 0;border-bottom:1px solid var(--line);break-inside:avoid}.m-point:last-child{border-bottom:0}.m-point h3{font-size:17px;margin:0 0 6px;display:flex;gap:10px;align-items:baseline;text-transform:none;letter-spacing:-.01em;color:var(--ink);font-weight:680}
.m-num{flex:none;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:13px}
.m-point p{margin:4px 0 4px 34px}.m-label{font-size:12px;font-weight:700;color:var(--muted);margin-right:8px;text-transform:uppercase;letter-spacing:.05em}
.m-decision{border-left:3px solid var(--good);padding:4px 0 4px 10px}.m-decision.m-none{border-left-color:var(--line);color:var(--muted)}
.m-box{border:1px solid var(--good);border-radius:12px;padding:2px 20px 10px;margin-top:24px}.m-box h2{color:var(--good)}.m-box ul{margin:0;padding-left:20px}
.m-tasks td:first-child{font-weight:600;white-space:nowrap}.m-tasks td:last-child{white-space:nowrap}
.m-original{margin-top:24px}.m-original div{white-space:pre-wrap;font-size:13.5px;color:var(--muted);margin-top:8px}@media print{.m-original{display:none}}
.m-sign{max-width:820px;width:100%;margin:0 auto}.m-sign-actions{display:grid;gap:8px}.m-sign-actions details{border-top:0;padding:0}@media print{.m-sign{display:none}}
.m-fix{margin:8px 0 0 34px;display:grid;gap:6px}.m-fixnote{font-size:13px;color:var(--muted);margin:0}.m-fixform{border-top:0;padding:0}.m-fixform summary{font-size:13px;font-weight:600;color:var(--accent)}
.m-fixform form{margin-top:8px}.m-ask{background:var(--soft);border-radius:10px;padding:10px 12px}.m-ask p{margin:0 0 8px}@media (max-width:640px){.m-fix{margin-left:0}}@media print{.m-fix{display:none}}
.m-foot{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media (max-width:640px){.minutes{padding:22px 18px;border-radius:12px}.minutes h1{font-size:23px}.m-point p{margin-left:0}}
@media print{header.bar,nav.tabs,.m-tools,.m-sign,.saga-fab{display:none!important}body{background:#fff;color:#000}main{padding:0;max-width:none}.minutes{border:0;padding:0;max-width:none;font-size:11pt}
:root{--muted:#555;--line:#ccc;--soft:#eef1f4;--accent:#2446d8;--good:#2446d8;--card:#fff;--ink:#000}a{color:inherit;text-decoration:none}}
`;
