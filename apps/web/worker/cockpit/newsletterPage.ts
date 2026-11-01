import { esc, layout } from "./page.js";
import { Cap, monthName, SEND_HOUR, type Highlight, type Issue } from "../newsletter.js";

/** Events → Nyhedsbrev: the coming month's "Månedens events" (newsletter.ts) - read it as it will arrive, change Saga's words, approve it.
 * Approved, it goes out through Mailchimp on the 1st at 19.00; nothing is sent before someone here has said yes. */

const STATUS: Record<Issue["status"], string> = { draft: "Udkast - ikke godkendt", approved: "Godkendt - sendes automatisk", sent: "Sendt", failed: "Kunne ikke sendes" };

export function newsletterPage(base: string, who: string | null, data: { month: string; issue: Issue | null; months: string[]; mailchimp: boolean; aiReady: boolean; notice: string; error: string }): string {
  const { month, issue } = data;
  const name = monthName(month);
  const tabs = data.months.map(m => `<a class="${m === month ? "on" : ""}" href="${base}/arrangementer/nyhedsbrev?m=${m}">${Cap(monthName(m))}</a>`).join("");
  const locked = issue?.status === "sent";
  const field = (label: string, input: string) => `<label class="nl-field"><span>${label}</span>${input}</label>`;
  const highlight = (h: Highlight, i: number) => `<fieldset class="nl-hl"><legend>Fremhævet ${i + 1}</legend>
${field("Overskrift", `<input name="h${i}_heading" value="${esc(h.heading)}" ${locked ? "disabled" : ""}>`)}
${field("Linje (underviser · datoer)", `<input name="h${i}_byline" value="${esc(h.byline)}" ${locked ? "disabled" : ""}>`)}
${field("Tekst - links skrives [titel](https://...)", `<textarea name="h${i}_text" rows="6" ${locked ? "disabled" : ""}>${esc(h.text)}</textarea>`)}
${field("Billede (adresse)", `<input name="h${i}_image" value="${esc(h.image ?? "")}" ${locked ? "disabled" : ""}>`)}
${field("Læs mere-link", `<input name="h${i}_link" value="${esc(h.link)}" ${locked ? "disabled" : ""}>`)}
${locked ? "" : `<label class="nl-remove"><input type="checkbox" name="h${i}_remove" value="1"> Fjern denne</label>`}</fieldset>`;
  const sendLine = `den 1. ${name} kl. ${SEND_HOUR}.00`;
  const actions = !issue ? "" : issue.status === "sent" ? `<p class="notice">Sendt ${issue.sent_at_ms ? new Date(issue.sent_at_ms).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : ""}.</p>`
    : issue.status === "approved" ? `<form method="post" action="${base}/arrangementer/nyhedsbrev/godkend" class="nl-acts"><input type="hidden" name="m" value="${month}"><input type="hidden" name="undo" value="1">
<p>Godkendt af ${esc(issue.approved_by ?? "")}. Det sendes ${sendLine} til dem, der har valgt "Månedens events".</p><button class="ghost">Fortryd godkendelsen</button></form>`
    : `<form method="post" action="${base}/arrangementer/nyhedsbrev/godkend" class="nl-acts"><input type="hidden" name="m" value="${month}">
<button ${data.mailchimp ? "" : "disabled"}>Godkend - send ${sendLine}</button>${data.mailchimp ? "" : `<p class="small muted">Mailchimp er ikke forbundet endnu (hemmeligheden MAILCHIMP_API_KEY mangler), så det kan ikke sendes herfra. Du kan hente mailen som HTML nedenfor og sætte den ind i Mailchimp.</p>`}</form>`;
  const body = `<main class="nl"><p class="small"><a href="${base}/arrangementer">← Events</a></p><h1>Nyhedsbrev · Månedens events</h1>
<p class="muted">Saga skriver næste måneds nyhedsbrev den ${20}. i måneden. Læs det, ret ordene, og godkend det - så går det ud den 1. kl. ${SEND_HOUR}.00 til dem, der har valgt "Månedens events" i Mailchimp. Listen over events læses fra kalenderen, når mailen sendes.</p>
<nav class="nl-tabs">${tabs}</nav>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${data.error ? `<p class="notice bad">${esc(data.error)}</p>` : ""}
${issue ? `<p><b>${esc(STATUS[issue.status])}</b>${issue.error ? ` <span class="small muted">· ${esc(issue.error)}</span>` : ""}</p>${actions}
<div class="nl-grid"><section><form method="post" action="${base}/arrangementer/nyhedsbrev/gem"><input type="hidden" name="m" value="${month}">
${field("Emnelinje", `<input name="subject" value="${esc(issue.subject)}" ${locked ? "disabled" : ""}>`)}
${field("Forhåndstekst (vises efter emnet i indbakken)", `<input name="preheader" value="${esc(issue.preheader)}" ${locked ? "disabled" : ""}>`)}
${field("Hilsen (afsnit adskilles af en tom linje)", `<textarea name="intro" rows="7" ${locked ? "disabled" : ""}>${esc(issue.intro)}</textarea>`)}
${issue.highlights.map(highlight).join("")}
${locked ? "" : `<p class="nl-acts"><button>Gem ændringer</button></p>`}</form>
${locked || !data.aiReady ? "" : `<form method="post" action="${base}/arrangementer/nyhedsbrev/skriv" onsubmit="return confirm('Saga skriver det hele forfra. Dine ændringer forsvinder.')"><input type="hidden" name="m" value="${month}"><button class="ghost">Lad Saga skrive det forfra</button></form>`}
<p><a class="button" href="${base}/arrangementer/nyhedsbrev/html?m=${month}" download="nyhedsbrev-${month}.html">Hent mailen som HTML</a></p></section>
<section><iframe class="nl-preview" src="${base}/arrangementer/nyhedsbrev/vis?m=${month}" title="Sådan ser mailen ud"></iframe></section></div>`
    : `<p>Der er intet nyhedsbrev for ${esc(name)} endnu.</p>${data.aiReady ? `<form method="post" action="${base}/arrangementer/nyhedsbrev/skriv"><input type="hidden" name="m" value="${month}"><button>Lad Saga skrive det nu</button></form>` : ""}`}
</main>`;
  return layout(base, "Nyhedsbrev", body, { section: "/arrangementer", who, style: STYLE });
}

const STYLE = `.nl-tabs{display:flex;gap:8px;margin:16px 0}.nl-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line,#ddd);text-decoration:none}.nl-tabs a.on{background:var(--ink,#2a2622);color:#fff}
.nl-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,640px);gap:24px;align-items:start}@media(max-width:1100px){.nl-grid{grid-template-columns:1fr}}
.nl-field{display:block;margin:0 0 12px}.nl-field span{display:block;font-size:13px;color:var(--muted,#6b5d52);margin-bottom:4px}.nl-field input,.nl-field textarea{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);color:inherit}
.nl-hl{border:1px solid var(--line,#ddd);border-radius:14px;padding:12px 14px;margin:0 0 14px}.nl-hl legend{font-weight:600;padding:0 6px}.nl-remove{font-size:13px}
.nl-acts{margin:12px 0}.nl-preview{width:100%;height:1400px;border:1px solid var(--line,#ddd);border-radius:14px;background:#f2f2f2}.notice.bad{border-color:#b3261e;color:#b3261e}`;
