import { section } from "../saga/markdown.js";
import { minutesTasks, type ApprovedMinutes, type Meeting } from "./data.js";
import { esc, longDay } from "./page.js";

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

export function minutesDocument(base: string, minutes: ApprovedMinutes, meeting: Meeting | null, fallbackHtml: string): string {
  const parsed = parseMinutes(minutes.draft_markdown ?? "");
  const agenda = meeting?.agenda.split("\n").map(line => line.trim()).filter(Boolean) ?? [];
  const agendaItems = agenda.length ? agenda : parsed?.points.map(p => p.title) ?? [];
  const facts = [["Dato", minutes.meeting_date ? longDay(minutes.meeting_date) : ""], ["Tid", meeting?.start_time ? `kl. ${meeting.start_time}` : ""], ["Sted", meeting?.place ?? ""],
    ["Til stede", parsed?.present ?? ""], ["Fraværende", parsed?.absent && !/^ikke nævnt$/i.test(parsed.absent) ? parsed.absent : ""]].filter(([, value]) => value);
  const tasks = minutesTasks(minutes);
  const body = parsed ? `
${agendaItems.length ? `<section class="m-agenda"><h2>Dagsorden</h2><ol>${agendaItems.map(item => `<li>${esc(item)}</li>`).join("")}</ol></section>` : ""}
<section><h2>Referat</h2>${parsed.points.map((point, i) => `<div class="m-point"><h3><span class="m-num">${i + 1}</span>${esc(point.title)}</h3>
${point.lines.map(line => /^beslutning/i.test(line.label) ? `<p class="m-decision${/^ingen beslutning/i.test(line.text) ? " m-none" : ""}"><span class="m-label">Beslutning</span>${esc(line.text)}</p>`
    : `<p>${line.label ? `<span class="m-label">${esc(line.label)}</span>` : ""}${esc(line.text)}</p>`).join("")}</div>`).join("")}</section>
${parsed.decisions.length ? `<section class="m-box"><h2>Beslutninger</h2><ul>${parsed.decisions.map(d => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
${tasks.length ? `<section><h2>Opgaver</h2><table class="m-tasks"><tr><th>Hvem</th><th>Hvad</th><th>Frist</th></tr>${tasks.map(t => `<tr><td>${esc(t.who || "-")}</td><td>${esc(t.what)}</td><td>${esc(t.due || "-")}</td></tr>`).join("")}</table></section>` : ""}
${parsed.next ? `<section><h2>Næste møde</h2><p>${esc(parsed.next)}</p></section>` : ""}`
    : `${agenda.length ? `<section class="m-agenda"><h2>Dagsorden</h2><ol>${agenda.map(item => `<li>${esc(item)}</li>`).join("")}</ol></section>` : ""}<section class="doc">${fallbackHtml.replace(/<h1>[\s\S]*?<\/h1>/, "")}</section>`;
  return `<div class="m-tools"><a href="${base}/moder">← Møder</a><span>${minutes.drive_document_url && minutes.source !== "document" ? `<a href="${esc(minutes.drive_document_url)}" target="_blank" rel="noopener">Åbn i Google Docs</a> · ` : ""}<button type="button" class="ghost" onclick="print()">Print / gem som PDF</button></span></div>
<article class="minutes"><header class="m-head"><div class="m-org">Hjerterum · Bestyrelsen</div><h1>Referat af bestyrelsesmøde</h1>
${facts.length ? `<dl class="m-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : ""}</header>
${body}
${minutes.source === "document" ? `${minutes.transcript ? `<details class="m-original"><summary>Originalteksten fra referatdokumentet</summary><div>${esc(minutes.transcript)}</div></details>` : ""}
<footer class="m-foot">Bestyrelsens referat, overført fra referatdokumentet og stillet op af Saga${minutes.drive_document_url ? ` · <a href="${esc(minutes.drive_document_url)}" target="_blank" rel="noopener">Åbn dokumentet</a>` : ""}</footer>`
    : `<footer class="m-foot">Godkendt af formanden ${esc(DECIDED.format(minutes.updated_at_ms))} · Skrevet af Saga ud fra mødeoptagelsen</footer>`}</article>`;
}

export const MINUTES_STYLE = `
.m-tools{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px}.m-tools button{padding:6px 12px;font-size:13px}
.minutes{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:40px 48px;max-width:820px;width:100%;margin:0 auto;font-size:15.5px;line-height:1.6}
.m-head{border-bottom:2px solid var(--accent);padding-bottom:18px;margin-bottom:8px}.m-org{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.minutes h1{font-size:28px;margin:6px 0 14px;letter-spacing:-.015em}.minutes h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:28px 0 10px}
.m-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 24px;margin:0}.m-facts div{min-width:0}.m-facts dt{font-size:12px;color:var(--muted);font-weight:600}.m-facts dd{margin:0}
.m-agenda{background:var(--soft);border-radius:12px;padding:4px 20px 12px;margin-top:22px}.m-agenda h2{margin-top:14px}.m-agenda ol{margin:0;padding-left:22px}.m-agenda li{margin:3px 0;font-weight:600}
.m-point{padding:14px 0;border-bottom:1px solid var(--line);break-inside:avoid}.m-point:last-child{border-bottom:0}.m-point h3{font-size:17px;margin:0 0 6px;display:flex;gap:10px;align-items:baseline}
.m-num{flex:none;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:13px}
.m-point p{margin:4px 0 4px 34px}.m-label{font-size:12px;font-weight:700;color:var(--muted);margin-right:8px;text-transform:uppercase;letter-spacing:.05em}
.m-decision{border-left:3px solid var(--good);padding:4px 0 4px 10px}.m-decision.m-none{border-left-color:var(--line);color:var(--muted)}
.m-box{border:1px solid var(--good);border-radius:12px;padding:2px 20px 10px;margin-top:24px}.m-box h2{color:var(--good)}.m-box ul{margin:0;padding-left:20px}
.m-tasks td:first-child{font-weight:600;white-space:nowrap}.m-tasks td:last-child{white-space:nowrap}
.m-original{margin-top:24px}.m-original div{white-space:pre-wrap;font-size:13.5px;color:var(--muted);margin-top:8px}@media print{.m-original{display:none}}
.m-foot{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media (max-width:640px){.minutes{padding:22px 18px;border-radius:12px}.minutes h1{font-size:23px}.m-point p{margin-left:0}}
@media print{header,.m-tools{display:none!important}body{background:#fff;color:#000}main{padding:0;max-width:none}.minutes{border:0;padding:0;max-width:none;font-size:11pt}
:root{--muted:#555;--line:#ccc;--soft:#edf1ee;--accent:#2f5d50;--good:#2f6f4f;--card:#fff;--ink:#000}a{color:inherit;text-decoration:none}}
`;
