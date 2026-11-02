import type { D1Database } from "../db.js";
import { membershipPlan, membershipPlans } from "../../membership.js";
import { FREE_TIER, memberTimeline, memberById, planName, recordTimeline, type TimelineEntry } from "../member-admin.js";
import { esc, layout } from "./page.js";

/** Requested by the chair: "Vi skal udvikle et membership cockpit i admin hvor vi kan tjekke og redigere alt vedrørende medlemmer,
 * medlemskab og abonnementer, se statistik og historik - inspireret af membership works" - "Idéen er jo at vi holder op med at bruge
 * membership works fra den ene dag til den næste" - "Men start gerne med at bygge". The chair's alone for now (authority.ts
 * "members.cockpit", docs/decisions/0007).
 *
 * One list of everyone: the platform's own members and, until the switch, the accounts in MembershipWorks' latest export (a
 * person in both is the platform's). The overview's figures, the list with search, filters and export, and a member's card -
 * the platform's members are changed here; an account that is only in MembershipWorks is read here and changed there until the
 * switch day, when they all move over (member-admin.ts importTurnover). */

export type CockpitStatus = "aktiv" | "restance" | "opsagt" | "uden";
export type CockpitBilling = "kort" | "manuel" | "gratis" | "ingen";
export type CockpitMember = {
  key: string; source: "platform" | "membershipworks"; platformId: number | null;
  name: string; email: string; phone: string | null; address: string | null; birthday: string | null;
  tier: string | null; plan: string; interval: "month" | "year" | null; monthlyMinor: number;
  status: CockpitStatus; statusSince: string | null; billing: CockpitBilling; nextPayment: string | null; joinedOn: string | null;
  labels: string[]; teacher: boolean; stripeCustomerId: string | null; paysInMembershipworks: boolean;
};

const DAY = 86_400_000;
const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string | null) => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? SHORT.format(new Date(`${iso}T12:00:00Z`)) : "–";
const kr = (minor: number) => `${Math.round(minor / 100).toLocaleString("da-DK")} kr.`;

/** What a membership costs a month (a yearly one spread over twelve months). */
export function monthlyMinor(tier: string | null, interval: string | null): number {
  const plan = tier ? membershipPlan(tier) : null;
  if (!plan || tier === FREE_TIER) return 0;
  return interval === "year" ? Math.round(plan.year / 12) : plan.month;
}

type PlatformRow = { id: number; full_name: string; email: string; phone: string | null; street_address: string | null; birthday: string | null; tier: string; interval: string;
  status: string; billing: string; status_since_ms: number | null; joined_on: string | null; created_at_ms: number; is_teacher: number; stripe_customer_id: string;
  stripe_subscription_id: string | null; pays_in_membershipworks: number; next_charge_on: string | null };
type AccountRow = { email: string; full_name: string; phone: string | null; plan: string | null; tier: string | null; interval: string | null; billing: string | null;
  joined_on: string | null; renews_on: string | null; stripe_customer_id: string | null; labels: string };

export type CockpitData = { members: CockpitMember[]; export: { filename: string; day: string } | null };

/** Everyone, the platform's members first in rank; an account only in MembershipWorks is judged as of its export's day. */
export async function cockpitMembers(db: D1Database): Promise<CockpitData> {
  const [platform, accounts, upload] = await Promise.all([
    db.prepare(`SELECT id, full_name, email, phone, street_address, birthday, tier, interval, status, billing, status_since_ms, joined_on, created_at_ms, is_teacher,
      stripe_customer_id, stripe_subscription_id, pays_in_membershipworks, next_charge_on FROM members`).all<PlatformRow>().then(r => r.results ?? []).catch(() => [] as PlatformRow[]),
    db.prepare("SELECT email, full_name, phone, plan, tier, interval, billing, joined_on, renews_on, stripe_customer_id, labels FROM membershipworks_accounts").all<AccountRow>().then(r => r.results ?? []).catch(() => [] as AccountRow[]),
    db.prepare("SELECT filename, uploaded_at_ms FROM membershipworks_uploads ORDER BY id DESC LIMIT 1").first<{ filename: string; uploaded_at_ms: number }>().catch(() => null)
  ]);
  const exportDay = upload ? copenhagenDay(upload.uploaded_at_ms) : copenhagenDay(Date.now());
  const labelsOf = (raw: string) => { try { const v = JSON.parse(raw) as unknown; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  const mwByEmail = new Map(accounts.map(a => [a.email.toLowerCase(), a] as const));
  const seen = new Set<string>();
  const members: CockpitMember[] = platform.map(p => {
    const email = p.email.toLowerCase();
    seen.add(email);
    const mw = mwByEmail.get(email);
    const free = p.tier === FREE_TIER;
    const status: CockpitStatus = p.status === "active" ? "aktiv" : p.status === "past_due" ? "restance" : "opsagt";
    const labels = mw ? labelsOf(mw.labels) : [];
    return {
      key: `p${p.id}`, source: "platform", platformId: p.id, name: p.full_name, email: p.email, phone: p.phone, address: p.street_address, birthday: p.birthday,
      tier: p.tier, plan: planName(p.tier), interval: p.interval === "year" ? "year" : p.interval === "month" ? "month" : null,
      monthlyMinor: status === "opsagt" ? 0 : monthlyMinor(p.tier, p.interval), status, statusSince: p.status_since_ms ? copenhagenDay(p.status_since_ms) : null,
      billing: free ? "gratis" : p.billing === "manual" && !p.pays_in_membershipworks ? "manuel" : "kort",
      nextPayment: p.next_charge_on, joinedOn: p.joined_on ?? copenhagenDay(p.created_at_ms), labels, teacher: p.is_teacher === 1 || labels.some(l => /teacher/i.test(l)),
      stripeCustomerId: p.stripe_customer_id && !p.stripe_customer_id.startsWith("pending:") ? p.stripe_customer_id : null, paysInMembershipworks: p.pays_in_membershipworks === 1
    };
  });
  for (const a of accounts) {
    if (seen.has(a.email.toLowerCase())) continue;
    const free = /free|gratis/i.test(a.plan ?? "");
    const tier = free ? FREE_TIER : a.tier;
    const status: CockpitStatus = !tier ? "uden" : !free && a.renews_on !== null && a.renews_on < exportDay ? "restance" : "aktiv";
    const labels = labelsOf(a.labels);
    members.push({
      key: `mw${encodeURIComponent(a.email.toLowerCase())}`, source: "membershipworks", platformId: null, name: a.full_name, email: a.email, phone: a.phone, address: null, birthday: null,
      tier, plan: tier ? planName(tier) : a.plan ? a.plan : "Intet medlemskab", interval: a.interval === "year" ? "year" : a.interval === "month" ? "month" : null,
      monthlyMinor: status === "aktiv" || status === "restance" ? monthlyMinor(tier, a.interval) : 0, status, statusSince: status === "restance" ? a.renews_on : null,
      billing: free ? "gratis" : !tier ? "ingen" : a.billing === "auto" ? "kort" : "manuel", nextPayment: tier && !free ? a.renews_on : null, joinedOn: a.joined_on,
      labels, teacher: labels.some(l => /teacher/i.test(l)), stripeCustomerId: a.stripe_customer_id, paysInMembershipworks: a.billing === "auto"
    });
  }
  members.sort((x, y) => x.name.localeCompare(y.name, "da"));
  return { members, export: upload ? { filename: upload.filename, day: exportDay } : null };
}

// ---- Filters ----

export type CockpitFilter = { q: string; status: string; tier: string; billing: string; teacher: boolean; sort: "navn" | "siden" | "betaling" };
export function readFilter(params: URLSearchParams): CockpitFilter {
  const sort = params.get("sort");
  return { q: (params.get("q") ?? "").trim().slice(0, 80), status: params.get("status") ?? "", tier: params.get("type") ?? "", billing: params.get("betaling") ?? "",
    teacher: params.get("underviser") === "1", sort: sort === "siden" || sort === "betaling" ? sort : "navn" };
}
export function applyFilter(list: CockpitMember[], f: CockpitFilter): CockpitMember[] {
  const q = f.q.toLowerCase();
  const out = list.filter(m => (!q || `${m.name} ${m.email} ${m.phone ?? ""}`.toLowerCase().includes(q))
    && (!f.status || m.status === f.status) && (!f.tier || m.tier === f.tier) && (!f.billing || m.billing === f.billing) && (!f.teacher || m.teacher));
  if (f.sort === "siden") out.sort((a, b) => (a.joinedOn ?? "9999").localeCompare(b.joinedOn ?? "9999"));
  if (f.sort === "betaling") out.sort((a, b) => (a.nextPayment ?? "9999").localeCompare(b.nextPayment ?? "9999"));
  return out;
}
const query = (f: CockpitFilter, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q); if (f.status) p.set("status", f.status); if (f.tier) p.set("type", f.tier); if (f.billing) p.set("betaling", f.billing);
  if (f.teacher) p.set("underviser", "1"); if (f.sort !== "navn") p.set("sort", f.sort);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ---- Figures ----

export type CockpitFigures = { active: number; pastDue: number; without: number; paying: number; free: number; monthlyMinor: number;
  byTier: Array<{ tier: string; name: string; count: number; monthlyMinor: number }>; byBilling: Record<CockpitBilling, number>;
  renewing30: { count: number; minor: number }; teachers: number; joinedByYear: Array<{ year: string; count: number }> };

export function figures(list: CockpitMember[], today: string): CockpitFigures {
  const current = list.filter(m => m.status === "aktiv" || m.status === "restance");
  const tiers = [...Object.keys(membershipPlans), FREE_TIER];
  const in30 = copenhagenDay(Date.parse(`${today}T12:00:00Z`) + 30 * DAY);
  const renewing = current.filter(m => m.billing === "kort" && m.nextPayment && m.nextPayment >= today && m.nextPayment <= in30);
  const years = new Map<string, number>();
  for (const m of current) if (m.joinedOn) years.set(m.joinedOn.slice(0, 4), (years.get(m.joinedOn.slice(0, 4)) ?? 0) + 1);
  const byBilling: Record<CockpitBilling, number> = { kort: 0, manuel: 0, gratis: 0, ingen: 0 };
  for (const m of current) byBilling[m.billing] += 1;
  return {
    active: list.filter(m => m.status === "aktiv").length, pastDue: list.filter(m => m.status === "restance").length,
    without: list.filter(m => m.status === "opsagt" || m.status === "uden").length,
    paying: current.filter(m => m.monthlyMinor > 0).length, free: current.filter(m => m.tier === FREE_TIER).length,
    monthlyMinor: current.filter(m => m.status === "aktiv").reduce((s, m) => s + m.monthlyMinor, 0),
    byTier: tiers.map(t => ({ tier: t, name: planName(t), count: current.filter(m => m.tier === t).length, monthlyMinor: current.filter(m => m.tier === t && m.status === "aktiv").reduce((s, m) => s + m.monthlyMinor, 0) })).filter(t => t.count),
    byBilling, renewing30: { count: renewing.length, minor: renewing.reduce((s, m) => s + (m.interval === "year" ? m.monthlyMinor * 12 : m.monthlyMinor), 0) },
    teachers: current.filter(m => m.teacher).length,
    joinedByYear: [...years].sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count }))
  };
}

// ---- Pages ----

const STATUS_LABEL: Record<CockpitStatus, string> = { aktiv: "Aktiv", restance: "I restance", opsagt: "Opsagt", uden: "Intet medlemskab" };
const BILLING_LABEL: Record<CockpitBilling, string> = { kort: "Kort (automatisk)", manuel: "Manuel", gratis: "Gratis", ingen: "–" };
const daysSince = (iso: string | null, today: string) => iso ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / DAY)) : null;
const statusBadge = (m: CockpitMember, today: string) => {
  const days = m.status === "restance" ? daysSince(m.statusSince, today) : null;
  return `<span class="mc-badge ${m.status}">${STATUS_LABEL[m.status]}${days ? ` ${days} dage` : ""}</span>`;
};

export function cockpitPage(base: string, who: string | null, d: { data: CockpitData; filter: CockpitFilter; today: string; notice: string }): string {
  const all = d.data.members, f = d.filter;
  const fig = figures(all, d.today);
  const shown = applyFilter(all, f);
  const max = Math.max(1, ...fig.joinedByYear.map(y => y.count));
  const opt = (value: string, label: string, current: string) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  const tiers = [...Object.keys(membershipPlans), FREE_TIER];
  const row = (m: CockpitMember) => `<tr><td><a href="${base}/medlemskab/medlem?k=${encodeURIComponent(m.key)}"><b>${esc(m.name)}</b></a><span>${esc(m.email)}</span></td>
<td>${esc(m.plan)}${m.interval ? `<span>${m.interval === "year" ? "årligt" : "månedligt"}</span>` : ""}</td><td>${statusBadge(m, d.today)}</td><td>${esc(BILLING_LABEL[m.billing])}${m.source === "membershipworks" ? `<span>MembershipWorks</span>` : ""}</td>
<td>${shortDate(m.nextPayment)}</td><td>${shortDate(m.joinedOn)}</td><td>${m.labels.filter(l => !/^Active /i.test(l)).map(l => `<i class="mc-label">${esc(l)}</i>`).join("")}${m.teacher && !m.labels.length ? `<i class="mc-label">Underviser</i>` : ""}</td></tr>`;
  const body = `<main class="mc"><p class="small"><a href="${base}/medlemmer">← Medlemmer</a></p><h1>Medlemsoverblik</h1>
<p class="muted small">Kun for dig som formand (indtil du åbner det for bestyrelsen). ${d.data.export ? `Medlemmerne fra MembershipWorks er fra eksporten ${esc(shortDate(d.data.export.day))} - <a href="${base}/medlemmer#membershipworks">upload en nyere</a>.` : "Ingen MembershipWorks-eksport endnu."}</p>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}
<section class="mc-figs">
<div><b>${fig.active}</b><span>aktive medlemmer</span></div>
<div><b>${fig.pastDue}</b><span>i restance</span></div>
<div><b>${kr(fig.monthlyMinor)}</b><span>kontingent pr. måned (aktive)</span></div>
<div><b>${kr(fig.monthlyMinor * 12)}</b><span>pr. år</span></div>
<div><b>${fig.renewing30.count}</b><span>fornyes de næste 30 dage · ${kr(fig.renewing30.minor)}</span></div>
<div><b>${fig.teachers}</b><span>undervisere</span></div>
</section>
<section class="mc-grid">
<div class="card"><h2>Medlemskaber</h2><table class="mc-small">${fig.byTier.map(t => `<tr><td>${esc(t.name)}</td><td>${t.count}</td><td>${kr(t.monthlyMinor)}/md.</td></tr>`).join("")}</table></div>
<div class="card"><h2>Betaling</h2><table class="mc-small">${(["kort", "manuel", "gratis"] as const).map(b => `<tr><td>${BILLING_LABEL[b]}</td><td>${fig.byBilling[b]}</td></tr>`).join("")}<tr><td>Uden medlemskab / opsagt</td><td>${fig.without}</td></tr></table></div>
<div class="card"><h2>Nuværende medlemmer efter indmeldelsesår</h2><div class="mc-bars">${fig.joinedByYear.map(y => `<div><span>${y.year}</span><i style="width:${Math.round(y.count / max * 100)}%"></i><b>${y.count}</b></div>`).join("")}</div></div>
</section>
<form class="mc-filter" method="get" action="${base}/medlemskab">
<input name="q" value="${esc(f.q)}" placeholder="Søg navn, e-mail eller telefon" aria-label="Søg">
<select name="status" aria-label="Status">${opt("", "Alle statusser", f.status)}${(["aktiv", "restance", "opsagt", "uden"] as const).map(s => opt(s, STATUS_LABEL[s], f.status)).join("")}</select>
<select name="type" aria-label="Medlemskab">${opt("", "Alle medlemskaber", f.tier)}${tiers.map(t => opt(t, planName(t), f.tier)).join("")}</select>
<select name="betaling" aria-label="Betaling">${opt("", "Al betaling", f.billing)}${(["kort", "manuel", "gratis"] as const).map(b => opt(b, BILLING_LABEL[b], f.billing)).join("")}</select>
<select name="sort" aria-label="Sortering">${opt("navn", "Sortér: navn", f.sort)}${opt("siden", "Sortér: medlem siden", f.sort)}${opt("betaling", "Sortér: næste betaling", f.sort)}</select>
<label class="mc-check"><input type="checkbox" name="underviser" value="1"${f.teacher ? " checked" : ""}> Undervisere</label>
<button>Vis</button><a class="button ghost" href="${base}/medlemskab/eksport.csv${query(f)}">Eksportér (${shown.length})</a></form>
<p class="small muted">${shown.length} af ${all.length}</p>
<div class="mc-table-wrap"><table class="mc-table"><thead><tr><th>Navn</th><th>Medlemskab</th><th>Status</th><th>Betaling</th><th>Næste betaling</th><th>Medlem siden</th><th>Labels</th></tr></thead>
<tbody>${shown.map(row).join("") || `<tr><td colspan="7" class="muted">Ingen medlemmer passer.</td></tr>`}</tbody></table></div></main>`;
  return layout(base, "Medlemsoverblik", body, { section: "/medlemmer", who, style: COCKPIT_MEMBERS_STYLE });
}

export function memberCardPage(base: string, who: string | null, d: { member: CockpitMember; timeline: TimelineEntry[]; today: string; notice: string; error: string }): string {
  const m = d.member, editable = m.source === "platform";
  const field = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value || "–"}</dd></div>`;
  const input = (label: string, name: string, value: string | null, type = "text") => `<label class="mc-field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value ?? "")}"></label>`;
  const TIME = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
  const body = `<main class="mc mc-card"><p class="small"><a href="${base}/medlemskab">← Medlemsoverblik</a></p>
<h1>${esc(m.name)}</h1><p>${statusBadge(m, d.today)} <span class="muted">${esc(m.plan)}${m.monthlyMinor ? ` · ${kr(m.interval === "year" ? m.monthlyMinor * 12 : m.monthlyMinor)} ${m.interval === "year" ? "pr. år" : "pr. måned"}` : ""}</span></p>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice bad">${esc(d.error)}</p>` : ""}
<section class="mc-grid">
<div class="card"><h2>Medlemskab og betaling</h2><dl class="mc-dl">
${field("Medlemskab", esc(m.plan))}${field("Betales", m.interval === "year" ? "Årligt" : m.interval === "month" ? "Månedligt" : "–")}${field("Betaling", esc(BILLING_LABEL[m.billing]))}
${field("Næste betaling", esc(shortDate(m.nextPayment)))}${field("Medlem siden", esc(shortDate(m.joinedOn)))}${field("Stripe-kunde", m.stripeCustomerId ? `<code>${esc(m.stripeCustomerId)}</code>` : "–")}
${field("Kilde", m.source === "platform" ? (m.paysInMembershipworks ? "Hjerterums system · betaler stadig via MembershipWorks" : "Hjerterums system") : "MembershipWorks (indtil skæringsdagen)")}</dl>
${m.platformId ? `<p><a class="button ghost" href="${base}/medlemmer/${m.platformId}">Skift, giv eller afslut medlemskab →</a></p>` : `<p class="small muted">Medlemskab og betaling ændres i MembershipWorks indtil skæringsdagen, hvor alle flyttes hertil.</p>`}</div>
<div class="card"><h2>Kontakt</h2>${editable ? `<form method="post" action="${base}/medlemskab/medlem?k=${encodeURIComponent(m.key)}" class="mc-form">
${input("Navn", "name", m.name)}${input("Telefon", "phone", m.phone)}${input("Adresse", "address", m.address)}${input("Fødselsdag", "birthday", m.birthday, "date")}
<label class="mc-check"><input type="checkbox" name="teacher" value="1"${m.teacher ? " checked" : ""}> Underviser</label>
<p class="small muted">E-mail: ${esc(m.email)} (bruges til login og kan ikke ændres her)</p><button>Gem</button></form>`
    : `<dl class="mc-dl">${field("E-mail", esc(m.email))}${field("Telefon", esc(m.phone ?? ""))}${field("Labels", m.labels.map(esc).join(", "))}</dl>`}</div>
</section>
${editable ? `<section class="card"><h2>Historik</h2>${d.timeline.length ? `<ul class="mc-timeline">${d.timeline.map(t => `<li><span>${esc(TIME.format(t.atMs))}</span><div><b>${esc(t.title)}</b>${t.detail ? `<p>${esc(t.detail)}</p>` : ""}${t.by ? `<small>${esc(t.by)}</small>` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Intet endnu.</p>`}
<form method="post" action="${base}/medlemskab/medlem?k=${encodeURIComponent(m.key)}" class="mc-form"><input type="hidden" name="action" value="note"><label class="mc-field"><span>Ny note</span><textarea name="note" rows="2" maxlength="2000"></textarea></label><button class="ghost">Tilføj note</button></form></section>`
    : `<section class="card"><h2>Historik</h2><p class="muted small">Betalinger og ændringer fra MembershipWorks kommer med, når den fulde eksport med betalingshistorik er hentet på skæringsdagen.</p></section>`}
</main>`;
  return layout(base, m.name, body, { section: "/medlemmer", who, style: COCKPIT_MEMBERS_STYLE });
}

/** A platform member's contact details from the card's form; what changed goes on their timeline. */
export async function saveContact(db: D1Database, id: number, form: FormData | null, by: string, now: number): Promise<{ changed: string[] } | { error: string }> {
  const before = await memberById(db, id);
  if (!before) return { error: "Medlemmet findes ikke." };
  const text = (name: string, max: number) => String(form?.get(name) ?? "").trim().slice(0, max);
  const name = text("name", 120), phone = text("phone", 40) || null, address = text("address", 200) || null, birthday = text("birthday", 10) || null;
  const teacher = form?.get("teacher") === "1";
  if (!name) return { error: "Navnet skal udfyldes." };
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { error: "Fødselsdagen skal være en dato." };
  const changed = [name !== before.fullName && "navn", phone !== before.phone && "telefon", address !== before.streetAddress && "adresse", birthday !== before.birthday && "fødselsdag",
    teacher !== before.isTeacher && (teacher ? "markeret som underviser" : "ikke længere underviser")].filter((x): x is string => Boolean(x));
  if (!changed.length) return { changed };
  await db.prepare("UPDATE members SET full_name = ?, phone = ?, street_address = ?, birthday = ?, is_teacher = ?, updated_at_ms = ? WHERE id = ?")
    .bind(name, phone, address, birthday, teacher ? 1 : 0, now, id).run();
  await recordTimeline(db, id, { atMs: now, kind: "note", title: "Oplysninger rettet", detail: changed.join(", "), by });
  return { changed };
}

export async function cardTimeline(db: D1Database, id: number): Promise<TimelineEntry[]> {
  const m = await memberById(db, id);
  return m ? memberTimeline(db, m) : [];
}

/** The list as a spreadsheet (semicolon-separated, as Danish Excel reads it). */
export function membersCsv(list: CockpitMember[]): string {
  const cell = (v: unknown) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Navn", "E-mail", "Telefon", "Medlemskab", "Interval", "Status", "Betaling", "Næste betaling", "Medlem siden", "Kontingent pr. md. (kr.)", "Labels", "Kilde"];
  const rows = list.map(m => [m.name, m.email, m.phone, m.plan, m.interval === "year" ? "årligt" : m.interval === "month" ? "månedligt" : "", STATUS_LABEL[m.status], BILLING_LABEL[m.billing],
    m.nextPayment, m.joinedOn, Math.round(m.monthlyMinor / 100), m.labels.join(", "), m.source === "platform" ? "Hjerterum" : "MembershipWorks"]);
  return "﻿" + [head, ...rows].map(r => r.map(cell).join(";")).join("\r\n");
}

export const COCKPIT_MEMBERS_STYLE = `
.mc-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.mc-figs div{border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:grid;gap:2px}
.mc-figs b{font-size:22px}.mc-figs span{font-size:12.5px;color:var(--muted)}
.mc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:0 0 14px}.mc-small{width:100%;font-size:14px}.mc-small td{padding:4px 0}.mc-small td:not(:first-child){text-align:right}
.mc-bars div{display:grid;grid-template-columns:44px 1fr 32px;gap:8px;align-items:center;font-size:13px;margin:3px 0}.mc-bars i{display:block;height:8px;border-radius:4px;background:var(--accent,#8a6a55)}.mc-bars b{text-align:right}
.mc-filter{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.mc-filter input[name=q]{flex:1 1 220px}.mc-filter input,.mc-filter select{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit}
.mc-check{display:inline-flex;gap:6px;align-items:center;font-size:14px}
.mc .mc-filter :is(select,input:not([type=checkbox])){width:auto;min-width:0;flex:0 1 auto;margin:0}.mc .mc-filter input[name=q]{flex:1 1 260px}
.mc .mc-filter button,.mc .mc-filter .button{width:auto;flex:0 0 auto;margin:0}
.mc .mc-check input[type=checkbox]{width:16px;height:16px;min-height:0;padding:0;margin:0;flex:none;appearance:auto}.mc-card .mc-form .mc-check{justify-content:flex-start}
.mc-table-wrap{overflow-x:auto}.mc-table{width:100%;border-collapse:collapse;font-size:14px}.mc-table th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
.mc-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.mc-table td span{display:block;font-size:12px;color:var(--muted)}
.mc-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.mc-badge.aktiv{background:#e3efe0;color:#355a2d}.mc-badge.restance{background:#f8e3d6;color:#8a3f1c}
.mc-badge.opsagt,.mc-badge.uden{background:rgba(127,127,127,.15);color:var(--muted)}.mc-label{display:inline-block;font-style:normal;font-size:11.5px;padding:1px 7px;margin:0 4px 4px 0;border-radius:999px;border:1px solid var(--line)}
.mc-dl{display:grid;gap:6px;margin:0}.mc-dl div{display:grid;grid-template-columns:130px 1fr;gap:8px}.mc-dl dt{color:var(--muted);font-size:13px}.mc-dl dd{margin:0}
.mc-form{display:grid;gap:8px}.mc-field{display:grid;gap:3px}.mc-field span{font-size:12.5px;color:var(--muted)}.mc-field input,.mc-field textarea{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,transparent);color:inherit}
.mc-timeline{list-style:none;margin:0;padding:0;display:grid}.mc-timeline li{display:grid;grid-template-columns:150px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.mc-timeline li:first-child{border-top:0}
.mc-timeline span{font-size:12.5px;color:var(--muted)}.mc-timeline p{margin:2px 0 0;font-size:14px}.mc-timeline small{color:var(--muted)}.notice.bad{color:#b3261e}
@media (prefers-color-scheme:dark){.mc-badge.aktiv{background:#2f3d2b;color:#cfe3c6}.mc-badge.restance{background:#4a3226;color:#f3c9b0}}
@media(max-width:700px){.mc-dl div,.mc-timeline li{grid-template-columns:1fr}}`;
