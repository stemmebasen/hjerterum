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
/** Requested: "vælge om man ønsker digital afstemning eller afstemning på næste møde": 'digital' is voted on the page; 'moede' is voted at the next meeting. */
export type Mode = "digital" | "moede";
export type Proposal = { id: number; title: string; text: string; created_by: string; members: number; mode: Mode; status: "open" | "adopted" | "rejected" | "withdrawn"; deadline_ms: number; decided_at_ms: number | null; created_at_ms: number };
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
  // A proposal for the next meeting is not counted here: the meeting decides it (decideAtMeeting).
  if (p.status !== "open" || p.mode === "moede") return;
  const result = outcome(p, await ballotsOf(db, p.id), nowMs);
  if (result !== "open") await db.prepare("UPDATE board_proposals SET status = ?, decided_at_ms = ? WHERE id = ? AND status = 'open'").bind(result, nowMs, p.id).run();
}

/** Closes the open proposals whose deadline has passed. */
export async function settleDue(db: D1Database, nowMs: number): Promise<void> {
  const due = (await db.prepare("SELECT * FROM board_proposals WHERE status = 'open' AND mode = 'digital' AND deadline_ms <= ?").bind(nowMs).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
  for (const p of due) await settle(db, p, nowMs);
}

export async function createProposal(db: D1Database, input: { title: string; text: string; days: number; who: string; members: number; mode?: string }, nowMs: number): Promise<number | null> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return null;
  const days = Number.isInteger(input.days) && input.days >= 1 && input.days <= 30 ? input.days : 7;
  const mode: Mode = input.mode === "moede" ? "moede" : "digital";
  // A proposal for the next meeting has no deadline of its own - the column wants a value, and nothing reads it for 'moede'.
  const result = await db.prepare("INSERT INTO board_proposals (title, text, created_by, members, mode, deadline_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(title, input.text.trim().slice(0, 4000), input.who, Math.max(1, input.members), mode, nowMs + (mode === "moede" ? 90 : days) * DAY, nowMs).run();
  return Number(result.meta?.last_row_id);
}

/** A board member's vote; changed while the proposal is open. False when it is decided or unknown. */
export async function castVote(db: D1Database, id: number, voter: string, vote: Vote, nowMs: number): Promise<boolean> {
  const p = await db.prepare("SELECT * FROM board_proposals WHERE id = ?").bind(id).first<Proposal>();
  if (!p || p.mode === "moede" || !VOTES.includes(vote)) return false;
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

/** A proposal for the next meeting: a board member notes the outcome once the meeting has voted. False when it is not open, not for a meeting, or unknown. */
export async function decideAtMeeting(db: D1Database, id: number, result: "adopted" | "rejected", nowMs: number): Promise<boolean> {
  if (result !== "adopted" && result !== "rejected") return false;
  const done = await db.prepare("UPDATE board_proposals SET status = ?, decided_at_ms = ? WHERE id = ? AND mode = 'moede' AND status = 'open'").bind(result, nowMs, id).run();
  return Number(done.meta?.changes ?? 0) === 1;
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
  return (await db.prepare(`SELECT p.* FROM board_proposals p WHERE p.status = 'open' AND p.mode = 'digital' AND NOT EXISTS (SELECT 1 FROM board_votes v WHERE v.proposal_id = p.id AND v.voter = ?)
    ORDER BY p.deadline_ms`).bind(who).all<Proposal>().catch(() => ({ results: [] as Proposal[] }))).results ?? [];
}

/** Adopted proposals, as decisions. */
export async function voteDecisions(db: D1Database): Promise<Decision[]> {
  const rows = (await db.prepare("SELECT id, title, mode, decided_at_ms FROM board_proposals WHERE status = 'adopted' ORDER BY decided_at_ms DESC LIMIT 200")
    .all<{ id: number; title: string; mode: Mode; decided_at_ms: number }>().catch(() => ({ results: [] as Array<{ id: number; title: string; mode: Mode; decided_at_ms: number }> }))).results ?? [];
  return rows.map(r => ({ text: r.title, date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(r.decided_at_ms), topic: "", source: "afstemning" as const, minutesId: null, voteId: r.id, atMeeting: r.mode === "moede" }));
}

/** For Saga: the open proposals and the latest outcomes. A proposal for the next meeting is marked AFSTEMNING PÅ NÆSTE MØDE - the agenda suggestion puts it on the agenda. */
export async function votesForSaga(db: D1Database, nowMs: number): Promise<string> {
  const list = await proposals(db, nowMs).catch(() => [] as ProposalView[]);
  return list.slice(0, 20).map(p => p.mode === "moede" && p.status === "open"
    ? `- ${p.title} (forslag fra ${p.created_by}): AFSTEMNING PÅ NÆSTE MØDE - skal på dagsordenen til næste møde${p.text ? `; begrundelse: ${p.text.replace(/\s+/g, " ").slice(0, 300)}` : ""}`
    : `- ${p.title} (forslag fra ${p.created_by}): ${STATUS[p.status]}${p.status === "open" ? `, frist ${shortDay(isoDay(p.deadline_ms))}` : ""}; ${tally(p)}${p.discuss.length ? `; ØNSKES DRØFTET PÅ ET MØDE af ${p.discuss.join(", ")}` : ""}`).join("\n") || "(ingen)";
}

// ---- Pages ----

const STATUS: Record<Proposal["status"], string> = { open: "Til afstemning", adopted: "Godkendt", rejected: "Ikke vedtaget", withdrawn: "Trukket tilbage" };
const MEETING_STATE = "Til næste møde";
const isoDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const tally = (p: ProposalView) => { const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length; return `${n("for")} for, ${n("imod")} imod, ${n("undlader")} undlader sig af ${p.members}`; };

/** Requested: "Du må gerne få det til at se lidt højtideligt ud, når et forslag er stemt ind. Start et forslag enten med et badge eller en laurbær." A laurel wreath in gold
 * around a check mark, drawn from leaves along a circle (two branches, mirrored); the colour is `--gold` (APPROVED_STYLE). */
export function laurel(size = 56): string {
  const leaves: string[] = [];
  const leaf = (x: number, y: number, deg: number) => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.5" ry="8.4" transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (112 + 148 * (i / 7)) * Math.PI / 180, x = 50 + 35 * Math.cos(a), y = 53 + 35 * Math.sin(a), deg = a * 180 / Math.PI - 22;
    leaves.push(leaf(x, y, deg), leaf(100 - x, y, -deg));
  }
  return `<svg class="laurel" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g fill="currentColor" opacity=".92">${leaves.join("")}</g>
<path d="M35 53l10.5 11.5L66 41" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** The seal on an adopted proposal (also on Beslutninger): a gold badge. */
export const APPROVED_BADGE = `<span class="approved-badge"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>GODKENDT</span>`;
export const APPROVED_STYLE = `
:root{--gold:#a8741a;--gold-ink:#2b1d05;--gold-soft:#f6ecd2}@media (prefers-color-scheme:dark){:root{--gold:#e3bb5e;--gold-ink:#2b1d05;--gold-soft:#2c2412}}
.approved-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;letter-spacing:.1em;padding:4px 11px 4px 9px;border-radius:999px;
color:var(--gold-ink);background:linear-gradient(135deg,#f0cf7a,#d6a63c);box-shadow:0 2px 10px rgb(168 116 26 / .3),inset 0 1px 0 rgb(255 255 255 / .45);margin-right:9px;vertical-align:2px;white-space:nowrap}
/* A proposal that has been voted in: a laurel in gold, a gold-edged card, the title in a firm hand. */
.prop.adopted{grid-template-columns:auto minmax(0,1fr);column-gap:18px;align-items:start;padding:20px 22px;margin:12px 0;border:1px solid color-mix(in srgb,var(--gold) 50%,var(--line));border-radius:18px;
background:linear-gradient(180deg,color-mix(in srgb,var(--gold) 11%,var(--card)),var(--card) 70%);box-shadow:0 1px 0 color-mix(in srgb,#fff 40%,transparent) inset}
.prop.adopted:first-child{padding-top:20px}.prop.adopted .seal{color:var(--gold);padding-top:2px}.prop.adopted .pbody{display:grid;gap:8px;min-width:0}
.prop.adopted .approved-badge{justify-self:start;margin-right:0}
.prop.adopted .ribbon{font-size:11.5px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.prop.adopted h3{font-size:19px}.prop.adopted .bar .y{background:var(--gold)}
.adopted-panel{border-color:color-mix(in srgb,var(--gold) 50%,var(--line));background:linear-gradient(180deg,color-mix(in srgb,var(--gold) 12%,var(--card)),var(--card) 80%)}.adopted-panel h2{color:var(--gold)}
.adopted-panel .prop.adopted{border:0;background:none;box-shadow:none;border-radius:0;padding:10px 0 4px;margin:0}.adopted-panel .prop.adopted h3 a{color:var(--ink);text-decoration:none}.adopted-panel .prop.adopted h3 a:hover{color:var(--gold)}
@media (max-width:520px){.prop.adopted{grid-template-columns:1fr;row-gap:6px}.prop.adopted .seal svg{width:46px;height:46px}}
/* Requested: "Laurbær designet skal også vises på historiske beslutninger": every decision on the list wears the laurel - a vote also the gold badge. */
.dec{display:flex;gap:12px;align-items:flex-start}.dec .seal{flex:none;color:var(--gold);padding-top:1px}.dec .seal svg{display:block}.dec .said{min-width:0}`;

export const VOTES_STYLE = `
.prop{border-top:1px solid var(--line);padding:16px 0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.prop h3{overflow-wrap:anywhere}.prop:first-child{border-top:0;padding-top:4px}.prop h3{margin:0;font-size:17px;font-weight:650;line-height:1.35;letter-spacing:-.01em;text-transform:none;color:var(--ink)}
.prop .state{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-right:8px;vertical-align:2px}
.prop .state.adopted{background:#e6f4ea;color:#1e6b35}.prop .state.rejected,.prop .state.withdrawn{background:var(--soft);color:var(--muted)}
.prop .bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;display:flex}.prop .bar i{display:block;height:100%}.prop .bar .y{background:var(--accent)}.prop .bar .n{background:#a16207}.prop .bar .a{background:var(--line)}
.prop .acts{display:flex;gap:8px;flex-wrap:wrap}.prop .acts button[aria-pressed="true"]{outline:2px solid var(--accent);outline-offset:2px}.prop .who,.prop .pmeta{font-size:13px;color:var(--muted)}
.prop .talk{display:inline-flex;align-items:center;gap:6px;width:fit-content;font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:#fdf3e1;color:#8a5a00}
.newprop{display:grid;gap:10px}.newprop label{display:grid;gap:4px}
.prop .state.meeting{background:var(--soft);color:var(--ink)}.prop .notevote{font-size:13px;color:var(--muted)}
.newprop fieldset{border:0;margin:0;padding:0;display:grid;gap:8px}.newprop legend{padding:0;margin:0 0 6px;font-size:13px;font-weight:650;color:var(--ink)}
.newprop .choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);cursor:pointer}
.newprop .choice input{appearance:auto;-webkit-appearance:radio;width:18px;height:18px;min-height:0;padding:0;margin:2px 0 0;border:0;background:none;box-shadow:none;accent-color:var(--accent)}.newprop .choice b{font-weight:650;color:var(--ink)}.newprop .choice span{grid-column:2;font-size:12.5px;color:var(--muted)}
.newprop .choice:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
.newprop:has(input[value="moede"]:checked) :is(.deadline,.digital-only){display:none}
/* Requested: "Der, hvor man skriver forslag, skal være lidt tydeligere på siden. Den skal i hvert fald ikke ligge i bunden." and "forslaget skal fremgå på alles forside,
   eventuelt i en lidt anden farve, som dog passer til farveskemaet": the form is first on Beslutninger, and the open proposals are in an accent-tinted card on the front page. */
.votes-panel{background:color-mix(in srgb,var(--accent) 7%,var(--card));border-color:color-mix(in srgb,var(--accent) 32%,var(--line))}
.votes-panel h2{color:var(--accent)}
.newprop .row{display:grid;gap:12px;grid-template-columns:1fr auto;align-items:end}.newprop .row p{margin:0}.newprop .go{padding-inline:28px}
/* Requested: "\"Opret forslag\" fylder for meget nu. Kan den være en fold-ud bjælke i højre side?": a tab on the right edge of the page that folds the form out over it. */
.drawer{position:fixed;top:150px;right:0;z-index:40;display:flex;align-items:flex-start;pointer-events:none;max-width:100vw}
.drawer>*{pointer-events:auto}
.drawer .tab{writing-mode:vertical-rl;transform:rotate(180deg);display:inline-flex;align-items:center;gap:8px;margin:0;padding:18px 11px;border:0;border-radius:0 12px 12px 0;background:var(--accent);color:var(--accent-ink);
font:inherit;font-size:13.5px;font-weight:700;letter-spacing:.04em;cursor:pointer;box-shadow:-3px 4px 18px rgb(0 0 0 / .18)}
.drawer .tab:hover{filter:brightness(1.07)}.drawer .tab i{font-style:normal;font-size:17px;line-height:1;transform:rotate(180deg);transition:transform .25s}
.drawer.open .tab i{transform:rotate(225deg)}
.drawer .panel{width:min(380px,calc(100vw - 52px));max-height:calc(100vh - 150px - 24px);overflow:auto;box-sizing:border-box;padding:20px 20px 18px;background:var(--card);color:var(--ink);
border:1px solid color-mix(in srgb,var(--accent) 32%,var(--line));border-right:0;border-radius:16px 0 0 16px;box-shadow:-8px 10px 34px rgb(0 0 0 / .22);
transition:transform .28s ease,opacity .2s;transform-origin:right center}
.drawer:not(.open) .panel{display:none}
.drawer textarea{min-height:64px}.drawer .panel h2{margin:0 0 4px;font-size:18px;color:var(--accent)}.drawer .panel .lead{margin:0 0 14px;font-size:13.5px;color:var(--muted)}
.drawer .panel .row{grid-template-columns:1fr}.drawer .panel .go{width:100%}
@media (prefers-reduced-motion:no-preference){.drawer.open .panel{animation:drawer-in .28s ease}@keyframes drawer-in{from{transform:translateX(40px);opacity:0}}}
@media (max-width:620px){.newprop .row{grid-template-columns:1fr}.drawer{top:30vh}.drawer.open{top:76px}.drawer .panel{max-height:calc(100vh - 76px - 90px)}}
@media print{.drawer{display:none}}
.votes-panel .count{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--accent);margin-left:8px;vertical-align:3px}
.votes-panel .prop{border-top:1px solid color-mix(in srgb,var(--accent) 22%,var(--line))}.votes-panel .prop h3 a{color:var(--ink);text-decoration:none}.votes-panel .prop h3 a:hover{color:var(--accent)}
.votes-panel .prop .state.todo{background:var(--accent);color:var(--accent-ink)}
@media (prefers-color-scheme:dark){.prop .state.adopted{background:#163824;color:#8fd6a5}.prop .talk{background:#3a2c10;color:#f3c66b}}
${APPROVED_STYLE}`;

const isMeeting = (p: Pick<Proposal, "mode">) => p.mode === "moede";
const meetingDay = (nextMeeting: string | null | undefined) => nextMeeting ? ` (${shortDay(nextMeeting)})` : "";

function proposalHtml(base: string, p: ProposalView, who: string | null, nextMeeting?: string | null): string {
  const mine = who ? p.ballots.find(b => b.voter === who)?.vote : undefined;
  const n = (v: Vote) => p.ballots.filter(b => b.vote === v).length, pct = (k: number) => `${Math.round(100 * k / p.members)}%`;
  const needed = Math.floor(p.members / 2) + 1;
  const talk = !!who && p.discuss.includes(who);
  const talkButton = `<button name="discuss" value="1" class="ghost" formaction="${base}/afstemninger/droeft" aria-pressed="${talk}">${talk ? "Fortryd: drøft på et møde" : "Jeg ønsker at drøfte dette på et møde"}</button>`;
  // Requested: "Giv det et flot badge \"GODKENDT\" ved godkendelse".
  const adopted = p.status === "adopted", meeting = isMeeting(p);
  const label = p.status === "open" && meeting ? `<span class="state meeting">${MEETING_STATE}</span>` : `<span class="state ${p.status}">${STATUS[p.status]}</span>`;
  const made = `Stillet af ${esc(p.created_by)} ${esc(shortDay(isoDay(p.created_at_ms)))}`;
  // Requested: "vælge om man ønsker digital afstemning eller afstemning på næste møde": a proposal for the meeting has no ballots here - the meeting decides, and a board member notes how.
  const facts = meeting
    ? `<div class="who">${made}${p.status === "open" ? ` · stemmes om på næste møde${esc(meetingDay(nextMeeting))} - Saga sætter det på dagsordenen` : p.decided_at_ms ? ` · ${p.status === "withdrawn" ? "trukket tilbage" : adopted ? "vedtaget på mødet" : "ikke vedtaget på mødet"} ${esc(shortDay(isoDay(p.decided_at_ms)))}` : ""}</div>`
    : `<div class="who">${made}${p.status === "open" ? ` · frist ${esc(shortDay(isoDay(p.deadline_ms)))} · vedtaget ved ${needed} stemmer for` : p.decided_at_ms ? ` · afgjort ${esc(shortDay(isoDay(p.decided_at_ms)))}` : ""}</div>
<div class="bar" role="img" aria-label="${esc(tally(p))}"><i class="y" style="width:${pct(n("for"))}"></i><i class="n" style="width:${pct(n("imod"))}"></i><i class="a" style="width:${pct(n("undlader"))}"></i></div>
${p.discuss.length ? `<div class="talk">💬 Ønskes drøftet på et møde af ${esc(p.discuss.map(n => n.split(/\s+/)[0]!).join(", "))}</div>` : ""}
<div class="who">${esc(tally(p))}${p.ballots.length ? ` · ${p.ballots.map(b => `${esc(b.voter.split(/\s+/)[0]!)}: ${b.vote}`).join(", ")}` : ""}</div>`;
  const withdraw = p.created_by === who ? `<button name="withdraw" value="1" class="ghost" formaction="${base}/afstemninger/tilbage">Træk forslaget tilbage</button>` : "";
  const actions = !who ? ""
    : p.status === "open" && meeting ? `<form method="post" action="${base}/afstemninger/moede" class="acts"><input type="hidden" name="id" value="${p.id}">
<span class="notevote">Når mødet har stemt:</span><button name="result" value="adopted" onclick="return confirm('Notér forslaget som vedtaget på mødet?')">Vedtaget på mødet</button><button name="result" value="rejected" class="ghost" onclick="return confirm('Notér forslaget som ikke vedtaget på mødet?')">Ikke vedtaget</button>${withdraw}</form>`
    : p.status === "open" ? `<form method="post" action="${base}/afstemninger/stem" class="acts"><input type="hidden" name="id" value="${p.id}">
${VOTES.map(v => `<button name="vote" value="${v}" class="${mine === v ? "" : "ghost"}" aria-pressed="${mine === v}">${v === "for" ? "Stem for" : v === "imod" ? "Stem imod" : "Undlad at stemme"}</button>`).join("")}
${talkButton}${withdraw}</form>${mine ? `<div class="who">Du har stemt ${mine}. Du kan ændre din stemme, indtil forslaget er afgjort.</div>` : ""}`
    : (p.status === "adopted" || p.status === "rejected") && !meeting ? `<form method="post" action="${base}/afstemninger/droeft" class="acts"><input type="hidden" name="id" value="${p.id}">${talkButton}</form>` : "";
  const body = `${adopted ? `<h3>${esc(p.title)}</h3>` : `<h3>${label}${esc(p.title)}</h3>`}
${p.text ? `<p style="margin:0;white-space:pre-wrap">${esc(p.text)}</p>` : ""}
${facts}
${actions}`;
  return adopted ? `<article class="prop adopted" id="p${p.id}"><div class="seal">${laurel(64)}</div><div class="pbody">${APPROVED_BADGE}${body}</div></article>` : `<article class="prop" id="p${p.id}">${body}</article>`;
}

const DRAWER_SCRIPT = `<script>(()=>{const d=document.getElementById("nyt"),b=d&&d.querySelector(".tab");if(!d||!b)return;
const set=o=>{d.classList.toggle("open",o);b.setAttribute("aria-expanded",String(o));if(o)setTimeout(()=>{const f=d.querySelector("input[name=title]");f&&f.focus({preventScroll:true})},60)};
b.addEventListener("click",()=>set(!d.classList.contains("open")));
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest('a[href$="#nyt"]');if(a)set(true)});
document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false)});
if(location.hash==="#nyt")set(true)})()</script>`;

/** Requested: "Beslutninger og Afstemninger skal merges" - the votes are part of the page Beslutninger (page.ts decisionsPage):
 * the open proposals first, the board's decisions, a new proposal, and the decided votes folded away.
 * Requested: "'Opret forslag' fylder for meget nu. Kan den være en fold-ud bjælke i højre side?" - `create` is a tab on the right edge that folds the form out. */
export type VoteBlocks = { intro: string; open: string; create: string; closed: string };
export function voteBlocks(base: string, data: { list: ProposalView[]; who: string | null; members: number; nowMs?: number; nextMeeting?: string | null }): VoteBlocks {
  const now = data.nowMs ?? Date.now();
  const open = data.list.filter(p => p.status === "open" && !isMeeting(p)), forMeeting = data.list.filter(p => p.status === "open" && isMeeting(p));
  // What was voted in during the last week stands open in a gold-edged card; the rest of the decided votes are folded away.
  const fresh = data.list.filter(p => p.status === "adopted" && p.decided_at_ms !== null && now - p.decided_at_ms <= 7 * DAY);
  const closed = data.list.filter(p => p.status !== "open" && !fresh.includes(p));
  const needed = Math.floor(Math.max(1, data.members) / 2) + 1;
  const card = (p: ProposalView) => proposalHtml(base, p, data.who, data.nextMeeting);
  return {
    intro: `Et forslag er vedtaget ved flertal: mindst ${needed} af ${data.members || "bestyrelsens"} stemmer for.`,
    open: `${open.length ? `<div class="card" id="afstemning"><h2>Til afstemning <span class="pill">${open.length}</span></h2>${open.map(card).join("")}</div>` : ""}${forMeeting.length
      ? `<div class="card" id="moede"><h2>Til næste møde <span class="pill">${forMeeting.length}</span></h2><p class="small muted" style="margin:-6px 0 6px">Forslag, der stemmes om på det næste bestyrelsesmøde${esc(meetingDay(data.nextMeeting))}. Saga foreslår dem som punkter på dagsordenen.</p>${forMeeting.map(card).join("")}</div>` : ""}${fresh.length
      ? `<div class="card adopted-panel" id="vedtaget"><h2>Vedtaget den seneste uge</h2>${fresh.map(card).join("")}</div>` : ""}`,
    create: `<aside class="drawer" id="nyt" aria-label="Opret forslag"><button type="button" class="tab" aria-expanded="false" aria-controls="nyt-panel"><i aria-hidden="true">+</i>Opret forslag</button>
<div class="panel" id="nyt-panel"><h2>Opret forslag</h2>${data.who ? `<p class="lead">Det står på alles forside og to-do - eller på næste dagsorden.</p><form class="newprop" method="post" action="${base}/afstemninger/ny">
<label>Forslag<input name="title" required maxlength="200" placeholder="Fx Vi åbner salen om søndagen"></label>
<label>Begrundelse (valgfri)<textarea name="text" rows="2" maxlength="4000"></textarea></label>
<fieldset><legend>Hvordan skal der stemmes?</legend>
<label class="choice"><input type="radio" name="mode" value="digital" checked><b>Digital afstemning</b><span>Bestyrelsen stemmer her. Vedtaget ved flertal.</span></label>
<label class="choice"><input type="radio" name="mode" value="moede"><b>På næste møde</b><span>${data.nextMeeting ? `Saga foreslår det som punkt på dagsordenen til mødet ${esc(shortDay(data.nextMeeting))}.` : "Saga foreslår det som punkt på næste dagsorden."}</span></label></fieldset>
<label class="deadline">Frist for afstemningen<select name="days"><option value="3">3 dage</option><option value="7" selected>7 dage</option><option value="14">14 dage</option></select></label>
<p style="margin:0"><button class="go">Stil forslaget</button></p>
<p class="small muted digital-only" style="margin:0">Vil nogen hellere tage et digitalt forslag op på et møde, kan de trykke <em>Jeg ønsker at drøfte dette på et møde</em> - afstemningen fortsætter, og Saga sætter forslaget på sit forslag til næste dagsorden.</p></form>` : `<p class="muted"><a href="${base}/hvem">Vælg hvem du er</a> for at stille et forslag.</p>`}</div></aside>
<noscript><style>.drawer:not(.open) .panel{display:block}</style></noscript>${DRAWER_SCRIPT}`,
    closed: closed.length ? `<div class="card"><details><summary><h2 style="display:inline">Afgjorte afstemninger (${closed.length})</h2></summary>${closed.map(card).join("")}</details></div>` : ""
  };
}

/** Requested: "forslaget skal fremgå på alles forside, eventuelt i en lidt anden farve, som dog passer til farveskemaet": every open proposal on every member's front page, in a card
 * tinted with the accent, with the count so far and the vote buttons (a vote from here comes back here). Nothing when no proposal is open.
 * A proposal for the next meeting has no buttons: it stands in a card of its own, "Til næste møde". */
export function frontVotes(base: string, list: ProposalView[], who: string | null, nowMs: number = Date.now(), nextMeeting?: string | null): string {
  const open = list.filter(p => p.status === "open" && !isMeeting(p)), forMeeting = list.filter(p => p.status === "open" && isMeeting(p));
  // Requested: "Du må gerne få det til at se lidt højtideligt ud, når et forslag er stemt ind": for a week, what the board has voted in stands in a gold-edged card with a laurel.
  const fresh = list.filter(p => p.status === "adopted" && p.decided_at_ms !== null && nowMs - p.decided_at_ms <= 7 * DAY);
  const adoptedCard = fresh.length ? `<section class="panel adopted-panel" id="vedtaget"><header><h2>Vedtaget</h2><p>Stemt ind af bestyrelsen den seneste uge.</p></header>
${fresh.map(p => `<article class="prop adopted" id="v${p.id}"><div class="seal">${laurel(64)}</div><div class="pbody">${APPROVED_BADGE}<h3><a href="${base}/beslutninger#p${p.id}">${esc(p.title)}</a></h3>
<div class="pmeta">${isMeeting(p) ? `Vedtaget på mødet ${esc(shortDay(isoDay(p.decided_at_ms!)))}` : `Vedtaget ${esc(shortDay(isoDay(p.decided_at_ms!)))} · ${esc(tally(p))}`}</div></div></article>`).join("")}</section>` : "";
  const meetingCard = forMeeting.length ? `<section class="panel votes-panel" id="moede"><header><h2>Til næste møde<span class="count">${forMeeting.length}</span></h2><p>Stemmes om på det næste bestyrelsesmøde${esc(meetingDay(nextMeeting))} - Saga sætter dem på dagsordenen.</p></header>
${forMeeting.map(p => `<article class="prop" id="m${p.id}"><h3><span class="state meeting">${MEETING_STATE}</span><a href="${base}/beslutninger#p${p.id}">${esc(p.title)}</a></h3><div class="pmeta">Stillet af ${esc(p.created_by)}</div></article>`).join("")}</section>` : "";
  if (!open.length) return `${adoptedCard}${meetingCard}`;
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
  return `${adoptedCard}<section class="panel votes-panel" id="forslag"><header><h2>Forslag til afstemning<span class="count">${open.length}</span></h2><p>Stem her - eller læs hele forslaget under Beslutninger.</p></header>
${open.map(item).join("")}<a class="more" href="${base}/beslutninger#nyt">Stil et nyt forslag →</a></section>${meetingCard}`;
}

/** On the to-do and the front page: "Stem om …". */
export const voteTodo = (base: string, p: Proposal) => `<li><a href="${base}/beslutninger#p${p.id}"><strong>Stem om: ${esc(p.title)}</strong></a><span class="ctx">Forslag fra ${esc(p.created_by)} · frist ${esc(shortDay(isoDay(p.deadline_ms)))}</span></li>`;
