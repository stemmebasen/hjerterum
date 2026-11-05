import type { D1Database } from "./db.js";

/** Requested (the chair, 5 Nov 2026): "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside." Until the chair says the
 * new website is in use (PR og SoMe → "Den nye hjemmeside er i brug"), what goes out to the public - the posts on Facebook and Instagram and the
 * newsletter - links to the old website (holistisk.org) instead of www.hjerterum.info: an event to its page there, the calendar to its event list.
 * The pictures stay where they are. An event that only exists in the new system (a member's own, /events/h12) keeps its new address. */

export const NEW_SITE = "https://www.hjerterum.info";
export const OLD_SITE = "https://holistisk.org";
export const OLD_EVENTS = `${OLD_SITE}/events/`;
const KEY = "public_site_live";

export async function siteLive(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT setting_value AS v FROM platform_settings WHERE setting_key = ?").bind(KEY).first<{ v: string }>().catch(() => null);
  return row?.v === "1";
}

export async function setSiteLive(db: D1Database, live: boolean, by: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO platform_settings (setting_key, setting_value, updated_by_email, updated_at_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by_email = excluded.updated_by_email, updated_at_ms = excluded.updated_at_ms`)
    .bind(KEY, live ? "1" : "0", by, nowMs).run();
}

const EVENT_PAGE = /https?:\/\/(?:www\.)?hjerterum\.info\/events\/([0-9a-f]{24})\b\/?/g;
const EVENTS = /https?:\/\/(?:www\.)?hjerterum\.info\/events(?![\w/-]*h\d)(?:\/(?![0-9a-f]{24}))?(?=[\s)"'<.,!?]|$)/g;
const SHORT = /\b(?:www\.)?hjerterum\.info\/events\b(?!\/)/g;

/** The text (or HTML) as it may go out today: with the old website's addresses while the new one is not in use. */
export async function toPublicSite(db: D1Database, text: string, live?: boolean): Promise<string> {
  if (!text || (live ?? await siteLive(db))) return text;
  const ids = [...new Set([...text.matchAll(EVENT_PAGE)].map(m => `SF${m[1]}`))];
  const links = new Map<string, string>();
  if (ids.length) {
    const rows = await db.prepare(`SELECT id, link FROM house_events WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).all<{ id: string; link: string | null }>().catch(() => null);
    for (const r of rows?.results ?? []) if (r.link && /^https:\/\//.test(r.link)) links.set(r.id, r.link);
  }
  return text
    .replace(EVENT_PAGE, (_all, hex: string) => links.get(`SF${hex}`) ?? OLD_EVENTS)
    .replace(EVENTS, OLD_EVENTS)
    .replace(SHORT, "holistisk.org/events");
}
