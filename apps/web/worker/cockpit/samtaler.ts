import type { D1Database } from "../db.js";
import { markdownToHtml } from "../saga/markdown.js";
import { ADMINS_STYLE } from "./admins.js";
import { esc, layout } from "./page.js";

/** Requested by the chair, as super admin: "Lad mig også se chatudskrift" - what each admin member has asked Saga, and what
 * Saga answered. The questions are kept 90 days (ask.ts). Only the chair sees them, and the chat window says so. A run of
 * questions from one person with less than 30 minutes between them is one conversation - the same 30 minutes after which the
 * chat window starts over. Nothing here changes anything. */

const MINUTE = 60_000;
export const CONVERSATION_GAP_MS = 30 * MINUTE;
export const SHOWN_TURNS = 400;
export const KEPT_DAYS = 90;

export type SagaTurn = { id: number; who: string; question: string; answer: string | null; atMs: number };
export type Conversation = { who: string; startMs: number; endMs: number; turns: SagaTurn[] };
export type Asker = { who: string; n: number; lastMs: number };
export type Transcript = { askers: Asker[]; conversations: Conversation[]; turns: number; more: boolean };

const UNKNOWN = "Ukendt";

/** Questions newest first: those of one member (or all), optionally containing a word, at most SHOWN_TURNS. */
export async function sagaTranscript(db: D1Database, filter: { who?: string | undefined; q?: string | undefined }): Promise<Transcript> {
  const word = (filter.q ?? "").trim().slice(0, 80);
  const where: string[] = [];
  const bind: unknown[] = [];
  if (filter.who) { where.push(filter.who === UNKNOWN ? "asked_by IS NULL" : "asked_by = ?"); if (filter.who !== UNKNOWN) bind.push(filter.who); }
  if (word) { where.push("(question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\')"); const like = `%${word.replace(/[\\%_]/g, c => `\\${c}`)}%`; bind.push(like, like); }
  const [rows, askers] = await Promise.all([
    db.prepare(`SELECT id, asked_by, question, answer, created_at_ms FROM cockpit_questions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at_ms DESC, id DESC LIMIT ${SHOWN_TURNS + 1}`)
      .bind(...bind).all<{ id: number; asked_by: string | null; question: string; answer: string | null; created_at_ms: number }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT COALESCE(asked_by, ?) AS who, COUNT(*) AS n, MAX(created_at_ms) AS last FROM cockpit_questions GROUP BY 1 ORDER BY last DESC")
      .bind(UNKNOWN).all<{ who: string; n: number; last: number }>().then(r => r.results ?? []).catch(() => [])
  ]);
  const turns = rows.slice(0, SHOWN_TURNS).map((r): SagaTurn => ({ id: Number(r.id), who: r.asked_by ?? UNKNOWN, question: r.question, answer: r.answer, atMs: Number(r.created_at_ms) }));
  return { askers: askers.map(a => ({ who: a.who, n: Number(a.n), lastMs: Number(a.last) })), conversations: conversations(turns), turns: turns.length, more: rows.length > SHOWN_TURNS };
}

/** Turns (any order) grouped per person into conversations; newest conversation first, each read from the top. */
export function conversations(turns: SagaTurn[]): Conversation[] {
  const byPerson = new Map<string, SagaTurn[]>();
  for (const turn of turns) byPerson.set(turn.who, [...(byPerson.get(turn.who) ?? []), turn]);
  const out: Conversation[] = [];
  for (const [who, list] of byPerson) {
    let current: Conversation | null = null;
    for (const turn of [...list].sort((a, b) => a.atMs - b.atMs || a.id - b.id)) {
      if (current && turn.atMs - current.endMs <= CONVERSATION_GAP_MS) { current.turns.push(turn); current.endMs = turn.atMs; }
      else { current = { who, startMs: turn.atMs, endMs: turn.atMs, turns: [turn] }; out.push(current); }
    }
  }
  return out.sort((a, b) => b.startMs - a.startMs || a.who.localeCompare(b.who, "da"));
}

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const CLOCK = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const DAY_MONTH = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });

/** The same conversations as plain text, to keep or send on: "chatudskrift". */
export function transcriptText(list: Conversation[], nowMs: number): string {
  const head = `Samtaler med Saga - udskrevet ${WHEN.format(nowMs)}\nSamtalerne gemmes i ${KEPT_DAYS} dage. Kun formanden kan læse dem.\n`;
  return head + list.map(c => `\n=== ${c.who} · ${WHEN.format(c.startMs)} ===\n` + c.turns.map(t => `[${CLOCK.format(t.atMs)}] ${c.who}: ${t.question}\n[${CLOCK.format(t.atMs)}] Saga: ${(t.answer ?? "(intet svar)").trim()}\n`).join("\n")).join("");
}

const answerHtml = (markdown: string | null) => markdown?.trim() ? /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(markdown))?.[1] ?? "" : `<p class="muted">(intet svar)</p>`;

export const SAMTALER_STYLE = `${ADMINS_STYLE}
.chat-pick{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.chat-pick a{padding:7px 14px;border-radius:999px;background:var(--soft);color:var(--muted);text-decoration:none;font-size:14px;font-weight:600}
.chat-pick a[aria-current]{background:var(--accent);color:var(--accent-ink)}.chat-pick small{opacity:.75;font-weight:500;margin-left:4px}
.chat{display:grid;gap:14px}.chat>header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}.chat>header h2{margin:0;font-size:17px}.chat>header span{font-size:13.5px;color:var(--muted)}
.chat .turn{display:grid;gap:8px}.chat .q,.chat .a{border-radius:14px;padding:11px 14px;max-width:760px;font-size:15px;line-height:1.5}.chat .q{background:var(--soft);justify-self:end;white-space:pre-wrap}
.chat .a{background:var(--card);border:1px solid var(--line)}.chat .a p,.chat .a ul{margin:0 0 6px}.chat .a>:last-child{margin-bottom:0}.chat .t{font-size:12px;color:var(--faint);margin:0 4px}
@media (max-width:760px){.chat .q,.chat .a{max-width:none}}
`;

export function samtalerPage(base: string, who: string | null, d: { transcript: Transcript; member: string; q: string; nowMs: number }): string {
  const t = d.transcript;
  const total = t.askers.reduce((sum, a) => sum + a.n, 0);
  const link = (member: string) => `${base}/samtaler${member || d.q ? `?${new URLSearchParams({ ...(member ? { medlem: member } : {}), ...(d.q ? { q: d.q } : {}) })}` : ""}`;
  const picks = `<nav class="chat-pick" aria-label="Medlem"><a href="${esc(link(""))}"${d.member ? "" : ' aria-current="page"'}>Alle<small>${total}</small></a>${t.askers.map(a =>
    `<a href="${esc(link(a.who))}"${a.who === d.member ? ' aria-current="page"' : ""}>${esc(a.who)}<small>${a.n}</small></a>`).join("")}</nav>`;
  const download = `${base}/samtaler?${new URLSearchParams({ ...(d.member ? { medlem: d.member } : {}), ...(d.q ? { q: d.q } : {}), udskrift: "1" })}`;
  const list = t.conversations.map(c => `<section class="panel chat"><header><h2>${esc(c.who)}</h2><span>${esc(WHEN.format(c.startMs))} · ${c.turns.length} spørgsmål</span></header>
${c.turns.map(turn => `<div class="turn"><div class="q">${esc(turn.question)}</div><div class="a">${answerHtml(turn.answer)}</div><span class="t">Kl. ${esc(CLOCK.format(turn.atMs))}${DAY_MONTH.format(turn.atMs) === DAY_MONTH.format(c.startMs) ? "" : ` · ${esc(DAY_MONTH.format(turn.atMs))}`}</span></div>`).join("")}</section>`).join("");
  return layout(base, "Samtaler med Saga", `<main class="adm"><div class="hero"><p class="small muted" style="margin:0 0 6px"><a href="${base}/administratorer">← Administratorer</a></p><h1>Samtaler med Saga</h1>
<p>Det bestyrelsens medlemmer har spurgt Saga om i cockpittet og i Matrix, og hvad hun svarede. Samtalerne gemmes i ${KEPT_DAYS} dage. Kun for formanden - og medlemmerne kan se i chatten, at formanden kan læse med.</p></div>
<form class="m-search" method="get" action="${base}/samtaler">${d.member ? `<input type="hidden" name="medlem" value="${esc(d.member)}">` : ""}<input type="search" name="q" value="${esc(d.q)}" placeholder="Søg i spørgsmål og svar" maxlength="80" aria-label="Søg"><button class="ghost">Søg</button>${t.turns ? `<a class="ghost" href="${esc(download)}" style="align-self:center">Hent udskrift (tekst)</a>` : ""}</form>
${picks}${list || `<p class="empty">${total ? "Ingen samtaler passer til det valgte." : "Ingen har spurgt Saga endnu."}</p>`}
${t.more ? `<p class="small muted">Her vises de seneste ${SHOWN_TURNS} spørgsmål. Vælg et medlem eller søg for at komme længere tilbage.</p>` : ""}</main>`,
    { section: "/medlemmer", who, style: SAMTALER_STYLE });
}
