import type { D1Database } from "./db.js";
import { designUrl } from "./event-designs.js";
import { eventDetail } from "./event-detail.js";

/** Reported: "Dette deles når man vil dele et event - det skal handle om eventet og det skal være meget mere spændende med billede og beskrivelse".
 * Facebook (and Messenger, LinkedIn, Slack ...) read the page's own HTML, not what the app draws afterwards, so a shared event showed only
 * "Hjerterum". The event pages (/events/<id>, /events/h<id>) now carry the event's title, picture, time and description in their meta tags. */

const SITE = "https://www.hjerterum.info";
export const EVENT_PAGE = /^\/events\/([0-9a-f]{24}|h\d+)\/?$/;
export type EventMeta = { title: string; description: string; image: string; url: string };

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "Fredag den 20. november kl. 19.00" - built from the parts, so it reads the same whatever the runtime's own pattern. */
const when = (iso: string) => {
  const p = Object.fromEntries(WHEN.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${(p.weekday ?? "").charAt(0).toUpperCase()}${(p.weekday ?? "").slice(1)} den ${p.day}. ${p.month} kl. ${p.hour}.${p.minute}`;
};
const short = (text: string, max: number) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")} …` : t; };

export async function eventMeta(db: D1Database | undefined, id: string, fetcher: typeof fetch, nowMs: number): Promise<EventMeta | null> {
  const own = /^h(\d+)$/.exec(id);
  if (own) {
    if (!db) return null;
    const row = await db.prepare(`SELECT b.id, b.title, b.description, b.teacher_name, b.starts_at_ms,
        (SELECT f.id FROM room_booking_files f WHERE f.room_booking_id = b.id AND f.kind = 'cover' LIMIT 1) AS cover_id,
        (SELECT d.created_at_ms FROM room_booking_designs d WHERE d.room_booking_id = b.id) AS design_at
      FROM room_bookings b WHERE b.id = ? AND b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved'`).bind(Number(own[1]))
      .first<{ id: number; title: string; description: string | null; teacher_name: string; starts_at_ms: number; cover_id: number | null; design_at: number | null }>().catch(() => null);
    if (!row) return null;
    const image = row.design_at ? designUrl(row.id, row.design_at) : row.cover_id ? `/api/event-files/${row.cover_id}` : "/media/hjerterum-deling.jpg";
    return { title: row.title, url: `${SITE}/events/h${row.id}`, image: `${SITE}${image}`,
      description: short(`${when(new Date(row.starts_at_ms).toISOString())} i Hjerterum, Aarhus · med ${row.teacher_name}. ${row.description ?? ""}`, 300) };
  }
  const detail = await eventDetail(id, fetcher, nowMs).catch(() => null);
  if (!detail) return null;
  return { title: detail.title, url: `${SITE}/events/${id}`, image: detail.imageUrl && /^https:\/\//.test(detail.imageUrl) ? detail.imageUrl : `${SITE}/media/hjerterum-deling.jpg`,
    description: short(`${when(detail.startsAt)} i Hjerterum, Aarhus${detail.host ? ` · med ${detail.host}` : ""}. ${detail.paragraphs.join(" ")}`, 300) };
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The app's page with the event's own title, description and Open Graph tags in place of the site's. */
export function withEventMeta(html: string, meta: EventMeta): string {
  const tags = [
    ["og:site_name", "Hjerterum"], ["og:locale", "da_DK"], ["og:type", "website"], ["og:title", meta.title], ["og:description", meta.description],
    ["og:image", meta.image], ["og:url", meta.url]
  ].map(([k, v]) => `<meta property="${k}" content="${attr(v!)}" />`).join("\n    ")
    + `\n    <meta name="twitter:card" content="summary_large_image" />\n    <link rel="canonical" href="${attr(meta.url)}" />`;
  const block = /<!-- og:start[\s\S]*?<!-- og:end -->/;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(meta.title)} · Hjerterum</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${attr(meta.description)}" />`)
    .replace(block.test(html) ? block : /<\/head>/, block.test(html) ? tags : `${tags}\n  </head>`);
}
