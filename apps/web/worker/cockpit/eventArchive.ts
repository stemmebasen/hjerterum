import type { D1Database } from "../db.js";
import { esc } from "./page.js";

/** Asked (the chair, 6 Nov 2026): "Der er slet ikke noget i vores filarkiv endnu? Hvad med event materialet som aftalt?" - "vi har jo allerede aftalt strukturen?
 * Underviser -> Dato/Event. Generelt materiale lægger i selve underviser-mappen" - and "Det er også disse mapper Saga skal søge i ved PR".
 *
 * Filarkiv → Undervisere: a folder for each teacher, with a folder for each of their events (date · title) holding the event's material (event_material:
 * what PR mails brought, pictures put with the event in Plakater og opslag, files the board adds). The teacher's own folder holds their general material:
 * their PR photos and profile photo (with their consent), their own words, and files the board puts there (event_material with the key "t:<name>").
 * It is the material itself, not a copy - Plakater og opslag reads the same (posterStudio.ts). */

export const TEACHERS_FOLDER = "Undervisere";
/** The board's own events (no teacher). */
export const HOUSE_NAME = "Hjerterum";
const EVENT_KEY = /^(mw:SF[0-9a-f]{24}|hr:\d{1,9})$/;
export const teacherKey = (name: string) => `t:${name.replace(/\s+/g, " ").trim().toLowerCase()}`;

/** "Undervisere", "Undervisere/<name>" or "Undervisere/<name>/<event key>". */
export function archivePlace(folder: string): { teacher: string | null; event: string | null } | null {
  if (folder === TEACHERS_FOLDER) return { teacher: null, event: null };
  if (!folder.startsWith(`${TEACHERS_FOLDER}/`)) return null;
  const [teacher, event, ...more] = folder.slice(TEACHERS_FOLDER.length + 1).split("/");
  if (!teacher || more.length || teacher.length > 120 || (event !== undefined && !EVENT_KEY.test(event))) return null;
  return { teacher, event: event ?? null };
}
const folderOf = (teacher: string, event?: string) => `${TEACHERS_FOLDER}/${teacher}${event ? `/${event}` : ""}`;
const link = (base: string, folder: string) => `${base}/filarkiv?mappe=${encodeURIComponent(folder)}`;

type EventRow = { key: string; title: string; host: string | null; starts_at_ms: number };
async function allEvents(db: D1Database, where: string, values: unknown[]): Promise<EventRow[]> {
  const calendar = await db.prepare(`SELECT 'mw:' || id AS key, title, host, starts_at_ms FROM house_events WHERE removed_at_ms IS NULL AND ${where.replaceAll("{host}", "host").replaceAll("{key}", "('mw:' || id)")}`).bind(...values)
    .all<EventRow>().then(r => r.results ?? []).catch(() => []);
  const own = await db.prepare(`SELECT 'hr:' || id AS key, title, teacher_name AS host, starts_at_ms FROM room_bookings WHERE status IN ('scheduled', 'completed') AND ${where.replaceAll("{host}", "teacher_name").replaceAll("{key}", "('hr:' || id)")}`).bind(...values)
    .all<EventRow>().then(r => r.results ?? []).catch(() => []);
  return [...calendar, ...own];
}
const nameOf = (host: string | null) => (host ?? "").replace(/\s+/g, " ").trim() || HOUSE_NAME;

/** The teacher a mail is from, by the sender's name as an event's host has it - for a PR mail that cannot be linked to one event: its material goes in the
 * teacher's own folder ("Generelt materiale lægger i selve underviser-mappen"). */
export async function teacherOfSender(db: D1Database, sender: string): Promise<string | null> {
  const name = sender.replace(/<[^>]*>/g, "").replace(/["']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 4 || !name.includes(" ")) return null;
  const row = await db.prepare(`SELECT host FROM (SELECT host FROM house_events WHERE host IS NOT NULL UNION SELECT teacher_name AS host FROM room_bookings WHERE teacher_name IS NOT NULL) WHERE lower(trim(host)) = ? LIMIT 1`)
    .bind(name).first<{ host: string }>().catch(() => null);
  return row?.host.replace(/\s+/g, " ").trim() ?? null;
}

export type TeacherFolder = { name: string; events: number; material: number };

/** The teachers: of the events of the coming six weeks, of every event with material, and those with a folder of their own. */
export async function teacherFolders(db: D1Database, nowMs: number): Promise<TeacherFolder[]> {
  const events = await allEvents(db, "({key} IN (SELECT event_key FROM event_material) OR starts_at_ms BETWEEN ? AND ?)", [nowMs - 86_400_000, nowMs + 42 * 86_400_000]);
  const counts = new Map((await db.prepare("SELECT event_key, COUNT(*) AS n FROM event_material GROUP BY event_key").all<{ event_key: string; n: number }>().then(r => r.results ?? []).catch(() => []))
    .map(r => [r.event_key, r.n]));
  const byName = new Map<string, TeacherFolder>();
  for (const e of events) {
    const name = nameOf(e.host), f = byName.get(name.toLowerCase()) ?? { name, events: 0, material: counts.get(teacherKey(name)) ?? 0 };
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), f);
    f.events++; f.material += counts.get(e.key) ?? 0;
  }
  // A teacher folder with only general material.
  for (const [key, n] of counts) if (key.startsWith("t:") && !byName.has(key.slice(2)))
    byName.set(key.slice(2), { name: key.slice(2).replace(/(^|[\s-])\p{L}/gu, c => c.toUpperCase()), events: 0, material: n });
  return [...byName.values()].sort((a, b) => (a.name === HOUSE_NAME ? 1 : 0) - (b.name === HOUSE_NAME ? 1 : 0) || a.name.localeCompare(b.name, "da"));
}

export type EventMaterialRow = { id: number; kind: "image" | "file" | "text"; filename: string | null; text: string | null; size_bytes: number | null; created_at_ms: number; mail_id: number | null };
const materialRows = (db: D1Database, key: string) => db.prepare("SELECT id, kind, filename, text, size_bytes, created_at_ms, mail_id FROM event_material WHERE event_key = ? ORDER BY id DESC LIMIT 200").bind(key)
  .all<EventMaterialRow>().then(r => r.results ?? []).catch(() => [] as EventMaterialRow[]);

export type TeacherView = { name: string; events: Array<{ key: string; title: string; startsMs: number; count: number }>; rows: EventMaterialRow[];
  photos: Array<{ url: string; label: string }>; quotes: string[]; consent: "given" | "withdrawn" | "none" | null };

/** A teacher's folder: their events, newest coming first, and their general material. */
export async function teacherFolder(db: D1Database, name: string, nowMs: number): Promise<TeacherView> {
  const key = name.toLowerCase();
  const events = key === HOUSE_NAME.toLowerCase() ? await allEvents(db, "({host} IS NULL OR trim({host}) = '' OR lower(trim({host})) = 'none')", [])
    : await allEvents(db, "lower(trim({host})) = ?", [key]);
  const counts = new Map((await db.prepare(`SELECT event_key, COUNT(*) AS n FROM event_material WHERE event_key IN (SELECT value FROM json_each(?)) GROUP BY event_key`).bind(JSON.stringify(events.map(e => e.key)))
    .all<{ event_key: string; n: number }>().then(r => r.results ?? []).catch(() => [])).map(r => [r.event_key, r.n]));
  const listed = events.filter(e => counts.has(e.key) || e.starts_at_ms >= nowMs - 86_400_000 || e.starts_at_ms >= nowMs - 120 * 86_400_000)
    .sort((a, b) => { const ac = a.starts_at_ms >= nowMs - 86_400_000, bc = b.starts_at_ms >= nowMs - 86_400_000; return ac !== bc ? (ac ? -1 : 1) : ac ? a.starts_at_ms - b.starts_at_ms : b.starts_at_ms - a.starts_at_ms; })
    .slice(0, 60).map(e => ({ key: e.key, title: e.title, startsMs: e.starts_at_ms, count: counts.get(e.key) ?? 0 }));
  // Their PR photos, profile photo and own words (given with their PR material, Min side) - by the people behind the name.
  const owners = key === HOUSE_NAME.toLowerCase() ? [] : (await db.prepare(`SELECT DISTINCT clerk_user_id AS id FROM (SELECT clerk_user_id, teacher_name AS name FROM room_bookings UNION SELECT clerk_user_id, full_name FROM members
      UNION SELECT clerk_user_id, json_extract(draft_json, '$.name') FROM public_profiles) WHERE lower(trim(name)) = ? AND clerk_user_id NOT LIKE 'cockpit:%'`).bind(key).all<{ id: string }>().then(r => r.results ?? []).catch(() => []))
    .map(r => r.id).filter(Boolean).slice(0, 5);
  const marks = owners.map(() => "?").join(",") || "NULL";
  const photos: TeacherView["photos"] = [];
  let quotes: string[] = [], consent: TeacherView["consent"] = null;
  if (owners.length) {
    for (const [i, p] of (await db.prepare(`SELECT id FROM pr_photos WHERE clerk_user_id IN (${marks}) ORDER BY created_at_ms`).bind(...owners).all<{ id: string }>().then(r => r.results ?? []).catch(() => [])).entries())
      photos.push({ url: `/filarkiv/billede/pr/${p.id}`, label: `PR-billede ${i + 1}` });
    for (const p of await db.prepare(`SELECT json_extract(draft_json, '$.photoUrl') AS photo FROM public_profiles WHERE clerk_user_id IN (${marks})`).bind(...owners).all<{ photo: string | null }>().then(r => r.results ?? []).catch(() => [])) {
      const m = /^\/api\/profile-photos\/([0-9a-f-]{36})\.jpg$/.exec(p.photo ?? ""); if (m) photos.push({ url: `/filarkiv/billede/profil/${m[1]}`, label: "Profilfoto" });
    }
    const material = await db.prepare(`SELECT quotes_json, consent_at_ms, withdrawn_at_ms FROM pr_material WHERE clerk_user_id IN (${marks}) ORDER BY updated_at_ms DESC LIMIT 1`).bind(...owners)
      .first<{ quotes_json: string; consent_at_ms: number | null; withdrawn_at_ms: number | null }>().catch(() => null);
    if (material) {
      consent = material.consent_at_ms && !material.withdrawn_at_ms ? "given" : material.withdrawn_at_ms ? "withdrawn" : "none";
      try { quotes = Object.values(JSON.parse(material.quotes_json) as Record<string, unknown>).filter((q): q is string => typeof q === "string" && q.trim().length > 10).slice(0, 4); } catch { quotes = []; }
    }
  }
  return { name, events: listed, rows: await materialRows(db, teacherKey(name)), photos, quotes, consent };
}

export async function eventFolder(db: D1Database, key: string): Promise<{ title: string; startsMs: number | null; host: string; rows: EventMaterialRow[] } | null> {
  const event = key.startsWith("mw:")
    ? await db.prepare("SELECT title, host, starts_at_ms FROM house_events WHERE id = ?").bind(key.slice(3)).first<{ title: string; host: string | null; starts_at_ms: number }>().catch(() => null)
    : await db.prepare("SELECT title, teacher_name AS host, starts_at_ms FROM room_bookings WHERE id = ?").bind(Number(key.slice(3))).first<{ title: string; host: string | null; starts_at_ms: number }>().catch(() => null);
  if (!event) return null;
  return { title: event.title, startsMs: event.starts_at_ms, host: nameOf(event.host), rows: await materialRows(db, key) };
}

// ---- The pages ----

const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric" });
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ISO = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const size = (bytes: number | null) => !bytes ? "" : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toLocaleString("da-DK", { maximumFractionDigits: 1 })} MB`;
const studioOf = (key: string) => /^mw:SF([0-9a-f]{24})$/.exec(key)?.[1] ?? (/^hr:(\d+)$/.exec(key) ? `h${key.slice(3)}` : null);
const things = (n: number) => n ? `${n} ${n === 1 ? "fil" : "filer"}` : "tom";

function crumbs(base: string, teacher?: string, event?: { key: string; label: string }): string {
  const parts = [`<a href="${base}/filarkiv">Filarkiv</a>`, teacher ? `<a href="${link(base, TEACHERS_FOLDER)}">${TEACHERS_FOLDER}</a>` : `<b>${TEACHERS_FOLDER}</b>`];
  if (teacher) parts.push(event ? `<a href="${link(base, folderOf(teacher))}">${esc(teacher)}</a>` : `<b>${esc(teacher)}</b>`);
  if (event) parts.push(`<b>${esc(event.label)}</b>`);
  return `<p class="fa-crumbs">${parts.join(" / ")}</p>`;
}

function filesList(base: string, rows: EventMaterialRow[], folder: string, canDelete: boolean): string {
  const files = rows.filter(r => r.kind !== "text").map(r => `<li class="fa-file">${r.kind === "image" ? `<img class="fa-thumb" src="${base}/filarkiv/materiale/${r.id}" alt="" loading="lazy">` : `<span class="fa-icon" aria-hidden="true">📄</span>`}
<a href="${base}/filarkiv/materiale/${r.id}?hent=1">${esc(r.filename ?? "fil")}</a><span class="small muted">${esc([size(r.size_bytes), WHEN.format(r.created_at_ms), r.mail_id ? "fra en PR-mail" : ""].filter(Boolean).join(" · "))}</span>
${canDelete ? `<form method="post" action="${base}/filarkiv/materiale-slet" onsubmit="return confirm('Slet filen? Den forsvinder også fra Plakater og opslag.')"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="mappe" value="${esc(folder)}"><button class="ghost danger small">Slet</button></form>` : ""}</li>`).join("");
  const texts = rows.filter(r => r.kind === "text" && r.text).map(r => `<details class="fa-text"><summary>${esc(r.filename || "Tekst fra mailen")} <span class="small muted">· ${esc(WHEN.format(r.created_at_ms))}</span></summary><p>${esc(r.text!).replace(/\n/g, "<br>")}</p></details>`).join("");
  return `${files ? `<ul class="plain">${files}</ul>` : ""}${texts ? `<h3>Tekster fra mails</h3>${texts}` : ""}`;
}

const uploadForm = (base: string, folder: string, label: string) => `<form method="post" action="${base}/filarkiv/materiale-upload" enctype="multipart/form-data" class="card fa-drop" id="fa-upload"><input type="hidden" name="mappe" value="${esc(folder)}">
<label for="fa-files"><b>${esc(label)}</b></label><p class="fa-hint">Billeder og dokumenter (jpg, png, webp, pdf, Word ...). Saga bruger dem, når der laves PR, og de kan vælges på Plakater og opslag.</p>
<input id="fa-files" type="file" name="filer" multiple required><button>Læg op</button></form>`;

export function teachersBody(base: string, teachers: TeacherFolder[]): string {
  return `${crumbs(base)}
<p class="muted">En mappe for hver underviser og i den en mappe for hvert af deres events (dato · event). Generelt materiale - PR-billeder, profilfoto, tekster - ligger i selve underviser-mappen. Materiale fra undervisernes PR-mails lægger Saga i eventets mappe. Saga søger i mapperne, når der laves PR.</p>
<section class="card fa-list">${teachers.length ? `<ul class="plain">${teachers.map(t => `<li class="fa-folder"><a href="${link(base, folderOf(t.name))}"><span class="fa-icon" aria-hidden="true">📁</span>${esc(t.name)}</a>
<span class="small muted">${t.events} ${t.events === 1 ? "event" : "events"}${t.material ? ` · ${things(t.material)}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted">Ingen undervisere endnu.</p>`}</section>`;
}

export function teacherBody(base: string, view: TeacherView, canDelete: boolean): string {
  const folder = folderOf(view.name);
  const events = view.events.map(e => `<li class="fa-folder"><a href="${link(base, folderOf(view.name, e.key))}"><span class="fa-icon" aria-hidden="true">📁</span>${esc(ISO(e.startsMs))} · ${esc(e.title)}</a><span class="small muted">${things(e.count)}</span></li>`).join("");
  const photos = view.photos.map(p => `<li class="fa-file"><img class="fa-thumb" src="${base}${p.url}" alt="" loading="lazy"><a href="${base}${p.url}" target="_blank" rel="noopener">${esc(p.label)}</a><span class="small muted">fra underviserens PR-materiale</span></li>`).join("");
  const consent = view.consent === "given" ? "Har givet samtykke til, at Hjerterum bruger billederne og teksterne i PR." : view.consent === "withdrawn" ? "Har trukket sit PR-samtykke tilbage - brug ikke billederne herfra." : view.consent === "none" ? "Har ikke givet PR-samtykke endnu." : "";
  return `${crumbs(base, view.name)}
<section class="card fa-list"><h3>Events</h3>${events ? `<ul class="plain">${events}</ul>` : `<p class="muted">Ingen events.</p>`}</section>
<section class="card fa-list"><h3>Generelt materiale</h3>${consent ? `<p class="small muted">${esc(consent)}</p>` : ""}
${photos || view.rows.length ? `${photos ? `<ul class="plain">${photos}</ul>` : ""}${filesList(base, view.rows, folder, canDelete)}` : `<p class="muted">Intet generelt materiale endnu.</p>`}
${view.quotes.length ? `<h3>Underviserens egne ord</h3>${view.quotes.map(q => `<blockquote class="fa-quote">${esc(q)}</blockquote>`).join("")}` : ""}</section>
${uploadForm(base, folder, `Læg generelt materiale i ${view.name}s mappe`)}`;
}

export function eventFolderBody(base: string, teacher: string, key: string, folder: { title: string; startsMs: number | null; rows: EventMaterialRow[] }, canDelete: boolean): string {
  const studio = studioOf(key), here = folderOf(teacher, key);
  return `${crumbs(base, teacher, { key, label: `${folder.startsMs ? `${ISO(folder.startsMs)} · ` : ""}${folder.title}` })}
${folder.startsMs ? `<p class="muted">${esc(DAY.format(folder.startsMs))}${studio ? ` · <a href="${base}/plakater/${esc(studio)}?fra=${encodeURIComponent(`/filarkiv?mappe=${here}`)}">Lav design med materialet</a>` : ""}</p>` : ""}
<section class="card fa-list">${folder.rows.length ? filesList(base, folder.rows, here, canDelete) : `<p class="muted">Mappen er tom.</p>`}</section>
${uploadForm(base, here, "Læg filer ved eventet")}`;
}

export const EVENT_ARCHIVE_STYLE = `.fa-thumb{width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none}.fa-text{margin:8px 0}.fa-text summary{cursor:pointer}.fa-text p{margin:8px 0 0}
.fa-quote{margin:8px 0;padding:8px 14px;border-left:3px solid var(--line);font-style:italic}.fa-list h3{font-size:15px;margin:4px 0 10px}`;
