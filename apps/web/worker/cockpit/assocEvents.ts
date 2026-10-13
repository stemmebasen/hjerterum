import type { D1Database } from "../db.js";
import type { Meeting } from "./data.js";
import { esc } from "./page.js";

/** Requested: "Når foreningen har arrangementer som teammøder og generalforsamlinger, skal det nævnes på forsiden af admin. Vi har for eksempel
 * generalforsamling i morgen. Det bør nævnes på forsiden med en flot gradient guldbaggrund." The association's own gatherings of the coming week -
 * the meetings planned in the admin, and a general assembly or members' meeting in the house's calendar - in a golden card on the front page. */
export type AssocEvent = { key: string; day: string; time: string; title: string; place: string; href: string };

const ZONE = "Europe/Copenhagen";
/** Reported: "You have now put in a gold frame for our team meeting. What I meant was the generalforsamling. The normal team meeting is just in
 * the normal regular box." The gold card is for the association's own big gatherings - not the board's team meetings. */
const ASSOC = /generalforsamling|stormøde|informationsmøde|medlemsmøde|årsmøde/i;
const DAY_OF = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE });
const TIME_OF = new Intl.DateTimeFormat("da-DK", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("da-DK", { timeZone: "UTC", weekday: "long" });
const LONG = new Intl.DateTimeFormat("da-DK", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function meetingTitle(m: Meeting): string {
  const named = ASSOC.exec(m.agenda ?? "")?.[0];
  return named ? named.charAt(0).toLocaleUpperCase("da-DK") + named.slice(1).toLocaleLowerCase("da-DK") : "Møde i foreningen";
}

export async function associationEvents(db: D1Database, base: string, meetings: Meeting[], today: string, nowMs: number): Promise<AssocEvent[]> {
  const until = addDays(today, 7);
  // A meeting in Møder is in the gold card only when it is said to be something else than a team meeting (a general assembly, an info meeting ...).
  const out: AssocEvent[] = meetings.filter(m => m.kind === "andet" && m.meeting_date >= today && m.meeting_date <= until)
    .map(m => ({ key: `moede:${m.id}`, day: m.meeting_date, time: m.start_time ?? "", title: meetingTitle(m), place: m.place ?? "", href: `${base}/moder/${m.id}` }));
  const house = (await db.prepare("SELECT id, title, starts_at_ms, location, link FROM house_events WHERE removed_at_ms IS NULL AND starts_at_ms >= ? AND starts_at_ms < ? ORDER BY starts_at_ms LIMIT 200")
    .bind(nowMs - 3 * 3_600_000, nowMs + 8 * 86_400_000).all<{ id: string; title: string; starts_at_ms: number; location: string | null; link: string | null }>().catch(() => ({ results: [] }))).results ?? [];
  for (const e of house) {
    if (!ASSOC.test(e.title)) continue;
    const day = DAY_OF.format(e.starts_at_ms);
    if (day < today || day > until) continue;
    // The same gathering planned in the admin too is shown once - with what the admin knows.
    const kind = ASSOC.exec(e.title)![0].toLocaleLowerCase("da-DK");
    if (out.some(o => o.day === day && o.title.toLocaleLowerCase("da-DK").includes(kind))) continue;
    out.push({ key: `hus:${e.id}`, day, time: TIME_OF.format(e.starts_at_ms).replace(":", "."), title: e.title.trim(), place: e.location ?? "Hjerterum", href: e.link ?? `${base}/arrangementer` });
  }
  return out.sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`));
}

const when = (day: string, today: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  if (day === today) return "I dag";
  if (day === addDays(today, 1)) return "I morgen";
  return `På ${WEEKDAY.format(date)}`;
};

/** Requested: "Kan du indsætte en lille knap? 'Jeg kommer' til vores fælles møder, inklusive generalforsamling." */
export async function rsvps(db: D1Database, keys: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!keys.length) return out;
  const rows = (await db.prepare(`SELECT event_key, member FROM assoc_rsvp WHERE event_key IN (${keys.map(() => "?").join(",")}) ORDER BY at_ms`).bind(...keys)
    .all<{ event_key: string; member: string }>().catch(() => ({ results: [] }))).results ?? [];
  for (const r of rows) out.set(r.event_key, [...(out.get(r.event_key) ?? []), r.member]);
  return out;
}
/** A member says they are coming - or, pressed again, that they are not after all. True when they are coming now. */
export async function toggleRsvp(db: D1Database, key: string, member: string, nowMs: number): Promise<boolean> {
  if (!/^(?:moede|hus):[\w-]{1,80}$/.test(key)) return false;
  const gone = await db.prepare("DELETE FROM assoc_rsvp WHERE event_key = ? AND member = ?").bind(key, member).run();
  if (Number(gone.meta?.changes ?? 0) > 0) return false;
  await db.prepare("INSERT INTO assoc_rsvp (event_key, member, at_ms) VALUES (?, ?, ?)").bind(key, member, nowMs).run();
  return true;
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Jeg kommer" outside the gold card - in the regular box of the next team meeting. */
export function rsvpLine(base: string, key: string, who: string | null, coming: string[]): string {
  const mine = Boolean(who && coming.includes(who));
  return `<div class="rsvp-line">${who ? `<form method="post" action="${base}/kommer"><input type="hidden" name="key" value="${esc(key)}"><button class="rsvp-plain${mine ? " is-coming" : ""}" aria-pressed="${mine}">${mine ? "✓ Du kommer" : "Jeg kommer"}</button></form>` : ""}
<span class="small muted">${coming.length ? `Kommer: ${esc(coming.map(first).join(", "))} (${coming.length})` : "Ingen har meldt sig endnu"}</span></div>`;
}

export function assocCard(events: AssocEvent[], today: string, rsvp: { base: string; who: string | null; coming: Map<string, string[]> } = { base: "", who: null, coming: new Map() }): string {
  if (!events.length) return "";
  return `<section class="assoc-card" aria-label="Foreningens arrangementer">${events.map(e => {
    const coming = rsvp.coming.get(e.key) ?? [], mine = Boolean(rsvp.who && coming.includes(rsvp.who));
    const button = rsvp.who ? `<form method="post" action="${rsvp.base}/kommer" class="assoc-rsvp"><input type="hidden" name="key" value="${esc(e.key)}">
<button class="${mine ? "is-coming" : ""}" aria-pressed="${mine}">${mine ? "✓ Du kommer" : "Jeg kommer"}</button>${mine ? `<span class="assoc-undo">Tryk igen, hvis du ikke kan alligevel</span>` : ""}</form>` : "";
    return `<div class="assoc"><a class="assoc-main" href="${esc(e.href)}">
<span class="assoc-when">${esc(when(e.day, today))}</span><strong>${esc(e.title)}</strong>
<span class="assoc-meta">${esc(LONG.format(new Date(`${e.day}T12:00:00Z`)).replace(/^\p{Ll}/u, c => c.toLocaleUpperCase("da-DK")))}${e.time ? ` kl. ${esc(e.time.replace(":", "."))}` : ""}${e.place ? ` · ${esc(e.place)}` : ""}</span>
${coming.length ? `<span class="assoc-who">Kommer: ${esc(coming.map(first).join(", "))} (${coming.length})</span>` : ""}</a>${button}</div>`;
  }).join("")}</section>`;
}

export const ASSOC_STYLE = `
.rsvp-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:12px 0 0}.rsvp-line form{margin:0}
.rsvp-plain{padding:7px 16px;min-height:0;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:14px;font-weight:700;cursor:pointer}
.rsvp-plain.is-coming{border-color:var(--accent);color:var(--accent)}
.assoc-card{display:grid;gap:10px;margin:0 0 22px}
.assoc{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 18px;align-items:center;padding:20px 24px;border-radius:18px;text-decoration:none;color:#3f2c08;
background:linear-gradient(120deg,#fbf0c9 0%,#f1d88a 38%,#e2b65a 72%,#c99a3b 100%);box-shadow:0 10px 30px -14px rgb(150 105 20 / .55),inset 0 1px 0 rgb(255 255 255 / .55);border:1px solid #d9b25a}
.assoc-main{display:grid;gap:2px;text-decoration:none;color:inherit}.assoc-main:hover strong{text-decoration:underline;text-underline-offset:4px}
.assoc-who{font-size:13.5px;font-weight:600;margin-top:4px;opacity:.9}
.assoc-rsvp{margin:0;display:grid;justify-items:end;gap:4px}
.assoc-rsvp button{padding:10px 20px;min-height:0;border-radius:999px;border:1.5px solid #3f2c08;background:#3f2c08;color:#fbf0c9;font:inherit;font-weight:700;font-size:14.5px;cursor:pointer;white-space:nowrap}
.assoc-rsvp button.is-coming{background:rgb(255 255 255 / .55);color:#3f2c08}.assoc-undo{font-size:11.5px;opacity:.75}
@media (max-width:620px){.assoc{grid-template-columns:1fr}.assoc-rsvp{justify-items:start}}
.assoc-when{font-size:11.5px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;opacity:.8}
.assoc strong{font-size:24px;line-height:1.2;font-weight:700}
.assoc-meta{font-size:14.5px;font-weight:600;opacity:.85}
@media (prefers-color-scheme:dark){.assoc-rsvp button{background:#fff3d1;color:#3f2c08;border-color:#fff3d1}.assoc-rsvp button.is-coming{background:transparent;color:#fff3d1}.assoc{color:#fff3d1;background:linear-gradient(120deg,#5c4512 0%,#7f6020 45%,#a07a2c 100%);border-color:#a8822f;box-shadow:0 10px 30px -14px rgb(0 0 0 / .6)}}`;
