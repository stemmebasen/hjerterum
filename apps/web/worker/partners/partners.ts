import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { claimJob } from "../saga/store.js";
import { extractPriceMinor, formatKrMinor, MAX_PARTNER_AMOUNT_MINOR, MAX_PARTNER_PERCENT, partnerDiscountLabel, partnerMemberPriceMinor,
  type PartnerDiscount } from "../../../../packages/core/src/partner-benefit.js";
import { contentHash, parseFeed, webUrl, type FeedEvent } from "./feed.js";

/** Partnerplanen, fase 1 (docs/decisions/0006-partner-events.md). The board records a partner's yes
 * (the discount, how members get it, and the partner's calendar address) in the cockpit; from then on
 * Saga reads the partner's calendar every hour and keeps the partner's coming events in Hjerterum's
 * calendar - new, changed, cancelled and past - without anyone doing anything. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How far ahead partner events are shown. */
export const PARTNER_WINDOW_DAYS = 180;
const MAX_EVENTS_PER_PARTNER = 300;
const MAX_FEED_BYTES = 3_000_000;
const MAX_PARTNERS_PER_RUN = 25;

export type PartnerStatus = "active" | "paused" | "ended";
export type Partner = {
  id: number; name: string; website: string | null; contact_name: string | null; contact_email: string | null; feed_url: string | null;
  discount_kind: "percent" | "amount"; discount_value: number; redemption: string; status: PartnerStatus; agreed_on: string | null; note: string | null;
  last_sync_at_ms: number | null; last_sync_ok: number | null; last_sync_message: string | null; created_by: string; created_at_ms: number; updated_at_ms: number;
};
export type PartnerInput = {
  name: string; website: string | null; contactName: string | null; contactEmail: string | null; feedUrl: string | null;
  discount: PartnerDiscount; redemption: string; agreedOn: string | null; note: string | null;
};
export type PartnerEventRow = {
  id: number; partner_id: number; source_uid: string; title: string; starts_at_ms: number; ends_at_ms: number | null; all_day: number; location: string | null;
  description: string | null; link: string | null; image_url: string | null; category: string | null; price_minor: number | null; hidden: number;
  hidden_by: string | null; removed_at_ms: number | null;
};

export const DEFAULT_REDEMPTION = "Skriv \"Hjerterum-medlem\" ved tilmeldingen, og vis dit medlemskab, hvis arrangøren beder om det.";

const field = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** The board's form, checked. Every error is a sentence the board can act on. */
export function partnerInput(form: FormData): { ok: true; value: PartnerInput } | { ok: false; error: string } {
  const name = field(form, "name", 120);
  if (!name) return { ok: false, error: "Skriv partnerens navn." };
  const websiteText = field(form, "website", 300);
  const website = websiteText ? webUrl(/^https?:\/\//i.test(websiteText) ? websiteText : `https://${websiteText}`) : null;
  if (websiteText && !website) return { ok: false, error: "Hjemmesiden skal være en almindelig webadresse." };
  const contactEmail = field(form, "contact_email", 200).toLowerCase() || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { ok: false, error: "Kontaktpersonens e-mail ser forkert ud." };
  const feedText = field(form, "feed_url", 500).replace(/^webcals?:\/\//i, "https://");
  const feedUrl = feedText ? webUrl(feedText, true) : null;
  if (feedText && !feedUrl) return { ok: false, error: "Kalenderadressen skal begynde med https:// (eller webcal://)." };
  const kind = form.get("discount_kind") === "amount" ? "amount" : "percent";
  const amountText = field(form, "discount_value", 12).replace(/\s|%|kr\.?/gi, "").replace(",", ".");
  const amount = Number(amountText);
  const value = kind === "percent" ? amount : Math.round(amount * 100);
  if (!amountText || !Number.isFinite(amount) || !Number.isSafeInteger(value) || value <= 0
    || (kind === "percent" ? value > MAX_PARTNER_PERCENT : value > MAX_PARTNER_AMOUNT_MINOR))
    return { ok: false, error: kind === "percent" ? `Rabatten skal være et helt antal procent mellem 1 og ${MAX_PARTNER_PERCENT}.` : "Rabatten skal være et beløb i kroner over 0." };
  const redemption = field(form, "redemption", 500);
  if (!redemption) return { ok: false, error: "Skriv, hvordan et medlem får rabatten (fx en rabatkode)." };
  const agreedText = field(form, "agreed_on", 10);
  if (agreedText && !/^20\d{2}-\d{2}-\d{2}$/.test(agreedText)) return { ok: false, error: "Datoen for aftalen skal skrives som ÅÅÅÅ-MM-DD." };
  return { ok: true, value: { name, website, contactName: field(form, "contact_name", 120) || null, contactEmail, feedUrl, discount: { kind, value }, redemption,
    agreedOn: agreedText || null, note: String(form.get("note") ?? "").trim().slice(0, 1000) || null } };
}

export async function createPartner(db: D1Database, input: PartnerInput, who: string, nowMs: number): Promise<number> {
  const result = await db.prepare(`INSERT INTO partners (name, website, contact_name, contact_email, feed_url, discount_kind, discount_value, redemption, agreed_on, note,
    created_by, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.name, input.website, input.contactName, input.contactEmail, input.feedUrl, input.discount.kind, input.discount.value, input.redemption, input.agreedOn, input.note,
      who, nowMs, nowMs).run();
  return Number(result.meta?.last_row_id);
}

export async function updatePartner(db: D1Database, id: number, input: PartnerInput, nowMs: number): Promise<void> {
  await db.prepare(`UPDATE partners SET name = ?, website = ?, contact_name = ?, contact_email = ?, feed_url = ?, discount_kind = ?, discount_value = ?, redemption = ?,
    agreed_on = ?, note = ?, updated_at_ms = ? WHERE id = ?`)
    .bind(input.name, input.website, input.contactName, input.contactEmail, input.feedUrl, input.discount.kind, input.discount.value, input.redemption, input.agreedOn,
      input.note, nowMs, id).run();
}

export async function setPartnerStatus(db: D1Database, id: number, status: PartnerStatus, nowMs: number): Promise<void> {
  await db.prepare("UPDATE partners SET status = ?, updated_at_ms = ? WHERE id = ?").bind(status, nowMs, id).run();
}

export async function getPartner(db: D1Database, id: number): Promise<Partner | null> {
  return db.prepare("SELECT * FROM partners WHERE id = ?").bind(id).first<Partner>();
}

export type PartnerListed = Partner & { coming: number; hidden_count: number };

export async function listPartners(db: D1Database, nowMs: number): Promise<PartnerListed[]> {
  const rows = await db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM partner_events e WHERE e.partner_id = p.id AND e.removed_at_ms IS NULL AND e.hidden = 0 AND e.starts_at_ms >= ?) AS coming,
      (SELECT COUNT(*) FROM partner_events e WHERE e.partner_id = p.id AND e.removed_at_ms IS NULL AND e.hidden = 1 AND e.starts_at_ms >= ?) AS hidden_count
    FROM partners p ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.name COLLATE NOCASE`).bind(nowMs, nowMs).all<PartnerListed>();
  return rows.results ?? [];
}

export async function partnerEventRows(db: D1Database, partnerId: number, nowMs: number): Promise<PartnerEventRow[]> {
  const rows = await db.prepare(`SELECT id, partner_id, source_uid, title, starts_at_ms, ends_at_ms, all_day, location, description, link, image_url, category, price_minor,
      hidden, hidden_by, removed_at_ms FROM partner_events WHERE partner_id = ? AND COALESCE(ends_at_ms, starts_at_ms + ?) >= ? ORDER BY starts_at_ms LIMIT 300`)
    .bind(partnerId, 3 * HOUR, nowMs).all<PartnerEventRow>();
  return rows.results ?? [];
}

export async function setEventHidden(db: D1Database, partnerId: number, eventId: number, hidden: boolean, who: string): Promise<boolean> {
  const result = await db.prepare("UPDATE partner_events SET hidden = ?, hidden_by = ? WHERE id = ? AND partner_id = ?")
    .bind(hidden ? 1 : 0, hidden ? who : null, eventId, partnerId).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

// ---- Saga keeps the partner's events in step ----

const COLUMNS = ["partner_id", "source_uid", "title", "starts_at_ms", "ends_at_ms", "all_day", "location", "description", "link", "image_url", "category", "price_minor",
  "content_hash", "removed_at_ms", "first_seen_at_ms", "updated_at_ms"] as const;
const ROWS_PER_STATEMENT = 6; // D1 takes at most 100 bound values per statement.

function eventRow(partnerId: number, event: FeedEvent, nowMs: number): unknown[] {
  const values = [event.title, event.startsAtMs, event.endsAtMs, event.allDay ? 1 : 0, event.location, event.description, event.link, event.imageUrl, event.category,
    extractPriceMinor(`${event.title}\n${event.description ?? ""}`)] as const;
  const removed = event.cancelled ? nowMs : null;
  return [partnerId, event.uid, ...values, contentHash(JSON.stringify([...values, event.cancelled])), removed, nowMs, nowMs];
}

/** The body as text, or null once it passes maxBytes - a huge calendar is never read whole into memory. */
async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export type SyncResult = { ok: boolean; message: string; coming: number; written: number };

/** Reads one partner's calendar and writes what is new, changed or gone. A failing calendar leaves the
 * events already shown as they are and says why on the partner's page in the cockpit. */
export async function syncPartner(db: D1Database, deps: Pick<SagaDeps, "fetcher" | "now">, partner: Pick<Partner, "id" | "feed_url">): Promise<SyncResult> {
  const now = deps.now();
  const finish = async (result: SyncResult) => {
    await db.prepare("UPDATE partners SET last_sync_at_ms = ?, last_sync_ok = ?, last_sync_message = ? WHERE id = ?")
      .bind(now, result.ok ? 1 : 0, result.message.slice(0, 300), partner.id).run();
    return result;
  };
  if (!partner.feed_url) return finish({ ok: false, message: "Der er ingen kalenderadresse - tilføj den, så henter Saga partnerens events.", coming: 0, written: 0 });
  let source: string;
  try {
    const response = await deps.fetcher(partner.feed_url, { redirect: "follow", signal: AbortSignal.timeout(15_000),
      headers: { accept: "text/calendar, application/rss+xml, application/xml;q=0.9, */*;q=0.5", "user-agent": "Hjerterum partnerkalender (+https://hjerterum.info)" } });
    if (!response.ok) return finish({ ok: false, message: `Kalenderen svarede med fejl ${response.status}. De viste events er beholdt.`, coming: 0, written: 0 });
    const text = await readLimited(response, MAX_FEED_BYTES);
    if (text === null) return finish({ ok: false, message: "Kalenderen er for stor (over 3 MB). Bed partneren om en adresse med kun kommende events.", coming: 0, written: 0 });
    source = text;
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return finish({ ok: false, message: timeout ? "Kalenderen svarede ikke inden for 15 sekunder. De viste events er beholdt." : "Kalenderen kunne ikke hentes. De viste events er beholdt.", coming: 0, written: 0 });
  }
  const feed = parseFeed(source);
  if (!feed) return finish({ ok: false, message: "Adressen er hverken en iCal- eller RSS-kalender. Tjek, at det er kalenderens abonnements-/eksportadresse.", coming: 0, written: 0 });

  const events = feed.events
    .filter(e => (e.endsAtMs ?? e.startsAtMs + 3 * HOUR) >= now && e.startsAtMs < now + PARTNER_WINDOW_DAYS * DAY)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  // One event per uid (a calendar can repeat one); the first wins.
  const uids = new Set<string>();
  const unique = events.filter(e => !uids.has(e.uid) && uids.add(e.uid)).slice(0, MAX_EVENTS_PER_PARTNER);
  const known = new Map(((await db.prepare("SELECT source_uid, content_hash, removed_at_ms FROM partner_events WHERE partner_id = ?").bind(partner.id)
    .all<{ source_uid: string; content_hash: string; removed_at_ms: number | null }>()).results ?? []).map(r => [r.source_uid, r]));
  const rows = unique.map(e => eventRow(partner.id, e, now)).filter(r => {
    const was = known.get(r[1] as string);
    return !was || was.content_hash !== r[12] || (was.removed_at_ms !== null) !== (r[13] !== null);
  });
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    await db.prepare(`INSERT INTO partner_events (${COLUMNS.join(", ")}) VALUES ${chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ")}
      ON CONFLICT(partner_id, source_uid) DO UPDATE SET title = excluded.title, starts_at_ms = excluded.starts_at_ms, ends_at_ms = excluded.ends_at_ms, all_day = excluded.all_day,
      location = excluded.location, description = excluded.description, link = excluded.link, image_url = excluded.image_url, category = excluded.category,
      price_minor = excluded.price_minor, content_hash = excluded.content_hash, removed_at_ms = excluded.removed_at_ms, updated_at_ms = excluded.updated_at_ms`)
      .bind(...chunk.flat()).run();
  }
  // A coming event that is no longer in the partner's calendar was taken off.
  const gone = [...known.keys()].filter(uid => !uids.has(uid));
  for (let i = 0; i < gone.length; i += 90) {
    const chunk = gone.slice(i, i + 90);
    await db.prepare(`UPDATE partner_events SET removed_at_ms = ?, updated_at_ms = ? WHERE partner_id = ? AND removed_at_ms IS NULL AND starts_at_ms > ?
      AND source_uid IN (${chunk.map(() => "?").join(", ")})`).bind(now, now, partner.id, now, ...chunk).run();
  }
  const coming = unique.filter(e => !e.cancelled).length;
  const parts = [`${coming} kommende event${coming === 1 ? "" : "s"} (${feed.kind === "ics" ? "iCal" : "RSS"})`];
  if (feed.recurring) parts.push(`${feed.recurring} ${feed.recurring === 1 ? "gentagen serie" : "gentagne serier"} vises ikke endnu`);
  return finish({ ok: true, message: parts.join(" · "), coming, written: rows.length });
}

/** Every five minutes from the cron; each active partner's calendar is read once an hour. No AI. */
export async function runPartnerSync(env: SagaEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db) return;
  const now = deps.now();
  if (!(await claimJob(db, "partner_events", Math.floor(now / HOUR) * HOUR, now))) return;
  const partners = (await db.prepare("SELECT id, feed_url FROM partners WHERE status = 'active' AND feed_url IS NOT NULL ORDER BY id LIMIT ?")
    .bind(MAX_PARTNERS_PER_RUN).all<Pick<Partner, "id" | "feed_url">>()).results ?? [];
  for (const partner of partners) {
    await syncPartner(db, deps, partner).catch(error => console.warn("partner_sync_failed", partner.id, error instanceof Error ? error.message : error));
  }
}

// ---- What the calendar shows ----

export type PartnerEventView = {
  id: number; partnerId: number; partnerName: string; partnerWebsite: string | null; title: string; description: string | null; startsAt: string; endsAt: string | null;
  allDay: boolean; location: string | null; imageUrl: string | null; category: string | null;
  /** The partner's normal price and the member price, when the event states the price; else null. */
  price: string | null; memberPrice: string | null; discount: string;
  /** Through Hjerterum, so a click to the partner is counted (fase 2). */
  link: string | null;
};
export type MemberPartnerEventView = PartnerEventView & { redemption: string };

type ListedRow = PartnerEventRow & { partner_name: string; partner_website: string | null; discount_kind: "percent" | "amount"; discount_value: number; redemption: string };

async function listedEvents(db: D1Database, nowMs: number): Promise<ListedRow[]> {
  const rows = await db.prepare(`SELECT e.id, e.partner_id, e.source_uid, e.title, e.starts_at_ms, e.ends_at_ms, e.all_day, e.location, e.description, e.link, e.image_url, e.category,
      e.price_minor, e.hidden, e.hidden_by, e.removed_at_ms, p.name AS partner_name, p.website AS partner_website, p.discount_kind, p.discount_value, p.redemption
    FROM partner_events e JOIN partners p ON p.id = e.partner_id
    WHERE p.status = 'active' AND e.hidden = 0 AND e.removed_at_ms IS NULL AND COALESCE(e.ends_at_ms, e.starts_at_ms + ?) >= ? AND e.starts_at_ms < ?
    ORDER BY e.starts_at_ms LIMIT 200`).bind(3 * HOUR, nowMs, nowMs + PARTNER_WINDOW_DAYS * DAY).all<ListedRow>();
  return rows.results ?? [];
}

function view(row: ListedRow, audience: "public" | "member"): PartnerEventView {
  const discount: PartnerDiscount = { kind: row.discount_kind, value: row.discount_value };
  const member = partnerMemberPriceMinor(row.price_minor, discount);
  return {
    id: row.id, partnerId: row.partner_id, partnerName: row.partner_name, partnerWebsite: row.partner_website, title: row.title, description: row.description,
    startsAt: new Date(row.starts_at_ms).toISOString(), endsAt: row.ends_at_ms === null ? null : new Date(row.ends_at_ms).toISOString(), allDay: row.all_day === 1,
    location: row.location, imageUrl: row.image_url, category: row.category,
    price: row.price_minor === null ? null : row.price_minor === 0 ? "Gratis" : formatKrMinor(row.price_minor),
    memberPrice: member === null || row.price_minor === 0 ? null : formatKrMinor(member),
    discount: `${partnerDiscountLabel(discount)} for Hjerterum-medlemmer`,
    link: row.link || row.partner_website ? `/api/events/partners/${row.id}/go${audience === "member" ? "?fra=medlem" : ""}` : null
  };
}

/** The public calendar: the event, the partner and the discount - never how the discount is redeemed. */
export async function publicPartnerEvents(db: D1Database, nowMs: number): Promise<PartnerEventView[]> {
  return (await listedEvents(db, nowMs)).map(row => view(row, "public"));
}

/** A member with member benefits: also how to get the discount. Counts that the member saw each
 * partner's events (fase 2), without recording who. */
export async function memberPartnerEvents(db: D1Database, nowMs: number): Promise<MemberPartnerEventView[]> {
  const rows = await listedEvents(db, nowMs);
  const partners = [...new Set(rows.map(r => r.partner_id))];
  if (partners.length) {
    await db.prepare(`INSERT INTO partner_metrics (day, partner_id, event_id, metric, n) SELECT ?, id, 0, 'member_view', 1 FROM partners WHERE id IN (${partners.map(() => "?").join(", ")})
      ON CONFLICT(day, partner_id, event_id, metric) DO UPDATE SET n = n + 1`).bind(copenhagenDay(nowMs), ...partners).run().catch(() => undefined);
  }
  return rows.map(row => ({ ...view(row, "member"), redemption: row.redemption }));
}

export const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);

/** Where a click on a partner event goes: the event's own page, else the partner's site. Counted. */
export async function partnerEventDestination(db: D1Database, eventId: number, member: boolean, nowMs: number): Promise<string | null> {
  const row = await db.prepare("SELECT e.partner_id, e.link, p.website FROM partner_events e JOIN partners p ON p.id = e.partner_id WHERE e.id = ? AND p.status <> 'ended'")
    .bind(eventId).first<{ partner_id: number; link: string | null; website: string | null }>();
  const destination = webUrl(row?.link) ?? webUrl(row?.website);
  if (!row || !destination) return null;
  await db.prepare(`INSERT INTO partner_metrics (day, partner_id, event_id, metric, n) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(day, partner_id, event_id, metric) DO UPDATE SET n = n + 1`).bind(copenhagenDay(nowMs), row.partner_id, eventId, member ? "member_click" : "click").run().catch(() => undefined);
  return destination;
}

export type PartnerMetrics = { clicks: number; memberClicks: number; memberViews: number };

/** Fase 2's numbers per partner since a day (YYYY-MM-DD). */
export async function partnerMetrics(db: D1Database, sinceDay: string): Promise<Map<number, PartnerMetrics>> {
  const rows = await db.prepare("SELECT partner_id, metric, SUM(n) AS n FROM partner_metrics WHERE day >= ? GROUP BY partner_id, metric").bind(sinceDay)
    .all<{ partner_id: number; metric: string; n: number }>();
  const metrics = new Map<number, PartnerMetrics>();
  for (const row of rows.results ?? []) {
    const m = metrics.get(row.partner_id) ?? { clicks: 0, memberClicks: 0, memberViews: 0 };
    if (row.metric === "click") m.clicks += Number(row.n);
    if (row.metric === "member_click") m.memberClicks += Number(row.n);
    if (row.metric === "member_view") m.memberViews += Number(row.n);
    metrics.set(row.partner_id, m);
  }
  return metrics;
}

/** Clicks per event for one partner since a day. */
export async function eventClicks(db: D1Database, partnerId: number, sinceDay: string): Promise<Map<number, { clicks: number; memberClicks: number }>> {
  const rows = await db.prepare("SELECT event_id, metric, SUM(n) AS n FROM partner_metrics WHERE partner_id = ? AND event_id > 0 AND day >= ? GROUP BY event_id, metric")
    .bind(partnerId, sinceDay).all<{ event_id: number; metric: string; n: number }>();
  const clicks = new Map<number, { clicks: number; memberClicks: number }>();
  for (const row of rows.results ?? []) {
    const c = clicks.get(row.event_id) ?? { clicks: 0, memberClicks: 0 };
    if (row.metric === "click") c.clicks += Number(row.n); else if (row.metric === "member_click") c.memberClicks += Number(row.n);
    clicks.set(row.event_id, c);
  }
  return clicks;
}
