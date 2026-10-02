import type { D1Database } from "../db.js";
import type { Decision } from "./data.js";
import { esc, layout, shortDay } from "./page.js";

/** Requested: "Vi skal også finde plads til et nyt punkt - \"Opret forslag til afstemning\". Her er ideen: Man kan komme med
 * et forslag, og så kan bestyrelsesmedlemmerne digitalt stemme for det. Ved flertal er forslaget vedtaget. Når et forslag er
 * stillet, skal hvert bestyrelsesmedlem have punktet på sin to do."
 * A majority is more than half of the board (its size when the proposal was made). The proposal is adopted the moment a
 * majority has voted for, falls the moment it can no longer reach one, and falls at its deadline without one. Each member
 * has it on their to-do until they have voted; a vote can be changed while the proposal is open. */

const DAY = 86_400_000;
export type Vote = "for" | "imod" | "undlader";
export const VOTES: readonly Vote[] = ["for", "imod", "undlader"];
export type Proposal = { id: number; title: string; text: string; created_by: string; members: number; status: "open" | "adopted" | "rejected" | "withdrawn"; deadline_ms: number; decided_at_ms: number | null; created_at_ms: number };
export type Ballot = { proposal_id: number; voter: string; vote: Vote; voted_at_ms: number };

/** The outcome so far: adopted at a majority for, rejected when one can no longer come, or at the deadline. */
export function outcome(p: Pick<Proposal, "members" | "deadline_ms">, ballots: Array<Pick<Ballot, "vote">>, nowMs: number): "open" | "adopted" | "rejected" {
  const yes = ballots.filter(b => b.vote === "for").length, missing = Math.max(0, p.members - ballots.length);
  if (yes * 2 > p.members) return "adopted";
  if ((yes + missing) * 2 <= p.members) return "rejected";
  return nowMs >= p.deadline_ms ? "rejected" : "open";
}

const ballotsOf = (db: D1Database, id: number) => db.prepare("SELECT proposal_id, voter, vote, voted_at_ms FROM board_votes WHERE proposal_id = ? ORDER BY voted_at_ms").bind(id).all<Ballot>().then(r => r.results ?? []);

async function settle(db: D1Database, p: Proposal, nowMs: number): Promise<void> {
  if (p.status !== "open") return;
  const result = outcome(p, await ballotsOf(db, p.id), nowMs);
  if (result !== "open") await db.prepare("UPDATE board_proposals SET status = ?, decided_at_ms = ? WHERE id = ? AND status = 'open'").bind(result, nowMs, p.id).run();
}

/** Closes the open proposals whose deadline has passed. */
export async function settleDue(db: D1Database, nowMs: number): Promise<void> {
  const due = (await db.prepare("SELECT * FROM board_proposals WHERE status = 'open' AND deadline_ms <= ?").bind(nowMs).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
  for (const p of due) await settle(db, p, nowMs);
}

export async function createProposal(db: D1Database, input: { title: string; text: string; days: number; who: string; members: number }, nowMs: number): Promise<number | null> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return null;
  const days = Number.isInteger(input.days) && input.days >= 1 && input.days <= 30 ? input.days : 7;
  const result = await db.prepare("INSERT INTO board_proposals (title, text, created_by, members, deadline_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(title, input.text.trim().slice(0, 4000), input.who, Math.max(1, input.members), nowMs + days * DAY, nowMs).run();
  return Number(result.meta?.last_row_id);
}

/** A board member's vote; changed while the proposal is open. False when it is decided or unknown. */
export async function castVote(db: D1Database, id: number, voter: string, vote: Vote, nowMs: number): Promise<boolean> {
  const p = await db.prepare("SELECT * FROM board_proposals WHERE id = ?").bind(id).first<Proposal>();
  if (!p || !VOTES.includes(vote)) return false;
  await settle(db, p, nowMs);
  if ((await db.prepare("SELECT status FROM board_proposals WHERE id = ?").bind(id).first<{ status: string }>())?.status !== "open") return false;
  await db.prepare("INSERT INTO board_votes (proposal_id, voter, vote, voted_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(proposal_id, voter) DO UPDATE SET vote = excluded.vote, voted_at_ms = excluded.voted_at_ms")
    .bind(id, voter, vote, nowMs).run();
  await settle(db, { ...p, status: "open" }, nowMs);
  return true;
}

/** The proposer takes an open proposal back. */
export async function withdrawProposal(db: D1Database, id: number, who: string, nowMs: number): Promise<boolean> {
  const result = await db.prepare("UPDATE board_proposals SET status = 'withdrawn', decided_at_ms = ? WHERE id = ? AND created_by = ? AND status = 'open'").bind(nowMs, id, who).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export type ProposalView = Proposal & { ballots: Ballot[] };

export async function proposals(db: D1Database, nowMs: number): Promise<ProposalView[]> {
  await settleDue(db, nowMs);
  const rows = (await db.prepare("SELECT * FROM board_proposals WHERE status = 'open' OR decided_at_ms >= ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(decided_at_ms, created_at_ms) DESC LIMIT 60")
    .bind(nowMs - 365 * DAY).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
  const ballots = rows.length ? (await db.prepare(`SELECT proposal_id, voter, vote, voted_at_ms FROM board_votes WHERE proposal_id IN (${rows.map(() => "?").join(",")})`).bind(...rows.map(r => r.id)).all<Ballot>()).results ?? [] : [];
  return rows.map(r => ({ ...r, ballots: ballots.filter(b => b.proposal_id === r.id) }));
}

/** The open proposals a member has not voted on - on their to-do. */
export async function awaitingVote(db: D1Database, who: string | null, nowMs: number): Promise<Proposal[]> {
  if (!who) return [];
  await settleDue(db, nowMs).catch(() => undefined);
  return (await db.prepare(`SELECT p.* FROM board_proposals p WHERE p.status = 'open' AND NOT EXISTS (SELECT 1 FROM board_votes v WHERE v.proposal_id = p.id AND v.voter = ?)
    ORDER BY p.deadline_ms`).bind(who).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
}

/** Adopted proposals, as decisions. */
export async function voteDecisions(db: D1Database): Promise<Decision[]> {
  const rows = (await db.prepare("SELECT id, title, decided_at_ms FROM board_proposals WHERE status = 'adopted' ORDER BY decided_at_ms DESC LIMIT 200")
    .all<{ id: number; title: string; decided_at_ms: number }>().catch(() => ({ results: [] as Array<{ id: number; title: string; decided_at_ms: number }> }))).results ?? [];
  return rows.map(r => ({ text: r.title, date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(r.decided_at_ms), topic: "", source: "afstemning" as const, minutesId: null, voteId: r.id }));
}

/** For Saga: the open proposals and the latest outcomes. */
export async function votesForSaga(db: D1Database, nowMs: number): Promise<string> {
  const list = await proposals(db, nowMs).catch(() => [] as ProposalView[]);
  return list.slice(0, 20).map(p => `- ${p.title} (forslag fra ${p.created_by}): ${STATUS[p.status]}${p.status === "open" ? `, frist ${shortDay(isoDay(p.deadline_ms))}` : ""}; ${tally(p)}`).join("\n") || "(ingen)";
}

// ---- Pages ----

const STATUS: Record<Proposal["status"], string> = { open: "Til afstemning", adopted: "Godkendt", rejected: "Ikke vedtaget", withdrawn: "Trukket tilbage" };
const isoDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const tally = (p: ProposalView) => { const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length; return `${n("for")} for, ${n("imod")} imod, ${n("undlader")} undlader sig af ${p.members}`; };

/** The seal on an adopted proposal (also on Beslutninger). */
export const APPROVED_BADGE = `<span class="approved-badge"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>GODKENDT</span>`;
export const APPROVED_STYLE = `.approved-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;letter-spacing:.09em;padding:4px 11px 4px 9px;border-radius:999px;
color:#fff;background:linear-gradient(135deg,#1f9d55,#127a3f);box-shadow:0 2px 10px rgb(18 122 63 / .35),inset 0 1px 0 rgb(255 255 255 / .25);margin-right:9px;vertical-align:2px;white-space:nowrap}`;

export const VOTES_STYLE = `
.prop{border-top:1px solid var(--line);padding:16px 0;display:grid;gap:8px}.prop:first-child{border-top:0;padding-top:4px}.prop h3{margin:0;font-size:17px}
.prop .state{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-right:8px;vertical-align:2px}
.prop .state.adopted{background:#e6f4ea;color:#1e6b35}.prop .state.rejected,.prop .state.withdrawn{background:var(--soft);color:var(--muted)}
.prop .bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;display:flex}.prop .bar i{display:block;height:100%}.prop .bar .y{background:var(--accent)}.prop .bar .n{background:#a16207}.prop .bar .a{background:var(--line)}
.prop .acts{display:flex;gap:8px;flex-wrap:wrap}.prop .acts button[aria-pressed="true"]{outline:2px solid var(--accent);outline-offset:2px}.prop .who{font-size:13px;color:var(--muted)}
.newprop{display:grid;gap:10px}.newprop label{display:grid;gap:4px}
@media (prefers-color-scheme:dark){.prop .state.adopted{background:#163824;color:#8fd6a5}}
${APPROVED_STYLE}`;

function proposalHtml(base: string, p: ProposalView, who: string | null): string {
  const mine = who ? p.ballots.find(b => b.voter === who)?.vote : undefined;
  const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length, pct = (k: number) => `${Math.round(100 * k / p.members)}%`;
  const needed = Math.floor(p.members / 2) + 1;
  // Requested: "Giv det et flot badge \"GODKENDT\" ved godkendelse".
  return `<article class="prop" id="p${p.id}"><h3>${p.status === "adopted" ? APPROVED_BADGE : `<span class="state ${p.status}">${STATUS[p.status]}</span>`}${esc(p.title)}</h3>
${p.text ? `<p style="margin:0;white-space:pre-wrap">${esc(p.text)}</p>` : ""}
<div class="who">Stillet af ${esc(p.created_by)} ${esc(shortDay(isoDay(p.created_at_ms)))}${p.status === "open" ? ` · frist ${esc(shortDay(isoDay(p.deadline_ms)))} · vedtaget ved ${needed} stemmer for` : p.decided_at_ms ? ` · afgjort ${esc(shortDay(isoDay(p.decided_at_ms)))}` : ""}</div>
<div class="bar" role="img" aria-label="${esc(tally(p))}"><i class="y" style="width:${pct(n("for"))}"></i><i class="n" style="width:${pct(n("imod"))}"></i><i class="a" style="width:${pct(n("undlader"))}"></i></div>
<div class="who">${esc(tally(p))}${p.ballots.length ? ` · ${p.ballots.map(b => `${esc(b.voter.split(/\s+/)[0]!)}: ${b.vote}`).join(", ")}` : ""}</div>
${p.status === "open" && who ? `<form method="post" action="${base}/afstemninger/stem" class="acts"><input type="hidden" name="id" value="${p.id}">
${VOTES.map(v => `<button name="vote" value="${v}" class="${mine === v ? "" : "ghost"}" aria-pressed="${mine === v}">${v === "for" ? "Stem for" : v === "imod" ? "Stem imod" : "Undlad at stemme"}</button>`).join("")}
${p.created_by === who ? `<button name="withdraw" value="1" class="ghost" formaction="${base}/afstemninger/tilbage">Træk forslaget tilbage</button>` : ""}</form>${mine ? `<div class="who">Du har stemt ${mine}. Du kan ændre din stemme, indtil forslaget er afgjort.</div>` : ""}` : ""}</article>`;
}

export function votesPage(base: string, data: { list: ProposalView[]; who: string | null; members: number; notice: string }): string {
  const open = data.list.filter(p => p.status === "open"), closed = data.list.filter(p => p.status !== "open");
  const needed = Math.floor(Math.max(1, data.members) / 2) + 1;
  return layout(base, "Afstemninger", `<main><h1>Afstemninger</h1><p class="muted">Stil et forslag, og bestyrelsen stemmer digitalt. Ved flertal - mindst ${needed} af ${data.members || "bestyrelsens"} stemmer for - er forslaget vedtaget. Alle har forslaget på deres to-do, til de har stemt.</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}
<div class="card"><h2>Opret forslag til afstemning</h2>${data.who ? `<form class="newprop" method="post" action="${base}/afstemninger/ny">
<label>Forslag<input name="title" required maxlength="200" placeholder="Fx Vi forlænger den gratis prøveperiode til 1. december"></label>
<label>Begrundelse (valgfri)<textarea name="text" rows="3" maxlength="4000"></textarea></label>
<label>Frist<select name="days"><option value="3">3 dage</option><option value="7" selected>7 dage</option><option value="14">14 dage</option></select></label>
<p style="margin:0"><button>Stil forslaget</button></p></form>` : `<p class="muted"><a href="${base}/hvem">Vælg hvem du er</a> for at stille et forslag.</p>`}</div>
<div class="card"><h2>Til afstemning${open.length ? ` <span class="pill">${open.length}</span>` : ""}</h2>${open.length ? open.map(p => proposalHtml(base, p, data.who)).join("") : `<p class="muted">Ingen forslag til afstemning lige nu.</p>`}</div>
${closed.length ? `<div class="card"><h2>Afgjort</h2>${closed.map(p => proposalHtml(base, p, data.who)).join("")}</div>` : ""}</main>`, { section: "/afstemninger", who: data.who, style: VOTES_STYLE });
}

/** On the to-do and the front page: "Stem om …". */
export const voteTodo = (base: string, p: Proposal) => `<li><a href="${base}/afstemninger#p${p.id}"><strong>Stem om: ${esc(p.title)}</strong></a><span class="ctx">Forslag fra ${esc(p.created_by)} · frist ${esc(shortDay(isoDay(p.deadline_ms)))}</span></li>`;
