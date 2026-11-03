import type { D1Database } from "../db.js";
import { monthEvents, monthOf, type NewsletterEvent } from "../newsletter.js";
import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { claimJob } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";
import { keySecret } from "../saga/teamMail.js";
import { prReadyNames } from "../cockpit/prMaterial.js";
import { instagramName } from "../../pr-material.js";
import { finishReel, followerCounts, instagramMedia, postToPage, publishToInstagram, reelStatus, startReel, taggedOnFacebook, taggedOnInstagram, type MetaEnv, type TaggedPost } from "./meta.js";
import { clock, dateOf, dayName, EVERY_EVENT, eventPostTimes, mondayOf, nextMonday, pickWeekEvents, plainEventText, PLAIN_WEEK_INTRO, planDue, SITE, weekKey, weekPostTime, weekStart, weekText } from "./plan.js";

/** The PR cockpit (admin → Kommunikation → PR og SoMe), requested by the chair (3 Nov 2026):
 * "1 Videredele opslag som undervisere laver og tagger os i. 2 Dele 7-10 begivenheder pr uge direkte på fb, bare med et lille opslag.
 * (since: "Kan vi systematisk sørge for at alle events deles mindst én gang" - every event now gets its post)
 * 3 ugens events på SoMe" - "som skal automatiseres smart".
 * Saga does the work: she finds what Hjerterum is tagged in and drafts a few words for passing it on; on Thursday she plans next week
 * (7-10 events, each with a little post on Facebook, and "Ugens events" on Facebook and Instagram on Monday morning). Nothing goes out
 * before the chair has approved it - the house's rule for what goes to many - and an approved post goes out at its time, once. */

export type SocialEnv = SagaEnv & MetaEnv;
export type Channel = "facebook" | "instagram";
export type SocialKind = "share" | "event" | "week";
export type SocialStatus = "draft" | "approved" | "publishing" | "published" | "failed" | "skipped";

export type SocialAccount = { page_id: string; page_name: string; page_token_sealed: string; ig_user_id: string | null; ig_username: string | null;
  connected_by: string; connected_at_ms: number; checked_at_ms: number | null; check_error: string | null };

export type ShareSource = { network: Channel; id: string; author: string | null; permalink: string | null; text: string; media: TaggedPost["media"]; createdMs: number; consent: boolean };
export type EventSource = { key: string; title: string; startsMs: number; host: string | null };
export type SocialPost = { id: number; kind: SocialKind; source_key: string; week: string | null; channels: Channel[]; text: string; link: string | null; images: string[];
  source: Partial<ShareSource & EventSource> & { instagramText?: string; events?: EventSource[]; collaborators?: string[]; format?: "reel"; video?: string }; publish_at_ms: number | null; status: SocialStatus;
  approved_by: string | null; approved_at_ms: number | null; published: Partial<Record<Channel | "instagram_container", string>>; published_at_ms: number | null; error: string | null;
  created_at_ms: number; updated_at_ms: number };

const MINUTE = 60_000;
/** How often Saga looks for new tags. */
export const TAG_EVERY_MS = 30 * MINUTE;
/** An approved post that could not go out is tried again, at most this often and this many times. */
const RETRY_AFTER_MS = 30 * MINUTE;

// ---- The sealed token ----

async function sealKey(env: SagaEnv): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(keySecret(env)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("hjerterum-social"), info: new TextEncoder().encode("page-token:v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export async function sealToken(env: SagaEnv, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `v1.${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), new TextEncoder().encode(token))))}`;
}
export async function openToken(env: SagaEnv, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("social_token_unreadable");
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(env), unb64(data))); }
  catch { throw new Error("social_token_unreadable"); }
}

// ---- The account ----

export async function socialAccount(db: D1Database): Promise<SocialAccount | null> {
  return db.prepare("SELECT page_id, page_name, page_token_sealed, ig_user_id, ig_username, connected_by, connected_at_ms, checked_at_ms, check_error FROM social_account WHERE id = 1")
    .first<SocialAccount>().catch(() => null);
}

export async function connectSocial(env: SagaEnv, db: D1Database, page: { id: string; name: string; token: string; igUserId: string | null; igUsername: string | null }, by: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO social_account (id, page_id, page_name, page_token_sealed, ig_user_id, ig_username, connected_by, connected_at_ms, checked_at_ms, check_error)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, page_name = excluded.page_name, page_token_sealed = excluded.page_token_sealed,
    ig_user_id = excluded.ig_user_id, ig_username = excluded.ig_username, connected_by = excluded.connected_by, connected_at_ms = excluded.connected_at_ms, checked_at_ms = NULL, check_error = NULL`)
    .bind(page.id, page.name.slice(0, 200), await sealToken(env, page.token), page.igUserId, page.igUsername, by, nowMs).run();
}

export async function disconnectSocial(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM social_account WHERE id = 1").run();
}

async function access(env: SagaEnv, account: SocialAccount) {
  const token = await openToken(env, account.page_token_sealed);
  return { page: { id: account.page_id, token }, instagram: account.ig_user_id ? { igUserId: account.ig_user_id, token } : null };
}

// ---- The posts ----

type Row = Omit<SocialPost, "channels" | "images" | "source" | "published"> & { channels: string; images: string; source: string; published: string };
const COLUMNS = "id, kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, approved_by, approved_at_ms, published, published_at_ms, error, created_at_ms, updated_at_ms";
const parse = <T>(text: string, fallback: T): T => { try { return JSON.parse(text) as T; } catch { return fallback; } };
const toPost = (r: Row): SocialPost => ({ ...r, channels: parse(r.channels, []), images: parse(r.images, []), source: parse(r.source, {}), published: parse(r.published, {}) });

export async function socialPost(db: D1Database, id: number): Promise<SocialPost | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM social_posts WHERE id = ?`).bind(id).first<Row>().catch(() => null);
  return row ? toPost(row) : null;
}
export async function socialPosts(db: D1Database, where: string, values: unknown[] = [], order = "publish_at_ms, id", limit = 100): Promise<SocialPost[]> {
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM social_posts WHERE ${where} ORDER BY ${order} LIMIT ?`).bind(...values, limit).all<Row>().then(r => r.results ?? []).catch(() => [] as Row[]);
  return rows.map(toPost);
}
/** The tagged posts waiting for the chair, newest first. */
export const waitingShares = (db: D1Database) => socialPosts(db, "kind = 'share' AND status = 'draft'", [], "created_at_ms DESC, id DESC", 50);
/** A week's posts: "Ugens events" first, then the events by time. */
export const weekPosts = (db: D1Database, week: string) => socialPosts(db, "week = ? AND kind IN ('week', 'event')", [week], "CASE kind WHEN 'week' THEN 0 ELSE 1 END, publish_at_ms, id", 20);
/** What has gone out or failed lately. */
export const recentPosts = (db: D1Database) => socialPosts(db, "status IN ('published', 'failed', 'publishing')", [], "COALESCE(published_at_ms, updated_at_ms) DESC, id DESC", 30);
export async function waitingCount(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE status = 'draft'").first<{ n: number }>().catch(() => null))?.n ?? 0;
}

async function insertPost(db: D1Database, post: { kind: SocialKind; sourceKey: string; week?: string | null; channels: Channel[]; text: string; link?: string | null; images?: string[];
  source: unknown; publishAtMs: number | null }, nowMs: number): Promise<boolean> {
  const result = await db.prepare(`INSERT OR IGNORE INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).bind(post.kind, post.sourceKey, post.week ?? null, JSON.stringify(post.channels), post.text, post.link ?? null,
    JSON.stringify(post.images ?? []), JSON.stringify(post.source), post.publishAtMs, nowMs, nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

/** The chair changes a post that has not gone out: its words, where it goes and (for the week's posts) when. A changed post is a draft again. */
export async function editPost(db: D1Database, id: number, change: { text?: string; instagramText?: string; collaborators?: string[]; channels?: Channel[]; publishAtMs?: number | null }, nowMs: number): Promise<boolean> {
  const post = await socialPost(db, id);
  if (!post || !["draft", "approved", "failed", "skipped"].includes(post.status)) return false;
  const source = { ...post.source, ...(change.instagramText !== undefined ? { instagramText: change.instagramText } : {}), ...(change.collaborators !== undefined ? { collaborators: change.collaborators.slice(0, 3) } : {}) };
  await db.prepare(`UPDATE social_posts SET text = ?, channels = ?, source = ?, publish_at_ms = ?, status = 'draft', approved_by = NULL, approved_at_ms = NULL, error = NULL, updated_at_ms = ? WHERE id = ?`)
    .bind(change.text ?? post.text, JSON.stringify(change.channels ?? post.channels), JSON.stringify(source), change.publishAtMs !== undefined ? change.publishAtMs : post.publish_at_ms, nowMs, id).run();
  return true;
}

/** Approved (it goes out at its time - a passed-on post at once), skipped, or back to a draft. Never for what is already out. */
export async function decidePost(db: D1Database, id: number, decision: "approve" | "skip" | "undo", who: string, nowMs: number): Promise<SocialPost | null> {
  const post = await socialPost(db, id);
  if (!post || post.status === "published" || post.status === "publishing") return null;
  if (decision === "approve" && !post.channels.length) return null;
  const status = decision === "approve" ? "approved" : decision === "skip" ? "skipped" : "draft";
  const publishAt = decision === "approve" && post.kind === "share" ? nowMs : post.publish_at_ms;
  await db.prepare("UPDATE social_posts SET status = ?, approved_by = ?, approved_at_ms = ?, publish_at_ms = ?, error = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(status, decision === "approve" ? who : null, decision === "approve" ? nowMs : null, publishAt, nowMs, id).run();
  return socialPost(db, id);
}

/** "Godkend hele ugen": every draft of the week whose time has not passed. */
export async function approveWeek(db: D1Database, week: string, who: string, nowMs: number): Promise<number> {
  const result = await db.prepare(`UPDATE social_posts SET status = 'approved', approved_by = ?, approved_at_ms = ?, error = NULL, updated_at_ms = ?
    WHERE week = ? AND kind IN ('week', 'event') AND status = 'draft' AND channels <> '[]' AND (publish_at_ms IS NULL OR publish_at_ms > ?)`).bind(who, nowMs, nowMs, week, nowMs).run();
  return Number(result.meta?.changes ?? 0);
}

// ---- 1. What Hjerterum is tagged in ----

const SHARE_SYSTEM = "Du skriver for Hjerterum, en forening og et hus i Aarhus for meditation, yoga, personlig udvikling og fællesskab. "
  + "Hjerterum deler et opslag, som en underviser eller en anden har lavet og tagget Hjerterum i. Skriv 1-2 korte, varme sætninger (højst 30 ord) på dansk, "
  + "som Hjerterum sætter over delingen: tak gerne personen ved fornavn og sig kort, hvad opslaget handler om, ud fra teksten. Find ikke på detaljer, "
  + "ingen helbredsløfter, ingen emojis, ingen hashtags, ingen links. Svar kun med teksten.";

export const firstName = (name: string | null) => (name ?? "").replace(/^@/, "").split(/\s+/)[0] ?? "";
export const plainShareText = (author: string | null) => `Tak til ${firstName(author) || "jer"} for at dele. Vi glæder os til at se jer i Hjerterum.`;
/** On Instagram the post is published again by Hjerterum, so the maker is named, and their own words follow. */
export const instagramShareText = (intro: string, author: string | null, original: string) =>
  `${intro.trim()}\n\nFoto og tekst: ${author ? `@${author.replace(/^@/, "")}` : "afsenderen"}${original.trim() ? `\n\n${original.trim().slice(0, 1800)}` : ""}`;

async function shareIntro(env: SagaEnv, deps: SagaDeps, post: TaggedPost): Promise<string> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return plainShareText(post.author);
  const text = await completeAs("social-share", true, 200)(env, deps, [{ role: "system", content: SHARE_SYSTEM },
    { role: "user", content: JSON.stringify({ fra: post.author, netvaerk: post.network, tekst: post.text.replace(/\s+/g, " ").slice(0, 1200) }) }])
    .then(t => t.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 400)).catch(() => "");
  return text || plainShareText(post.author);
}

/** Every half hour: new posts that tag Hjerterum become drafts for the chair (each once), and the chair is told in one message. */
export async function scanTags(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const account = await socialAccount(db);
  if (!account) return 0;
  const now = deps.now();
  let found: TaggedPost[] = [];
  const problems: string[] = [];
  try {
    const { page, instagram } = await access(env, account);
    found.push(...await taggedOnFacebook(deps.fetcher, page).catch(error => { problems.push(`Facebook: ${error instanceof Error ? error.message : error}`); return []; }));
    if (instagram) found.push(...await taggedOnInstagram(deps.fetcher, instagram).catch(error => { problems.push(`Instagram: ${error instanceof Error ? error.message : error}`); return []; }));
  } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  await db.prepare("UPDATE social_account SET checked_at_ms = ?, check_error = ? WHERE id = 1").bind(now, problems.join(" · ").slice(0, 500) || null).run().catch(() => undefined);
  // Only what was posted after the page was connected: the first look does not bring up years of old tags.
  found = found.filter(p => p.createdMs >= account.connected_at_ms - 14 * 86_400_000);
  const known = new Set((await db.prepare("SELECT source_key FROM social_posts WHERE kind = 'share' AND source_key IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(found.map(p => `${p.network}:${p.id}`))).all<{ source_key: string }>().then(r => r.results ?? []).catch(() => [])).map(r => r.source_key));
  const fresh = found.filter(p => !known.has(`${p.network}:${p.id}`)).slice(0, 10);
  if (!fresh.length) return 0;
  const ready = await prReadyNames(db);
  let made = 0;
  for (const post of fresh) {
    const intro = await shareIntro(env, deps, post);
    const consent = Boolean(post.author && ready.has(post.author.trim().toLowerCase()));
    // Facebook: shared as a link to the post. Instagram: published again (photos only), with its maker named.
    const instagramOk = post.network === "instagram" && (post.media === "image" || post.media === "carousel") && Boolean(account.ig_user_id);
    const channels: Channel[] = post.network === "facebook" ? ["facebook"] : instagramOk ? ["instagram"] : ["facebook"];
    const source: ShareSource & { instagramText?: string; collaborators?: string[] } = { network: post.network, id: post.id, author: post.author, permalink: post.permalink, text: post.text.slice(0, 2200),
      media: post.media, createdMs: post.createdMs, consent, ...(post.network === "instagram" ? { instagramText: instagramShareText(intro, post.author, post.text),
        // The one who made it is invited as collaborator on Hjerterum's post of it.
        collaborators: [instagramName(post.author)].filter((n): n is string => Boolean(n)) } : {}) };
    if (await insertPost(db, { kind: "share", sourceKey: `${post.network}:${post.id}`, channels, text: intro, link: post.permalink, images: post.images.slice(0, 10), source, publishAtMs: null }, now)) made++;
  }
  if (made) await tellChair(env, deps, `${made === 1 ? "Ét nyt opslag" : `${made} nye opslag`} har tagget Hjerterum. Se dem og del dem her: ${cockpitUrl(env)}/pr`);
  return made;
}

// ---- 2 and 3. The week ----

const WEEK_SYSTEM = `Du skriver Hjerterums opslag på Facebook og Instagram (Hjerterum er en forening og et hus i Aarhus for meditation, yoga, personlig udvikling og fællesskab).
Du får ugens udvalgte events med en reference (E1, E2 ...). Svar KUN med JSON: {"uge": "...", "events": {"E1": "..."}}
- "uge": 1-2 korte, varme sætninger (højst 35 ord), der indleder "Ugens events" - hvad ugen byder på (bredden, ingen navne). Listen over events sættes ind under teksten af systemet.
- "events": et lille opslag til hvert event på Facebook: 2-3 korte sætninger, højst 45 ord. Hvad det er, hvem der leder det (fornavn), og hvornår (ugedag og "kl. TT.MM", som de står i feltet "hvornaar" - aldrig en dato). Linket til eventet sættes på af systemet, så skriv ingen adresse.
Varmt, konkret og roligt. Find ikke på detaljer, der ikke står i beskrivelsen. Ingen helbredsløfter, ingen emojis, ingen hashtags, ingen udråbstegn. Skriv på dansk.`;

type WeekWords = { intro: string; events: Record<string, string> };

async function weekWords(env: SagaEnv, deps: SagaDeps, events: NewsletterEvent[]): Promise<WeekWords> {
  const plain: WeekWords = { intro: PLAIN_WEEK_INTRO, events: Object.fromEntries(events.map((e, i) => [`E${i + 1}`, plainEventText(e)])) };
  if (!env.AI_API_KEY || !env.AI_MODEL || !events.length) return plain;
  const raw = await completeAs("social-week", "mid", 2500)(env, deps, [{ role: "system", content: WEEK_SYSTEM }, { role: "user", content: JSON.stringify(events.map((e, i) => ({
    ref: `E${i + 1}`, titel: e.title, underviser: e.host, hvornaar: `${dayName(e.startsMs)} kl. ${clock(e.startsMs)}`, beskrivelse: e.description.slice(0, 600) }))) }]).catch(() => "");
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  const data = json ? parse<{ uge?: unknown; events?: Record<string, unknown> }>(json, {}) : {};
  const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
  return { intro: clean(data.uge, 400) || plain.intro,
    events: Object.fromEntries(Object.entries(plain.events).map(([ref, text]) => [ref, clean(data.events?.[ref], 600) || text])) };
}

/** The events of the week that starts on `monday`: the house's own (not the partner houses'), from the calendar and the members' approved ones. */
export async function weekEvents(db: D1Database, monday: string, fetcher?: typeof fetch): Promise<NewsletterEvent[]> {
  const from = weekStart(monday), to = weekStart(nextMonday(from));
  const months = [...new Set([monthOf(from), monthOf(to - 1)])];
  const all = (await Promise.all(months.map(m => monthEvents(db, m, fetcher)))).flat();
  const byKey = new Map(all.map(e => [e.key, e] as const));
  return [...byKey.values()].filter(e => e.startsMs >= from && e.startsMs < to).sort((a, b) => a.startsMs - b.startsMs);
}

/** Requested (Gitta, 3 Nov 2026, the chair: "Ja"): invite the teachers as "samarbejdspartner" - the Instagram names they gave in their PR material
 * (with their consent), for the events' teachers in order, at most three (Instagram's limit). */
export async function instagramNames(db: D1Database, hosts: Array<string | null>): Promise<string[]> {
  const names = [...new Set(hosts.map(h => (h ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!names.length) return [];
  const rows = await db.prepare(`SELECT lower(trim(n.name)) AS name, m.quotes_json FROM pr_material m
      JOIN (SELECT clerk_user_id, teacher_name AS name FROM room_bookings UNION SELECT clerk_user_id, full_name FROM members
        UNION SELECT clerk_user_id, json_extract(draft_json, '$.name') FROM public_profiles) n ON n.clerk_user_id = m.clerk_user_id
      WHERE m.consent_at_ms IS NOT NULL AND m.withdrawn_at_ms IS NULL AND lower(trim(n.name)) IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(names))
    .all<{ name: string; quotes_json: string }>().then(r => r.results ?? []).catch(() => []);
  const byName = new Map<string, string>();
  for (const r of rows) { const ig = instagramName(parse<{ instagram?: string }>(r.quotes_json, {}).instagram); if (ig && !byName.has(r.name)) byName.set(r.name, ig); }
  return [...new Set(names.map(n => byName.get(n)).filter((n): n is string => Boolean(n)))].slice(0, 3);
}

/** The board's PR wishes for events (Admin → Events): an event someone wished for is shown first. */
async function wishedKeys(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare("SELECT DISTINCT event_id FROM event_pr_wishes WHERE done_at_ms IS NULL").all<{ event_id: string }>().then(r => r.results ?? []).catch(() => []);
  return new Set(rows.flatMap(r => [`mw:${r.event_id}`, `hr:${r.event_id}`]));
}

/** Plans the week that starts on `monday`: "Ugens events" (Facebook and, with pictures, Instagram) on Monday afternoon, and every event of the week with
 * its own little post on Facebook ("alle events deles mindst én gang"). Only what is not planned yet is added - so planning again keeps the chair's
 * changes and skips, and Saga only writes words for the new events. With onlyNew, a week that has not been planned is left alone.
 * Returns how many posts were made, how many events the week has, and how many of them were new. */
export async function planWeek(env: SocialEnv, deps: SagaDeps, db: D1Database, monday: string, options: { onlyNew?: boolean } = {}): Promise<{ made: number; events: number; fresh: number }> {
  const now = deps.now(), week = weekKey(monday);
  const planned = Boolean(await db.prepare("SELECT 1 AS yes FROM social_posts WHERE source_key = ?").bind(`week:${week}`).first().catch(() => null));
  if (options.onlyNew && !planned) return { made: 0, events: 0, fresh: 0 };
  const events = await weekEvents(db, monday, deps.fetcher);
  if (!events.length) return { made: 0, events: 0, fresh: 0 };
  const chosen = pickWeekEvents(events, await wishedKeys(db), EVERY_EVENT);
  const existing = await db.prepare("SELECT source_key, publish_at_ms FROM social_posts WHERE week = ? AND kind = 'event'").bind(week)
    .all<{ source_key: string; publish_at_ms: number | null }>().then(r => r.results ?? []).catch(() => []);
  const known = new Set(existing.map(r => r.source_key));
  // An event that begins within two hours is not given a post it could not get in time.
  const fresh = chosen.filter(e => !known.has(`event:${week}:${e.key}`) && e.startsMs > now + 2 * 3_600_000);
  if (planned && !fresh.length) return { made: 0, events: chosen.length, fresh: 0 };
  const words = await weekWords(env, deps, fresh);
  const account = await socialAccount(db);
  const notBefore = now + 30 * MINUTE;
  let made = 0;
  const eventSource = (e: NewsletterEvent): EventSource => ({ key: e.key, title: e.title, startsMs: e.startsMs, host: e.host });
  if (!planned) {
    // "Ugens events": every event of the week in the list; on Instagram a carousel of up to ten of the week's pictures, the most worth telling first.
    const listed = pickWeekEvents(events, new Set(), 30);
    const pictures = [...new Set(pickWeekEvents(events, await wishedKeys(db)).map(e => e.imageUrl).filter((u): u is string => Boolean(u)))].slice(0, 10);
    const instagram = Boolean(account?.ig_user_id) && pictures.length > 0;
    if (await insertPost(db, { kind: "week", sourceKey: `week:${week}`, week, channels: instagram ? ["facebook", "instagram"] : ["facebook"],
      text: weekText(week, words.intro, listed, "facebook"), link: `${SITE}/events`, images: pictures,
      source: { instagramText: weekText(week, words.intro, listed, "instagram"), events: listed.map(eventSource), collaborators: await instagramNames(db, chosen.map(e => e.host)) },
      publishAtMs: weekPostTime(monday, notBefore) }, now)) made++;
  }
  const times = eventPostTimes(fresh, notBefore, existing.map(r => r.publish_at_ms).filter((t): t is number => t !== null));
  for (const [i, e] of fresh.entries()) {
    if (await insertPost(db, { kind: "event", sourceKey: `event:${week}:${e.key}`, week, channels: ["facebook"], text: words.events[`E${i + 1}`] ?? plainEventText(e),
      link: e.link, images: e.imageUrl ? [e.imageUrl] : [], source: eventSource(e), publishAtMs: times[i]! }, now)) made++;
  }
  return { made, events: chosen.length, fresh: fresh.length };
}

/** Every three hours: events that came to the calendar after this week or next week was planned get their post too - "systematisk ... alle events". */
export async function topUpWeeks(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  if (!(await claimJob(db, "social_top_up", Math.floor(now / (3 * 3_600_000)) * 3 * 3_600_000, now))) return 0;
  let fresh = 0;
  for (const monday of [mondayOf(now), nextMonday(now)]) fresh += (await planWeek(env, deps, db, monday, { onlyNew: true })).fresh;
  if (fresh) await tellChair(env, deps, `${fresh === 1 ? "Ét nyt event" : `${fresh} nye events`} i kalenderen har fået et opslag på Facebook. Læs ${fresh === 1 ? "det" : "dem"}, og godkend her: ${cockpitUrl(env)}/pr`);
  return fresh;
}

/** Thursday from 10.00: next week is planned (once), and the chair is told. */
export async function scheduledWeekPlan(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<boolean> {
  const now = deps.now();
  if (!planDue(now) || !(await socialAccount(db))) return false;
  const monday = nextMonday(now), week = weekKey(monday);
  // Planned once: when "Ugens events" is there, the week is planned (the chair's changes and skips stay as they are).
  if (await db.prepare("SELECT 1 AS yes FROM social_posts WHERE source_key = ?").bind(`week:${week}`).first().catch(() => null)) return false;
  // Tried at most once an hour - a week with nothing in the calendar yet is tried again later.
  if (!(await claimJob(db, `social_week_plan:${week}`, Math.floor(now / 3_600_000) * 3_600_000, now))) return false;
  const { made, events } = await planWeek(env, deps, db, monday);
  if (made) await tellChair(env, deps, `Ugens opslag for uge ${Number(week.slice(6))} er klar: "Ugens events" og alle ugens ${events} events med hvert sit lille opslag på Facebook. Læs dem, ret dem og godkend ugen her: ${cockpitUrl(env)}/pr`);
  return made > 0;
}

// ---- Publishing ----

/** Instagram is still working on a reel's video: the post waits for the next round. */
export class ReelPending extends Error { constructor() { super("reel_pending"); } }

/** One approved post goes out: on each of its channels that it has not gone out on yet. */
export async function publishPost(env: SocialEnv, deps: SagaDeps, db: D1Database, post: SocialPost): Promise<void> {
  const account = await socialAccount(db);
  if (!account) throw new Error("Facebook og Instagram er ikke forbundet");
  const { page, instagram } = await access(env, account);
  const done = { ...post.published };
  try {
    for (const channel of post.channels) {
      if (done[channel]) continue;
      if (channel === "facebook") done.facebook = await postToPage(deps.fetcher, page, { message: post.text, link: post.link });
      else {
        if (!instagram) throw new Error("Instagram er ikke koblet til Facebook-siden");
        if (post.source.format === "reel") {
          // "Ugens events" as a reel: Instagram processes the video between Saga's rounds.
          if (!post.source.video) throw new Error("Reelen har ingen video");
          done.instagram_container ??= await startReel(deps.fetcher, instagram, { videoUrl: post.source.video, caption: post.text, collaborators: post.source.collaborators ?? [] });
          await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
          const status = await reelStatus(deps.fetcher, instagram.token, done.instagram_container);
          if (status === "ERROR" || status === "EXPIRED") { delete done.instagram_container; throw new Error(`Instagram kunne ikke behandle videoen (${status})`); }
          if (status !== "FINISHED") throw new ReelPending();
          done.instagram = await finishReel(deps.fetcher, instagram, done.instagram_container);
          await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
          continue;
        }
        // A tagged Instagram post's picture addresses expire: read again now.
        const images = post.kind === "share" && post.source.network === "instagram" && post.source.id
          ? (await instagramMedia(deps.fetcher, instagram.token, post.source.id)).images : post.images;
        done.instagram = await publishToInstagram(deps.fetcher, instagram, { caption: post.source.instagramText || post.text, images, collaborators: post.source.collaborators ?? [] });
      }
      // Kept at once: a retry never posts the same thing twice on a channel it already reached.
      await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
    }
  } catch (error) {
    await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run().catch(() => undefined);
    throw error;
  }
  await db.prepare("UPDATE social_posts SET status = 'published', published_at_ms = ?, error = NULL, updated_at_ms = ? WHERE id = ?").bind(deps.now(), deps.now(), post.id).run();
}

/** Whether an event is still in the calendar: a cancelled or removed one never gets its post. */
async function eventStillOn(db: D1Database, key: string): Promise<boolean> {
  const [source, id] = [key.slice(0, 3), key.slice(3)];
  // The calendar's events: only one that is known and removed is off (some are only in the membership system's list, never stored).
  if (source === "mw:") return !(await db.prepare("SELECT 1 AS yes FROM house_events WHERE id = ? AND removed_at_ms IS NOT NULL").bind(id).first().catch(() => null));
  if (source === "hr:") return Boolean(await db.prepare("SELECT 1 AS yes FROM room_bookings WHERE id = ? AND status = 'scheduled'").bind(Number(id)).first().catch(() => ({ yes: 1 })));
  return true;
}

/** Every round: the approved posts whose time has come go out, each once. An event's post whose event has begun is not sent late. */
export async function publishDue(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  const due = await socialPosts(db, "status = 'approved' AND publish_at_ms <= ?", [now], "publish_at_ms, id", 5);
  let sent = 0;
  for (const post of due) {
    if (post.kind === "event" && post.source.key && !(await eventStillOn(db, post.source.key))) {
      await db.prepare("UPDATE social_posts SET status = 'skipped', error = ?, updated_at_ms = ? WHERE id = ?").bind("Eventet er aflyst eller fjernet fra kalenderen", now, post.id).run();
      continue;
    }
    if (post.kind === "event" && post.source.startsMs && post.source.startsMs <= now) {
      await db.prepare("UPDATE social_posts SET status = 'skipped', error = ?, updated_at_ms = ? WHERE id = ?").bind("Eventet var begyndt, før opslaget skulle ud", now, post.id).run();
      continue;
    }
    // Claimed first, so two rounds never send the same post.
    const claimed = await db.prepare("UPDATE social_posts SET status = 'publishing', updated_at_ms = ? WHERE id = ? AND status = 'approved'").bind(now, post.id).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) continue;
    try {
      await publishPost(env, deps, db, post);
      sent++;
    } catch (error) {
      if (error instanceof ReelPending) {
        // Tried again in the next round, at most for six hours.
        if (deps.now() - (post.publish_at_ms ?? deps.now()) < 6 * 3_600_000) {
          await db.prepare("UPDATE social_posts SET status = 'approved', updated_at_ms = ? WHERE id = ?").bind(deps.now(), post.id).run();
          continue;
        }
        error = new Error("Instagram blev ikke færdig med videoen inden for seks timer");
      }
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db.prepare("UPDATE social_posts SET status = 'failed', error = ?, updated_at_ms = ? WHERE id = ?").bind(message, deps.now(), post.id).run();
      await tellChair(env, deps, `Et opslag kunne ikke komme ud (${post.kind === "share" ? "deling" : post.kind === "week" ? "Ugens events" : "event"}): ${message.slice(0, 200)}. Se ${cockpitUrl(env)}/pr`);
    }
  }
  return sent;
}

/** A post stuck in "publishing" (the run stopped halfway) is tried again: what reached a channel is kept, so nothing goes out twice. */
async function releaseStuck(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("UPDATE social_posts SET status = 'approved', updated_at_ms = ? WHERE status = 'publishing' AND updated_at_ms < ?").bind(nowMs, nowMs - RETRY_AFTER_MS).run().catch(() => undefined);
}

/** In every round (config-entry.ts): publish what is due, look for new tags every half hour, and plan next week on Thursday. */
export async function runSocialJob(env: SocialEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db || !(await socialAccount(db))) return;
  const now = deps.now();
  await releaseStuck(db, now);
  await publishDue(env, deps, db).catch(error => console.warn("social_publish_failed", error instanceof Error ? error.message : error));
  if (await claimJob(db, "social_tags", Math.floor(now / TAG_EVERY_MS) * TAG_EVERY_MS, now).catch(() => false))
    await scanTags(env, deps, db).catch(error => console.warn("social_tags_failed", error instanceof Error ? error.message : error));
  await scheduledWeekPlan(env, deps, db).catch(error => console.warn("social_week_plan_failed", error instanceof Error ? error.message : error));
  await topUpWeeks(env, deps, db).catch(error => console.warn("social_top_up_failed", error instanceof Error ? error.message : error));
  await countFollowers(env, deps, db).catch(error => console.warn("social_stats_failed", error instanceof Error ? error.message : error));
}

/** Once a day: Hjerterum's followers on Facebook and Instagram, for the month's insight on PR og SoMe (cockpit/prInsight.ts). */
export async function countFollowers(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<boolean> {
  const now = deps.now(), day = dateOf(now);
  const account = await socialAccount(db);
  if (!account || !(await claimJob(db, `social_stats:${day}`, 0, now))) return false;
  const { page, instagram } = await access(env, account);
  const counts = await followerCounts(deps.fetcher, page, instagram);
  await db.prepare(`INSERT INTO social_stats (day, fb_followers, ig_followers, ig_media, at_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET fb_followers = excluded.fb_followers, ig_followers = excluded.ig_followers, ig_media = excluded.ig_media, at_ms = excluded.at_ms`)
    .bind(day, counts.fb, counts.ig, counts.igMedia, now).run();
  return true;
}

const cockpitUrl = (env: SagaEnv) => (env.COCKPIT_URL ?? "https://admin.hjerterum.info").replace(/\/+$/, "");

/** The PR cockpit is the chair's (docs/decisions/0007): Saga tells the chair privately, never the board's group. */
async function tellChair(env: SagaEnv, deps: SagaDeps, text: string): Promise<void> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return;
  await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, text).catch(error => console.warn("social_notice_failed", error instanceof Error ? error.message : error));
}

export { mondayOf, nextMonday, weekKey };
