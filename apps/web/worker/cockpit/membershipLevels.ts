import { MEMBERSHIP_TIERS, membershipPlans } from "../../membership.js";
import type { LevelChange } from "../membership-levels.js";
import { COCKPIT_MEMBERS_STYLE } from "./membershipCockpit.js";
import { esc, layout } from "./page.js";

/** Asked (the chair, 12 Nov 2026), on Douglas' "The membership levels must be in the 'Membership Overview' page and editable": "Af mig og Douglas"
 * (authority.ts "members.levels"). Each level's name, words and prices; what it changes and what it does not stands at the top. */

const kr = (minor: number) => (minor / 100).toLocaleString("da-DK", { maximumFractionDigits: 2 });
const TIME = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

export function levelsPage(base: string, who: string | null, d: { changes: LevelChange[]; notice: string; error: string; errorTier?: string }): string {
  const forms = MEMBERSHIP_TIERS.map(tier => {
    const p = membershipPlans[tier];
    return `<form class="card mc-form" method="post" action="${base}/medlemskab/niveauer" id="niveau-${tier}"><input type="hidden" name="tier" value="${tier}">
<h2>${esc(p.name)}</h2>${d.error && d.errorTier === tier ? `<p class="notice bad">${esc(d.error)}</p>` : ""}
<label class="mc-field"><span>Navn</span><input name="name" maxlength="80" required value="${esc(p.name)}"></label>
<label class="mc-field"><span>Beskrivelse</span><textarea name="description" rows="5" maxlength="1000">${esc(p.description)}</textarea></label>
<div class="ml-prices"><label class="mc-field"><span>Kr. pr. måned</span><input name="month" inputmode="decimal" required value="${kr(p.month)}"></label>
<label class="mc-field"><span>Kr. pr. år</span><input name="year" inputmode="decimal" required value="${kr(p.year)}"></label></div>
<p class="small muted">${p.benefits ? "Giver adgang til medlemsfordelene." : "Giver ikke adgang til medlemsfordelene."}</p>
<button>Gem ${esc(p.name.toLocaleLowerCase("da-DK"))}</button></form>`;
  }).join("");
  const history = d.changes.length ? `<ul class="mc-timeline">${d.changes.map(c => {
    const what = [c.before.name !== c.after.name && `navn: ${c.before.name} → ${c.after.name}`, c.before.month !== c.after.month && `pr. måned: ${kr(c.before.month)} → ${kr(c.after.month)} kr.`,
      c.before.year !== c.after.year && `pr. år: ${kr(c.before.year)} → ${kr(c.after.year)} kr.`, c.before.description !== c.after.description && "beskrivelsen"].filter(Boolean).join(" · ");
    return `<li><span>${esc(TIME.format(c.atMs))}</span><div><b>${esc(c.after.name)}</b><p>${esc(what || "ingen ændring")}</p><small>${esc(c.by)}</small></div></li>`;
  }).join("")}</ul>` : `<p class="muted">Ingen ændringer endnu - medlemskaberne er, som de står på hjemmesiden.</p>`;
  const body = `<main class="mc"><p class="small"><a href="${base}/medlemskab">← Medlemsoverblik</a></p><h1>Medlemskaber</h1>
<p class="muted small">Navne, beskrivelser og priser på de fire medlemskaber. Kun for formanden og Douglas, der er ansvarlig for medlemssystemet.</p>
<div class="card ml-note"><p><b>En ændring slår igennem på</b> hjemmesiden, medlemssiderne og det, Saga svarer, inden for et minut - og prisen på et nyt medlemskab, der betales i Hjerterums nye system.</p>
<p><b>Den ændrer ikke</b> prisen på medlemskaber, der allerede kører. Priserne i MembershipWorks ændres ikke herfra - så længe indmeldelse sker dér, skal en ny pris også rettes dér.</p>
<p>En ny pris kræver en beslutning i bestyrelsen.</p></div>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}${d.error && !d.errorTier ? `<p class="notice bad">${esc(d.error)}</p>` : ""}
<section class="mc-grid ml-grid">${forms}</section>
<section class="card"><h2>Ændringer</h2>${history}</section></main>`;
  return layout(base, "Medlemskaber", body, { section: "/medlemskab", who, style: COCKPIT_MEMBERS_STYLE + LEVELS_STYLE });
}

const LEVELS_STYLE = `
.ml-note p{margin:0 0 6px;font-size:14px}.ml-note p:last-child{margin:0}.ml-grid{margin-top:12px}
.ml-prices{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mc .mc-form textarea{width:100%;box-sizing:border-box}`;
