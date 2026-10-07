import { membershipPlan, membershipPlans } from "../../membership.js";
import { isoDay, planName, statusText, STATUS_FILTERS, type AdminMember, type MemberEvent, type MembershipWorksAccount, type StatusFilter, type TimelineEntry, type TurnoverGroup, type TurnoverRow } from "../member-admin.js";
import { esc, fold, layout, SHOWN } from "./page.js";

/** Requested: "Hvad med "Medlemmer"-sektion i admin, hvor vi kan se medlemmer, profilinfo, status og historik?" - "Husk den
 * skal lægge sig op ad hvad MembershipWorks gør med medlemmer" - "Her kan du se den relevante info vi skal videreføre.
 * Herudover en oversigt over events medlemmet har oprettet" - "vi skal kun fokusere på vores eget systems medlemmer".
 * The list, and a member's page as MembershipWorks has it: the membership label with its status ("Past Due 35 Days"),
 * then Medlemskab (billing, since when), Kontakt, Tidslinje and Events. Data: worker/member-admin.ts. */

const KR = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 });
const kr = (minor: number) => `${KR.format(minor / 100)} kr.`;
const DATE = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" });
const WEEKDAY = new Intl.DateTimeFormat("da-DK", { weekday: "short", timeZone: "Europe/Copenhagen" });
const DAY_MONTH = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });
const YEAR = new Intl.DateTimeFormat("da-DK", { year: "numeric", timeZone: "Europe/Copenhagen" });
const TIME = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

export const MEMBER_PAGES_STYLE = `
.m-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.m-tile{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 18px;box-shadow:var(--shadow);display:grid;gap:2px;text-decoration:none;color:var(--ink)}
.m-tile span{font-size:12.5px;font-weight:650;color:var(--muted)}.m-tile b{font-size:30px;font-weight:600;letter-spacing:-.03em;line-height:1.15}
.m-tile.on{border-color:var(--accent)}
.m-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}.m-side{display:grid;gap:20px}
.m-search{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}.m-search input{flex:1 1 220px}.m-search select{flex:0 1 180px}.m-search button{flex:none}
table.m-list td,table.m-list th{padding:11px 8px;font-size:14.5px;vertical-align:middle}table.m-list td small{display:block;color:var(--faint);font-size:12.5px}
table.m-list a{font-weight:600;text-decoration:none;color:var(--ink)}table.m-list a:hover{color:var(--accent)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:650;padding:4px 11px;border-radius:999px;white-space:nowrap;line-height:1.3}
.badge.plan{background:var(--accent);color:var(--accent-ink)}.badge.ok{background:var(--tint);color:var(--good)}.badge.due{background:var(--warn-soft);color:var(--warn)}
.badge.off{background:var(--soft);color:var(--muted)}.badge.blocked{background:var(--warn);color:var(--card)}
.labels{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:2px 0 4px}.labels .badge.plan{border-radius:999px 0 0 999px;margin-right:-6px}.labels .badge.plan+.badge{border-radius:0 999px 999px 0}
.m-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:10px}
.m-tabs a{padding:8px 14px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14.5px;color:var(--accent)}.m-tabs a[aria-current]{background:var(--soft);color:var(--ink)}
.m-back{font-size:14px;font-weight:600;text-decoration:none}
.m-facts{display:grid;gap:4px;margin:0 0 16px}.m-facts p{margin:0}.m-facts .warn{font-weight:500}
.m-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.m-actions form{display:flex;gap:8px;align-items:end;margin:0}.m-actions select{min-width:220px}
.m-mw{background:var(--soft);border-radius:16px;padding:16px 18px;display:grid;gap:4px;margin-top:16px}.m-mw p{margin:0}.m-mw .lbl{font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lys-terra)}
.m-contact{display:grid;gap:8px;font-size:15.5px}.m-contact a{text-decoration:none}
.tl{list-style:none;margin:8px 0 0;padding:0;display:grid}.tl li{display:grid;grid-template-columns:58px 1fr;gap:16px;padding:12px 0;position:relative}
.tl li::before{content:"";position:absolute;left:28px;top:0;bottom:0;width:2px;background:var(--line)}.tl li:first-child::before{top:24px}.tl li:last-child::before{bottom:calc(100% - 24px)}
.tl .when{position:relative;z-index:1;background:var(--card);border:1px solid var(--line);border-radius:10px;text-align:center;font-size:11px;line-height:1.25;padding:5px 2px;color:var(--muted);align-self:start}
.tl .when b{display:block;color:var(--ink);font-size:12.5px}.tl h3{all:unset;display:block;font-weight:650;font-size:15.5px}.tl .amt{font-weight:650}.tl .bad h3{color:var(--warn)}
.tl p{margin:2px 0 0;font-size:14px;color:var(--muted);white-space:pre-wrap}.tl .by{font-size:12.5px;color:var(--faint)}
.m-note{display:grid;gap:10px;margin:0 0 6px}.m-note textarea{min-height:80px}
@media (max-width:1000px){.m-layout{grid-template-columns:1fr}.m-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.labels .badge{white-space:normal}.labels .badge.plan{border-radius:12px;margin-right:0}.labels .badge.plan+.badge{border-radius:999px}}
`;

/** As MembershipWorks labels a membership: "Standard medlemskab - 222 kr./md. eller 2.310 kr./år". */
function planLabel(m: Pick<AdminMember, "tier" | "billing">): string {
  const plan = membershipPlan(m.tier);
  if (!plan) return planName(m.tier);
  return m.billing === "manual" ? plan.name : `${plan.name} - ${kr(plan.month)}/md. eller ${kr(plan.year)}/år`;
}

export function statusBadge(m: AdminMember, now: number): string {
  const cls = m.status === "active" ? "ok" : m.status === "past_due" ? "due" : "off";
  return `<span class="badge ${cls}">${esc(statusText(m, now))}</span>${m.accessBlocked ? ' <span class="badge blocked">Adgang blokeret</span>' : ""}`;
}

const memberSince = (m: AdminMember) => m.joinedOn ? isoDay(m.joinedOn) : DATE.format(m.createdAtMs);

export type MembersListData = {
  /** The chair also gets a link to Administratorer. */
  chair?: boolean | undefined; members: AdminMember[]; counts: { active: number; pastDue: number; ended: number; newLast30: number }; q: string; filter: StatusFilter; notice?: string | undefined; error?: string | undefined;
  mw: { accounts: number; linked: number; latest: { filename: string; by: string; atMs: number } | null }; now: number;
};

const FILTER_LABEL: Record<StatusFilter, string> = { alle: "Alle", aktive: "Aktive", restance: "I restance", opsagt: "Opsagt" };

export function membersListPage(base: string, who: string | null, d: MembersListData): string {
  const tile = (filter: StatusFilter, label: string, n: number) => `<a class="m-tile${d.filter === filter ? " on" : ""}" href="${base}/medlemmer?status=${filter}"><span>${label}</span><b>${n}</b></a>`;
  const rows = d.members.map(m => `<tr><td data-label="Navn"><a href="${base}/medlemmer/${m.id}">${esc(m.fullName)}</a><small>${esc(m.email)}</small></td>
<td data-label="Medlemskab">${esc(planName(m.tier))}</td><td data-label="Status">${statusBadge(m, d.now)}</td>
<td data-label="Betaling">${m.paysInMembershipworks ? "MembershipWorks" : m.billing === "manual" ? "Manuel" : m.interval === "year" ? "Kort · årlig" : "Kort · månedlig"}</td><td data-label="Medlem siden">${esc(memberSince(m))}</td></tr>`).join("");
  const list = `<section class="panel"><form class="m-search" method="get" action="${base}/medlemmer"><input type="search" name="q" value="${esc(d.q)}" placeholder="Søg på navn eller e-mail" aria-label="Søg">
<select name="status" aria-label="Status">${STATUS_FILTERS.map(f => `<option value="${f}"${f === d.filter ? " selected" : ""}>${FILTER_LABEL[f]}</option>`).join("")}</select><button>Søg</button></form>
${d.members.length ? `<table class="rows m-list"><tr><th>Navn</th><th>Medlemskab</th><th>Status</th><th>Betaling</th><th>Medlem siden</th></tr>${rows}</table>`
    : `<p class="empty">${d.q || d.filter !== "alle" ? "Ingen medlemmer matcher søgningen." : "Ingen medlemmer i det nye system endnu."}</p>`}</section>`;
  const give = `<section class="panel" id="giv"><header><h2>Giv medlemskab</h2><p>Uden betaling via kort - som manuel betaling i MembershipWorks.</p></header>
<form class="stack" method="post" action="${base}/medlemmer/giv"><label>E-mail<input type="email" name="email" required autocomplete="off"></label>
<label>Medlemskab<select name="tier">${Object.entries(membershipPlans).map(([key, plan]) => `<option value="${key}">${esc(plan.name)}</option>`).join("")}</select></label>
<label>Note <span class="muted" style="font-weight:400">(valgfri)</span><input name="note" maxlength="300" placeholder="Fx æresmedlem eller frivillig"></label><button>Giv medlemskab</button></form>
<p class="small muted" style="margin:10px 0 0">Personen skal have logget ind på medlem.hjerterum.info én gang med sin e-mail.</p></section>`;
  const mw = `<section class="panel"><header><h2>MembershipWorks-eksport</h2><p>Kun til opslag: giver ingen adgang og ændrer intet i MembershipWorks.</p></header>
${d.mw.latest ? `<p class="small" style="margin:0 0 8px"><strong>${d.mw.accounts}</strong> konti fra <em>${esc(d.mw.latest.filename)}</em>, ${esc(DATE.format(d.mw.latest.atMs))} (${esc(d.mw.latest.by)}). ${d.mw.linked} er flyttet hertil.</p>` : `<p class="small muted" style="margin:0 0 8px">Ingen eksport endnu.</p>`}
<p class="small muted" style="margin:0 0 10px">Når en af dem melder sig ind her, kobles medlem siden, telefon og underviser på, og I mindes om at stoppe betalingen i MembershipWorks.</p>
<form class="stack" method="post" action="${base}/medlemmer/membershipworks" enctype="multipart/form-data"><input type="file" name="fil" accept=".csv,text/csv" required><button class="ghost">Upload eksport (CSV)</button></form>
${d.mw.accounts ? `<a class="more" href="${base}/medlemmer/skifte">Skiftet fra MembershipWorks →</a>` : ""}
<a class="more" href="${base}/medlemmer/tal">Tal fra MembershipWorks (skærmbillede) →</a></section>`;
  const admins = d.chair ? `<section class="panel"><header><h2>Administratorer</h2><p>Se, hvem der har adgang til admin, og hvem der har været aktive. Kun for formanden.</p></header><a class="more" href="${base}/administratorer">Se administratorerne →</a></section>` : "";
  return layout(base, "Medlemmer", `<main><div class="hero"><h1>Medlemmer</h1><p>Medlemmerne i det nye system. Medlemmer i MembershipWorks fortsætter dér, indtil de selv melder sig ind her.</p></div>
${d.notice ? `<p class="notice good">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice warn">${esc(d.error)}</p>` : ""}
<div class="m-tiles">${tile("aktive", "Aktive", d.counts.active)}${tile("restance", "I restance", d.counts.pastDue)}${tile("opsagt", "Opsagt", d.counts.ended)}<div class="m-tile"><span>Nye de sidste 30 dage</span><b>${d.counts.newLast30}</b></div></div>
<div class="m-layout">${list}<div class="m-side">${give}${mw}${admins}</div></div></main>`, { section: "/medlemmer", who, style: MEMBER_PAGES_STYLE });
}

export const MEMBER_TABS = ["medlemskab", "kontakt", "tidslinje", "events"] as const;
export type MemberTab = (typeof MEMBER_TABS)[number];
const TAB_LABEL: Record<MemberTab, string> = { medlemskab: "Medlemskab", kontakt: "Kontakt", tidslinje: "Tidslinje", events: "Events" };

const BAD = new Set(["payment_failed", "cancelled", "ended"]);
function timelineList(entries: TimelineEntry[]): string {
  if (!entries.length) return `<p class="empty">Intet på tidslinjen endnu.</p>`;
  return `<ol class="tl">${entries.map(e => `<li${BAD.has(e.kind) ? ' class="bad"' : ""}><span class="when">${esc(WEEKDAY.format(e.atMs))}<b>${esc(DAY_MONTH.format(e.atMs))}</b>${esc(YEAR.format(e.atMs))}</span>
<div><h3>${esc(e.title)}${e.amountMinor ? ` <span class="amt">${esc(kr(e.amountMinor))}</span>` : ""}</h3>${e.detail ? `<p>${esc(e.detail)}</p>` : ""}${e.by ? `<p class="by">${esc(e.by)}</p>` : ""}</div></li>`).join("")}</ol>`;
}

function eventList(title: string, events: MemberEvent[], empty: string): string {
  const line = (e: MemberEvent) => `<li>${esc(e.title)}
<span class="ctx">${esc(TIME.format(e.startsAtMs))} · ${e.where === "kalender" ? "Hjerterums kalender" : "det nye system"}${e.status === "cancelled" ? " · aflyst" : ""}</span></li>`;
  return `<section class="panel"><header><h2>${title} <span class="pill">${events.length}</span></h2></header>${events.length ? `<ul class="items">${events.slice(0, SHOWN).map(line).join("")}</ul>${events.length > SHOWN ? fold("Klik her for at se alle", "Skjul de ældre", `<ul class="items">${events.slice(SHOWN, 50).map(line).join("")}</ul>${events.length > 50 ? `<p class="small muted">og ${events.length - 50} mere</p>` : ""}`, events.length - SHOWN) : ""}` : `<p class="empty">${empty}</p>`}</section>`;
}

function mwBox(a: MembershipWorksAccount, m: AdminMember, today: string): string {
  const stillPaying = a.billing === "auto" && a.renewsOn !== null && a.renewsOn >= today;
  const url = a.accountId && /^[a-f0-9]{24}$/.test(a.accountId) ? `https://membershipworks.com/admin/#!biz/id/${a.accountId}` : null;
  return `<div class="m-mw"><p class="lbl">Fra MembershipWorks</p>
<p>${esc(a.plan ?? "Intet medlemskab")}${a.interval ? ` · ${a.interval === "year" ? "årlig" : "månedlig"}` : ""}${a.billing ? ` · ${a.billing === "manual" ? "manuel betaling" : "automatisk betaling"}` : ""}</p>
${a.joinedOn ? `<p>Medlem siden ${esc(isoDay(a.joinedOn))}${a.renewsOn ? ` · ${a.renewsOn < today ? `fornyelse udløb ${esc(isoDay(a.renewsOn))}` : `næste fornyelse ${esc(isoDay(a.renewsOn))}`}` : ""}</p>` : ""}
${a.labels.length ? `<p>${a.labels.map(l => `<span class="chip">${esc(l)}</span>`).join("")}</p>` : ""}
${stillPaying && m.status === "active" ? `<p class="warn">Betaler stadig i MembershipWorks - stop betalingen dér, så medlemmet ikke trækkes dobbelt.</p>` : ""}
${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Åbn i MembershipWorks ↗</a></p>` : ""}</div>`;
}

export type MemberPageData = { member: AdminMember; tab: MemberTab; timeline: TimelineEntry[]; events: { created: MemberEvent[]; registered: MemberEvent[] };
  mw: MembershipWorksAccount | null; notice?: string | undefined; now: number; today: string };

export function memberPage(base: string, who: string | null, d: MemberPageData): string {
  const m = d.member, at = `${base}/medlemmer/${m.id}`;
  const tabs = `<nav class="m-tabs" aria-label="Medlem">${MEMBER_TABS.map(t => `<a href="${at}?fane=${t}"${t === d.tab ? ' aria-current="page"' : ""}>${TAB_LABEL[t]}</a>`).join("")}</nav>`;
  const head = `<a class="m-back" href="${base}/medlemmer">← Medlemmer</a><div class="hero"><h1>${esc(m.fullName)}</h1>
<div class="labels"><span class="badge plan">${esc(planLabel(m))}</span>${statusBadge(m, d.now)}${m.isTeacher ? ' <span class="badge off">Underviser</span>' : ""}${m.membershipworksId ? ' <span class="badge off">Fra MembershipWorks</span>' : ""}${m.awaitingLogin ? ' <span class="badge off">Har ikke logget ind endnu</span>' : ""}</div></div>`;
  let body: string;
  if (d.tab === "kontakt") {
    body = `<section class="panel"><div class="m-contact"><strong>${esc(m.fullName)}</strong>
${m.phone ? `<a href="tel:${esc(m.phone.replace(/\s+/g, ""))}">☎ ${esc(m.phone)}</a>` : `<span class="muted">Intet telefonnummer</span>`}
<a href="mailto:${esc(m.email)}">✉ ${esc(m.email)}</a>${m.streetAddress ? `<span>${esc(m.streetAddress)}</span>` : ""}
<a class="button ghost" style="justify-self:start;margin-top:6px" href="mailto:${esc(m.email)}">Send en mail</a></div></section>`;
  } else if (d.tab === "tidslinje") {
    body = `<section class="panel"><form class="m-note" method="post" action="${at}/note"><label>Ny note på tidslinjen<textarea name="note" maxlength="2000" required placeholder="Fx aftale om betaling, en samtale eller en bemærkning"></textarea></label>
<div class="actions"><button>Tilføj note</button></div></form>${timelineList(d.timeline)}</section>`;
  } else if (d.tab === "events") {
    body = `<div class="grid">${eventList("Har oprettet", d.events.created, "Har ikke oprettet events.")}${eventList("Tilmeldt", d.events.registered, "Ingen tilmeldinger i det nye system.")}</div>`;
  } else {
    const since = m.statusSinceMs ? DATE.format(m.statusSinceMs) : null;
    const statusLine = m.status === "past_due" ? `<p class="warn">I restance${since ? ` siden ${esc(since)}` : ""}</p>`
      : m.status === "active" ? (since ? `<p>Aktiv siden ${esc(since)}</p>` : "") : `<p class="muted">${esc(statusText(m, d.now))}${since ? ` siden ${esc(since)}` : ""}</p>`;
    const manual = m.billing === "manual" ? `<div class="m-actions"><form method="post" action="${at}/medlemskab"><label>Skift medlemskab<select name="tier">${Object.entries(membershipPlans).map(([key, plan]) => `<option value="${key}"${key === m.tier ? " selected" : ""}>${esc(plan.name)}</option>`).join("")}</select></label><button class="ghost">Skift</button></form>
<form method="post" action="${at}/${m.status === "active" ? "afslut" : "genaktiver"}"><button class="ghost">${m.status === "active" ? "Afslut medlemskab" : "Genaktivér"}</button></form></div>`
      : `<p class="small muted">Betaling, kort og opsigelse styres i Stripe - medlemmet gør det selv i medlemsområdet.</p>`;
    body = `<section class="panel"><h2>${esc(planName(m.tier))}</h2><div class="m-facts">
<p>${m.paysInMembershipworks ? `Betaler stadig via MembershipWorks · ${m.interval === "year" ? "årlig" : "månedlig"}${m.nextChargeOn ? ` · første træk i det nye system ${esc(isoDay(m.nextChargeOn))}` : ""}`
    : m.billing === "manual" ? "Manuel betaling - givet af Hjerterum, ingen betaling via kort" : `Betaling med kort via Stripe · ${m.interval === "year" ? "årlig" : "månedlig"}`}</p>
${statusLine}<p>Medlem siden ${esc(memberSince(m))}</p></div>${manual}
<div class="m-actions" style="margin-top:12px"><form method="post" action="${at}/adgang"><input type="hidden" name="blocked" value="${m.accessBlocked ? "0" : "1"}"><button class="ghost">${m.accessBlocked ? "Genåbn adgang" : "Bloker adgang"}</button></form></div>
${d.mw ? mwBox(d.mw, m, d.today) : ""}</section>`;
  }
  return layout(base, m.fullName, `<main>${head}${d.notice ? `<p class="notice good">${esc(d.notice)}</p>` : ""}${tabs}${body}</main>`, { section: "/medlemmer", who, style: MEMBER_PAGES_STYLE });
}

const GROUPS: Array<{ key: TurnoverGroup; title: string; text: string }> = [
  { key: "kort", title: "Betaler med kort", text: "Bliver medlemmer her. Betalingen kører videre i MembershipWorks, indtil det nye system overtager trækket på deres fornyelsesdato." },
  { key: "manuel", title: "Manuel betaling", text: "Bliver medlemmer med manuel betaling, som i MembershipWorks." },
  { key: "gratis", title: "Gratis medlemskab", text: "Bliver medlemmer med gratis medlemskab." },
  { key: "restance", title: "I restance", text: "Fornyelsesdatoen er passeret. Bliver medlemmer i restance - tag stilling til hver enkelt." },
  { key: "medlem", title: "Allerede medlem her", text: "Har allerede et medlemskab i det nye system og røres ikke." },
  { key: "springes", title: "Springes over", text: "Kan ikke flyttes automatisk." }
];

/** Requested: "det er meningen at vi ved turnover importerer alle medlemmer og fra den dato begynder at trække kontingent over
 * vores nye system". What the switch will do with each account, before anything is done; then the one button. */
export function turnoverPage(base: string, who: string | null, d: { rows: TurnoverRow[]; today: string; notice?: string | undefined }): string {
  const movable = d.rows.filter(r => r.group !== "medlem" && r.group !== "springes").length;
  const section = (g: (typeof GROUPS)[number]) => {
    const rows = d.rows.filter(r => r.group === g.key);
    if (!rows.length) return "";
    return `<details class="panel"${g.key === "restance" || g.key === "springes" ? " open" : ""}><summary><strong>${g.title}</strong> <span class="pill">${rows.length}</span></summary><p class="small muted">${g.text}</p>
<table class="rows m-list"><tr><th>Navn</th><th>Medlemskab</th><th>Betaling</th><th>Medlem siden</th><th>${g.key === "springes" || g.key === "medlem" ? "Hvorfor" : "Fornyelse"}</th></tr>
${rows.map(r => `<tr><td data-label="Navn">${esc(r.fullName)}<small>${esc(r.email)}</small></td><td data-label="Medlemskab">${esc(r.tier ? planName(r.tier) : r.plan ?? "–")}</td>
<td data-label="Betaling">${r.billing === "auto" ? (r.interval === "year" ? "Kort · årlig" : "Kort · månedlig") : r.billing === "manual" ? "Manuel" : "–"}</td>
<td data-label="Medlem siden">${r.joinedOn ? esc(isoDay(r.joinedOn)) : "–"}</td><td data-label="${g.key === "springes" || g.key === "medlem" ? "Hvorfor" : "Fornyelse"}">${r.reason ? esc(r.reason) : r.renewsOn ? esc(isoDay(r.renewsOn)) : "–"}</td></tr>`).join("")}</table></details>`;
  };
  return layout(base, "Skiftet fra MembershipWorks", `<main><a class="m-back" href="${base}/medlemmer">← Medlemmer</a><div class="hero"><h1>Skiftet fra MembershipWorks</h1>
<p>Sådan bliver medlemmerne fra den seneste eksport flyttet til det nye system på skiftedagen. Intet sker, før I trykker på knappen nederst.</p></div>
${d.notice ? `<p class="notice good">${esc(d.notice)}</p>` : ""}
<div class="m-tiles">${GROUPS.slice(0, 4).map(g => `<div class="m-tile"><span>${g.title}</span><b>${d.rows.filter(r => r.group === g.key).length}</b></div>`).join("")}</div>
${GROUPS.map(section).join("")}
<section class="panel"><h2>Flyt ${movable} medlemmer</h2>
<p class="small muted">De bliver medlemmer her med samme e-mail og logger ind med en e-mailkode. Der trækkes intet i det nye system endnu: betaling med kort fortsætter i MembershipWorks, indtil Stripe er sat op til at overtage. Kør igen efter en ny eksport - kun nye medlemmer tilføjes.</p>
${movable ? `<form class="stack" method="post" action="${base}/medlemmer/skifte"><label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" name="ok" value="1" required style="width:20px;min-height:0"> Ja, flyt ${movable} medlemmer fra MembershipWorks til det nye system</label><button>Flyt medlemmerne</button></form>`
    : `<p class="empty">Der er ingen at flytte.</p>`}</section></main>`, { section: "/medlemmer", who, style: MEMBER_PAGES_STYLE });
}
