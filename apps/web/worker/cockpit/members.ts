import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { esc, layout, shortDay } from "./page.js";

/** Requested: "Hvis vi uploader et sådan skærmbillede til Saga ind i mellem, kan hun så opdatere det i
 * systemet?" - "I can't see that you have inserted the figures anywhere." MembershipWorks' dashboard
 * numbers, one dated row per update. A screenshot is read by Saga into a form the member checks before
 * it is saved: Saga only reads what is on the picture, and nothing is stored before someone presses Gem.
 * Totals only - never a member's name, mail or anything else about one person. */

export type Plan = { name: string; count: number | null; share: number | null };
export type MemberStats = {
  id: number; taken_on: string; total_accounts: number; with_membership: number | null; paying: number; free: number | null;
  past_due: number | null; pending_cancellation: number | null; cancelled: number | null; annual_revenue_kr: number | null;
  plans: Plan[]; added_by: string; created_at_ms: number;
};
export type StatsInput = Omit<MemberStats, "id" | "added_by" | "created_at_ms">;

const FIELDS = ["total_accounts", "with_membership", "paying", "free", "past_due", "pending_cancellation", "cancelled", "annual_revenue_kr"] as const;
const LABELS: Record<(typeof FIELDS)[number], string> = {
  total_accounts: "Konti i alt", with_membership: "Konti med medlemskab", paying: "Betalende medlemmer", free: "Gratis medlemskab",
  past_due: "I restance", pending_cancellation: "Venter på opsigelse", cancelled: "Opsagt", annual_revenue_kr: "Årlig indtægt (kr.)"
};
const REQUIRED = new Set(["total_accounts", "paying"]);
const KR = new Intl.NumberFormat("da-DK");

const count = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[\s.,](?=\d{3}\b)/g, "").replace(/[^\d-]/g, ""));
  return String(value ?? "").trim() !== "" && Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n) : null;
};
const day = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function plansOf(value: unknown): Plan[] {
  const list = Array.isArray(value) ? value : [];
  return list.slice(0, 20).map(p => p as { name?: unknown; count?: unknown; share?: unknown })
    .filter(p => typeof p.name === "string" && p.name.trim())
    .map(p => ({ name: String(p.name).trim().slice(0, 120), count: count(p.count), share: typeof p.share === "number" && p.share >= 0 && p.share <= 100 ? Math.round(p.share * 10) / 10 : null }));
}

export function statsFrom(raw: Record<string, unknown>, today: string): StatsInput | null {
  const out = { taken_on: day(raw.taken_on) ?? today, plans: plansOf(raw.plans) } as StatsInput;
  for (const field of FIELDS) (out as Record<string, unknown>)[field] = count(raw[field]);
  return out.total_accounts === null || out.paying === null ? null : out;
}

/** The form the member checks: the numbers as fields, the plans carried along as JSON. */
export function statsInput(form: FormData, today: string): StatsInput | null {
  const raw: Record<string, unknown> = { taken_on: form.get("taken_on") };
  for (const field of FIELDS) raw[field] = form.get(field);
  try { raw.plans = JSON.parse(String(form.get("plans") ?? "[]")); } catch { raw.plans = []; }
  return statsFrom(raw, today);
}

export async function latestStats(db: D1Database, limit = 2): Promise<MemberStats[]> {
  const rows = await db.prepare("SELECT * FROM cockpit_member_stats ORDER BY taken_on DESC, id DESC LIMIT ?").bind(limit).all<Omit<MemberStats, "plans"> & { plans: string }>().catch(() => null);
  return (rows?.results ?? []).map(r => ({ ...r, plans: (() => { try { return plansOf(JSON.parse(r.plans)); } catch { return []; } })() }));
}

export async function saveStats(db: D1Database, input: StatsInput, who: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO cockpit_member_stats (taken_on, total_accounts, with_membership, paying, free, past_due, pending_cancellation, cancelled, annual_revenue_kr, plans, added_by, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.taken_on, ...FIELDS.map(f => input[f]), JSON.stringify(input.plans), who, nowMs).run();
}

const READ_SYSTEM = "Du aflæser et skærmbillede af MembershipWorks' oversigt (Dashboard › Current Stats) for foreningen Hjerterum. "
  + "Svar KUN med ét JSON-objekt med felterne total_accounts, with_membership, paying, free, past_due, pending_cancellation, cancelled, annual_revenue_kr (hele tal) og plans (liste af {name, count, share}). "
  + "total_accounts = \"total accounts\"; with_membership = \"Accounts with membership\"; paying = \"Current paying members\"; free = \"Accounts on free membership\"; past_due = \"Members past due\"; "
  + "pending_cancellation = \"Members pending cancellation\"; cancelled = \"Members cancelled\"; annual_revenue_kr = \"Annual Recurring Revenue\" i kroner. "
  + "plans er medlemstyperne i lagkagen med deres navn på dansk (uden HTML-koder), antal hvis det står der (ellers null) og procent som tal. "
  + "Skriv null for et tal, du ikke kan se tydeligt - gæt aldrig. Står der ingen MembershipWorks-tal på billedet, så svar {}.";

/** Saga reads the screenshot. Nothing is saved here: the member sees the numbers and presses Gem. */
export async function readScreenshot(env: SagaEnv, deps: SagaDeps, image: { type: string; base64: string }, today: string): Promise<StatsInput | null> {
  const text = await complete(env, deps, [{ role: "system", content: READ_SYSTEM },
    { role: "user", content: [{ type: "text", text: "Aflæs tallene på dette skærmbillede." }, { type: "image_url", image_url: { url: `data:${image.type};base64,${image.base64}` } }] }]);
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try { return statsFrom(JSON.parse(json) as Record<string, unknown>, today); } catch { return null; }
}

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const IMAGE_MAX = 5 * 1024 * 1024;
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The figures for Saga's answers. */
export function statsForSaga(rows: MemberStats[]): string {
  const [now, before] = rows;
  if (!now) return "";
  const line = (s: MemberStats) => [`${s.total_accounts} konti`, s.with_membership !== null ? `${s.with_membership} med medlemskab` : "", `${s.paying} betalende`, s.free !== null ? `${s.free} på gratis medlemskab` : "",
    s.past_due !== null ? `${s.past_due} i restance` : "", s.pending_cancellation !== null ? `${s.pending_cancellation} venter på opsigelse` : "", s.cancelled !== null ? `${s.cancelled} opsagt` : "",
    s.annual_revenue_kr !== null ? `årlig tilbagevendende indtægt fra betalende ${KR.format(s.annual_revenue_kr)} kr.` : ""].filter(Boolean).join(", ");
  return `- MembershipWorks pr. ${on(now.taken_on)}: ${line(now)}.${now.plans.length ? `\n- Medlemstyper: ${now.plans.map(p => `${p.name}${p.count !== null ? ` ${p.count}` : ""}${p.share !== null ? ` (${p.share} %)` : ""}`).join("; ")}.` : ""}`
    + (before ? `\n- Forrige opgørelse ${on(before.taken_on)}: ${line(before)}.` : "");
}
const on = (iso: string) => shortDay(iso);

function change(now: number | null, before: number | null | undefined): string {
  if (now === null || before === null || before === undefined || now === before) return "";
  const d = now - before;
  return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${KR.format(Math.abs(d))}</span>`;
}

export const MEMBERS_STYLE = `
.figures{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:2px 0 14px}.figures div{background:var(--soft);border-radius:14px;padding:12px 14px;min-width:0}
.figures b{display:block;font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15}.figures span{font-size:12.5px;color:var(--muted)}
.delta{font-size:12px;font-weight:700;margin-left:6px;padding:1px 7px;border-radius:999px;vertical-align:middle}.delta.up{background:var(--tint);color:var(--accent)}.delta.down{background:var(--warn-soft);color:var(--warn)}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:9px}.bars li{display:grid;gap:4px;font-size:13.5px}.bars .lbl{display:flex;justify-content:space-between;gap:10px}
.bars .lbl span:last-child{color:var(--muted);white-space:nowrap}.bars i{display:block;height:6px;border-radius:999px;background:var(--accent)}.bars .track{background:var(--soft);border-radius:999px}
.drop{display:grid;gap:10px;place-items:center;text-align:center;border:1.5px dashed var(--line);border-radius:16px;padding:26px 18px;background:var(--soft)}
.drop input{max-width:320px;background:var(--card)}.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
`;

/** The front page's "Medlemmer" panel. */
export function membersPanel(base: string, rows: MemberStats[], link = true): string {
  const [now, before] = rows;
  const head = `<header><h2>Medlemmer</h2><p>Fra MembershipWorks${now ? ` · opdateret ${esc(shortDay(now.taken_on))}` : ""}.</p></header>`;
  if (!now) return `<article class="panel">${head}<p class="empty">Ingen medlemstal endnu.</p><a class="more" href="${base}/medlemmer">Upload et skærmbillede →</a></article>`;
  // Requested: "\"Betaling stoppet\" grafen er ikke relevant. Men fint at se hvordan det går med samtlige abonnementer" -
  // every kind of membership, without the stopped payments.
  const top = now.plans.filter(p => p.share !== null && !/stoppet|cancel/i.test(p.name));
  const max = Math.max(...top.map(p => p.share ?? 0), 1);
  return `<article class="panel">${head}<div class="figures">
<div><b>${KR.format(now.paying)}${change(now.paying, before?.paying)}</b><span>betalende medlemmer</span></div>
<div><b>${now.annual_revenue_kr !== null ? `${KR.format(now.annual_revenue_kr)} kr.` : "–"}</b><span>årlig indtægt fra dem</span></div>
<div><b>${now.free !== null ? KR.format(now.free) : "–"}${change(now.free, before?.free)}</b><span>på gratis medlemskab</span></div>
<div><b>${now.past_due !== null ? KR.format(now.past_due) : "–"}${change(now.past_due, before?.past_due)}</b><span>i restance${now.cancelled ? ` · ${now.cancelled} opsagt` : ""}</span></div></div>
${top.length ? `<ul class="bars" aria-label="Medlemstyper">${top.map(p => `<li><div class="lbl"><span>${esc(p.name)}</span><span>${p.count !== null ? `${p.count} · ` : ""}${String(p.share).replace(".", ",")} %</span></div><div class="track"><i style="width:${Math.round(100 * (p.share ?? 0) / max)}%"></i></div></li>`).join("")}</ul>` : ""}
${link ? `<a class="more" href="${base}/medlemmer">Alle tal og opdatering →</a>` : ""}</article>`;
}

function numbersForm(base: string, input: StatsInput, note: string): string {
  return `<div class="card"><h2>Tjek tallene</h2><p class="small muted" style="margin-top:-6px">${esc(note)}</p>
<form class="stack" method="post" action="${base}/medlemmer/gem"><label>Dato for tallene<input type="date" name="taken_on" value="${esc(input.taken_on)}" required></label>
<div class="nums">${FIELDS.map(f => `<label>${LABELS[f]}<input name="${f}" inputmode="numeric" value="${input[f] ?? ""}"${REQUIRED.has(f) ? " required" : ""}></label>`).join("")}</div>
<input type="hidden" name="plans" value="${esc(JSON.stringify(input.plans))}">
${input.plans.length ? `<p class="small muted" style="margin:0">Medlemstyper: ${input.plans.map(p => `${esc(p.name)}${p.share !== null ? ` ${String(p.share).replace(".", ",")} %` : ""}`).join(" · ")}</p>` : ""}
<div class="actions"><a class="button ghost" href="${base}/medlemmer">Fortryd</a><button>Gem tallene</button></div></form></div>`;
}

export function membersPage(base: string, data: { who: string | null; rows: MemberStats[]; history: MemberStats[]; read?: StatsInput | null; notice?: string; today: string }): string {
  const [now] = data.rows;
  const upload = `<div class="card"><h2>Opdatér fra MembershipWorks</h2><p class="small muted" style="margin-top:-6px">Tag et skærmbillede af Dashboard › Current Stats i MembershipWorks og læg det her. Saga læser tallene, og du tjekker dem, før de gemmes.</p>
<form method="post" action="${base}/medlemmer/laes" enctype="multipart/form-data" class="drop" id="read-figures"><input type="file" name="billede" accept="image/png,image/jpeg,image/webp" required><button>Lad Saga læse tallene</button></form></div>
<script>document.getElementById("read-figures")?.addEventListener("submit",e=>{const f=e.currentTarget;if(f.dataset.sent){e.preventDefault();return}f.dataset.sent="1";
const b=f.querySelector("button");setTimeout(()=>{b.disabled=true},0);b.textContent="Saga læser tallene …"})</script>`;
  const history = data.history.length > 1 ? `<div class="card"><h2>Udvikling</h2><table class="rows"><tr><th>Dato</th><th>Betalende</th><th>Gratis</th><th>I restance</th><th>Årlig indtægt</th></tr>
${data.history.map(h => `<tr><td data-label="Dato">${esc(shortDay(h.taken_on))}</td><td data-label="Betalende">${h.paying}</td><td data-label="Gratis">${h.free ?? "–"}</td><td data-label="I restance">${h.past_due ?? "–"}</td><td data-label="Årlig indtægt">${h.annual_revenue_kr !== null ? `${KR.format(h.annual_revenue_kr)} kr.` : "–"}</td></tr>`).join("")}</table></div>` : "";
  const body = data.read !== undefined
    ? data.read ? numbersForm(base, data.read, "Saga har læst disse tal fra skærmbilledet. Ret dem, hvis noget er forkert, og gem.")
      : `<p class="notice warn">Saga kunne ikke læse MembershipWorks-tal på billedet. Prøv et skærmbillede af hele Current Stats-siden.</p>${upload}`
    : `${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}<div class="grid">${membersPanel(base, data.rows, false)}${upload}</div>${history}`;
  return layout(base, "Medlemmer", `<main><h1>Medlemmer</h1><p class="muted">Tallene fra MembershipWorks${now ? `, senest ${esc(shortDay(now.taken_on))}` : ""}. Kun tal - aldrig navne eller kontaktoplysninger.</p>${body}</main>`,
    { section: "/medlemmer", who: data.who, style: MEMBERS_STYLE });
}
