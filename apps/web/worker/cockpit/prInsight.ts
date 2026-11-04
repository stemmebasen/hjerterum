import type { D1Database } from "../db.js";
import { monthName, monthOf, monthStart, nextMonth } from "../newsletter.js";
import { esc } from "./page.js";

/** Requested (the chair, 3 Nov 2026: "Ja til det hele" to the plan - "Mål få ting, en gang om måneden"): the month's insight on PR og SoMe. Followers on
 * Facebook and Instagram (one count a day, social.ts countFollowers) and what went out, month by month - the last three months. Reach per post needs
 * further permissions from Meta (read_insights, instagram_manage_insights) and is not here. */

export type MonthInsight = { month: string; fb: { start: number | null; end: number | null }; ig: { start: number | null; end: number | null };
  sent: { week: number; event: number; share: number; instagram: number } };

const prevMonth = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export async function insightData(db: D1Database, nowMs: number, months = 3): Promise<MonthInsight[]> {
  const list: string[] = [monthOf(nowMs)];
  while (list.length < months) list.push(prevMonth(list[list.length - 1]!));
  return Promise.all(list.map(async month => {
    const from = monthStart(month), to = monthStart(nextMonth(month));
    const first = month + "-01", last = nextMonth(month) + "-01";
    const edge = (order: "ASC" | "DESC", column: "fb_followers" | "ig_followers") => db.prepare(`SELECT ${column} AS n FROM social_stats WHERE day >= ? AND day < ? AND ${column} IS NOT NULL ORDER BY day ${order} LIMIT 1`)
      .bind(first, last).first<{ n: number }>().then(r => r?.n ?? null).catch(() => null);
    const sent = await db.prepare(`SELECT kind, COUNT(*) AS n, SUM(CASE WHEN json_extract(published, '$.instagram') IS NOT NULL THEN 1 ELSE 0 END) AS ig
        FROM social_posts WHERE status = 'published' AND published_at_ms >= ? AND published_at_ms < ? GROUP BY kind`).bind(from, to)
      .all<{ kind: string; n: number; ig: number }>().then(r => r.results ?? []).catch(() => []);
    const count = (kind: string) => sent.find(r => r.kind === kind)?.n ?? 0;
    return { month, fb: { start: await edge("ASC", "fb_followers"), end: await edge("DESC", "fb_followers") }, ig: { start: await edge("ASC", "ig_followers"), end: await edge("DESC", "ig_followers") },
      sent: { week: count("week"), event: count("event"), share: count("share"), instagram: sent.reduce((n, r) => n + (r.ig ?? 0), 0) } };
  }));
}

const number = (n: number) => n.toLocaleString("da-DK");
function growth(f: { start: number | null; end: number | null }): string {
  if (f.end === null) return `<span class="muted">-</span>`;
  const change = f.start === null ? 0 : f.end - f.start;
  return `${number(f.end)}${f.start !== null && change !== 0 ? ` <small class="${change > 0 ? "good" : "warn"}">${change > 0 ? "+" : ""}${number(change)}</small>` : ""}`;
}

export function insightSection(rows: MonthInsight[]): string {
  const any = rows.some(r => r.fb.end !== null || r.ig.end !== null || r.sent.week + r.sent.event + r.sent.share > 0);
  const body = !any ? `<p class="empty">Endnu ingen tal. Saga tæller følgerne hver dag, når Facebook og Instagram er forbundet, og her står så månedens udvikling og det, der er sendt.</p>`
    : `<table class="insight"><thead><tr><th>Måned</th><th>Følgere på Facebook</th><th>Følgere på Instagram</th><th>Ugens events</th><th>Eventopslag</th><th>Delinger</th><th>På Instagram</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(monthName(r.month))}</td><td data-label="Facebook">${growth(r.fb)}</td><td data-label="Instagram">${growth(r.ig)}</td><td data-label="Ugens events">${r.sent.week}</td><td data-label="Eventopslag">${r.sent.event}</td><td data-label="Delinger">${r.sent.share}</td><td data-label="På Instagram">${r.sent.instagram}</td></tr>`).join("")}</tbody></table>
<p class="small muted">Følgerne ved månedens slutning (eller i dag), og ændringen i løbet af måneden. Rækkevidde pr. opslag kræver flere tilladelser fra Meta og er ikke med endnu.</p>`;
  return `<section class="panel" id="indsigt"><header><h2>Indsigt</h2><p>Kig her en gang om måneden, og justér hvert kvartal.</p></header>${body}</section>`;
}

export const INSIGHT_STYLE = `.insight{width:100%;border-collapse:collapse;font-size:14.5px}.insight th{text-align:left;font-size:12.5px;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line)}
.insight td{padding:9px 8px;border-bottom:1px solid var(--line)}.insight small{font-size:12px;font-weight:600}.insight small.good{color:var(--accent)}
@media (max-width:760px){.insight thead{display:none}.insight tr{display:grid;grid-template-columns:1fr 1fr;padding:8px 0;border-bottom:1px solid var(--line)}.insight td{border:0;padding:2px 0}.insight td:first-child{grid-column:1/-1;font-weight:600}.insight td[data-label]::before{content:attr(data-label) ": ";color:var(--muted);font-size:13px}}`;
