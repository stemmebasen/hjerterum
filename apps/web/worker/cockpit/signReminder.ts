import { editUntil, type ApprovedMinutes } from "./data.js";
import { esc } from "./page.js";

/** Requested: "Hvis et medlem ikke har godkendt referatet efter to dage, skal der komme en gul ring omkring påmindelsen, og hvis
 * der går fem dage, skal der komme en rød ring." - "Påmindelsen bør ligge i toppen som en bar med farvet baggrund - enten grå,
 * orange/gul eller rød baggrund lige under headeren." A bar under the menu on every page while the member has minutes to approve:
 * grey at first, amber from two days, red from five - counted from when the three days of corrections ended (or the chair last corrected them). */
const DAY = 86_400_000;
const DATE = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", timeZone: "UTC" });

export type ReminderLevel = "ny" | "gul" | "roed";
export const reminderLevel = (days: number): ReminderLevel => days >= 5 ? "roed" : days >= 2 ? "gul" : "ny";

export function signReminder(base: string, toSign: ApprovedMinutes[], nowMs: number): string {
  if (!toSign.length) return "";
  // The oldest decides the colour and is the one to read first.
  const since = (m: ApprovedMinutes) => Math.max(editUntil(m), m.updated_at_ms ?? 0);
  const oldest = [...toSign].sort((a, b) => since(a) - since(b))[0]!;
  const days = Math.max(0, Math.floor((nowMs - since(oldest)) / DAY));
  const level = reminderLevel(days);
  const which = oldest.meeting_date ? `referatet fra mødet ${DATE.format(new Date(`${oldest.meeting_date}T12:00:00Z`))}` : "referatet";
  const waited = days >= 2 ? ` Det har ventet på dig i ${days} dage.` : "";
  const text = toSign.length > 1
    ? `${toSign.length} referater venter på din godkendelse.${days >= 2 ? ` Det ældste har ventet i ${days} dage.` : ""}`
    : `Husk at godkende ${which}.${waited}`;
  return `<div class="sign-bar ${level}" role="status"><div class="sign-inner"><span>${esc(text)}</span><a class="button" href="${base}/referat/${oldest.id}">Læs og godkend →</a></div></div>`;
}

/** Requested: "Det ville også være godt, hvis godkendelse af referatet kommer på den individuelle opgaveliste for dem, der ikke har godkendt
 * det endnu." - one line on Dine opgaver per minutes still to approve; it goes when they are approved. */
export function signTodo(base: string, m: ApprovedMinutes, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - Math.max(editUntil(m), m.updated_at_ms ?? 0)) / DAY));
  const which = m.meeting_date ? `referatet fra ${DATE.format(new Date(`${m.meeting_date}T12:00:00Z`))}` : "referatet";
  return `<li><a href="${base}/referat/${m.id}"><strong>Godkend ${esc(which)}</strong></a><span class="ctx">Referat · ${days >= 2 ? `har ventet i ${days} dage` : "nyt"}</span></li>`;
}

export const SIGN_STYLE = `<style>
.sign-bar{border-bottom:1px solid var(--line);background:var(--soft);color:var(--ink)}
.sign-bar .sign-inner{max-width:1160px;margin:0 auto;padding:10px 24px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;font-size:14.5px;font-weight:600}
.sign-bar .button{padding:6px 14px;min-height:0;font-size:13.5px;white-space:nowrap}
.sign-bar.ny .button{background:var(--ink);border-color:var(--ink);color:var(--card)}
.sign-bar.gul{background:#fdf0d5;border-color:#f0c766;color:#6b4500}.sign-bar.gul .button{background:#b7791f;border-color:#b7791f;color:#fff}
.sign-bar.roed{background:#fbe3df;border-color:#e59a8f;color:#8a1f12}.sign-bar.roed .button{background:#b3361f;border-color:#b3361f;color:#fff}
@media (prefers-color-scheme:dark){.sign-bar.gul{background:#4a3712;border-color:#8a6a24;color:#f7dc9c}.sign-bar.roed{background:#4d211b;border-color:#8f3b2f;color:#f6c4bb}}
@media (max-width:620px){.sign-bar .sign-inner{padding:10px 16px;font-size:14px}}
@media print{.sign-bar{display:none}}
</style>`;
