import type { D1Database } from "../db.js";
import { addAgendaPoints, meetings, nextTeamMeeting } from "./data.js";
import { esc, layout, shortDay } from "./page.js";
import type { ProposalView } from "./votes.js";

/** Requested (Gitta, via the chair: "Ja"): "et slags åbent fora næsten som en opslagstavle for bestyrelsen ... hvor vi lige kan tage et emne op eller
 * hurtige beslutninger sammen. Stille noget op til 'afstemning/afklaring/beslutning' som ikke behøver være til et møde. Så kun det vigtigste når med til mødet."
 * Three kinds on one board: an Afklaring (a question the others answer in a short thread, closed online with what was settled), Til orientering (something
 * the others should know - each marks it seen), and the votes, which stay where they are (Beslutninger) and are shown here. "Til mødet" puts a post on the
 * next team meeting's agenda as the asker's own point; nothing else reaches the meeting. */
export type PostKind = "afklaring" | "orientering";
export type Post = { id: number; kind: PostKind; title: string; text: string; created_by: string; created_at_ms: number; status: "open" | "closed"; outcome: string | null;
  closed_by: string | null; closed_at_ms: number | null; for_meeting_by: string | null; meeting_id: number | null };
export type Reply = { id: number; post_id: number; author: string; text: string; created_at_ms: number };
export type PostView = Post & { replies: Reply[]; seen: string[] };

const DAY = 86_400_000;
const clean = (text: string, max: number) => text.replace(/\r/g, "").trim().slice(0, max);

export async function createPost(db: D1Database, input: { kind: string; title: string; text: string; who: string; forMeeting?: boolean }, nowMs: number): Promise<number | null> {
  const kind: PostKind = input.kind === "orientering" ? "orientering" : "afklaring";
  const title = clean(input.title, 200).replace(/\s+/g, " ");
  if (!title || !input.who) return null;
  const result = await db.prepare("INSERT INTO board_posts (kind, title, text, created_by, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(kind, title, clean(input.text, 4000), input.who, nowMs).run();
  const id = Number(result.meta?.last_row_id);
  if (input.forMeeting) await toMeeting(db, id, input.who, nowMs);
  return id;
}

export async function reply(db: D1Database, id: number, who: string, text: string, nowMs: number): Promise<boolean> {
  const body = clean(text, 2000);
  const post = await db.prepare("SELECT status FROM board_posts WHERE id = ?").bind(id).first<{ status: string }>();
  if (!post || !body || !who) return false;
  await db.prepare("INSERT INTO board_post_replies (post_id, author, text, created_at_ms) VALUES (?, ?, ?, ?)").bind(id, who, body, nowMs).run();
  return true;
}

/** Closed online - an Afklaring with what was settled. Reopened by closing it again with open = true. */
export async function closePost(db: D1Database, id: number, who: string, outcome: string, nowMs: number, open = false): Promise<boolean> {
  const done = open
    ? await db.prepare("UPDATE board_posts SET status = 'open', outcome = NULL, closed_by = NULL, closed_at_ms = NULL WHERE id = ?").bind(id).run()
    : await db.prepare("UPDATE board_posts SET status = 'closed', outcome = ?, closed_by = ?, closed_at_ms = ? WHERE id = ? AND status = 'open'").bind(clean(outcome, 400) || null, who, nowMs, id).run();
  return Number(done.meta?.changes ?? 0) === 1;
}

export async function markSeen(db: D1Database, id: number, who: string, nowMs: number): Promise<void> {
  if (!who) return;
  await db.prepare("INSERT OR IGNORE INTO board_post_seen (post_id, member, seen_at_ms) VALUES (?, ?, ?)").bind(id, who, nowMs).run();
}

/** "Til mødet": on the next team meeting's agenda as the asker's own point, once. Without a planned team meeting, it waits for one (placePending). */
export async function toMeeting(db: D1Database, id: number, who: string, nowMs: number): Promise<"added" | "waiting" | null> {
  const post = await db.prepare("SELECT title, meeting_id FROM board_posts WHERE id = ?").bind(id).first<{ title: string; meeting_id: number | null }>();
  if (!post || !who) return null;
  await db.prepare("UPDATE board_posts SET for_meeting_by = COALESCE(for_meeting_by, ?) WHERE id = ?").bind(who, id).run();
  if (post.meeting_id) return "added";
  return await place(db, id, nowMs) ? "added" : "waiting";
}

async function place(db: D1Database, id: number, nowMs: number): Promise<boolean> {
  const post = await db.prepare("SELECT title, for_meeting_by FROM board_posts WHERE id = ? AND meeting_id IS NULL AND for_meeting_by IS NOT NULL").bind(id).first<{ title: string; for_meeting_by: string }>();
  if (!post) return false;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nowMs);
  const meeting = nextTeamMeeting(await meetings(db), today);
  if (!meeting) return false;
  const first = post.for_meeting_by.trim().split(/\s+/)[0] ?? post.for_meeting_by;
  await addAgendaPoints(db, meeting.id, [`${post.title} (fra opslagstavlen, ønsket af ${first})`], post.for_meeting_by, nowMs, false);
  await db.prepare("UPDATE board_posts SET meeting_id = ? WHERE id = ?").bind(meeting.id, id).run();
  return true;
}

/** In Saga's round: posts sent to the meeting before one was planned go on as soon as there is one. */
export async function placePending(db: D1Database, nowMs: number): Promise<number> {
  const rows = (await db.prepare("SELECT id FROM board_posts WHERE for_meeting_by IS NOT NULL AND meeting_id IS NULL AND status = 'open'").all<{ id: number }>().catch(() => ({ results: [] }))).results ?? [];
  let n = 0;
  for (const r of rows) if (await place(db, r.id, nowMs)) n++;
  return n;
}

export async function boardPosts(db: D1Database, nowMs: number): Promise<PostView[]> {
  const rows = (await db.prepare("SELECT * FROM board_posts WHERE status = 'open' OR closed_at_ms >= ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(closed_at_ms, created_at_ms) DESC LIMIT 80")
    .bind(nowMs - 60 * DAY).all<Post>().catch(() => ({ results: [] as Post[] }))).results ?? [];
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map(r => r.id));
  const [replies, seen] = await Promise.all([
    db.prepare("SELECT * FROM board_post_replies WHERE post_id IN (SELECT value FROM json_each(?)) ORDER BY created_at_ms").bind(ids).all<Reply>().then(r => r.results ?? []),
    db.prepare("SELECT post_id, member FROM board_post_seen WHERE post_id IN (SELECT value FROM json_each(?)) ORDER BY seen_at_ms").bind(ids).all<{ post_id: number; member: string }>().then(r => r.results ?? [])
  ]);
  return rows.map(r => ({ ...r, replies: replies.filter(x => x.post_id === r.id), seen: seen.filter(s => s.post_id === r.id).map(s => s.member) }));
}

/** For a member's to-do and Overblik: the open posts that wait on them - an Afklaring they have not answered, or an orientation they have not seen. */
export function waitingOn(posts: PostView[], who: string | null): PostView[] {
  if (!who) return [];
  return posts.filter(p => p.status === "open" && p.created_by !== who && (p.kind === "afklaring" ? !p.replies.some(r => r.author === who) : !p.seen.includes(who)));
}

/** A post that waits on a member, as a line on their to-do (Overblik and Opgaver). */
export const postTodo = (base: string, p: PostView): string => `<li><a href="${base}/opslag#o${p.id}"><strong>${p.kind === "afklaring" ? "Svar på" : "Læs"}: ${esc(p.title)}</strong></a><span class="ctx">Opslagstavlen · ${esc(p.created_by.trim().split(/\s+/)[0] ?? "")}</span></li>`;

/** For Saga: what is on the board now. */
export function postsForSaga(posts: PostView[]): string {
  const open = posts.filter(p => p.status === "open");
  if (!open.length) return "";
  return "OPSLAGSTAVLEN (åbne opslag):\n" + open.map(p => `- ${p.kind === "afklaring" ? "Afklaring" : "Til orientering"}: ${p.title} (${p.created_by})${p.for_meeting_by ? " [TIL MØDET]" : ""}${p.replies.length ? ` · ${p.replies.length} svar, senest ${p.replies[p.replies.length - 1]!.author}: ${p.replies[p.replies.length - 1]!.text.slice(0, 160)}` : ""}`).join("\n");
}

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const KIND: Record<PostKind, string> = { afklaring: "Afklaring", orientering: "Til orientering" };

function postCard(base: string, p: PostView, who: string | null, members: string[]): string {
  const meeting = p.meeting_id ? `<span class="tag meet">På dagsordenen</span>` : p.for_meeting_by ? `<span class="tag meet">Til mødet</span>` : "";
  const thread = p.replies.length ? `<ul class="plain thread">${p.replies.map(r => `<li><b>${esc(first(r.author))}</b> <span class="small muted">${esc(WHEN.format(r.created_at_ms))}</span><p>${esc(r.text)}</p></li>`).join("")}</ul>` : "";
  const seen = p.kind === "orientering" ? `<p class="small muted">Set af ${p.seen.length ? p.seen.map(first).map(esc).join(", ") : "ingen endnu"}${members.length ? ` (${p.seen.length} af ${members.length})` : ""}</p>` : "";
  const actions = who && p.status === "open" ? `<div class="post-actions">
${p.kind === "orientering" && !p.seen.includes(who) ? `<form method="post" action="${base}/opslag/${p.id}/set"><button class="ghost">Set</button></form>` : ""}
${!p.for_meeting_by ? `<form method="post" action="${base}/opslag/${p.id}/moede"><button class="ghost" title="Sæt det på dagsordenen til næste teammøde">Til mødet</button></form>` : ""}
<details class="close"><summary class="ghost">Luk</summary><form method="post" action="${base}/opslag/${p.id}/luk" class="stack"><input name="outcome" maxlength="400" placeholder="${p.kind === "afklaring" ? "Hvad blev afklaret? (valgfrit)" : "Bemærkning (valgfri)"}" aria-label="Hvad blev afklaret"><button>Luk opslaget</button></form></details></div>
<form method="post" action="${base}/opslag/${p.id}/svar" class="reply"><input name="text" required maxlength="2000" placeholder="${p.kind === "afklaring" ? "Dit svar …" : "Kommentar …"}" aria-label="Svar"><button>Svar</button></form>` : "";
  return `<article class="post ${p.kind}${p.status === "closed" ? " closed" : ""}" id="o${p.id}"><header><span class="tag">${KIND[p.kind]}</span>${meeting}<strong>${esc(p.title)}</strong>
<span class="small muted">${esc(first(p.created_by))} · ${esc(WHEN.format(p.created_at_ms))}</span></header>${p.text ? `<p>${esc(p.text)}</p>` : ""}${seen}${thread}
${p.status === "closed" ? `<p class="outcome">${p.outcome ? `<b>${p.kind === "afklaring" ? "Afklaret" : "Lukket"}:</b> ${esc(p.outcome)}` : "Lukket"} <span class="small muted">· ${esc(first(p.closed_by ?? ""))}</span>${who ? ` <form method="post" action="${base}/opslag/${p.id}/genaabn" class="inline"><button class="linkbtn">Genåbn</button></form>` : ""}</p>` : ""}${actions}</article>`;
}

export function boardPage(base: string, data: { posts: PostView[]; votes: ProposalView[]; who: string | null; members: string[]; notice: string }): string {
  const open = data.posts.filter(p => p.status === "open"), closed = data.posts.filter(p => p.status === "closed");
  const votes = data.votes.filter(v => v.status === "open");
  const form = data.who ? `<details class="card new-post"${open.length ? "" : " open"}><summary><h2>Nyt opslag</h2></summary><form method="post" action="${base}/opslag" class="stack">
<div class="kinds"><label class="pick"><input type="radio" name="kind" value="afklaring" checked> <b>Afklaring</b> <span class="muted small">et spørgsmål, de andre svarer på</span></label>
<label class="pick"><input type="radio" name="kind" value="orientering"> <b>Til orientering</b> <span class="muted small">noget, de andre skal vide</span></label>
<a class="pick" href="${base}/beslutninger#ny"><b>Afstemning</b> <span class="muted small">stem digitalt eller på mødet →</span></a></div>
<label>Overskrift<input name="title" required maxlength="200" placeholder="Fx Skal vi forlænge den gratis prøveperiode?"></label>
<label>Uddybning (valgfri)<textarea name="text" rows="3" maxlength="4000"></textarea></label>
<label class="pick"><input type="checkbox" name="moede" value="1"> Tag det også med til næste teammøde</label><div class="actions"><button>Slå op</button></div></form></details>` : `<p class="notice">Vælg hvem du er for at skrive på opslagstavlen.</p>`;
  const voteList = votes.length ? `<div class="card"><h2>Åbne afstemninger<span class="count">${votes.length}</span></h2><ul class="plain">${votes.map(v => `<li><a href="${base}/beslutninger#p${v.id}">${esc(v.title)}</a> <span class="small muted">${v.mode === "moede" ? "stemmes om på mødet" : `${v.ballots.length} af ${v.members} har stemt`}${data.who && v.mode === "digital" && !v.ballots.some(b => b.voter === data.who) ? " · mangler din stemme" : ""}</span></li>`).join("")}</ul></div>` : "";
  return layout(base, "Opslag", `<main class="board"><h1>Opslagstavlen</h1><p class="muted">Tag et emne op eller få noget afklaret uden at vente på et møde. Kun det, I sender "Til mødet", kommer på dagsordenen.</p>
${data.notice ? `<p class="notice good">${esc(data.notice)}</p>` : ""}${form}${voteList}
<h2>Åbne opslag${open.length ? `<span class="count">${open.length}</span>` : ""}</h2>${open.length ? open.map(p => postCard(base, p, data.who, data.members)).join("") : `<p class="muted">Ingen åbne opslag.</p>`}
${closed.length ? `<details class="fold"><summary>Lukkede opslag (${closed.length})</summary>${closed.map(p => postCard(base, p, data.who, data.members)).join("")}</details>` : ""}</main>`, { section: "/opslag", who: data.who, style: BOARD_STYLE });
}

export const BOARD_STYLE = `.board .post{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 14px;display:grid;gap:8px}
.board .post header{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.board .post header strong{font-size:17px;flex:1 1 260px}
.board .post p{margin:0;white-space:pre-wrap}.board .tag{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:var(--soft);border:1px solid var(--line)}
.board .post.orientering .tag:first-child{color:var(--accent)}.board .tag.meet{background:transparent}.board .post.closed{opacity:.75}
.board .thread{display:grid;gap:8px;border-left:2px solid var(--line);padding-left:12px}.board .thread p{margin:2px 0 0}
.board .post-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:start}.board .post-actions form{margin:0}.board details.close summary{list-style:none;cursor:pointer;padding:7px 14px;border:1px solid var(--line);border-radius:999px;font-size:14px}
.board details.close summary::-webkit-details-marker{display:none}.board details.close[open] form{margin-top:8px}
.board form.reply{display:flex;gap:8px}.board form.reply input{flex:1;min-width:0}.board .outcome{font-size:14px}.board form.inline{display:inline}
.board .new-post summary{list-style:none;cursor:pointer}.board .new-post summary::-webkit-details-marker{display:none}.board .new-post summary h2{margin:0}
.board .kinds{display:grid;gap:6px}.board .kinds .pick{display:flex;gap:8px;align-items:baseline;text-decoration:none;color:inherit}`;
