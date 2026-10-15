import type { D1Database } from "../db.js";
import { esc } from "./page.js";

/** Requested (Gitta, via the chair): "Vælge/klikke på et event, have en lille dropdown menu om hvad man godt kunne tænke sig der blev lavet: story, reel,
 * karrusel, andet? Bare en hurtig måde for jer og mig at se hvad I gerne vil have delt/opmærksomhed på. ... det her ville være helt forsimplet og konkret."
 * Every coming event in admin → Events has a small "PR-ønske": each board member ticks what they would like made; the list "PR-ønsker" shows Gitta
 * every wish for the coming events, who wished it, and lets her mark it made. */
export const PR_KINDS = [["story", "Story"], ["reel", "Reel"], ["karrusel", "Karrusel"], ["andet", "Andet"]] as const;
export type PrKind = typeof PR_KINDS[number][0];
export type PrWish = { event_id: string; kind: PrKind; wished_by: string[]; note: string | null; done_by: string | null; done_at_ms: number | null };
const isKind = (k: string): k is PrKind => PR_KINDS.some(([id]) => id === k);
const names = (raw: string): string[] => { try { const v = JSON.parse(raw) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

export async function prWishes(db: D1Database, eventIds: string[]): Promise<Map<string, PrWish[]>> {
  const out = new Map<string, PrWish[]>();
  if (!eventIds.length) return out;
  const rows = (await db.prepare("SELECT event_id, kind, wished_by, note, done_by, done_at_ms FROM event_pr_wishes WHERE event_id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(eventIds)).all<{ event_id: string; kind: PrKind; wished_by: string; note: string | null; done_by: string | null; done_at_ms: number | null }>().catch(() => ({ results: [] }))).results ?? [];
  for (const r of rows) {
    const w: PrWish = { ...r, wished_by: names(r.wished_by) };
    if (!w.wished_by.length) continue;
    out.set(r.event_id, [...(out.get(r.event_id) ?? []), w].sort((a, b) => PR_KINDS.findIndex(([k]) => k === a.kind) - PR_KINDS.findIndex(([k]) => k === b.kind)));
  }
  return out;
}

/** A member's ticks for one event: added where ticked, taken away where not (a kind nobody wishes any more is gone). */
export async function setPrWishes(db: D1Database, eventId: string, who: string, kinds: string[], note: string, nowMs: number): Promise<void> {
  if (!eventId || !who) return;
  const wanted = new Set(kinds.filter(isKind));
  const current = (await prWishes(db, [eventId])).get(eventId) ?? [];
  for (const [kind] of PR_KINDS) {
    const row = current.find(w => w.kind === kind);
    const had = row?.wished_by.includes(who) ?? false, wants = wanted.has(kind);
    const noteNow = kind === "andet" && wants ? note.trim().slice(0, 200) || row?.note || null : row?.note ?? null;
    if (had === wants && !(kind === "andet" && wants && noteNow !== (row?.note ?? null))) continue;
    const by = wants ? [...new Set([...(row?.wished_by ?? []), who])] : (row?.wished_by ?? []).filter(n => n !== who);
    if (!by.length) { await db.prepare("DELETE FROM event_pr_wishes WHERE event_id = ? AND kind = ?").bind(eventId, kind).run(); continue; }
    await db.prepare(`INSERT INTO event_pr_wishes (event_id, kind, wished_by, note, updated_at_ms) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id, kind) DO UPDATE SET wished_by = excluded.wished_by, note = excluded.note, updated_at_ms = excluded.updated_at_ms`)
      .bind(eventId, kind, JSON.stringify(by), noteNow, nowMs).run();
  }
}

/** Made (or not made after all): who marked it and when. */
export async function markPrDone(db: D1Database, eventId: string, kind: string, who: string, done: boolean, nowMs: number): Promise<void> {
  if (!isKind(kind) || !who) return;
  await db.prepare("UPDATE event_pr_wishes SET done_by = ?, done_at_ms = ? WHERE event_id = ? AND kind = ?").bind(done ? who : null, done ? nowMs : null, eventId, kind).run();
}

const label = (k: PrKind) => PR_KINDS.find(([id]) => id === k)![1];
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The small form on an event card: a member's own ticks, and what the others wished. */
export function prPicker(base: string, eventId: string, wishes: PrWish[], who: string | null): string {
  if (!who) return "";
  const mine = new Set(wishes.filter(w => w.wished_by.includes(who)).map(w => w.kind));
  const note = wishes.find(w => w.kind === "andet")?.note ?? "";
  const summary = wishes.length ? wishes.map(w => `<span class="pr-chip${w.done_at_ms ? " done" : ""}">${label(w.kind)} · ${w.wished_by.map(first).map(esc).join(", ")}</span>`).join("") : `<span class="muted">PR-ønske</span>`;
  return `<details class="pr"><summary>${summary}</summary><form method="post" action="${base}/arrangementer/pr"><input type="hidden" name="event" value="${esc(eventId)}">
${PR_KINDS.map(([id, name]) => `<label class="pick"><input type="checkbox" name="kind" value="${id}"${mine.has(id) ? " checked" : ""}> ${name}</label>`).join("")}
<input name="note" maxlength="200" value="${esc(note)}" placeholder="Andet: hvad?" aria-label="Andet: hvad?"><button>Gem</button></form></details>`;
}

/** Gitta's list: every wish for the coming events, earliest event first, with "Lavet". */
export function prWishList(base: string, events: Array<{ id: string; title: string; starts_at_ms: number }>, wishes: Map<string, PrWish[]>, who: string | null): string {
  const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "numeric", month: "short" });
  const rows = events.filter(e => wishes.has(e.id));
  if (!rows.length) return `<div class="card pr-list" id="pr"><h2>PR-ønsker</h2><p class="muted small">Ingen ønsker endnu. Tryk "PR-ønske" på et kommende event, og kryds af, hvad du gerne vil have lavet: story, reel, karrusel eller andet.</p></div>`;
  return `<div class="card pr-list" id="pr"><h2>PR-ønsker<span class="count">${rows.length} ${rows.length === 1 ? "event" : "events"}</span></h2><ul class="plain">${rows.map(e => `<li><span class="small muted">${esc(DAY.format(e.starts_at_ms))}</span><strong>${esc(e.title)}</strong>
<div class="pr-kinds">${wishes.get(e.id)!.map(w => `<form method="post" action="${base}/arrangementer/pr/lavet" class="pr-kind${w.done_at_ms ? " done" : ""}"><input type="hidden" name="event" value="${esc(e.id)}"><input type="hidden" name="kind" value="${w.kind}"><input type="hidden" name="done" value="${w.done_at_ms ? "0" : "1"}">
<span>${label(w.kind)}${w.kind === "andet" && w.note ? `: ${esc(w.note)}` : ""} <span class="muted">(${w.wished_by.map(first).map(esc).join(", ")})</span></span>${who ? `<button class="linkbtn">${w.done_at_ms ? `Lavet af ${esc(first(w.done_by ?? ""))} · fortryd` : "Markér lavet"}</button>` : ""}</form>`).join("")}</div></li>`).join("")}</ul></div>`;
}

export const PR_STYLE = `.pr{margin-top:6px}.pr summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:4px;font-size:12.5px}.pr summary::-webkit-details-marker{display:none}
.pr-chip{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--soft);border:1px solid var(--line);font-size:12px}.pr-chip.done{text-decoration:line-through;color:var(--muted)}
.pr form{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:8px}.pr form input[name=note]{flex:1 1 140px;min-width:0}.pr .pick{font-size:13px}
.pr-list ul{display:grid;gap:12px}.pr-list li{display:grid;gap:4px}.pr-kinds{display:grid;gap:4px}.pr-kind{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:14px}
.pr-kind.done>span{text-decoration:line-through;color:var(--muted)}`;

/** Requested (Gitta): "i andres PR ønsker, dukker op på min todo ... Det ville være lækkert at det også dukker op på min todo/opgave liste." - "Ja på Gittas liste."
 * Each wish not yet made, for an event still to come, is a line on Gitta's list (her first name; until the chair gives out powers), with Lavet. */
export const isPrOwner = (who: string | null) => Boolean(who && /^gitta\b/i.test(who.trim()));
export type PrTodo = { event_id: string; kind: PrKind; note: string | null; wished_by: string[]; title: string; starts_at_ms: number };
export async function openPrWishes(db: D1Database, nowMs: number): Promise<PrTodo[]> {
  const rows = (await db.prepare(`SELECT w.event_id, w.kind, w.note, w.wished_by, e.title, e.starts_at_ms FROM event_pr_wishes w JOIN house_events e ON e.id = w.event_id
    WHERE w.done_at_ms IS NULL AND e.removed_at_ms IS NULL AND e.starts_at_ms >= ? ORDER BY e.starts_at_ms LIMIT 60`).bind(nowMs - 86_400_000)
    .all<{ event_id: string; kind: PrKind; note: string | null; wished_by: string; title: string; starts_at_ms: number }>().catch(() => ({ results: [] }))).results ?? [];
  return rows.map(r => ({ ...r, wished_by: names(r.wished_by) }));
}
const TODO_DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "short", day: "numeric", month: "short" });
export const prTodo = (base: string, w: PrTodo, back: "opgaver" | "forside" = "opgaver") => `<li data-cat="pr"><a href="${base}/arrangementer#pr"><strong>${label(w.kind)}${w.kind === "andet" && w.note ? `: ${esc(w.note)}` : ""} - ${esc(w.title)}</strong></a>`
  + `<span class="ctx">PR-ønske · ${esc(TODO_DAY.format(w.starts_at_ms))} · ønsket af ${w.wished_by.map(first).map(esc).join(", ")}</span>`
  + `<form method="post" action="${base}/arrangementer/pr/lavet" class="pr-done"><input type="hidden" name="event" value="${esc(w.event_id)}"><input type="hidden" name="kind" value="${w.kind}"><input type="hidden" name="done" value="1"><input type="hidden" name="back" value="${back}"><button class="linkbtn">Markér lavet</button></form></li>`;
