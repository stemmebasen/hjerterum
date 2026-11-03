import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { esc, layout } from "./page.js";

/** Requested (the chair, 3 Nov 2026). The website promises: "Når du booker Hjerterum, får dit event automatisk en god eksponering: det bliver offentliggjort både
 * på vores hjemmeside og på vores Facebook-side" - and "Så opretter vi eventet på vores hjemmeside og Facebook-side og sender dig et link". Meta does not let
 * an app create a Page's events, so the chair chose: "Lisbeth opretter dem", the cockpit reminds her - and "Hele bestyrelsen" may see and tick the list.
 * Events → Facebook-begivenheder (/arrangementer/facebook): the coming six weeks' events, each ticked off when it is on Facebook. On Monday and Thursday
 * at 9 Saga tells Lisbeth privately on Telegram what is missing in the next three weeks. */

export const FB_EVENTS_PERSON = "Lisbeth";
const DAY = 86_400_000;
export const LIST_DAYS = 42;
export const REMIND_DAYS = 21;
const TZ = "Europe/Copenhagen";

export type FbEvent = { key: string; title: string; startsMs: number; host: string | null; done: { by: string; at: number; link: string | null } | null };

/** The house's coming events - the calendar's and the members' approved ones, not the partner houses' nor CIRKLER's meetings - with whether each is on Facebook. */
export async function facebookEvents(db: D1Database, nowMs: number, days = LIST_DAYS): Promise<FbEvent[]> {
  const until = nowMs + days * DAY;
  const calendar = await db.prepare(`SELECT id, title, starts_at_ms, host, location, category FROM house_events WHERE starts_at_ms >= ? AND starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms LIMIT 300`)
    .bind(nowMs, until).all<{ id: string; title: string; starts_at_ms: number; host: string | null; location: string | null; category: string | null }>().then(r => r.results ?? []).catch(() => []);
  const own = await db.prepare(`SELECT id, title, teacher_name, starts_at_ms FROM room_bookings WHERE status = 'scheduled' AND COALESCE(review_status, 'approved') = 'approved'
      AND cirkler_meeting_id IS NULL AND starts_at_ms >= ? AND starts_at_ms < ? ORDER BY starts_at_ms LIMIT 300`).bind(nowMs, until)
    .all<{ id: number; title: string; teacher_name: string | null; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => []);
  const partner = /hjerteland/i;
  const events = [
    ...calendar.filter(e => ![e.location, e.category, e.title].some(v => v && partner.test(v))).map(e => ({ key: `mw:${e.id}`, title: e.title, startsMs: e.starts_at_ms, host: e.host })),
    ...own.map(b => ({ key: `hr:${b.id}`, title: b.title, startsMs: b.starts_at_ms, host: b.teacher_name }))
  ];
  const done = new Map((await db.prepare("SELECT event_key, done_by, done_at_ms, link FROM facebook_events WHERE event_key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(events.map(e => e.key)))
    .all<{ event_key: string; done_by: string; done_at_ms: number; link: string | null }>().then(r => r.results ?? []).catch(() => [])).map(r => [r.event_key, { by: r.done_by, at: r.done_at_ms, link: r.link }] as const));
  return events.map(e => ({ ...e, done: done.get(e.key) ?? null })).sort((a, b) => a.startsMs - b.startsMs);
}

export const missingSoon = (events: FbEvent[], nowMs: number, days = REMIND_DAYS) => events.filter(e => !e.done && e.startsMs < nowMs + days * DAY);

/** Ticked off (with the link, when given) or undone. Only an event that is in the list can be ticked. */
export async function markFacebookEvent(db: D1Database, key: string, done: boolean, who: string, link: string, nowMs: number): Promise<boolean> {
  if (!done) { await db.prepare("DELETE FROM facebook_events WHERE event_key = ?").bind(key).run(); return true; }
  const event = (await facebookEvents(db, nowMs - DAY)).find(e => e.key === key);
  if (!event) return false;
  const url = /^https:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.me)\//i.test(link.trim()) ? link.trim().slice(0, 500) : null;
  await db.prepare(`INSERT INTO facebook_events (event_key, title, starts_at_ms, done_by, done_at_ms, link) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_key) DO UPDATE SET done_by = excluded.done_by, done_at_ms = excluded.done_at_ms, link = COALESCE(excluded.link, facebook_events.link)`)
    .bind(key, event.title.slice(0, 300), event.startsMs, who, nowMs, url).run();
  return true;
}

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" })
  .formatToParts(ms).map(p => [p.type, p.value])) as Record<string, string>;

/** Monday and Thursday from 9 (Danish time), once each day: Saga tells Lisbeth privately what is missing in the next three weeks. Nothing when nothing is. */
export async function scheduledFacebookReminder(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>): Promise<boolean> {
  const now = deps.now(), p = parts(now);
  if (!["Mon", "Thu"].includes(p.weekday ?? "") || Number(p.hour) < 9 || !env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_BOARD_CHAT_ID) return false;
  const missing = missingSoon(await facebookEvents(db, now, REMIND_DAYS), now);
  if (!missing.length) return false;
  const person = await db.prepare(`SELECT author_name, author_telegram_id FROM board_messages WHERE chat_id = ? AND from_assistant = 0 AND author_telegram_id IS NOT NULL
      AND lower(author_name) LIKE ? ORDER BY sent_at_ms DESC LIMIT 1`).bind(env.SAGA_BOARD_CHAT_ID, `${FB_EVENTS_PERSON.toLowerCase()}%`)
    .first<{ author_name: string; author_telegram_id: string }>().catch(() => null);
  if (!person || !(await claim("facebook_events_reminder", Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`)))) return false;
  const url = (env.COCKPIT_URL ?? "https://admin.hjerterum.info").replace(/\/+$/, "");
  const lines = missing.slice(0, 12).map(e => `• ${WHEN.format(e.startsMs)}: ${e.title}`).join("\n");
  const text = `Hej ${person.author_name.split(/\s+/)[0]}. ${missing.length === 1 ? "Ét event" : `${missing.length} events`} de næste tre uger mangler en begivenhed på Hjerterums Facebook-side:\n\n${lines}${missing.length > 12 ? "\n…" : ""}\n\nOpret dem på Facebook, og sæt flueben her, når de er oprettet: ${url}/arrangementer/facebook`;
  await telegramClient(env, deps).sendMessage(person.author_telegram_id, text);
  return true;
}

export function facebookEventsPage(base: string, who: string | null, events: FbEvent[], nowMs: number, notice = ""): string {
  const missing = events.filter(e => !e.done), done = events.filter(e => e.done);
  const row = (e: FbEvent) => `<li class="${!e.done && e.startsMs < nowMs + 7 * DAY ? "is-soon" : ""}"><span class="at">${esc(WHEN.format(e.startsMs))}</span><span><b>${esc(e.title)}</b>${e.host ? ` <span class="muted">· ${esc(e.host)}</span>` : ""}
${e.done ? `<small>Oprettet af ${esc(e.done.by)} ${esc(WHEN.format(e.done.at))}${e.done.link ? ` · <a href="${esc(e.done.link)}" target="_blank" rel="noopener">Se på Facebook</a>` : ""}</small>` : ""}</span>
<form method="post" action="${base}/arrangementer/facebook" class="fb-act"><input type="hidden" name="event" value="${esc(e.key)}">${e.done
    ? `<input type="hidden" name="done" value="0"><button class="ghost">Fortryd</button>`
    : `<input type="hidden" name="done" value="1"><input name="link" placeholder="Link til begivenheden (valgfrit)" aria-label="Link til begivenheden"><button>Oprettet</button>`}</form></li>`;
  return layout(base, "Facebook-begivenheder", `<main class="fb-events"><div class="hero"><p class="small muted" style="margin:0 0 6px"><a href="${base}/arrangementer">← Events</a></p><h1>Facebook-begivenheder</h1>
<p>Hjemmesiden lover, at hvert event kommer på Hjerterums Facebook-side. Meta lader ikke systemet oprette begivenheder, så de oprettes i hånden. Sæt flueben, når et event er oprettet. Saga minder ${esc(FB_EVENTS_PERSON)} om det mandag og torsdag.</p></div>
${notice ? `<p class="notice good">${esc(notice)}</p>` : ""}
<section class="panel"><header><h2>Mangler (${missing.length})</h2><p>De næste seks uger, de nærmeste først.</p></header>${missing.length ? `<ul>${missing.map(row).join("")}</ul>` : `<p class="good">Alle events de næste seks uger er på Facebook.</p>`}</section>
${done.length ? `<details class="panel"><summary><b>Oprettet (${done.length})</b></summary><ul>${done.map(row).join("")}</ul></details>` : ""}</main>`,
    { section: "/arrangementer/facebook", who, style: `.fb-events ul{list-style:none;margin:0;padding:0}.fb-events li{display:grid;grid-template-columns:170px 1fr auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--line);font-size:14.5px}
.fb-events li:first-child{border-top:0}.fb-events li.is-soon .at{color:var(--warn);font-weight:600}.fb-events .at{color:var(--muted);font-size:13.5px}.fb-events small{display:block;color:var(--faint);font-size:12.5px}
.fb-act{display:flex;gap:8px;margin:0}.fb-act input[name=link]{width:220px;font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
@media (max-width:760px){.fb-events li{grid-template-columns:1fr;gap:4px}.fb-act input[name=link]{flex:1;width:auto}}` });
}
