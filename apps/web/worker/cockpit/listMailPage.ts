import { esc, layout } from "./page.js";
import { AUDIENCES, listMailReady, type ListMail } from "../list-mail.js";

/** Events → Mail til listen (list-mail.ts): the mails sent and drafted, and one mail to write, read as it will arrive, try on oneself and send. */

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<ListMail["status"], string> = { draft: "Udkast", sent: "Sendt", failed: "Kunne ikke sendes" };

export function listMailsPage(base: string, who: string | null, data: { mails: ListMail[]; mailchimp: boolean; notice: string }): string {
  const row = (m: ListMail) => `<li><a href="${base}/arrangementer/mail/${m.id}"><b>${esc(m.subject || "(uden emne)")}</b></a>
<span class="small muted">${STATUS[m.status]}${m.status === "sent" && m.sent_at_ms ? ` ${esc(WHEN.format(m.sent_at_ms))}${m.recipients !== null ? ` til ${m.recipients} modtagere` : ""}` : ` · ${esc(WHEN.format(m.updated_at_ms))}`} · ${AUDIENCES[m.audience].label}</span></li>`;
  return layout(base, "Mail til listen", `<main class="lm"><p class="small"><a href="${base}/arrangementer">← Events</a></p><h1>Mail til listen</h1>
<p class="muted">Send en mail til dem, der har sagt ja til nyheder fra Hjerterum - alle i Mailchimp-listen eller kun medlemmerne. Du skriver den selv eller beder Saga om et udkast, prøver den på din egen mail og sender, når du er klar. Intet sendes, før du trykker Send.</p>
${data.mailchimp ? "" : `<p class="notice bad">Mailchimp er ikke forbundet endnu (hemmeligheden MAILCHIMP_API_KEY mangler). Du kan skrive mails, men ikke sende dem.</p>`}
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}
<form method="post" action="${base}/arrangementer/mail/ny"><button>Skriv en ny mail</button></form>
${data.mails.length ? `<ul class="plain lm-list">${data.mails.map(row).join("")}</ul>` : `<p class="muted">Ingen mails endnu.</p>`}</main>`, { section: "/arrangementer", who, style: STYLE });
}

export function listMailPage(base: string, who: string | null, mail: ListMail, data: { mailchimp: boolean; aiReady: boolean; count: number | null; notice: string; error: string; testTo: string }): string {
  const locked = mail.status === "sent";
  const off = locked ? "disabled" : "";
  const field = (label: string, input: string, hint = "") => `<label class="lm-field"><span>${label}</span>${input}${hint ? `<small class="muted">${hint}</small>` : ""}</label>`;
  const audience = (Object.keys(AUDIENCES) as Array<ListMail["audience"]>).map(key => `<label class="lm-radio"><input type="radio" name="audience" value="${key}" ${mail.audience === key ? "checked" : ""} ${off}> ${AUDIENCES[key].label}</label>`).join("");
  const at = `${base}/arrangementer/mail/${mail.id}`;
  const recipients = data.count !== null ? `${data.count} modtagere` : AUDIENCES[mail.audience].label.toLowerCase();
  const ask = `Send "${mail.subject}" nu til ${recipients}?\n\nDen kan ikke kaldes tilbage, når den er sendt.`;
  const actions = locked ? `<p class="notice">Sendt ${mail.sent_at_ms ? esc(WHEN.format(mail.sent_at_ms)) : ""}${mail.sent_by ? ` af ${esc(mail.sent_by)}` : ""}${mail.recipients !== null ? ` til ${mail.recipients} modtagere` : ""}.</p>`
    : `<div class="lm-send">
<form method="post" action="${at}/test" class="lm-inline"><input type="email" name="to" required placeholder="din@mail.dk" value="${esc(data.testTo)}" aria-label="Send en prøve til"><button class="ghost" ${data.mailchimp && listMailReady(mail) ? "" : "disabled"}>Send en prøve til mig</button></form>
<form method="post" action="${at}/send" onsubmit="return confirm(${esc(JSON.stringify(ask))})"><button ${data.mailchimp && listMailReady(mail) ? "" : "disabled"}>Send til ${esc(recipients)}</button></form>
${listMailReady(mail) ? "" : `<p class="small muted">Skriv en emnelinje og en tekst, og gem, før den kan sendes.</p>`}</div>`;
  return layout(base, mail.subject || "Ny mail", `<main class="lm"><p class="small"><a href="${base}/arrangementer/mail">← Mail til listen</a></p><h1>${esc(mail.subject || "Ny mail")}</h1>
<p><b>${STATUS[mail.status]}</b>${mail.error ? ` <span class="small muted">· ${esc(mail.error)}</span>` : ""}</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${data.error ? `<p class="notice bad">${esc(data.error)}</p>` : ""}
<div class="lm-grid"><section>
${locked || !data.aiReady ? "" : `<form method="post" action="${at}/saga" class="card lm-saga">${field("Bed Saga om et udkast", `<textarea name="notes" rows="4" maxlength="4000" placeholder="Fx: Invitation til julefesten fredag den 11. december kl. 18 i Hjerterum. Medlemmer gratis, andre 111 kr. Tag mad med til fællesbordet."></textarea>`, "Skriv stikord: hvad, hvornår, hvor, pris og links. Saga opfinder intet.")}<button class="ghost">Lad Saga skrive udkastet</button></form>`}
<form method="post" action="${at}/gem" class="card">
${field("Modtagere", `<div class="lm-radios">${audience}</div>`)}
${field("Emnelinje", `<input name="subject" maxlength="150" value="${esc(mail.subject)}" ${off}>`)}
${field("Forhåndstekst", `<input name="preheader" maxlength="150" value="${esc(mail.preheader)}" ${off}>`, "Vises efter emnet i indbakken.")}
${field("Overskrift i mailen (valgfri)", `<input name="heading" maxlength="120" value="${esc(mail.heading)}" ${off}>`)}
${field("Tekst", `<textarea name="body" rows="16" maxlength="8000" ${off}>${esc(mail.body)}</textarea>`, "Afsnit adskilles af en tom linje. Links skrives [tekst](https://...).")}
${locked ? "" : `<p><button>Gem</button></p>`}</form>
${actions}
${locked ? "" : `<form method="post" action="${at}/slet" onsubmit="return confirm('Slet udkastet?')"><button class="ghost danger">Slet udkastet</button></form>`}
</section><section><iframe class="lm-preview" src="${at}/vis" title="Sådan ser mailen ud"></iframe></section></div></main>`, { section: "/arrangementer", who, style: STYLE });
}

const STYLE = `.lm-list li{display:grid;gap:2px;padding:10px 0;border-top:1px solid var(--line)}.lm-list li:first-child{border-top:0}
.lm-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,620px);gap:24px;align-items:start}@media(max-width:1100px){.lm-grid{grid-template-columns:1fr}}
.lm form.card{display:grid;gap:12px;margin:0 0 16px}.lm-field{display:grid;gap:4px}.lm-field>span{font-size:13px;color:var(--muted)}
.lm-field input,.lm-field textarea{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit;width:100%;box-sizing:border-box}
.lm-radios{display:flex;gap:18px;flex-wrap:wrap}.lm .lm-radio{display:inline-flex;gap:8px;align-items:center;white-space:nowrap}.lm .lm-radio input{width:18px;height:18px;min-height:0;margin:0;padding:0;flex:none}
.lm-send{display:grid;gap:12px;margin:0 0 16px}.lm-inline{display:flex;gap:8px;flex-wrap:wrap}.lm-inline input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;min-width:220px;background:var(--card,transparent);color:inherit}
.lm-preview{width:100%;height:1000px;border:1px solid var(--line);border-radius:14px;background:#f2f2f2}.notice.bad{color:#b3261e;border-color:#b3261e}button.danger{color:var(--danger,#b3261e);border-color:currentColor}`;
