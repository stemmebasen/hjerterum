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

/** Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde". A note on the proposal -
 * the vote goes on - that Saga takes into her suggestion for the next agenda. Pressed again, it is taken back. */
export async function toggleDiscuss(db: D1Database, id: number, who: string, nowMs: number): Promise<"added" | "removed" | null> {
  const p = await db.prepare("SELECT status FROM board_proposals WHERE id = ?").bind(id).first<{ status: string }>();
  if (!p || p.status === "withdrawn") return null;
  const gone = await db.prepare("DELETE FROM board_vote_discuss WHERE proposal_id = ? AND member = ?").bind(id, who).run();
  if (Number(gone.meta?.changes ?? 0) > 0) return "removed";
  await db.prepare("INSERT INTO board_vote_discuss (proposal_id, member, created_at_ms) VALUES (?, ?, ?)").bind(id, who, nowMs).run();
  return "added";
}

export type ProposalView = Proposal & { ballots: Ballot[]; discuss: string[] };

export async function proposals(db: D1Database, nowMs: number): Promise<ProposalView[]> {
  await settleDue(db, nowMs);
  const rows = (await db.prepare("SELECT * FROM board_proposals WHERE status = 'open' OR decided_at_ms >= ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(decided_at_ms, created_at_ms) DESC LIMIT 60")
    .bind(nowMs - 365 * DAY).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
  const ballots = rows.length ? (await db.prepare(`SELECT proposal_id, voter, vote, voted_at_ms FROM board_votes WHERE proposal_id IN (${rows.map(() => "?").join(",")})`).bind(...rows.map(r => r.id)).all<Ballot>()).results ?? [] : [];
  const discuss = rows.length ? (await db.prepare(`SELECT proposal_id, member FROM board_vote_discuss WHERE proposal_id IN (${rows.map(() => "?").join(",")}) ORDER BY created_at_ms`)
    .bind(...rows.map(r => r.id)).all<{ proposal_id: number; member: string }>().catch(() => ({ results: [] as Array<{ proposal_id: number; member: string }> }))).results ?? [] : [];
  return rows.map(r => ({ ...r, ballots: ballots.filter(b => b.proposal_id === r.id), discuss: discuss.filter(d => d.proposal_id === r.id).map(d => d.member) }));
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
  return list.slice(0, 20).map(p => `- ${p.title} (forslag fra ${p.created_by}): ${STATUS[p.status]}${p.status === "open" ? `, frist ${shortDay(isoDay(p.deadline_ms))}` : ""}; ${tally(p)}${p.discuss.length ? `; ØNSKES DRØFTET PÅ ET MØDE af ${p.discuss.join(", ")}` : ""}`).join("\n") || "(ingen)";
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
.prop{border-top:1px solid var(--line);padding:16px 0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.prop h3{overflow-wrap:anywhere}.prop:first-child{border-top:0;padding-top:4px}.prop h3{margin:0;font-size:17px;font-weight:650;line-height:1.35;letter-spacing:-.01em;text-transform:none;color:var(--ink)}
.prop .state{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-right:8px;vertical-align:2px}
.prop .state.adopted{background:#e6f4ea;color:#1e6b35}.prop .state.rejected,.prop .state.withdrawn{background:var(--soft);color:var(--muted)}
.prop .bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;display:flex}.prop .bar i{display:block;height:100%}.prop .bar .y{background:var(--accent)}.prop .bar .n{background:#a16207}.prop .bar .a{background:var(--line)}
.prop .acts{display:flex;gap:8px;flex-wrap:wrap}.prop .acts button[aria-pressed="true"]{outline:2px solid var(--accent);outline-offset:2px}.prop .who,.prop .pmeta{font-size:13px;color:var(--muted)}
.prop .talk{display:inline-flex;align-items:center;gap:6px;width:fit-content;font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:#fdf3e1;color:#8a5a00}
.newprop{display:grid;gap:10px}.newprop label{display:grid;gap:4px}
/* Requested: "Der, hvor man skriver forslag, skal være lidt tydeligere på siden. Den skal i hvert fald ikke ligge i bunden." and "forslaget skal fremgå på alles forside,
   eventuelt i en lidt anden farve, som dog passer til farveskemaet": the form is first on Beslutninger, and the open proposals are in an accent-tinted card on the front page. */
.card.propose,.votes-panel{background:color-mix(in srgb,var(--accent) 7%,var(--card));border-color:color-mix(in srgb,var(--accent) 32%,var(--line))}
.card.propose h2,.votes-panel h2{color:var(--accent)}.card.propose .lead{margin:-6px 0 14px;color:var(--muted)}
.newprop .row{display:grid;gap:12px;grid-template-columns:1fr auto;align-items:end}.newprop .row p{margin:0}.newprop .go{padding-inline:28px}
@media (max-width:620px){.newprop .row{grid-template-columns:1fr}}
.votes-panel .count{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-left:8px;vertical-align:3px}
.votes-panel .prop{border-top:1px solid color-mix(in srgb,var(--accent) 22%,var(--line))}.votes-panel .prop h3 a{color:var(--ink);text-decoration:none}.votes-panel .prop h3 a:hover{color:var(--accent)}
.votes-panel .prop .state.todo{background:var(--accent);color:var(--accent-ink)}
@media (prefers-color-scheme:dark){.prop .state.adopted{background:#163824;color:#8fd6a5}.prop .talk{background:#3a2c10;color:#f3c66b}}
${APPROVED_STYLE}`;

function proposalHtml(base: string, p: ProposalView, who: string | null): string {
  const mine = who ? p.ballots.find(b => b.voter === who)?.vote : undefined;
  const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length, pct = (k: number) => `${Math.round(100 * k / p.members)}%`;
  const needed = Math.floor(p.members / 2) + 1;
  const talk = !!who && p.discuss.includes(who);
  const talkButton = `<button name="discuss" value="1" class="ghost" formaction="${base}/afstemninger/droeft" aria-pressed="${talk}">${talk ? "Fortryd: drøft på et møde" : "Jeg ønsker at drøfte dette på et møde"}</button>`;
  // Requested: "Giv det et flot badge \"GODKENDT\" ved godkendelse".
  return `<article class="prop" id="p${p.id}"><h3>${p.status === "adopted" ? APPROVED_BADGE : `<span class="state ${p.status}">${STATUS[p.status]}</span>`}${esc(p.title)}</h3>
${p.text ? `<p style="margin:0;white-space:pre-wrap">${esc(p.text)}</p>` : ""}
<div class="who">Stillet af ${esc(p.created_by)} ${esc(shortDay(isoDay(p.created_at_ms)))}${p.status === "open" ? ` · frist ${esc(shortDay(isoDay(p.deadline_ms)))} · vedtaget ved ${needed} stemmer for` : p.decided_at_ms ? ` · afgjort ${esc(shortDay(isoDay(p.decided_at_ms)))}` : ""}</div>
<div class="bar" role="img" aria-label="${esc(tally(p))}"><i class="y" style="width:${pct(n("for"))}"></i><i class="n" style="width:${pct(n("imod"))}"></i><i class="a" style="width:${pct(n("undlader"))}"></i></div>
${p.discuss.length ? `<div class="talk">💬 Ønskes drøftet på et møde af ${esc(p.discuss.map(n => n.split(/\s+/)[0]!).join(", "))}</div>` : ""}
<div class="who">${esc(tally(p))}${p.ballots.length ? ` · ${p.ballots.map(b => `${esc(b.voter.split(/\s+/)[0]!)}: ${b.vote}`).join(", ")}` : ""}</div>
${p.status === "open" && who ? `<form method="post" action="${base}/afstemninger/stem" class="acts"><input type="hidden" name="id" value="${p.id}">
${VOTES.map(v => `<button name="vote" value="${v}" class="${mine === v ? "" : "ghost"}" aria-pressed="${mine === v}">${v === "for" ? "Stem for" : v === "imod" ? "Stem imod" : "Undlad at stemme"}</button>`).join("")}
${talkButton}${p.created_by === who ? `<button name="withdraw" value="1" class="ghost" formaction="${base}/afstemninger/tilbage">Træk forslaget tilbage</button>` : ""}</form>${mine ? `<div class="who">Du har stemt ${mine}. Du kan ændre din stemme, indtil forslaget er afgjort.</div>` : ""}`
  : p.status === "adopted" || p.status === "rejected" ? who ? `<form method="post" action="${base}/afstemninger/droeft" class="acts"><input type="hidden" name="id" value="${p.id}">${talkButton}</form>` : "" : ""}</article>`;
}

/** Requested: "Beslutninger og Afstemninger skal merges" - the votes are part of the page Beslutninger (page.ts decisionsPage):
 * the open proposals first, the board's decisions, a new proposal, and the decided votes folded away. */
export type VoteBlocks = { intro: string; open: string; create: string; closed: string };
export function voteBlocks(base: string, data: { list: ProposalView[]; who: string | null; members: number }): VoteBlocks {
  const open = data.list.filter(p => p.status === "open"), closed = data.list.filter(p => p.status !== "open");
  const needed = Math.floor(Math.max(1, data.members) / 2) + 1;
  return {
    intro: `Et forslag er vedtaget ved flertal: mindst ${needed} af ${data.members || "bestyrelsens"} stemmer for.`,
    open: open.length ? `<div class="card" id="afstemning"><h2>Til afstemning <span class="pill">${open.length}</span></h2>${open.map(p => proposalHtml(base, p, data.who)).join("")}</div>` : "",
    create: `<div class="card propose" id="nyt"><h2>Opret forslag til afstemning</h2>${data.who ? `<p class="lead">Skriv forslaget her. Det står på alles forside og to-do, til de har stemt.</p><form class="newprop" method="post" action="${base}/afstemninger/ny">
<label>Forslag<input name="title" required maxlength="200" placeholder="Fx Vi forlænger den gratis prøveperiode til 1. december"></label>
<label>Begrundelse (valgfri)<textarea name="text" rows="2" maxlength="4000"></textarea></label>
<div class="row"><label>Frist<select name="days"><option value="3">3 dage</option><option value="7" selected>7 dage</option><option value="14">14 dage</option></select></label>
<p><button class="go">Stil forslaget</button></p></div>
<p class="small muted" style="margin:0">Vil nogen hellere tage det op på et møde, kan de trykke <em>Jeg ønsker at drøfte dette på et møde</em> - afstemningen fortsætter, og Saga sætter forslaget på sit forslag til næste dagsorden.</p></form>` : `<p class="muted"><a href="${base}/hvem">Vælg hvem du er</a> for at stille et forslag.</p>`}</div>`,
    closed: closed.length ? `<div class="card"><details><summary><h2 style="display:inline">Afgjorte afstemninger (${closed.length})</h2></summary>${closed.map(p => proposalHtml(base, p, data.who)).join("")}</details></div>` : ""
  };
}

/** Requested: "forslaget skal fremgå på alles forside, eventuelt i en lidt anden farve, som dog passer til farveskemaet": every open proposal on every member's front page, in a card
 * tinted with the accent, with the count so far and the vote buttons (a vote from here comes back here). Nothing when no proposal is open. */
export function frontVotes(base: string, list: ProposalView[], who: string | null): string {
  const open = list.filter(p => p.status === "open");
  if (!open.length) return "";
  const item = (p: ProposalView) => {
    const mine = who ? p.ballots.find(b => b.voter === who)?.vote : undefined;
    const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length, pct = (k: number) => `${Math.round(100 * k / p.members)}%`;
    const needed = Math.floor(p.members / 2) + 1;
    return `<article class="prop" id="f${p.id}"><h3>${who && !mine ? `<span class="state todo">Du mangler at stemme</span>` : `<span class="state">${STATUS.open}</span>`}<a href="${base}/beslutninger#p${p.id}">${esc(p.title)}</a></h3>
<div class="pmeta">Stillet af ${esc(p.created_by)} · frist ${esc(shortDay(isoDay(p.deadline_ms)))} · vedtaget ved ${needed} stemmer for</div>
<div class="bar" role="img" aria-label="${esc(tally(p))}"><i class="y" style="width:${pct(n("for"))}"></i><i class="n" style="width:${pct(n("imod"))}"></i><i class="a" style="width:${pct(n("undlader"))}"></i></div>
<div class="pmeta">${esc(tally(p))}</div>
${who ? `<form method="post" action="${base}/afstemninger/stem" class="acts"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="back" value="forside">
${VOTES.map(v => `<button name="vote" value="${v}" class="${mine === v ? "" : "ghost"}" aria-pressed="${mine === v}">${v === "for" ? "Stem for" : v === "imod" ? "Stem imod" : "Undlad at stemme"}</button>`).join("")}</form>` : ""}</article>`;
  };
  return `<section class="panel votes-panel" id="forslag"><header><h2>Forslag til afstemning<span class="count">${open.length}</span></h2><p>Stem her - eller læs hele forslaget under Beslutninger.</p></header>
${open.map(item).join("")}<a class="more" href="${base}/beslutninger#nyt">Stil et nyt forslag →</a></section>`;
}

/** On the to-do and the front page: "Stem om …". */
export const voteTodo = (base: string, p: Proposal) => `<li><a href="${base}/beslutninger#p${p.id}"><strong>Stem om: ${esc(p.title)}</strong></a><span class="ctx">Forslag fra ${esc(p.created_by)} · frist ${esc(shortDay(isoDay(p.deadline_ms)))}</span></li>`;
