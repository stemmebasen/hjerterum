import { siteLive, toPublicSite } from "../public-site.js";
import type { D1Database } from "../db.js";
import { listTitle, monthEvents, monthOf, type NewsletterEvent } from "../newsletter.js";
import { isCancelledEvent } from "../external-events.js";
import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { claimJob } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";
import { keySecret } from "../saga/teamMail.js";
import { prReadyNames } from "../cockpit/prMaterial.js";
import { instagramName } from "../../pr-material.js";
import { finishReel, followerCounts, freshInstagramImages, ownInstagramMedia, pagePosts, permalinkOf, postPhotoToPage, postToPage, postVideoToPage, publishToInstagram, reelStatus, sendMessengerReply, sentInMessenger, messengerThreads, startReel, type MessengerThread, taggedOnFacebook, taggedOnInstagram, type MetaEnv, type TaggedPost } from "./meta.js";
import { addDays, at, clock, dateOf, dayName, earlyBy, earlySlot, EVERY_EVENT, eventPostTimes, instagramPostTimes, lastPostMs, longWhen, placeFirsts, SERIES_GAP_MS, shoutWindows, mondayOf, nextMonday, pickWeekEvents, plainEventText, PLAIN_WEEK_INTRO, planDue, SITE, weekKey, weekPostTime, weekStart, weekText, withEventDate } from "./plan.js";

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
export type StillEffect = "zoom" | "ryst" | "slor";
export type SocialStatus = "draft" | "approved" | "publishing" | "published" | "failed" | "skipped";

export type SocialAccount = { page_id: string; page_name: string; page_token_sealed: string; ig_user_id: string | null; ig_username: string | null;
  connected_by: string; connected_at_ms: number; checked_at_ms: number | null; check_error: string | null };

export type ShareSource = { network: Channel; id: string; author: string | null; permalink: string | null; text: string; media: TaggedPost["media"]; createdMs: number; consent: boolean;
  /** When Hjerterum had already shared it (before Saga found it): "Delt d. <dato>". */
  sharedAt?: number | null;
  /** Sent to the page in Messenger (meta.ts sentInMessenger), not tagged. */
  via?: "messenger" };
export type EventSource = { key: string; title: string; startsMs: number; host: string | null };
export type SocialPost = { id: number; kind: SocialKind; source_key: string; week: string | null; channels: Channel[]; text: string; link: string | null; images: string[];
  source: Partial<ShareSource & EventSource> & { instagramText?: string; events?: EventSource[]; collaborators?: string[]; format?: "reel"; video?: string;
    /** The chair's design from Plakater og opslag is the post's picture: on Facebook as a photo post, not a link card. */
    design?: boolean;
    /** Taken down again on Facebook and Instagram by hand (the chair, 3 Nov 2026: "Jeg har slettet opslagene igen for Aura-eventet, for det var bare
     * en test. Det må du gerne registrere."): kept in the history, and the event may get a new post. */
    removed?: { atMs: number; note: string };
    /** Instagram's own time, when it is not Facebook's (publish_at_ms) - "forskellige tidspunkter på de to medier". */
    instagramAtMs?: number | null;
    /** The event's video (video/, made on GitHub by .github/workflows/video-events.yml): on Instagram as a reel, unless the chair took it off. */
    videoTemplate?: number; videoAtMs?: number; noVideo?: boolean;
    /** "Videoen på Facebook" taken off: Facebook gets the picture (or the link) instead of the event's video. */
    noFacebookVideo?: boolean;
    /** Shared as the event's own Facebook event (shareEventInstead). */
    fbEventShare?: boolean;
    /** The chair chose the time (moved it in the calendar, or saved it): Saga does not move it (pullEarlier). */
    chairTime?: boolean;
    /** "to shouts på hvert medie" (plan.ts shoutWindows): which of the event's posts this is - the first (none said: the first) or the reminder a week
     * before - and how many the event has. */
    shout?: 1 | 2; shouts?: 1 | 2;
    /** When Saga sent the chair the link to the finished video (notifyVideos). */
    videoNotifiedAtMs?: number;
    /** "flere ... video designs på kommando": the templates the chair asked for (video-events.yml makes them), the videos made to choose among, and how many
     * of them Saga has told the chair about. */
    videoAsk?: { atMs: number; templates: number[] }; videoChoices?: Array<{ template: number; effect?: StillEffect; video: string; atMs: number }>; videoChoicesTold?: number;
    /** "med lidt bevægelse ... ryste, zoom eller slør ind": the chair's design to be made a video (video/src/still.tsx); a choice with template 0. */
    stillAsk?: { atMs: number; image: string; effect: StillEffect };
    /** For the templates "Citat" and "Mød underviseren": the teacher's own sentence and photo, given with consent. */
    quote?: string; portrait?: string }; publish_at_ms: number | null; status: SocialStatus;
  approved_by: string | null; approved_at_ms: number | null; published: Partial<Record<Channel | "instagram_container" | "facebook_link" | "instagram_link", string>>; published_at_ms: number | null; error: string | null;
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
  // The old website's addresses while the new one is not in use (public-site.ts) - so the chair reads the post as it will go out.
  const live = await siteLive(db);
  post = { ...post, text: await toPublicSite(db, post.text, live), link: post.link ? await toPublicSite(db, post.link, live) : post.link ?? null };
  const src = post.source as { instagramText?: unknown } | null;
  if (src && typeof src === "object" && typeof src.instagramText === "string") post.source = { ...src, instagramText: await toPublicSite(db, src.instagramText, live) };
  const result = await db.prepare(`INSERT OR IGNORE INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).bind(post.kind, post.sourceKey, post.week ?? null, JSON.stringify(post.channels), post.text, post.link ?? null,
    JSON.stringify(post.images ?? []), JSON.stringify(post.source), post.publishAtMs, nowMs, nowMs).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

/** The chair changes a post that has not gone out: its words, where it goes and (for the week's posts) when. A changed post is a draft again. */
export async function editPost(db: D1Database, id: number, change: { text?: string; instagramText?: string; collaborators?: string[]; channels?: Channel[]; publishAtMs?: number | null;
  instagramAtMs?: number | null; noVideo?: boolean; noFacebookVideo?: boolean }, nowMs: number): Promise<boolean> {
  const post = await socialPost(db, id);
  if (!post || !["draft", "approved", "failed", "skipped"].includes(post.status)) return false;
  const source = { ...post.source, ...(change.instagramText !== undefined ? { instagramText: change.instagramText } : {}), ...(change.collaborators !== undefined ? { collaborators: change.collaborators.slice(0, 3) } : {}),
    ...(change.instagramAtMs !== undefined ? { instagramAtMs: change.instagramAtMs } : {}), ...(change.noVideo !== undefined ? { noVideo: change.noVideo || undefined } : {}),
    ...(change.noFacebookVideo !== undefined ? { noFacebookVideo: change.noFacebookVideo || undefined } : {}),
    ...((change.publishAtMs !== undefined && change.publishAtMs !== post.publish_at_ms) || (change.instagramAtMs !== undefined && change.instagramAtMs !== post.source.instagramAtMs) ? { chairTime: true } : {}) };
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
  // Asked (the chair, 5 Nov 2026): "Alle fire på én gang" - an event's posts (the first and the reminder a week before) are approved, skipped or taken back
  // together. What has gone out, or has no channel, is left as it is.
  if (post.kind === "event" && post.source.key) {
    const from = decision === "approve" ? "('draft', 'failed')" : decision === "skip" ? "('draft', 'approved', 'failed')" : "('approved')";
    await db.prepare(`UPDATE social_posts SET status = ?, approved_by = ?, approved_at_ms = ?, error = NULL, updated_at_ms = ? WHERE kind = 'event' AND id <> ?
        AND json_extract(source, '$.key') = ? AND status IN ${from} AND channels <> '[]' AND coalesce(publish_at_ms, ?) >= ?`)
      .bind(status, decision === "approve" ? who : null, decision === "approve" ? nowMs : null, nowMs, id, post.source.key, nowMs, decision === "approve" ? nowMs - 60_000 : 0).run();
  }
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
  + "ingen helbredsløfter, ingen hashtags, ingen links. Gerne én passende emoji fra naturen eller med begejstring og kærlighed (fx 🌿 🌸 🌙 🤍 ✨ 🙌). Svar kun med teksten.";

export const firstName = (name: string | null) => (name ?? "").replace(/^@/, "").split(/\s+/)[0] ?? "";
export const plainShareText = (author: string | null) => `Tak til ${firstName(author) || "jer"} for at dele. Vi glæder os til at se jer i Hjerterum.`;
/** On Instagram the post is published again by Hjerterum, so the maker is named, and their own words follow. */
/** A share on Instagram is published again by Hjerterum: Hjerterum's own words and who made the photo. Asked (the chair, 5 Nov 2026) what Instagram's text should
 * hold - "Kun Hjerterums ord": the maker's own caption is not copied (it speaks as "jeg", points to their profile, and may hold what an AI tool told them). */
export const instagramShareText = (intro: string, author: string | null, _original = "", network: Channel = "instagram") =>
  `${intro.trim()}\n\nFoto: ${author ? (network === "instagram" ? `@${author.replace(/^@/, "")}` : author) : "afsenderen"}`;
/** An event's post on Instagram: its words, and where to read more (Instagram has no links in the text). */
/** Reported (the chair, 6 Nov 2026): "»Læs mere og tilmeld dig på holistisk.org/events (link i bio).« Det virker lidt underligt, at der står det, når der jo
 * også bare i bio står samme url" - the link in the bio, without its address. */
export const instagramEventText = (text: string) => `${text.trim()}\n\nLæs mere og tilmeld dig via linket i bio.`;
const OLD_BIO_LINE = /(Læs mere og tilmeld dig|Se alle events og tilmeld dig) på (?:www\.)?(?:hjerterum\.info|holistisk\.org)\/events\/? \(link i bio\)\./g;
export const bioLine = (text: string) => text.replace(OLD_BIO_LINE, "$1 via linket i bio.");

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
    // Reading Instagram's tags needs instagram_manage_comments (not instagram_business_manage_comments, which belongs to Instagram's own login): a refusal is noted plainly.
    if (instagram) found.push(...await taggedOnInstagram(deps.fetcher, instagram).catch(error => {
      problems.push(/permission|\(#10\)|\(#200\)|meta_403/i.test(error instanceof Error ? error.message : String(error)) ? "Instagram-tags kan ikke læses: appen mangler tilladelsen instagram_manage_comments (ikke instagram_business_manage_comments)" : `Instagram: ${error instanceof Error ? error.message : error}`);
      return [];
    }));
    // "Saga læser Messenger": what teachers send the page there. Needs pages_messaging - until the page is connected again with it, a plain word.
    found.push(...await sentInMessenger(deps.fetcher, page).catch(error => {
      problems.push(/permission|\(#10\)|\(#200\)|\(#230\)|meta_403/i.test(error instanceof Error ? error.message : String(error)) ? (env as MetaEnv).META_MESSENGER === "1" ? "Messenger kan ikke læses endnu: tryk \"Forbind Facebook og Instagram\" igen, og sig ja til beskeder" : "Messenger kan ikke læses endnu: appen hos Meta mangler brugsscenariet Messenger (tilladelsen pages_messaging)" : `Messenger: ${error instanceof Error ? error.message : error}`);
      return [];
    }));
  } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  await db.prepare("UPDATE social_account SET checked_at_ms = ?, check_error = ? WHERE id = 1").bind(now, problems.join(" · ").slice(0, 500) || null).run().catch(() => undefined);
  // Only what was posted after the page was connected: the first look does not bring up years of old tags.
  found = found.filter(p => p.createdMs >= account.connected_at_ms - 14 * 86_400_000);
  const known = new Set((await db.prepare("SELECT source_key FROM social_posts WHERE kind = 'share' AND source_key IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(found.map(p => `${p.network}:${p.id}`))).all<{ source_key: string }>().then(r => r.results ?? []).catch(() => [])).map(r => r.source_key));
  const fresh = found.filter(p => !known.has(`${p.network}:${p.id}`)).slice(0, 10);
  if (!fresh.length) return 0;
  const ready = await prReadyNames(db);
  // "Delt d. <dato>": what Hjerterum has already shared, by hand or otherwise - on Facebook the post itself, on Instagram a post naming its maker.
  const { page: ownPage, instagram: ownIg } = await access(env, account);
  const ownPosts = await pagePosts(deps.fetcher, ownPage).catch(() => []);
  const ownMedia = ownIg && fresh.some(p => p.network === "instagram") ? await ownInstagramMedia(deps.fetcher, ownIg).catch(() => []) : [];
  const sharedAt = (post: TaggedPost): number | null => {
    const times = post.network === "facebook"
      ? ownPosts.filter(o => o.createdMs >= post.createdMs && o.refs.some(r => r === post.id || r.endsWith(`_${post.id.split("_").pop()}`) || (post.permalink && r.replace(/\/$/, "") === post.permalink.replace(/\/$/, "")))).map(o => o.createdMs)
      : post.author ? ownMedia.filter(m => m.createdMs >= post.createdMs && m.caption.toLowerCase().includes(`@${post.author!.replace(/^@/, "").toLowerCase()}`)).map(m => m.createdMs) : [];
    return times.length ? Math.min(...times) : null;
  };
  let made = 0, waiting = 0;
  for (const post of fresh) {
    const intro = await shareIntro(env, deps, post);
    const consent = Boolean(post.author && ready.has(post.author.trim().toLowerCase()));
    // Requested: "Jeg vil rigtig gerne kunne dele simultant på begge medier, når som helst det er muligt." Facebook: shared as a link to the post.
    // Instagram: its photos published again with its maker named - also a Facebook post's picture. Both from the start, when both can be.
    const instagramOk = (post.media === "image" || post.media === "carousel") && post.images.length > 0 && Boolean(account.ig_user_id);
    const channels: Channel[] = instagramOk ? ["facebook", "instagram"] : ["facebook"];
    const shared = sharedAt(post);
    const source: ShareSource & { instagramText?: string; collaborators?: string[] } = { network: post.network, id: post.id, author: post.author, permalink: post.permalink, text: post.text.slice(0, 2200),
      media: post.media, createdMs: post.createdMs, consent, sharedAt: shared, ...(post.via ? { via: post.via } : {}), ...(instagramOk ? { instagramText: instagramShareText(intro, post.author, post.text, post.network),
        // The one who made it is invited as collaborator on Hjerterum's post of it.
        collaborators: post.network === "instagram" ? [instagramName(post.author)].filter((n): n is string => Boolean(n)) : [] } : {}) };
    if (await insertPost(db, { kind: "share", sourceKey: `${post.network}:${post.id}`, channels, text: intro, link: post.permalink, images: post.images.slice(0, 10), source, publishAtMs: null }, now)) {
      made++;
      if (!shared) waiting++;
    }
  }
  // Only what has not been shared already is news for the chair.
  if (waiting) await tellChair(env, deps, `${waiting === 1 ? "Ét nyt opslag" : `${waiting} nye opslag`} har tagget Hjerterum. Se dem og del dem her: ${cockpitUrl(env)}/pr`);
  return made;
}

// ---- 2 and 3. The week ----

const WEEK_SYSTEM = `Du skriver Hjerterums opslag på Facebook og Instagram (Hjerterum er en forening og et hus i Aarhus for meditation, yoga, personlig udvikling og fællesskab).
Du får ugens udvalgte events med en reference (E1, E2 ...). Svar KUN med JSON: {"uge": "...", "events": {"E1": "..."}}
- "uge": 1-2 korte, varme sætninger (højst 35 ord), der indleder "Ugens events" - hvad ugen byder på (bredden, ingen navne). Listen over events sættes ind under teksten af systemet.
- "events": et lille opslag til hvert event på Facebook: 2-3 korte sætninger, højst 45 ord. Hvad det er, hvem der leder det (fornavn), og hvornår: ugedag med dato og "kl. TT.MM", som de står i feltet "hvornaar" (fx "lørdag d. 21. november kl. 10.30") - opslaget går ud en til to uger før, så ugedagen alene er ikke nok. Linket til eventet sættes på af systemet, så skriv ingen adresse.
Varmt, konkret og roligt. Find ikke på detaljer, der ikke står i beskrivelsen. Ingen helbredsløfter, ingen hashtags, ingen udråbstegn.
Emojis (formanden: "gerne nogle, der er baseret i naturen eller begejstring og kærlighed"): 1-2 i hver tekst, valgt så de passer til netop eventet - fra naturen (🌿 🍃 🌱 🌸 🌾 🍂 🌊 🌙 ☀️ 🌳 🪷) eller begejstring og kærlighed (🤍 💛 🧡 ✨ 🙌 🥰 💫). Ved en sætnings slutning, aldrig flere i træk.
Sproget (formanden: "Dette er dårligt dansk"): skriv mundret, naturligt dansk, som en dansk tekstforfatter skriver det, aldrig oversat engelsk.
- Sammensatte ord skrives i ét ord: aurabalancering, lydhealing, yogaforløb, meditationsaften. Aldrig "aura balancering".
- Hele sætninger med et udsagnsord. Ingen sætningsbrokker som "Fire timers aurabalancering i ro og nærvær."
- Dansk kommatering: intet komma foran "med", "og" eller "i", som man ville sætte det på engelsk.
- Ingen stive vendinger som "X leder den", "X faciliterer" eller "Oplev ...". Skriv fx "Marianne guider dig", "Kom med Marianne" eller "Marianne inviterer til".
- Kun underviserens fornavn.
Et eksempel på tonen (efterlign ikke ordene): "Lørdag kl. 13.00 inviterer Marianne til fire timers aurabalancering. Der er ro og nærvær og plads til bare at være."`;

type WeekWords = { intro: string; events: Record<string, string> };

/** The second post about each event, a week before (shoutWindows): told differently from the first. */
const REMINDER_RULE = `\nDette er det ANDET opslag om hvert event: en påmindelse cirka en uge før. Skriv det anderledes end et første opslag, fx med "om en uge", kort og med lyst til at komme - stadig med ugedag og dato. Gentag ikke en lang introduktion.`;

async function weekWords(env: SagaEnv, deps: SagaDeps, events: NewsletterEvent[], reminder = false): Promise<WeekWords> {
  const plain: WeekWords = { intro: PLAIN_WEEK_INTRO, events: Object.fromEntries(events.map((e, i) => [`E${i + 1}`, reminder ? `Om en uge: ${plainEventText(e)}` : plainEventText(e)])) };
  if (!env.AI_API_KEY || !env.AI_MODEL || !events.length) return plain;
  const raw = await completeAs("social-week", "mid", 2500)(env, deps, [{ role: "system", content: reminder ? WEEK_SYSTEM + REMINDER_RULE : WEEK_SYSTEM }, { role: "user", content: JSON.stringify(events.map((e, i) => ({
    ref: `E${i + 1}`, titel: e.title, underviser: e.host, hvornaar: longWhen(e.startsMs), beskrivelse: e.description.slice(0, 600) }))) }]).catch(() => "");
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  const data = json ? parse<{ uge?: unknown; events?: Record<string, unknown> }>(json, {}) : {};
  const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
  return { intro: clean(data.uge, 400) || plain.intro,
    events: Object.fromEntries(Object.entries(plain.events).map(([ref, text], i) => [ref, withEventDate(clean(data.events?.[ref], 600) || text, events[i]!.startsMs)])) };
}

/** Asked (the chair, 5 Nov 2026) about an event without a post in Plakater og opslag: "Hvorfor kan det ikke bruges? Det forstår jeg ikke." The chair makes one
 * there - also for a weekly class in its quiet weeks, or one set aside before: Saga's words and times as for any event, and its reminder when there is time. */
export async function proposeEventPost(env: SocialEnv, deps: SagaDeps, db: D1Database, key: string, emergency = false): Promise<"ok" | "past" | "not_found" | "today"> {
  const now = deps.now();
  const start = key.startsWith("mw:")
    ? (await db.prepare("SELECT starts_at_ms AS s FROM house_events WHERE id = ?").bind(key.slice(3)).first<{ s: number }>().catch(() => null))?.s
    : (await db.prepare("SELECT starts_at_ms AS s FROM room_bookings WHERE id = ?").bind(Number(key.slice(3))).first<{ s: number }>().catch(() => null))?.s;
  if (!start) return "not_found";
  if (start <= now + 2 * 3_600_000) return "past";
  // "Det skal være et nødstilfælde, hvis et event skal promoveres, når det foregår på samme dag": only when the chair says so.
  if (lastPostMs(start) < now + 30 * MINUTE && !emergency) return "today";
  const monday = mondayOf(start), week = weekKey(monday);
  const event = (await weekEvents(db, monday, deps.fetcher)).find(e => e.key === key);
  if (!event) return "not_found";
  const account = await socialAccount(db);
  const windows = shoutWindows(event.startsMs, now);
  const notBefore = now + 30 * MINUTE;
  const fbTaken = await takenSlots(db, now);
  const placed = placeFirsts([event], [windows], notBefore, fbTaken);
  const time = placed.times[0]!;
  const both = Boolean(account?.ig_user_id && event.imageUrl);
  const [igTime] = both ? instagramPostTimes([event], [time], notBefore, await instagramSlots(db, now), placed.latest, fbTaken) : [time];
  const text = (await weekWords(env, deps, [event])).events.E1 ?? plainEventText(event);
  const source = { key: event.key, title: event.title, startsMs: event.startsMs, host: event.host, shout: 1, shouts: placed.single[0] ? 1 : windows.length,
    ...(both ? { instagramText: instagramEventText(text), collaborators: await instagramNames(db, [event.host]), ...(igTime !== time ? { instagramAtMs: igTime } : {}) } : {}) };
  const sourceKey = `event:${week}:${event.key}`;
  const had = await db.prepare("SELECT id FROM social_posts WHERE source_key = ?").bind(sourceKey).first<{ id: number }>().catch(() => null);
  if (had) await db.prepare(`UPDATE social_posts SET status = 'draft', text = ?, channels = ?, images = ?, link = ?, source = ?, publish_at_ms = ?, approved_by = NULL, approved_at_ms = NULL,
      error = NULL, updated_at_ms = ? WHERE id = ? AND status NOT IN ('published', 'publishing')`)
    .bind(text, JSON.stringify(both ? ["facebook", "instagram"] : ["facebook"]), JSON.stringify(event.imageUrl ? [event.imageUrl] : []), event.link, JSON.stringify(source), time, now, had.id).run();
  else await insertPost(db, { kind: "event", sourceKey, week, channels: both ? ["facebook", "instagram"] : ["facebook"], text, link: event.link, images: event.imageUrl ? [event.imageUrl] : [], source, publishAtMs: time! }, now);
  await planShouts(env, deps, db);
  return "ok";
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
export async function planWeek(env: SocialEnv, deps: SagaDeps, db: D1Database, monday: string,
  options: { onlyNew?: boolean; eventsOnly?: boolean; series?: Map<string, number[]> } = {}): Promise<{ made: number; events: number; fresh: number }> {
  const now = deps.now(), week = weekKey(monday);
  // With eventsOnly (Saga's proposals for every event as soon as it is in the calendar), "Ugens events" is left for Thursday's plan.
  const planned = options.eventsOnly || Boolean(await db.prepare("SELECT 1 AS yes FROM social_posts WHERE source_key = ?").bind(`week:${week}`).first().catch(() => null));
  if (options.onlyNew && !planned) return { made: 0, events: 0, fresh: 0 };
  const events = await weekEvents(db, monday, deps.fetcher);
  if (!events.length) return { made: 0, events: 0, fresh: 0 };
  const chosen = pickWeekEvents(events, await wishedKeys(db), EVERY_EVENT);
  const existing = await db.prepare("SELECT source_key, publish_at_ms FROM social_posts WHERE week = ? AND kind = 'event'").bind(week)
    .all<{ source_key: string; publish_at_ms: number | null }>().then(r => r.results ?? []).catch(() => []);
  const known = new Set(existing.map(r => r.source_key));
  // An event that begins within two hours is not given a post it could not get in time - nor a weekly class told about in the three weeks around
  // ("Faste hold": "Hver 4. uge"; it is in "Ugens events" all the same).
  const series = options.series ?? await seriesMap(db, now);
  const fresh = chosen.filter(e => {
    // The chair (5 Nov 2026): "Det skal være et nødstilfælde, hvis et event skal promoveres, når det foregår på samme dag." - never proposed by Saga on the day.
    if (known.has(`event:${week}:${e.key}`) || lastPostMs(e.startsMs) < now + 30 * MINUTE) return false;
    const told = series.get(titleKey(e)) ?? [];
    if (told.some(t => t !== e.startsMs && Math.abs(t - e.startsMs) < SERIES_GAP_MS)) return false;
    series.set(titleKey(e), [...told, e.startsMs]);
    return true;
  });
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
  // "to shouts på hvert medie": the first post in its window now; the reminder a week before is made by planShouts.
  const windows = fresh.map(e => shoutWindows(e.startsMs, now));
  const fbTaken = await takenSlots(db, now);
  const { times, single, latest } = placeFirsts(fresh, windows, notBefore, fbTaken);
  const igTimes = instagramPostTimes(fresh, times, notBefore, await instagramSlots(db, now), latest, fbTaken);
  for (const [i, e] of fresh.entries()) {
    // On Instagram too, when it is connected and the event has a picture ("på begge medier, når som helst det er muligt").
    const text = words.events[`E${i + 1}`] ?? plainEventText(e);
    const both = Boolean(account?.ig_user_id && e.imageUrl);
    if (await insertPost(db, { kind: "event", sourceKey: `event:${week}:${e.key}`, week, channels: both ? ["facebook", "instagram"] : ["facebook"], text,
      link: e.link, images: e.imageUrl ? [e.imageUrl] : [], source: { ...eventSource(e), shout: 1, shouts: (single[i] ? 1 : windows[i]!.length) as 1 | 2, ...(both ? { instagramText: instagramEventText(text), collaborators: await instagramNames(db, [e.host]), ...(igTimes[i] !== times[i] ? { instagramAtMs: igTimes[i] } : {}) } : {}) },
      publishAtMs: times[i]! }, now)) made++;
  }
  return { made, events: chosen.length, fresh: fresh.length };
}

const titleKey = (e: Pick<NewsletterEvent, "title">) => listTitle(e.title).toLocaleLowerCase("da-DK");

/** The events told about lately and ahead, by title: a weekly class gets its own posts every fourth week (SERIES_GAP_MS). */
async function seriesMap(db: D1Database, nowMs: number): Promise<Map<string, number[]>> {
  const rows = await db.prepare(`SELECT DISTINCT json_extract(source, '$.title') AS title, json_extract(source, '$.startsMs') AS starts FROM social_posts WHERE kind = 'event'
      AND status IN ('draft', 'approved', 'publishing', 'published') AND json_extract(source, '$.startsMs') > ?`).bind(nowMs - 28 * 86_400_000)
    .all<{ title: string | null; starts: number | null }>().then(r => r.results ?? []).catch(() => []);
  const map = new Map<string, number[]>();
  for (const r of rows) if (r.title && r.starts) map.set(titleKey({ title: r.title }), [...(map.get(titleKey({ title: r.title })) ?? []), r.starts]);
  return map;
}

/** "to shouts på hvert medie": every event whose first post is planned (or out) and that still has a week before it gets its second - the reminder, with
 * words of its own - in its window 7-9 days before. Approving one of an event's posts approves both (decidePost). Returns how many were made. */
export async function planShouts(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  const firsts = (await socialPosts(db, `kind = 'event' AND coalesce(json_extract(source, '$.shout'), 1) = 1 AND status IN ('draft', 'approved', 'publishing', 'published')
      AND json_extract(source, '$.startsMs') > ? AND NOT EXISTS (SELECT 1 FROM social_posts t WHERE t.source_key = social_posts.source_key || ':2')`, [now], "json_extract(source, '$.startsMs'), id", 60))
    .filter(p => p.source.startsMs && p.source.key && p.source.shouts !== 1 && shoutWindows(p.source.startsMs, now).length === 2);
  if (!firsts.length) return 0;
  const events = firsts.map(p => ({ key: p.source.key!, title: p.source.title ?? "", startsMs: p.source.startsMs!, host: p.source.host ?? null, description: "", link: p.link ?? "",
    imageUrl: p.images[0] ?? null, endsMs: null, category: null, mornings: false }) as NewsletterEvent);
  const words = await weekWords(env, deps, events, true);
  const second = events.map(e => shoutWindows(e.startsMs, now)[1]!);
  const notBefore = now + 30 * MINUTE;
  const fbTaken = await takenSlots(db, now);
  // The reminder keeps to the day's three too; with no room, the event has its first post only.
  const times = eventPostTimes(events, notBefore, fbTaken, second.map(w => w.earliest), second.map(w => w.latest), events.map(() => true));
  const igTimes = instagramPostTimes(events, times.map((t, i) => Number.isNaN(t) ? second[i]!.latest : t), notBefore, await instagramSlots(db, now), second.map(w => w.latest), fbTaken);
  let made = 0;
  for (const [i, p] of firsts.entries()) {
    if (Number.isNaN(times[i]!)) { await db.prepare("UPDATE social_posts SET source = json_set(source, '$.shouts', 1) WHERE id = ?").bind(p.id).run(); continue; }
    const text = words.events[`E${i + 1}`] ?? `Om en uge: ${p.text}`;
    const ig = p.channels.includes("instagram");
    const { video: _v, videoTemplate: _t, videoAtMs: _a, videoNotifiedAtMs: _n, videoAsk: _q, videoChoices: _c, videoChoicesTold: _ct, stillAsk: _s, noVideo: _o, instagramAtMs: _i, ...rest } = p.source;
    if (await insertPost(db, { kind: "event", sourceKey: `${p.source_key}:2`, week: p.week, channels: p.channels, text, link: p.link, images: p.images,
      source: { ...rest, shout: 2, shouts: 2, ...(ig ? { instagramText: instagramEventText(text), ...(igTimes[i] !== times[i] ? { instagramAtMs: igTimes[i] } : {}) } : {}) }, publishAtMs: times[i]! }, now)) made++;
    if (p.source.shouts !== 2) await db.prepare("UPDATE social_posts SET source = json_set(source, '$.shouts', 2) WHERE id = ?").bind(p.id).run();
  }
  return made;
}

/** The times already taken by an event's post (any week - a post now goes out as soon as may be, not in its event's week). */
async function takenSlots(db: D1Database, nowMs: number): Promise<number[]> {
  return db.prepare("SELECT publish_at_ms FROM social_posts WHERE kind = 'event' AND publish_at_ms >= ? AND status IN ('draft', 'approved', 'publishing', 'published')").bind(nowMs - 86_400_000)
    .all<{ publish_at_ms: number }>().then(r => (r.results ?? []).map(x => x.publish_at_ms)).catch(() => []);
}

/** The times already taken on Instagram by an event's post. */
async function instagramSlots(db: D1Database, nowMs: number): Promise<number[]> {
  return db.prepare(`SELECT coalesce(json_extract(source, '$.instagramAtMs'), publish_at_ms) AS at FROM social_posts WHERE kind = 'event' AND channels LIKE '%instagram%'
      AND coalesce(json_extract(source, '$.instagramAtMs'), publish_at_ms) >= ? AND status IN ('draft', 'approved', 'publishing', 'published')`).bind(nowMs - 86_400_000)
    .all<{ at: number }>().then(r => (r.results ?? []).map(x => x.at)).catch(() => []);
}

/** How far ahead Saga proposes posts for the calendar's events (the same six weeks as PR og SoMe → Events). */
export const PROPOSE_WEEKS = 6;

/** Requested (the chair, 3 Nov 2026): "Saga kommer med forslag til samtlige events, der bliver skeduleret" and "hurtigst muligt". Every hour: every
 * event of the next six weeks that has no post yet gets Saga's proposal, to go out in the first free slot (a class that comes back: in the week before),
 * and the chair is told. The first time, the drafts nobody has touched are moved from the day before to as soon as may be. */
export async function topUpWeeks(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  if (!(await socialAccount(db))) return 0;
  if (!(await claimJob(db, "social_top_up", Math.floor(now / 3_600_000) * 3_600_000, now))) return 0;
  if (await claimJob(db, "social_balance_retime", 0, now)) { await retimeUntouched(db, now); await addInstagram(db, now); }
  if (await claimJob(db, "social_instagram_times", 0, now)) await instagramOwnTimes(db, now);
  // The new plan (the chair, 5 Nov 2026: "Så vi skal have lavet en ny planlægning"): once, the proposals are planned again by it.
  if (await claimJob(db, "social_shouts_v1", 0, now)) await replanForShouts(db, now);
  // Asked: "Hvorfor har du lagt så mange ind?" - once more, now with no day over three (placeFirsts).
  if (await claimJob(db, "social_shouts_v2", 0, now)) await replanForShouts(db, now);
  if (await claimJob(db, "social_shouts_v3", 0, now)) await replanForShouts(db, now);
  const sharedEvents = await retimeOverdue(db, now);
  for (const e of sharedEvents) await tellChair(env, deps, `Opslaget om "${e.title}" blev ikke godkendt i tide, så Saga deler Facebook-begivenheden på Facebook ${longWhen(e.at)}, som du har valgt. Stop det her: ${cockpitUrl(env)}/pr/kalender`).catch(() => undefined);
  await pullEarlier(db, now).catch(error => console.warn("social_pull_earlier_failed", error instanceof Error ? error.message : error));
  let fresh = 0;
  const series = await seriesMap(db, now);
  for (let i = 0, monday = mondayOf(now); i < PROPOSE_WEEKS; i++, monday = nextMonday(weekStart(monday)))
    fresh += (await planWeek(env, deps, db, monday, { eventsOnly: true, series })).fresh;
  fresh += await planShouts(env, deps, db);
  if (fresh) await tellChair(env, deps, `Saga har lavet ${fresh === 1 ? "et forslag til et opslag om et nyt event" : `forslag til opslag om ${fresh} nye events`}. Se ${fresh === 1 ? "det" : "dem"} i PR-kalenderen, og godkend: ${cockpitUrl(env)}/pr/kalender`);
  return fresh;
}

/** Once: the event drafts with a picture made before Instagram was connected go on Instagram too (asked: "hvorfor bliver Instagram stort set ikke
 * inkluderet?"). Only drafts nobody has changed. */
async function addInstagram(db: D1Database, nowMs: number): Promise<void> {
  if (!(await socialAccount(db))?.ig_user_id) return;
  const drafts = await socialPosts(db, "kind = 'event' AND status = 'draft' AND updated_at_ms = created_at_ms AND images <> '[]' AND channels = '[\"facebook\"]' AND publish_at_ms > ?", [nowMs], "publish_at_ms, id", 500);
  for (const p of drafts) {
    const source = { ...p.source, instagramText: p.source.instagramText || instagramEventText(p.text), collaborators: p.source.collaborators ?? await instagramNames(db, [p.source.host ?? null]) };
    await db.prepare("UPDATE social_posts SET channels = ?, source = ? WHERE id = ? AND status = 'draft' AND updated_at_ms = created_at_ms").bind(JSON.stringify(["facebook", "instagram"]), JSON.stringify(source), p.id).run();
  }
}

/** Asked (the chair, 4 Nov 2026): "Er det rigtigt forstået, at opslaget bliver sendt ud på begge medier på samme tid?" - and (5 Nov 2026): "Hvis et event
 * ikke er blevet delt ifølge planen (fordi jeg ikke har godkendt det) skal Saga replanlægge kommende events." Every hour: a proposal whose time has come
 * without the chair's yes gets the next free time inside its window - the first post at the latest ten days before when the event has a second, the
 * second (or only) one the day before at the latest - and is set aside when its window has passed. */
/** Asked (the chair, 6 Nov 2026): "Er det muligt at dele selve eventet (altså videresende kan man sige) som et post via systemet?" - "Når der ikke er godkendt
 * et opslag, så deles selve eventet bare". A setting the chair turns on in PR og SoMe → Overblik (an approval in admin, once): when an event's last post
 * passes unapproved and none of its posts is approved, its Facebook event (Events → Facebook-begivenheder, with its link) is shared on the page instead -
 * the event's own card, with its title and time. Only on Facebook (Instagram has no events), once per event. */
const SHARE_EVENT_KEY = "social_share_facebook_event";
export async function shareFacebookEventOn(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT setting_value AS v FROM platform_settings WHERE setting_key = ?").bind(SHARE_EVENT_KEY).first<{ v: string }>().catch(() => null))?.v === "1";
}
export async function setShareFacebookEvent(db: D1Database, on: boolean, by: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO platform_settings (setting_key, setting_value, updated_by_email, updated_at_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by_email = excluded.updated_by_email, updated_at_ms = excluded.updated_at_ms`)
    .bind(SHARE_EVENT_KEY, on ? "1" : "0", by, nowMs).run();
}

/** The event's own Facebook event shared instead of its unapproved last post, at that post's time: the time it goes out, or null when it cannot (no link,
 * the setting off, or one of its posts approved). */
async function shareEventInstead(db: D1Database, p: SocialPost, nowMs: number): Promise<number | null> {
  if (!p.source.key || !p.source.startsMs || !(await shareFacebookEventOn(db))) return null;
  const link = (await db.prepare("SELECT link FROM facebook_events WHERE event_key = ?").bind(p.source.key).first<{ link: string | null }>().catch(() => null))?.link;
  if (!link) return null;
  const approved = await db.prepare("SELECT 1 AS yes FROM social_posts WHERE kind = 'event' AND json_extract(source, '$.key') = ? AND status IN ('approved', 'publishing', 'published')").bind(p.source.key).first().catch(() => null);
  if (approved || p.source.startsMs < nowMs + 3 * 3_600_000) return null;
  // At the post's own time - it has just come, unapproved.
  const at = Math.max(nowMs, p.publish_at_ms ?? nowMs);
  const { design: _d, video: _v, instagramAtMs: _i, ...rest } = p.source;
  const source = { ...rest, fbEventShare: true, noFacebookVideo: true, instagramAtMs: null };
  await db.prepare(`UPDATE social_posts SET status = 'approved', channels = '["facebook"]', text = ?, link = ?, source = ?, publish_at_ms = ?, approved_by = 'Saga (Facebook-begivenheden, efter din indstilling)', approved_at_ms = ?, error = NULL, updated_at_ms = ?
    WHERE id = ? AND status = 'draft'`).bind(`${p.source.title ?? ""} - ${longWhen(p.source.startsMs)}`, link, JSON.stringify(source), at, nowMs, nowMs, p.id).run();
  return at;
}

async function retimeOverdue(db: D1Database, nowMs: number): Promise<Array<{ title: string; at: number }>> {
  const shared: Array<{ title: string; at: number }> = [];
  const late = (await socialPosts(db, `kind = 'event' AND status = 'draft'
      AND min(publish_at_ms, coalesce(json_extract(source, '$.instagramAtMs'), publish_at_ms)) < ? AND json_extract(source, '$.startsMs') > ?`, [nowMs + 15 * MINUTE, nowMs + 3 * 3_600_000], "publish_at_ms, id", 200))
    .filter(p => p.source.startsMs);
  if (!late.length) return shared;
  const lastChance = new Set((await db.prepare("SELECT source_key FROM social_posts WHERE source_key LIKE '%:2' AND status IN ('draft', 'approved', 'publishing', 'published')").all<{ source_key: string }>()
    .then(r => r.results ?? []).catch(() => [])).map(r => r.source_key.slice(0, -2)));
  // "Når der ikke er godkendt et opslag, så deles selve eventet bare": the event's last post, come unapproved - its Facebook event instead (when the chair said so).
  for (const p of [...late]) {
    if (p.source.shout !== 2 && lastChance.has(p.source_key)) continue;
    const at = await shareEventInstead(db, p, nowMs);
    if (at !== null) { shared.push({ title: p.source.title ?? "", at }); late.splice(late.indexOf(p), 1); }
  }
  if (!late.length) return shared;
  const ids = new Set(late.map(p => p.id));
  const others = await socialPosts(db, "kind = 'event' AND status IN ('draft', 'approved', 'publishing', 'published') AND publish_at_ms >= ?", [nowMs - 86_400_000], "publish_at_ms, id", 1000);
  const rest = others.filter(p => !ids.has(p.id));
  // The first post keeps to ten days before only when its reminder is really there; else it is the event's only post, up to the day before.
  const withReminder = new Set((await db.prepare("SELECT source_key FROM social_posts WHERE source_key LIKE '%:2' AND status IN ('draft', 'approved', 'publishing', 'published')").all<{ source_key: string }>()
    .then(r => r.results ?? []).catch(() => [])).map(r => r.source_key.slice(0, -2)));
  const latestOf = (p: SocialPost) => p.source.shout !== 2 && withReminder.has(p.source_key) ? at(dateOf(p.source.startsMs! - 10 * 86_400_000), 23, 59) : lastPostMs(p.source.startsMs!);
  const latest = late.map(latestOf);
  const events = late.map(p => ({ title: p.source.title ?? "", startsMs: p.source.startsMs! }) as NewsletterEvent);
  // A first post with its reminder there gives way when the day's three are full (the reminder tells about the event).
  const fb = eventPostTimes(events, nowMs + 30 * MINUTE, rest.map(p => p.publish_at_ms!), [], latest, late.map(p => p.source.shout !== 2 && withReminder.has(p.source_key)));
  // Reported (the chair, 6 Nov 2026): "et opslag om et kursus i mirakler, som skulle sendes i dag, to uger før, men som nu er helt forsvundet." A first post
  // with no room among the day's three by ten days before is not set aside while its reminder is still to come: it gets the first time it can have up to
  // the day before the reminder - a fourth that day only when there is no other way.
  const reminderAt = new Map((await db.prepare("SELECT source_key, publish_at_ms FROM social_posts WHERE source_key LIKE '%:2' AND status IN ('draft', 'approved', 'publishing')")
    .all<{ source_key: string; publish_at_ms: number | null }>().then(r => r.results ?? []).catch(() => [])).map(r => [r.source_key.slice(0, -2), r.publish_at_ms ?? 0]));
  const stuck = late.map((p, i) => i).filter(i => Number.isNaN(fb[i]!) && late[i]!.source.shout !== 2 && (reminderAt.get(late[i]!.source_key) ?? 0) - 86_400_000 > nowMs + 30 * MINUTE);
  if (stuck.length) {
    const before = stuck.map(i => reminderAt.get(late[i]!.source_key)! - 86_400_000);
    const again = eventPostTimes(stuck.map(i => events[i]!), nowMs + 30 * MINUTE, [...rest.map(p => p.publish_at_ms!), ...fb.filter(t => !Number.isNaN(t))], [], before);
    stuck.forEach((i, k) => { if (!Number.isNaN(again[k]!) && again[k]! <= before[k]!) { fb[i] = again[k]!; latest[i] = before[k]!; } });
  }
  const ig = instagramPostTimes(events, fb.map((t, i) => Number.isNaN(t) ? latest[i]! : t), nowMs + 30 * MINUTE, rest.filter(p => p.channels.includes("instagram")).map(p => p.source.instagramAtMs ?? p.publish_at_ms!), latest, rest.map(p => p.publish_at_ms!));
  for (const [i, p] of late.entries()) {
    if (Number.isNaN(fb[i]!) || fb[i]! > latest[i]! || fb[i]! < nowMs) {
      await db.prepare("UPDATE social_posts SET status = 'skipped', error = ?, updated_at_ms = ? WHERE id = ? AND status = 'draft'")
        .bind(p.source.shout === 2 ? "Tiden for påmindelsen gik, uden at den blev godkendt" : "Tiden for 1. opslag gik, uden at det blev godkendt - 2. opslag står tilbage", nowMs, p.id).run();
      continue;
    }
    const source = { ...p.source, instagramAtMs: p.channels.includes("instagram") && ig[i] !== fb[i] ? ig[i] : null };
    await db.prepare("UPDATE social_posts SET publish_at_ms = ?, source = ? WHERE id = ? AND status = 'draft'").bind(fb[i], JSON.stringify(source), p.id).run();
  }
  return shared;
}

/** Asked (the chair, 6 Nov 2026): "Der er stadig en del steder med kun 1 dag til eventet, selvom der vil være god tid til at dele dem noget før" - "Op til 5 om
 * dagen". Every hour Saga's proposals that would go out less than three days before their event are moved to the first time they can have before that (the
 * day's three, else 9.30 or 17.30), on each medium for itself - only earlier, and never a time the chair chose. */
export async function pullEarlier(db: D1Database, nowMs: number): Promise<number> {
  const drafts = (await socialPosts(db, "kind = 'event' AND status = 'draft' AND json_extract(source, '$.startsMs') > ? AND json_extract(source, '$.chairTime') IS NULL",
    [nowMs + 3 * 3_600_000], "json_extract(source, '$.startsMs'), id", 300)).filter(p => p.source.startsMs && p.publish_at_ms);
  const igOf = (p: SocialPost) => p.source.instagramAtMs ?? p.publish_at_ms!;
  const late = drafts.filter(p => (p.channels.includes("facebook") && p.publish_at_ms! > earlyBy(p.source.startsMs!)) || (p.channels.includes("instagram") && igOf(p) > earlyBy(p.source.startsMs!)));
  if (!late.length) return 0;
  const all = await socialPosts(db, "kind IN ('event', 'week') AND status IN ('draft', 'approved', 'publishing', 'published') AND publish_at_ms >= ?", [nowMs - 86_400_000], "publish_at_ms, id", 1000);
  const fb = new Map(all.filter(p => p.channels.includes("facebook")).map(p => [p.id, p.publish_at_ms!]));
  const ig = new Map(all.filter(p => p.channels.includes("instagram")).map(p => [p.id, igOf(p)]));
  const from = nowMs + 30 * MINUTE;
  let moved = 0;
  for (const p of late) {
    // Three days before; where that is full, two days before is still better than the day before.
    const limits = [earlyBy(p.source.startsMs!), at(addDays(dateOf(p.source.startsMs!), -2), 23, 59)];
    const earlier = (now: number, taken: Map<number, number>) => {
      for (const limit of limits) {
        if (now <= limit) return now;
        const t = earlySlot(from, limit, [...taken].filter(([id]) => id !== p.id).map(([, x]) => x));
        if (t !== null && t < now) return t;
      }
      return now;
    };
    const fbAt = p.channels.includes("facebook") ? earlier(p.publish_at_ms!, fb) : p.publish_at_ms!;
    const igAt = p.channels.includes("instagram") ? earlier(igOf(p), ig) : igOf(p);
    if (fbAt === p.publish_at_ms && igAt === igOf(p)) continue;
    const both = p.channels.includes("facebook") && p.channels.includes("instagram");
    const publishAt = p.channels.includes("facebook") ? fbAt : igAt;
    const source = { ...p.source, instagramAtMs: p.channels.includes("instagram") && (!both || igAt !== fbAt) ? igAt : null };
    await db.prepare("UPDATE social_posts SET publish_at_ms = ?, source = ? WHERE id = ? AND status = 'draft'").bind(publishAt, JSON.stringify(source), p.id).run();
    if (p.channels.includes("facebook")) fb.set(p.id, fbAt);
    if (p.channels.includes("instagram")) ig.set(p.id, igAt);
    moved++;
  }
  return moved;
}

/** Once (the new plan): the waiting proposals for the events ahead. A weekly class told about in the three weeks around is set aside ("Hver 4. uge"), and
 * the rest get their first post's time in its window (shoutWindows); planShouts then adds the second. Approved posts stay as they are. */
async function replanForShouts(db: D1Database, nowMs: number): Promise<void> {
  const drafts = (await socialPosts(db, "kind = 'event' AND status = 'draft' AND json_extract(source, '$.startsMs') > ?", [nowMs + 3 * 3_600_000], "json_extract(source, '$.startsMs'), id", 500))
    .filter(p => p.source.startsMs && p.source.shout !== 2);
  const kept = await socialPosts(db, "kind = 'event' AND status IN ('approved', 'publishing', 'published') AND json_extract(source, '$.startsMs') > ?", [nowMs - 28 * 86_400_000], "id", 1000);
  const series = new Map<string, number[]>();
  for (const p of kept) if (p.source.title && p.source.startsMs) series.set(titleKey({ title: p.source.title }), [...(series.get(titleKey({ title: p.source.title })) ?? []), p.source.startsMs]);
  const keep: SocialPost[] = [];
  for (const p of drafts) {
    // On the day itself only when the chair says so ("et nødstilfælde").
    if (lastPostMs(p.source.startsMs!) < nowMs + 30 * MINUTE) {
      await db.prepare("UPDATE social_posts SET status = 'skipped', error = 'Eventet er i dag - opslag samme dag kun i nødstilfælde (lav det på plakatsiden)', updated_at_ms = ? WHERE id = ? AND status = 'draft'").bind(nowMs, p.id).run();
      continue;
    }
    const k = titleKey({ title: p.source.title ?? "" }), told = series.get(k) ?? [];
    if (told.some(t => t !== p.source.startsMs && Math.abs(t - p.source.startsMs!) < SERIES_GAP_MS)) {
      await db.prepare("UPDATE social_posts SET status = 'skipped', error = 'Fast hold: deles hver 4. uge - denne gang kun i Ugens events', updated_at_ms = ? WHERE id = ? AND status = 'draft'").bind(nowMs, p.id).run();
      continue;
    }
    series.set(k, [...told, p.source.startsMs!]);
    keep.push(p);
  }
  if (!keep.length) return;
  const ids = new Set(keep.map(p => p.id));
  const others = (await socialPosts(db, "kind = 'event' AND status IN ('draft', 'approved', 'publishing', 'published') AND publish_at_ms >= ?", [nowMs - 86_400_000], "publish_at_ms, id", 1000)).filter(p => !ids.has(p.id));
  const windows = keep.map(p => shoutWindows(p.source.startsMs!, nowMs));
  const events = keep.map(p => ({ title: p.source.title ?? "", startsMs: p.source.startsMs! }) as NewsletterEvent);
  // Without the reminders, which are planned again with them (planShouts).
  const reminders = new Set(keep.map(p => `${p.source_key}:2`));
  const free = others.filter(p => !(p.status === "draft" && reminders.has(p.source_key)));
  const { times: fb, single, latest } = placeFirsts(events, windows, nowMs + 30 * MINUTE, free.map(p => p.publish_at_ms!));
  const ig = instagramPostTimes(events, fb, nowMs + 30 * MINUTE, free.filter(p => p.channels.includes("instagram")).map(p => p.source.instagramAtMs ?? p.publish_at_ms!), latest, free.map(p => p.publish_at_ms!));
  for (const [i, p] of keep.entries()) {
    const source = { ...p.source, shout: 1, shouts: single[i] ? 1 : windows[i]!.length, instagramAtMs: p.channels.includes("instagram") && ig[i] !== fb[i] ? ig[i] : null };
    await db.prepare("UPDATE social_posts SET publish_at_ms = ?, source = ? WHERE id = ? AND status = 'draft'").bind(fb[i], JSON.stringify(source), p.id).run();
  }
  // The reminders still waiting are made again in their windows by the new times (planShouts) - and an event with one post has none.
  await db.prepare(`DELETE FROM social_posts WHERE status = 'draft' AND source_key IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...reminders])).run();
}

/** Once: the event drafts on Instagram nobody has changed get Instagram's own time. */
async function instagramOwnTimes(db: D1Database, nowMs: number): Promise<void> {
  const drafts = (await socialPosts(db, "kind = 'event' AND status = 'draft' AND updated_at_ms = created_at_ms AND channels LIKE '%instagram%' AND publish_at_ms > ? AND json_extract(source, '$.instagramAtMs') IS NULL", [nowMs], "publish_at_ms, id", 500))
    .filter(p => p.source.startsMs);
  if (!drafts.length) return;
  const events = drafts.map(p => ({ title: p.source.title ?? "", startsMs: p.source.startsMs! }) as NewsletterEvent);
  const times = instagramPostTimes(events, drafts.map(p => p.publish_at_ms!), nowMs + 30 * MINUTE, await instagramSlots(db, nowMs).then(all => {
    const own = new Set(drafts.map(p => p.publish_at_ms!)); return all.filter(t => !own.has(t)); }));
  for (const [i, p] of drafts.entries()) if (times[i] !== p.publish_at_ms)
    await db.prepare("UPDATE social_posts SET source = ? WHERE id = ? AND status = 'draft' AND updated_at_ms = created_at_ms").bind(JSON.stringify({ ...p.source, instagramAtMs: times[i] }), p.id).run();
}

/** Once: the event drafts nobody has changed are given their time again by the rule of now (soon, and evenly over the days). */
async function retimeUntouched(db: D1Database, nowMs: number): Promise<void> {
  const rows = await db.prepare(`SELECT id, publish_at_ms, json_extract(source, '$.title') AS title, json_extract(source, '$.startsMs') AS starts FROM social_posts
      WHERE kind = 'event' AND status = 'draft' AND updated_at_ms = created_at_ms AND publish_at_ms > ? ORDER BY starts`).bind(nowMs)
    .all<{ id: number; publish_at_ms: number; title: string | null; starts: number | null }>().then(r => r.results ?? []).catch(() => []);
  const movable = rows.filter(r => r.starts);
  if (!movable.length) return;
  const ids = new Set(movable.map(r => r.id));
  const taken = (await db.prepare("SELECT id, publish_at_ms FROM social_posts WHERE kind = 'event' AND publish_at_ms >= ? AND status IN ('draft', 'approved', 'publishing', 'published')").bind(nowMs - 86_400_000)
    .all<{ id: number; publish_at_ms: number }>().then(r => r.results ?? []).catch(() => [])).filter(r => !ids.has(r.id)).map(r => r.publish_at_ms);
  const events = movable.map(r => ({ title: r.title ?? "", startsMs: r.starts! }) as NewsletterEvent);
  const windows = events.map(e => shoutWindows(e.startsMs, nowMs)[0]!);
  const times = eventPostTimes(events, nowMs + 30 * MINUTE, taken, windows.map(w => w.earliest), windows.map(w => w.latest));
  for (const [i, r] of movable.entries()) if (times[i]! !== r.publish_at_ms)
    await db.prepare("UPDATE social_posts SET publish_at_ms = ? WHERE id = ? AND status = 'draft' AND updated_at_ms = created_at_ms").bind(times[i], r.id).run();
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
  if (made) await tellChair(env, deps, `"Ugens events" for uge ${Number(week.slice(6))} er klar (ugens ${events} events har hvert sit opslag). Læs det, ret det og godkend her: ${cockpitUrl(env)}/pr/uge`);
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
  // "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside" - also for posts made before that rule (public-site.ts).
  const live = await siteLive(db), pub = (text: string) => toPublicSite(db, text, live);
  try {
    for (const channel of post.channels) {
      if (done[channel] || dueAt(post, channel) > deps.now()) continue;
      // Asked (the chair, 6 Nov 2026): "Hvorfor er det, at vi ikke deler film på Facebook også?" - "Videoen på begge": an event's video goes on Facebook too,
      // with the words and the link in them (pages_manage_posts). Should Facebook refuse it for want of a permission, the picture goes out as before.
      const facebookVideo = channel === "facebook" && post.kind === "event" && post.source.video && !post.source.noFacebookVideo
        ? await postVideoToPage(deps.fetcher, page, { url: post.source.video, description: await pub(post.link ? `${post.text}\n\n${post.link}` : post.text) }).catch(error => {
          if (/permission|\(#10\)|\(#200\)|publish_video|meta_403/i.test(error instanceof Error ? error.message : String(error))) return null;
          throw error;
        }) : null;
      if (channel === "facebook") done.facebook = facebookVideo ?? (post.source.design && post.images[0]
        ? await postPhotoToPage(deps.fetcher, page, { url: post.images[0], caption: await pub(post.link ? `${post.text}\n\n${post.link}` : post.text) })
        : await postToPage(deps.fetcher, page, { message: await pub(post.text), link: post.link ? await pub(post.link) : post.link }));
      else {
        if (!instagram) throw new Error("Instagram er ikke koblet til Facebook-siden");
        // "Ugens events" as a reel, and an event's post with its video (requested: the video templates, "Lad os få dem op"): Instagram processes the
        // video between Saga's rounds. Facebook has the video too (above).
        if (post.source.format === "reel" || (post.kind === "event" && post.source.video && !post.source.noVideo)) {
          if (!post.source.video) throw new Error("Reelen har ingen video");
          const caption = await pub(post.kind === "event" ? post.source.instagramText || instagramEventText(post.text) : post.text);
          done.instagram_container ??= await startReel(deps.fetcher, instagram, { videoUrl: post.source.video, caption, collaborators: post.source.collaborators ?? [] });
          await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
          const status = await reelStatus(deps.fetcher, instagram.token, done.instagram_container);
          if (status === "ERROR" || status === "EXPIRED") { delete done.instagram_container; throw new Error(`Instagram kunne ikke behandle videoen (${status})`); }
          if (status !== "FINISHED") throw new ReelPending();
          done.instagram = await finishReel(deps.fetcher, instagram, done.instagram_container);
          const reelLink = await permalinkOf(deps.fetcher, instagram.token, "instagram", done.instagram);
          if (reelLink) done.instagram_link = reelLink;
          await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
          continue;
        }
        // A tagged Instagram post's picture addresses expire: read again now.
        const images = post.kind === "share" && post.source.network === "instagram" && post.source.id
          ? await freshInstagramImages(deps.fetcher, instagram, post.source.id, post.images) : post.images;
        done.instagram = await publishToInstagram(deps.fetcher, instagram, { caption: await pub(post.source.instagramText || (post.kind === "event" ? instagramEventText(post.text) : post.text)), images,
          collaborators: post.source.collaborators ?? [] }).catch(error => {
          // Instagram takes only jpg pictures.
          throw /format|image.*(type|jpeg)|2207/i.test(error instanceof Error ? error.message : String(error)) ? new Error("Instagram kunne ikke bruge billedet (Instagram tager kun jpg). Facebook-delen er sendt; fjern Instagram og godkend igen, eller lav et design.") : error;
        });
      }
      // "Et lille link til det publicerede opslag" (prCalendar.ts): where it is now.
      const id = done[channel], linkKey = channel === "facebook" ? "facebook_link" : "instagram_link";
      if (id && !done[linkKey]) { const link = await permalinkOf(deps.fetcher, channel === "facebook" ? page.token : instagram!.token, channel, id); if (link) done[linkKey] = link; }
      // Kept at once: a retry never posts the same thing twice on a channel it already reached.
      await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run();
    }
  } catch (error) {
    await db.prepare("UPDATE social_posts SET published = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(done), deps.now(), post.id).run().catch(() => undefined);
    throw error;
  }
  // Everything out: published. Instagram (or Facebook) still to come at its own time: approved, with what is out kept.
  const all = post.channels.every(c => done[c]);
  await db.prepare(`UPDATE social_posts SET status = ?, ${all ? "published_at_ms = ?," : ""} error = NULL, updated_at_ms = ? WHERE id = ?`).bind(...[all ? "published" : "approved", ...(all ? [deps.now()] : []), deps.now(), post.id]).run();
}

/** When a post goes out on a medium: Instagram at its own time, when it has one. */
export const dueAt = (post: Pick<SocialPost, "publish_at_ms" | "source">, channel: Channel): number =>
  (channel === "instagram" ? post.source.instagramAtMs ?? post.publish_at_ms : post.publish_at_ms) ?? Infinity;
/** The first time anything of the post is due (on a medium it has not reached). */
export const firstDue = (post: Pick<SocialPost, "publish_at_ms" | "source" | "channels" | "published">): number =>
  Math.min(...post.channels.filter(c => !post.published[c]).map(c => dueAt(post, c)), Infinity);

/** Whether an event is still in the calendar: a cancelled or removed one never gets its post. */
async function eventStillOn(db: D1Database, key: string): Promise<boolean> {
  const [source, id] = [key.slice(0, 3), key.slice(3)];
  // The calendar's events: only one that is known and removed is off (some are only in the membership system's list, never stored).
  if (source === "mw:") {
    const row = await db.prepare("SELECT title, description, removed_at_ms FROM house_events WHERE id = ?").bind(id).first<{ title: string; description: string | null; removed_at_ms: number | null }>().catch(() => null);
    // Reported (the chair, 5 Nov 2026): "Jeg får stadig vist et event som dette, selvom det er aflyst" - cancelled in the calendar by "- Aflyst -" in its title.
    return !row || (!row.removed_at_ms && !isCancelledEvent({ title: row.title, description: row.description }));
  }
  if (source === "hr:") return Boolean(await db.prepare("SELECT 1 AS yes FROM room_bookings WHERE id = ? AND status = 'scheduled'").bind(Number(id)).first().catch(() => ({ yes: 1 })));
  return true;
}

/** Requested (5 Nov 2026): "Når et event er aflyst bør det fjernes fra listen" - "Altså i PR - også i pr kalenderen". A post Saga proposed (or the chair
 * approved) for an event that has since been cancelled or taken off the calendar is set aside, so it leaves the PR calendar and never goes out. */
export async function retireCancelled(db: D1Database, nowMs: number): Promise<number> {
  const waiting = await socialPosts(db, "kind = 'event' AND status IN ('draft', 'approved')", [], "publish_at_ms, id", 500);
  let retired = 0;
  for (const post of waiting) {
    const key = post.source.key;
    // A proposal for an event that has taken place without its post going out is set aside too (an approved one is publishOne's to settle).
    if (post.status === "draft" && post.source.startsMs && post.source.startsMs <= nowMs) {
      const done = await db.prepare("UPDATE social_posts SET status = 'skipped', error = 'Eventet er afholdt, før opslaget blev godkendt', updated_at_ms = ? WHERE id = ? AND status = 'draft'").bind(nowMs, post.id).run();
      retired += done.meta?.changes ?? 0;
      continue;
    }
    if (!key || await eventStillOn(db, key)) continue;
    const done = await db.prepare("UPDATE social_posts SET status = 'skipped', error = 'Eventet er aflyst eller fjernet fra kalenderen', updated_at_ms = ? WHERE id = ? AND status IN ('draft', 'approved')").bind(nowMs, post.id).run();
    retired += done.meta?.changes ?? 0;
  }
  return retired;
}

/** Requested (the chair, 5 Nov 2026): "Og det skal være muligt at jeg selv kan flytte entries rundt i kalenderen." A post that has not gone out is moved
 * to another time - on Facebook, on Instagram (when it has its own time there) or both - and keeps its status. Not in the past, and an event's post
 * at the latest an hour before the event begins. */
export type MoveChannel = "facebook" | "instagram" | "both";
export async function movePost(db: D1Database, id: number, channel: MoveChannel, atMs: number, nowMs: number): Promise<"moved" | "not_found" | "sent" | "time"> {
  const post = await socialPost(db, id);
  if (!post) return "not_found";
  if (!["draft", "approved", "failed"].includes(post.status)) return "sent";
  if (!Number.isFinite(atMs) || atMs < nowMs - 60_000 || (post.kind === "event" && post.source.startsMs && atMs > post.source.startsMs - 3_600_000)) return "time";
  const ownIg = typeof post.source.instagramAtMs === "number" && post.source.instagramAtMs !== post.publish_at_ms;
  const source = { ...post.source };
  let publishAt = post.publish_at_ms;
  // A time the chair chose stays (pullEarlier leaves it).
  source.chairTime = true;
  if (channel === "instagram" && ownIg) source.instagramAtMs = atMs;
  else if (channel === "facebook" && ownIg) publishAt = atMs;
  else { publishAt = atMs; if (typeof source.instagramAtMs === "number") source.instagramAtMs = atMs; }
  await db.prepare("UPDATE social_posts SET publish_at_ms = ?, source = ?, updated_at_ms = ? WHERE id = ?").bind(publishAt, JSON.stringify(source), nowMs, id).run();
  return "moved";
}

/** The posts waiting to go out, written before the rule "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside"
 * (public-site.ts): their words and links with the old website's addresses, so the chair reads them as they will go out. Nothing while the new site is in use. */
export async function oldSiteInWaiting(db: D1Database, nowMs: number): Promise<number> {
  const live = await siteLive(db);
  if (live) return 0;
  const waiting = await socialPosts(db, "status IN ('draft', 'approved', 'failed') AND (text LIKE '%hjerterum.info/events%' OR link LIKE '%hjerterum.info/events%' OR json_extract(source, '$.instagramText') LIKE '%hjerterum.info/events%')", [], "publish_at_ms, id", 500);
  let changed = 0;
  for (const post of waiting) {
    const text = await toPublicSite(db, post.text, live), link = post.link ? await toPublicSite(db, post.link, live) : post.link;
    const source = typeof post.source.instagramText === "string" ? { ...post.source, instagramText: await toPublicSite(db, post.source.instagramText, live) } : post.source;
    await db.prepare("UPDATE social_posts SET text = ?, link = ?, source = ?, updated_at_ms = ? WHERE id = ?").bind(text, link, JSON.stringify(source), nowMs, post.id).run();
    changed++;
  }
  return changed;
}

/** Every round: the approved posts whose time has come go out, each once. An event's post whose event has begun is not sent late. */
export async function publishDue(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const due = await socialPosts(db, "status = 'approved' AND (publish_at_ms <= ? OR json_extract(source, '$.instagramAtMs') <= ?)", [deps.now(), deps.now()], "publish_at_ms, id", 5);
  let sent = 0;
  for (const post of due) if (await publishOne(env, deps, db, post)) sent++;
  return sent;
}

/** One approved post out now, once: skipped when its event is cancelled or has begun; a failure is kept with its reason, and the chair is told.
 * Asked (the chair, 3 Nov 2026): "Hvorfor skal der gå så lang tid?" - a post approved for "nu" goes out at once from the cockpit, not in Saga's next
 * round (every ten minutes). Returns whether it went out. */
export async function publishOne(env: SocialEnv, deps: SagaDeps, db: D1Database, post: SocialPost): Promise<boolean> {
  const now = deps.now();
  if (post.status !== "approved" || firstDue(post) > now) return false;
  if (post.kind === "event" && post.source.key && !(await eventStillOn(db, post.source.key))) {
    await db.prepare("UPDATE social_posts SET status = 'skipped', error = ?, updated_at_ms = ? WHERE id = ?").bind("Eventet er aflyst eller fjernet fra kalenderen", now, post.id).run();
    return false;
  }
  if (post.kind === "event" && post.source.startsMs && post.source.startsMs <= now) {
    // Out on one medium already: kept as published, with why the other did not follow.
    const some = Object.keys(post.published).some(k => k === "facebook" || k === "instagram");
    await db.prepare(`UPDATE social_posts SET status = ?, error = ?, ${some ? "published_at_ms = coalesce(published_at_ms, ?)," : ""} updated_at_ms = ? WHERE id = ?`)
      .bind(...[some ? "published" : "skipped", some ? "Eventet var begyndt, før det skulle ud på det andet medie" : "Eventet var begyndt, før opslaget skulle ud", ...(some ? [now] : []), now, post.id]).run();
    return false;
  }
  // Claimed first, so two rounds (or a round and the cockpit) never send the same post.
  const claimed = await db.prepare("UPDATE social_posts SET status = 'publishing', updated_at_ms = ? WHERE id = ? AND status = 'approved'").bind(now, post.id).run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) return false;
  try {
    await publishPost(env, deps, db, post);
    return true;
  } catch (error) {
    if (error instanceof ReelPending) {
      // Tried again in the next round, at most for six hours.
      if (deps.now() - (post.publish_at_ms ?? deps.now()) < 6 * 3_600_000) {
        await db.prepare("UPDATE social_posts SET status = 'approved', updated_at_ms = ? WHERE id = ?").bind(deps.now(), post.id).run();
        return false;
      }
      error = new Error("Instagram blev ikke færdig med videoen inden for seks timer");
    }
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await db.prepare("UPDATE social_posts SET status = 'failed', error = ?, updated_at_ms = ? WHERE id = ?").bind(message, deps.now(), post.id).run();
    await tellChair(env, deps, `Et opslag kunne ikke komme ud (${post.kind === "share" ? "deling" : post.kind === "week" ? "Ugens events" : "event"}): ${message.slice(0, 200)}. Se ${cockpitUrl(env)}/pr`);
    return false;
  }
}

/** A post stuck in "publishing" (the run stopped halfway) is tried again: what reached a channel is kept, so nothing goes out twice. */
async function releaseStuck(db: D1Database, nowMs: number): Promise<void> {
  await db.prepare("UPDATE social_posts SET status = 'approved', updated_at_ms = ? WHERE status = 'publishing' AND updated_at_ms < ?").bind(nowMs, nowMs - RETRY_AFTER_MS).run().catch(() => undefined);
}

/** Once (5 Nov 2026, "Kun Hjerterums ord"): the waiting shares' Instagram text without the maker's own caption. */
async function ownWordsOnShares(db: D1Database): Promise<number> {
  const waiting = await socialPosts(db, "kind = 'share' AND status IN ('draft', 'failed') AND json_extract(source, '$.instagramText') IS NOT NULL", [], "id", 200);
  for (const p of waiting) await db.prepare("UPDATE social_posts SET source = json_set(source, '$.instagramText', ?) WHERE id = ?")
    .bind(instagramShareText(p.text, p.source.author ?? null, "", p.source.network === "facebook" ? "facebook" : "instagram"), p.id).run();
  return waiting.length;
}

/** PR og SoMe → Beskeder: the page's conversations in Messenger, read when the chair opens them (nothing is kept). */
export async function messengerInbox(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<{ threads: MessengerThread[]; error: string | null }> {
  const account = await socialAccount(db);
  if (!account) return { threads: [], error: "Facebook og Instagram er ikke forbundet." };
  try {
    const { page } = await access(env, account);
    return { threads: await messengerThreads(deps.fetcher, page), error: null };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { threads: [], error: /permission|\(#10\)|\(#200\)|\(#230\)|meta_403/i.test(text) ? "Beskederne kan ikke læses endnu: tryk \"Forbind Facebook og Instagram\" under Overblik igen, og sig ja til beskeder." : `Beskederne kunne ikke hentes: ${text}` };
  }
}

/** The chair's answer in Messenger (only when Send is pressed). */
export async function answerInMessenger(env: SocialEnv, deps: SagaDeps, db: D1Database, recipientId: string, text: string): Promise<"sent" | "late" | "error"> {
  const account = await socialAccount(db);
  if (!account || !text.trim() || !/^\d{3,30}$/.test(recipientId)) return "error";
  const { page } = await access(env, account);
  return sendMessengerReply(deps.fetcher, page, recipientId, text.trim().slice(0, 1900)).then(() => "sent" as const,
    error => /outside of allowed window|\(#10\)|2018278|2018109/i.test(error instanceof Error ? error.message : String(error)) ? "late" as const : "error" as const);
}

/** Once: the links of the posts published before the calendar showed them ("Og et lille link til det publicerede opslag"). */
async function linksForPublished(env: SocialEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const account = await socialAccount(db);
  if (!account) return 0;
  const { page } = await access(env, account);
  const posts = await socialPosts(db, "status = 'published' AND published_at_ms > ?", [deps.now() - 90 * 86_400_000], "id", 300);
  let changed = 0;
  for (const p of posts) {
    const done = { ...p.published };
    for (const channel of ["facebook", "instagram"] as const) {
      const key = channel === "facebook" ? "facebook_link" : "instagram_link";
      if (done[channel] && !done[key]) { const link = await permalinkOf(deps.fetcher, page.token, channel, done[channel]!); if (link) done[key] = link; }
    }
    if (JSON.stringify(done) === JSON.stringify(p.published)) continue;
    await db.prepare("UPDATE social_posts SET published = ? WHERE id = ?").bind(JSON.stringify(done), p.id).run();
    changed++;
  }
  return changed;
}

/** Once: the waiting posts' Instagram words get the new line about the bio (bioLine). */
async function bioLineInWaiting(db: D1Database): Promise<number> {
  const waiting = await socialPosts(db, "status IN ('draft', 'approved', 'failed') AND (text LIKE '%(link i bio)%' OR json_extract(source, '$.instagramText') LIKE '%(link i bio)%')", [], "id", 1000);
  for (const p of waiting) await db.prepare("UPDATE social_posts SET text = ?, source = ? WHERE id = ? AND status IN ('draft', 'approved', 'failed')")
    .bind(bioLine(p.text), JSON.stringify(typeof p.source.instagramText === "string" ? { ...p.source, instagramText: bioLine(p.source.instagramText) } : p.source), p.id).run();
  return waiting.length;
}

/** Once (the chair, 6 Nov 2026: "Det er en fejl, at der bare står lørdag klokken 10:30, da det først er lørdagen efter."): the waiting event posts' words
 * get the event's date beside its weekday. */
async function datesInWaiting(db: D1Database): Promise<number> {
  const waiting = await socialPosts(db, "kind = 'event' AND status IN ('draft', 'approved', 'failed') AND json_extract(source, '$.startsMs') IS NOT NULL", [], "id", 1000);
  let changed = 0;
  for (const p of waiting) {
    const text = withEventDate(p.text, p.source.startsMs!), ig = p.source.instagramText ? withEventDate(p.source.instagramText, p.source.startsMs!) : p.source.instagramText;
    if (text === p.text && ig === p.source.instagramText) continue;
    await db.prepare("UPDATE social_posts SET text = ?, source = ? WHERE id = ? AND status IN ('draft', 'approved', 'failed')").bind(text, JSON.stringify({ ...p.source, instagramText: ig }), p.id).run();
    changed++;
  }
  return changed;
}

/** In every round (config-entry.ts): publish what is due, look for new tags every half hour, and plan next week on Thursday. */
export async function runSocialJob(env: SocialEnv, deps: SagaDeps): Promise<void> {
  const db = env.DB;
  if (!db || !(await socialAccount(db))) return;
  const now = deps.now();
  await releaseStuck(db, now);
  if (await claimJob(db, "social_share_own_words", 0, now).catch(() => false)) await ownWordsOnShares(db).catch(error => console.warn("social_share_words_failed", error instanceof Error ? error.message : error));
  if (await claimJob(db, "social_post_links", 0, now).catch(() => false)) await linksForPublished(env, deps, db).catch(error => console.warn("social_post_links_failed", error instanceof Error ? error.message : error));
  if (await claimJob(db, "social_bio_line", 0, now).catch(() => false)) await bioLineInWaiting(db).catch(error => console.warn("social_bio_line_failed", error instanceof Error ? error.message : error));
  if (await claimJob(db, "social_event_dates", 0, now).catch(() => false)) await datesInWaiting(db).catch(error => console.warn("social_event_dates_failed", error instanceof Error ? error.message : error));
  await retireCancelled(db, now).catch(error => console.warn("social_retire_failed", error instanceof Error ? error.message : error));
  await oldSiteInWaiting(db, now).catch(error => console.warn("social_old_site_failed", error instanceof Error ? error.message : error));
  await publishDue(env, deps, db).catch(error => console.warn("social_publish_failed", error instanceof Error ? error.message : error));
  if (await claimJob(db, "social_tags", Math.floor(now / TAG_EVERY_MS) * TAG_EVERY_MS, now).catch(() => false))
    await scanTags(env, deps, db).catch(error => console.warn("social_tags_failed", error instanceof Error ? error.message : error));
  await scheduledWeekPlan(env, deps, db).catch(error => console.warn("social_week_plan_failed", error instanceof Error ? error.message : error));
  await topUpWeeks(env, deps, db).catch(error => console.warn("social_top_up_failed", error instanceof Error ? error.message : error));
  await countFollowers(env, deps, db).catch(error => console.warn("social_stats_failed", error instanceof Error ? error.message : error));
  await notifyVideos(env, deps, db).catch(error => console.warn("social_video_notice_failed", error instanceof Error ? error.message : error));
}

// ---- The videos, approved from Saga's link ----

/** Requested (the chair, 5 Nov 2026): "lav gerne delen med videoskabelon. Det skal fungere sådan at jeg kan klikke på sagas link i telegram og på et
 * øjeblik godkende". When a video is made (video-events.yml, ugens-reel.yml), Saga writes to the chair - once per video - with a link per post. */
export async function notifyVideos(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return 0;
  const now = deps.now();
  const fresh = await socialPosts(db, `status = 'draft' AND kind IN ('event', 'week') AND json_extract(source, '$.video') IS NOT NULL AND json_extract(source, '$.videoNotifiedAtMs') IS NULL
    AND coalesce(json_extract(source, '$.instagramAtMs'), publish_at_ms, ?) > ?`, [now + 1, now], "coalesce(json_extract(source, '$.instagramAtMs'), publish_at_ms), id", 10);
  const choices = await notifyChoices(env, deps, db);
  if (!fresh.length) return choices;
  // Marked first, without touching updated_at_ms (Saga's re-timing leaves only untouched proposals): a message is never sent twice.
  const marked: SocialPost[] = [];
  for (const p of fresh) {
    const done = await db.prepare("UPDATE social_posts SET source = json_set(source, '$.videoNotifiedAtMs', ?) WHERE id = ? AND json_extract(source, '$.videoNotifiedAtMs') IS NULL").bind(now, p.id).run();
    if (Number(done.meta?.changes ?? 0) === 1) marked.push(p);
  }
  if (!marked.length) return 0;
  const { quickLink } = await import("./quickLink.js");
  const lines = await Promise.all(marked.map(async p => {
    const link = await quickLink(env, p.id, now);
    const title = p.kind === "week" ? `Ugens events${p.week ? `, uge ${Number(p.week.slice(6))}` : ""}` : p.source.title ?? "Event";
    const when = p.kind === "event" && p.source.startsMs ? ` (${dayName(p.source.startsMs)} ${clock(p.source.startsMs)})` : "";
    return `▶ <a href="${htmlText(link ?? `${cockpitUrl(env)}/pr/kalender`)}">${htmlText(title)}</a>${htmlText(when)}`;
  }));
  const head = marked.length === 1 ? "Saga har lavet en video til Instagram. Tryk for at se den og godkende:" : `Saga har lavet ${marked.length} videoer til Instagram. Tryk på hver for at se den og godkende:`;
  await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `${head}\n\n${lines.join("\n")}`, { html: true })
    .catch(error => console.warn("social_video_notice_failed", error instanceof Error ? error.message : error));
  return marked.length + choices;
}

/** The videos made on the chair's "Lav flere videoer": one message, a link per post, once per batch. */
async function notifyChoices(env: SagaEnv, deps: SagaDeps, db: D1Database): Promise<number> {
  const now = deps.now();
  const ready = await socialPosts(db, `kind = 'event' AND status IN ('draft', 'approved', 'failed') AND json_extract(source, '$.videoAsk') IS NULL AND json_extract(source, '$.stillAsk') IS NULL
    AND json_array_length(json_extract(source, '$.videoChoices')) > coalesce(json_extract(source, '$.videoChoicesTold'), 0)`, [], "id", 10);
  const told: SocialPost[] = [];
  for (const p of ready) {
    const n = p.source.videoChoices?.length ?? 0;
    const done = await db.prepare("UPDATE social_posts SET source = json_set(source, '$.videoChoicesTold', ?) WHERE id = ? AND coalesce(json_extract(source, '$.videoChoicesTold'), 0) < ?").bind(n, p.id, n).run();
    if (Number(done.meta?.changes ?? 0) === 1) told.push(p);
  }
  if (!told.length) return 0;
  const { quickLink } = await import("./quickLink.js");
  const lines = await Promise.all(told.map(async p => `▶ <a href="${htmlText(await quickLink(env, p.id, now) ?? `${cockpitUrl(env)}/pr/kalender`)}">${htmlText(p.source.title ?? "Event")}</a>`));
  await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID!, `De nye videoer er klar. Tryk, se dem side om side, og vælg den, du vil bruge:\n\n${lines.join("\n")}`, { html: true })
    .catch(error => console.warn("social_video_notice_failed", error instanceof Error ? error.message : error));
  return told.length;
}

/** "Lav flere videoer": up to three templates the post has not had, the least used first (social/videoTemplates.ts); made within a quarter of an hour. */
export async function askVideos(db: D1Database, id: number, nowMs: number): Promise<"ok" | "not_found" | "late" | "none" | "busy"> {
  const post = await socialPost(db, id);
  if (!post || post.kind !== "event" || !["draft", "approved", "failed"].includes(post.status)) return "not_found";
  if (post.source.videoAsk) return "busy";
  if (!post.source.startsMs || post.source.startsMs < nowMs + 3 * 3_600_000) return "late";
  const { templatesFor, templateUses } = await import("./videoTemplates.js");
  const had = new Set([post.source.video ? post.source.videoTemplate : undefined, ...(post.source.videoChoices ?? []).map(c => c.template)].filter((n): n is number => typeof n === "number"));
  const uses = await templateUses(db);
  const fresh = templatesFor(post).filter(n => !had.has(n)).sort((a, b) => (uses.get(a)?.atMs ?? 0) - (uses.get(b)?.atMs ?? 0)).slice(0, 3);
  if (!fresh.length) return "none";
  await db.prepare("UPDATE social_posts SET source = json_set(source, '$.videoAsk', json(?)) WHERE id = ?").bind(JSON.stringify({ atMs: nowMs, templates: fresh }), id).run();
  return "ok";
}

/** "Er det muligt at bruge disse skabeloner, med lidt bevægelse?": the chair's design (stored in R2 by the studio) made a video with a marked start, within a
 * quarter of an hour; it lands among the videos to choose from. */
export async function askStill(db: D1Database, id: number, image: string, effect: StillEffect, nowMs: number): Promise<"ok" | "not_found" | "late" | "busy"> {
  const post = await socialPost(db, id);
  if (!post || post.kind !== "event" || !["draft", "approved", "failed"].includes(post.status)) return "not_found";
  if (post.source.stillAsk) return "busy";
  if (!post.source.startsMs || post.source.startsMs < nowMs + 3 * 3_600_000) return "late";
  await db.prepare("UPDATE social_posts SET source = json_set(source, '$.stillAsk', json(?)) WHERE id = ?").bind(JSON.stringify({ atMs: nowMs, image, effect }), id).run();
  return "ok";
}

export const EFFECTS: Record<StillEffect, string> = { zoom: "Zoom ind", ryst: "Ryst", slor: "Slør ind" };
/** A video choice's name: its template, or the chair's own design with its start. */
export const choiceName = (c: { template: number; effect?: StillEffect | undefined }, templateName: (n: number) => string | null) =>
  c.template === 0 ? `Dit design · ${EFFECTS[c.effect ?? "zoom"]}` : `${c.template}. ${templateName(c.template) ?? ""}`;

/** The chair picks one of the videos: it becomes the post's video (on Instagram as a reel), and the post waits for the chair's approval again. */
export async function pickVideo(db: D1Database, id: number, index: number, nowMs: number): Promise<SocialPost | null> {
  const post = await socialPost(db, id);
  const choice = post?.source.videoChoices?.[index];
  if (!post || !choice || !["draft", "approved", "failed"].includes(post.status)) return null;
  const { noVideo: _off, noFacebookVideo: _offFb, ...rest } = post.source;
  await db.prepare("UPDATE social_posts SET source = ?, status = 'draft', approved_by = NULL, approved_at_ms = NULL, error = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(JSON.stringify({ ...rest, video: choice.video, videoTemplate: choice.template, videoAtMs: choice.atMs, videoNotifiedAtMs: nowMs }), nowMs, id).run();
  return socialPost(db, id);
}

const htmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Whether a new video can still be made for the post before it goes out (video-events.yml takes proposals at least 3 hours before the event, and an
 * hour before Instagram's time). */
export function videoInTime(post: Pick<SocialPost, "kind" | "channels" | "publish_at_ms" | "source">, nowMs: number): boolean {
  if (post.kind !== "event" || !post.channels.includes("instagram") || !post.source.startsMs) return false;
  return post.source.startsMs > nowMs + 3 * 3_600_000 && (post.source.instagramAtMs ?? post.publish_at_ms ?? 0) > nowMs + 3_600_000;
}

/** "En anden skabelon": the video is made again, in the chosen template, within half an hour (video-events.yml); the post waits as a proposal. */
export async function chooseVideoTemplate(db: D1Database, id: number, template: number, nowMs: number): Promise<"ok" | "not_found" | "template" | "late"> {
  const post = await socialPost(db, id);
  if (!post || post.kind !== "event" || !["draft", "approved", "failed"].includes(post.status)) return "not_found";
  const { templatesFor } = await import("./videoTemplates.js");
  if (!templatesFor(post).includes(template)) return "template";
  if (!videoInTime(post, nowMs)) return "late";
  const { video: _video, videoAtMs: _at, videoNotifiedAtMs: _told, noVideo: _off, noFacebookVideo: _offFb, ...rest } = post.source;
  await db.prepare("UPDATE social_posts SET source = ?, status = 'draft', approved_by = NULL, approved_at_ms = NULL, error = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(JSON.stringify({ ...rest, videoTemplate: template }), nowMs, id).run();
  return "ok";
}

/** The next proposal waiting for the chair (its time not passed), after the one just decided: videos first, then by time. */
export async function nextWaiting(db: D1Database, afterId: number, nowMs: number): Promise<SocialPost | null> {
  const [post] = await socialPosts(db, "status = 'draft' AND kind IN ('event', 'week') AND id <> ? AND channels <> '[]' AND coalesce(publish_at_ms, ?) > ?",
    [afterId, nowMs + 1, nowMs], "CASE WHEN json_extract(source, '$.video') IS NULL THEN 1 ELSE 0 END, publish_at_ms, id", 1);
  return post ?? null;
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

/** Requested (the chair, 3 Nov 2026): "I forhold til designskabelonerne skal vi kun bruge dem til sociale medier, og derfor er hele tanken, at jeg kan generere et
 * design til et social media-post." The open post of an event (draft, approved or failed - not one that has gone out), for Plakater og opslag. */
export async function eventPost(db: D1Database, key: string): Promise<SocialPost | null> {
  // The event's first post still waiting ("to shouts": the reminder after it).
  const [post] = await socialPosts(db, "kind = 'event' AND json_extract(source, '$.key') = ? AND status IN ('draft', 'approved', 'failed')", [key], "coalesce(json_extract(source, '$.shout'), 1), publish_at_ms, id", 1);
  return post ?? null;
}

/** The design becomes the post's picture (on Facebook and Instagram); a changed post is a draft again, for the chair to approve. */
export async function setPostDesign(db: D1Database, postId: number, url: string, nowMs: number): Promise<boolean> {
  const post = await socialPost(db, postId);
  if (!post || !["draft", "approved", "failed"].includes(post.status)) return false;
  await db.prepare("UPDATE social_posts SET images = ?, source = ?, status = 'draft', approved_by = NULL, approved_at_ms = NULL, error = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(JSON.stringify([url]), JSON.stringify({ ...post.source, design: true }), nowMs, postId).run();
  return true;
}
