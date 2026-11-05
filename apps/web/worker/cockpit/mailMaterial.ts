import type { D1Database } from "../db.js";
import { checkUpload, type EventMediaBucket } from "../event-files.js";
import { dateOf } from "../social/plan.js";
import type { WebMessage } from "./webmail.js";

/** Requested (the chair, 5 Nov 2026): "Det ville være rigtig fint, at der allerede er lavet en kobling til det pågældende event og at materialet, der er sendt
 * allerede ligger klar i den pågældende mappe under det pågældende event klar til brug. Kan vi indsætte en knap, som tager mig direkte til redigeringen af
 * opslaget med det pågældende materiale?" A PR mail is linked to the event it is about (by the sender's name and the date it mentions - or by the chair), and
 * what it brought - its pictures, its documents and its own words - is kept with the event (event_material) for Plakater og opslag. */

export type UpcomingEvent = { key: string; title: string; host: string | null; startsMs: number };

/** The events of the coming four months: the calendar's and the house's own. */
export async function upcomingEvents(db: D1Database, nowMs: number): Promise<UpcomingEvent[]> {
  const [calendar, own] = await Promise.all([
    db.prepare("SELECT id, title, host, starts_at_ms FROM house_events WHERE starts_at_ms BETWEEN ? AND ? AND removed_at_ms IS NULL ORDER BY starts_at_ms LIMIT 400")
      .bind(nowMs - 86_400_000, nowMs + 120 * 86_400_000).all<{ id: string; title: string; host: string | null; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT id, title, teacher_name, starts_at_ms FROM room_bookings WHERE status = 'scheduled' AND starts_at_ms BETWEEN ? AND ? ORDER BY starts_at_ms LIMIT 200")
      .bind(nowMs - 86_400_000, nowMs + 120 * 86_400_000).all<{ id: number; title: string; teacher_name: string | null; starts_at_ms: number }>().then(r => r.results ?? []).catch(() => []),
  ]);
  return [...calendar.map(e => ({ key: `mw:${e.id}`, title: e.title, host: e.host, startsMs: e.starts_at_ms })),
    ...own.map(e => ({ key: `hr:${e.id}`, title: e.title, host: e.teacher_name || null, startsMs: e.starts_at_ms }))].sort((a, b) => a.startsMs - b.startsMs);
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a");
const words = (s: string, min = 3) => new Set(fold(s).split(/[^a-z0-9]+/).filter(w => w.length >= min));
const MONTHS = ["jan", "feb", "mar", "apr", "maj|may", "jun", "jul", "aug", "sep", "okt|oct", "nov", "dec"];

/** The days a mail mentions ("24 november", "24. nov", "24/11", "24.11"), as YYYY-MM-DD - the next such day from when it came. */
export function mentionedDays(text: string, receivedMs: number): string[] {
  const t = fold(text), out = new Set<string>();
  const at = (day: number, month: number) => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return;
    const year = Number(dateOf(receivedMs).slice(0, 4));
    for (const y of [year, year + 1]) {
      const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso >= dateOf(receivedMs - 86_400_000)) { out.add(iso); return; }
    }
  };
  for (const m of t.matchAll(/(\d{1,2})\.?\s*(?:de[nr]\s+)?(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)[a-z]*/g))
    at(Number(m[1]), MONTHS.findIndex(p => new RegExp(`^(?:${p})`).test(m[2]!)) + 1);
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})[./](\d{1,2})(?![\d])/g)) at(Number(m[1]), Number(m[2]));
  return [...out];
}

/** The event the mail is about: the teacher's name (the sender) and the day it mentions weigh most, the title's words a little. Null when no event stands out. */
export function matchEvent(events: UpcomingEvent[], mail: { sender: string; subject: string; text: string; receivedMs: number }): UpcomingEvent | null {
  const name = words(mail.sender.replace(/<[^>]*>/, " "));
  const address = fold(/<([^>]+)>/.exec(mail.sender)?.[1] ?? mail.sender);
  const days = new Set(mentionedDays(`${mail.subject} ${mail.text}`, mail.receivedMs));
  const said = words(`${mail.subject} ${mail.text.slice(0, 3000)}`, 5);
  const scored = events.filter(e => e.startsMs >= mail.receivedMs - 86_400_000).map(e => {
    const host = words(e.host ?? "");
    let score = 0;
    for (const w of host) { if (name.has(w)) score += 2; else if (w.length >= 5 && address.includes(w)) score += 2; }
    if (days.has(dateOf(e.startsMs))) score += 3;
    score += Math.min(3, [...words(e.title, 5)].filter(w => said.has(w)).length);
    return { e, score };
  }).sort((a, b) => b.score - a.score || a.e.startsMs - b.e.startsMs);
  const [best, next] = scored;
  return best && best.score >= 4 && (!next || next.score < best.score) ? best.e : null;
}

/** Keeps what the mail brought with the event: its pictures and documents (as an event's files may be), and its own words. */
export async function storeMaterial(db: D1Database, bucket: EventMediaBucket, mailId: number, eventKey: string, message: WebMessage, nowMs: number): Promise<number> {
  let kept = 0;
  for (const a of message.attachments) {
    // A small picture inline in the mail is a signature or a logo, not material.
    if (a.inline && a.size < 40_000) continue;
    const check = checkUpload("file", a.filename, a.size, a.content.subarray(0, 2048));
    if (!check.ok) continue;
    // The same file again (a mail sent twice, or an answer with it again): kept once.
    if (await db.prepare("SELECT 1 AS yes FROM event_material WHERE event_key = ? AND filename = ? AND size_bytes = ?").bind(eventKey, check.filename, a.size).first().catch(() => null)) continue;
    const kind = check.contentType.startsWith("image/") ? "image" : "file";
    const key = `material/${eventKey.replace(/[^A-Za-z0-9]/g, "_")}/${crypto.randomUUID()}.${check.extension}`;
    await bucket.put(key, a.content.slice().buffer, { httpMetadata: { contentType: check.contentType } });
    await db.prepare("INSERT INTO event_material (event_key, mail_id, kind, filename, content_type, r2_key, size_bytes, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(eventKey, mailId, kind, check.filename, check.contentType, key, a.size, nowMs).run();
    kept++;
  }
  // The mail's own words, without the quoted mails below them.
  const text = message.text.split(/\n(?:>|-{2,}\s*(?:Original|Oprindelig)|(?:On|Den) .{4,80}(?:wrote|skrev):)/)[0]!.trim();
  if (text && !(await db.prepare("SELECT 1 AS yes FROM event_material WHERE event_key = ? AND kind = 'text' AND text = ?").bind(eventKey, text.slice(0, 6000)).first().catch(() => null))) {
    await db.prepare("INSERT INTO event_material (event_key, mail_id, kind, filename, text, created_at_ms) VALUES (?, ?, 'text', ?, ?, ?)")
      .bind(eventKey, mailId, message.subject, text.slice(0, 6000), nowMs).run();
    kept++;
  }
  return kept;
}

/** Requested (the chair, 5 Nov 2026): "Her bør det også gøres muligt at uploade et billede selv, der kan bruges." A picture the chair puts with the event in the
 * studio, kept as the mails' are. */
export async function storeUpload(db: D1Database, bucket: EventMediaBucket, eventKey: string, name: string, bytes: ArrayBuffer, nowMs: number): Promise<number | null> {
  const check = checkUpload("file", name, bytes.byteLength, new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2048)));
  if (!check.ok || !check.contentType.startsWith("image/")) return null;
  const key = `material/${eventKey.replace(/[^A-Za-z0-9]/g, "_")}/${crypto.randomUUID()}.${check.extension}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: check.contentType } });
  const row = await db.prepare("INSERT INTO event_material (event_key, mail_id, kind, filename, content_type, r2_key, size_bytes, created_at_ms) VALUES (?, NULL, 'image', ?, ?, ?, ?, ?)")
    .bind(eventKey, check.filename, check.contentType, key, bytes.byteLength, nowMs).run();
  return Number(row.meta?.last_row_id ?? 0) || null;
}

export type Material = { id: number; kind: "image" | "file" | "text"; filename: string | null; content_type: string | null; text: string | null; mail_id: number | null };

export async function materialOf(db: D1Database, eventKey: string): Promise<Material[]> {
  return db.prepare("SELECT id, kind, filename, content_type, text, mail_id FROM event_material WHERE event_key = ? ORDER BY id DESC LIMIT 60").bind(eventKey)
    .all<Material>().then(r => r.results ?? []).catch(() => []);
}

/** One piece of material, as stored (for the studio's pictures and the download). */
export async function materialFile(db: D1Database, bucket: EventMediaBucket | undefined, id: number, download: boolean): Promise<Response> {
  const row = await db.prepare("SELECT filename, content_type, r2_key FROM event_material WHERE id = ? AND r2_key IS NOT NULL").bind(id).first<{ filename: string; content_type: string; r2_key: string }>().catch(() => null);
  const object = row && bucket ? await bucket.get(row.r2_key).catch(() => null) : null;
  if (!row || !object) return new Response("Ikke fundet", { status: 404 });
  return new Response(object.body, { headers: { "content-type": row.content_type, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    ...(download ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}` } : {}) } });
}
