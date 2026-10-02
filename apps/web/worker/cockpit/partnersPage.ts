import { formatKrMinor, partnerDiscountLabel, partnerMemberPriceMinor } from "../../../../packages/core/src/partner-benefit.js";
import { DEFAULT_REDEMPTION, PARTNER_WINDOW_DAYS, type Partner, type PartnerEventRow, type PartnerListed, type PartnerMetrics } from "../partners/partners.js";
import { esc, layout } from "./page.js";

/** Partnerplanen, fase 1, in the cockpit: the board records a partner's yes, and Saga does the rest -
 * she reads the partner's calendar every hour and keeps the partner's events in Hjerterum's calendar. */

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
const SYNCED = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<Partner["status"], string> = { active: "Aktiv", paused: "Sat på pause", ended: "Afsluttet" };

const STYLE = `
.pa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.pa-stats div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.pa-stats b{display:block;font-size:24px;letter-spacing:-.01em}.pa-stats span{font-size:13px;color:var(--muted)}
.pa-list,.card>ul.pa-list,details>ul.pa-list{list-style:none;margin:0;padding:0}.pa-list li{display:grid;gap:3px;padding:12px 0;border-top:1px solid var(--line)}.pa-list li:first-child{border-top:0;padding-top:2px}
.pa-list a.name{font-weight:700;font-size:16px}.pa-form{display:grid;gap:10px}.pa-form .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.pa-form textarea{min-height:64px}.pa-acts{display:flex;gap:8px;flex-wrap:wrap;margin:0}.pa-acts form{margin:0}
.badge{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-left:6px}.badge.dim{background:var(--soft);color:var(--muted)}
.pa-ev li{display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center}.pa-ev .meta{font-size:13px;color:var(--muted)}.pa-ev form{grid-row:1/span 2;grid-column:2;margin:0}
.pa-ev .off{opacity:.55}.sync-bad{color:#9a3412}`;

const syncLine = (p: Pick<Partner, "feed_url" | "last_sync_at_ms" | "last_sync_ok" | "last_sync_message">) =>
  !p.feed_url ? `<span class="sync-bad">Ingen kalenderadresse endnu</span>`
    : p.last_sync_at_ms === null ? `<span class="muted">Ikke hentet endnu</span>`
    : `<span class="${p.last_sync_ok ? "muted" : "sync-bad"}">${p.last_sync_ok ? "Hentet" : "Fejl"} ${esc(SYNCED.format(p.last_sync_at_ms))}: ${esc(p.last_sync_message ?? "")}</span>`;

/** All clicks to the partner, of which some came from members' calendar. */
const numbers = (m: PartnerMetrics | undefined) => `${(m?.clicks ?? 0) + (m?.memberClicks ?? 0)} klik videre · ${m?.memberClicks ?? 0} fra medlemmer · ${m?.memberViews ?? 0} medlemsvisninger`;

type FormValues = Partial<Record<"name" | "website" | "contact_name" | "contact_email" | "feed_url" | "discount_kind" | "discount_value" | "redemption" | "agreed_on" | "note", string>>;

export function partnerFormValues(p: Partner): FormValues {
  return { name: p.name, website: p.website ?? "", contact_name: p.contact_name ?? "", contact_email: p.contact_email ?? "", feed_url: p.feed_url ?? "",
    discount_kind: p.discount_kind, discount_value: p.discount_kind === "percent" ? String(p.discount_value) : String(p.discount_value / 100).replace(".", ","),
    redemption: p.redemption, agreed_on: p.agreed_on ?? "", note: p.note ?? "" };
}

export const formValuesFrom = (form: FormData | null): FormValues =>
  Object.fromEntries(["name", "website", "contact_name", "contact_email", "feed_url", "discount_kind", "discount_value", "redemption", "agreed_on", "note"]
    .map(k => [k, String(form?.get(k) ?? "")]));

function partnerForm(action: string, v: FormValues, button: string): string {
  const kind = v.discount_kind === "amount" ? "amount" : "percent";
  return `<form class="pa-form" method="post" action="${action}">
<div class="two"><label>Partnerens navn<input name="name" required maxlength="120" value="${esc(v.name)}"></label>
<label>Hjemmeside<input name="website" maxlength="300" value="${esc(v.website)}" placeholder="partner.dk"></label></div>
<div class="two"><label>Rabat til Hjerterums medlemmer<select name="discount_kind"><option value="percent"${kind === "percent" ? " selected" : ""}>Procent</option><option value="amount"${kind === "amount" ? " selected" : ""}>Kroner pr. billet</option></select></label>
<label>Rabatten (fx 10)<input name="discount_value" required inputmode="decimal" maxlength="12" value="${esc(v.discount_value)}"></label></div>
<label>Sådan får et medlem rabatten (vises kun for medlemmer)<textarea name="redemption" required maxlength="500">${esc(v.redemption ?? DEFAULT_REDEMPTION)}</textarea></label>
<label>Partnerens kalenderadresse (iCal/.ics eller RSS)<input name="feed_url" maxlength="500" value="${esc(v.feed_url)}" placeholder="https://… eller webcal://…"></label>
<p class="small muted" style="margin:-4px 0 0">Google Kalender: Indstillinger → kalenderen → "Offentlig adresse i iCal-format". Outlook: Kalender → Del → Udgiv → ICS-link. Mange hjemmesider og billetsystemer har et "Abonnér"- eller iCal-link.</p>
<div class="two"><label>Kontaktperson<input name="contact_name" maxlength="120" value="${esc(v.contact_name)}"></label>
<label>Kontaktpersonens e-mail<input type="email" name="contact_email" maxlength="200" value="${esc(v.contact_email)}"></label></div>
<div class="two"><label>Aftalt den<input type="date" name="agreed_on" value="${esc(v.agreed_on)}"></label><label>Note til bestyrelsen<input name="note" maxlength="1000" value="${esc(v.note)}"></label></div>
<p style="margin:0"><button>${esc(button)}</button></p></form>`;
}

export function partnersPage(base: string, data: { partners: PartnerListed[]; metrics: Map<number, PartnerMetrics>; notice: string; error: string; values: FormValues;
  who: string | null }): string {
  const active = data.partners.filter(p => p.status === "active");
  const total = [...data.metrics.values()].reduce((sum, m) => ({ clicks: sum.clicks + m.clicks + m.memberClicks, views: sum.views + m.memberViews }), { clicks: 0, views: 0 });
  const list = data.partners.length ? `<ul class="pa-list">${data.partners.map(p => `<li><span><a class="name" href="${base}/arrangementer/partnere/${p.id}">${esc(p.name)}</a>
<span class="badge${p.status === "active" ? "" : " dim"}">${STATUS[p.status]}</span></span>
<span>${esc(partnerDiscountLabel({ kind: p.discount_kind, value: p.discount_value }))} · ${p.coming} kommende event${p.coming === 1 ? "" : "s"} i kalenderen${p.hidden_count ? ` · ${p.hidden_count} skjult` : ""}</span>
<span class="small">${syncLine(p)}</span><span class="small muted">Seneste 30 dage: ${numbers(data.metrics.get(p.id))}</span></li>`).join("")}</ul>`
    : `<p class="muted">Ingen partnere endnu. Det første mål: én partner, der siger ja til medlemsrabat, og hvis events kommer ind af sig selv.</p>`;
  return layout(base, "Partnere", `<main><p class="small"><a href="${base}/arrangementer">← Arrangementer</a></p><h1>Partnere</h1>
<p class="muted">En partner giver Hjerterums medlemmer rabat på sine events. Saga henter partnerens kalender hver time, og de kommende events vises i Hjerterums kalender som partner-events med normalpris og medlemspris. Tilmelding, betaling og billetter bliver hos partneren.</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}
<div class="pa-stats"><div><b>${active.length}</b><span>aktive partnere</span></div><div><b>${active.reduce((n, p) => n + p.coming, 0)}</b><span>kommende partner-events</span></div>
<div><b>${total.clicks}</b><span>klik videre, 30 dage</span></div><div><b>${total.views}</b><span>medlemsvisninger, 30 dage</span></div></div>
<div class="card"><h2>Partnere</h2>${list}</div>
<div class="card" id="ny"><h2>Ny partner</h2><p class="small muted">Partneren skal kun tage stilling til rabatten. Udfyld det, I har aftalt - Saga henter events, så snart der er en kalenderadresse.</p>
${data.error ? `<p class="notice warn" role="alert">${esc(data.error)}</p>` : ""}${partnerForm(`${base}/arrangementer/partnere`, data.values, "Opret partner og hent events")}</div></main>`,
  { section: "/arrangementer", who: data.who, style: STYLE });
}

export function partnerPage(base: string, data: { partner: Partner; events: PartnerEventRow[]; metrics: PartnerMetrics | undefined;
  clicks: Map<number, { clicks: number; memberClicks: number }>; notice: string; error: string; values: FormValues | null; nowMs: number; who: string | null }): string {
  const p = data.partner, here = `${base}/arrangementer/partnere/${p.id}`;
  const discount = { kind: p.discount_kind, value: p.discount_value } as const;
  const price = (e: PartnerEventRow) => {
    if (e.price_minor === null) return "pris ukendt";
    if (e.price_minor === 0) return "gratis";
    return `${formatKrMinor(e.price_minor)} → medlemmer ${formatKrMinor(partnerMemberPriceMinor(e.price_minor, discount) ?? e.price_minor)}`;
  };
  const coming = data.events.filter(e => e.removed_at_ms === null);
  const gone = data.events.filter(e => e.removed_at_ms !== null);
  const line = (e: PartnerEventRow) => {
    const c = data.clicks.get(e.id);
    return `<li class="${e.hidden || e.removed_at_ms ? "off" : ""}"><span>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : esc(e.title)}${e.hidden ? `<span class="badge dim">Skjult${e.hidden_by ? ` af ${esc(e.hidden_by)}` : ""}</span>` : ""}</span>
<span class="meta">${esc(WHEN.format(e.starts_at_ms))}${e.all_day ? "" : ` · kl. ${esc(CLOCK.format(e.starts_at_ms))}`} · ${esc(price(e))}${c ? ` · ${c.clicks + c.memberClicks} klik` : ""}</span>
${e.removed_at_ms ? "" : `<form method="post" action="${here}"><input type="hidden" name="event" value="${e.id}"><button class="ghost" name="action" value="${e.hidden ? "show" : "hide"}">${e.hidden ? "Vis igen" : "Skjul"}</button></form>`}</li>`;
  };
  const statusButtons = [
    `<form method="post" action="${here}"><button name="action" value="sync"${p.feed_url ? "" : " disabled"}>Hent events nu</button></form>`,
    p.status === "active" ? `<form method="post" action="${here}"><button class="ghost" name="action" value="pause">Sæt på pause</button></form>`
      : `<form method="post" action="${here}"><button class="ghost" name="action" value="activate">Gør aktiv igen</button></form>`,
    p.status === "ended" ? "" : `<form method="post" action="${here}" onsubmit="return confirm('Afslut samarbejdet? Partnerens events forsvinder fra kalenderen.')"><button class="ghost" name="action" value="end">Afslut samarbejdet</button></form>`
  ].join("");
  return layout(base, p.name, `<main><p class="small"><a href="${base}/arrangementer/partnere">← Partnere</a></p>
<h1>${esc(p.name)}</h1>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}
<p><span class="badge${p.status === "active" ? "" : " dim"}" style="margin:0 6px 0 0">${STATUS[p.status]}</span>${esc(partnerDiscountLabel(discount))} for Hjerterums medlemmer${p.agreed_on ? ` · aftalt ${esc(p.agreed_on)}` : ""}${p.website ? ` · <a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">${esc(p.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}</p>
<p class="small">${syncLine(p)}</p><div class="pa-acts">${statusButtons}</div>
<div class="card"><h2>Målinger, seneste 30 dage</h2><p>${numbers(data.metrics)}</p><p class="small muted">Klik videre tælles, når nogen åbner et partner-event fra Hjerterums kalender. Medlemsvisninger er de gange, et medlems kalender viste partnerens events. Hvor mange der har brugt rabatten, ved kun partneren - spørg ved næste opfølgning.</p></div>
<div class="card"><h2>Kommende events</h2>${coming.length ? `<ul class="pa-list pa-ev">${coming.map(line).join("")}</ul>` : `<p class="muted">${p.feed_url ? "Ingen kommende events i partnerens kalender." : "Tilføj partnerens kalenderadresse nedenfor, så henter Saga events."}</p>`}
${gone.length ? `<details><summary>Aflyst eller fjernet fra partnerens kalender (${gone.length})</summary><ul class="pa-list pa-ev">${gone.map(line).join("")}</ul></details>` : ""}
<p class="small muted">Hjerterum viser kun events de næste ${PARTNER_WINDOW_DAYS} dage. Gentagne serier (fx ugentlige hold) vises ikke i fase 1.</p></div>
<div class="card"><h2>Aftalen</h2>${data.error ? `<p class="notice warn" role="alert">${esc(data.error)}</p>` : ""}
${partnerForm(here, data.values ?? partnerFormValues(p), "Gem aftalen")}
<p class="small muted">Oprettet af ${esc(p.created_by)} ${esc(SYNCED.format(p.created_at_ms))}.${p.contact_name || p.contact_email ? ` Kontakt: ${esc([p.contact_name, p.contact_email].filter(Boolean).join(", "))}.` : ""}</p></div></main>`,
  { section: "/arrangementer", who: data.who, style: STYLE });
}
