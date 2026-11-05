import type { D1Database } from "../db.js";
import type { EventMediaBucket } from "../event-files.js";
import { eventDetail } from "../event-detail.js";
import { posterImage, posterImageAllowed } from "../poster-image.js";
import { removeDesign, storeDesign } from "../event-designs.js";
import { parsePrQuotes, EMPTY_QUOTES, type PrQuotes } from "../../pr-material.js";
import { esc, layout } from "./page.js";
import { mondayOf as mondayOfMs } from "../social/plan.js";
import { choiceName, instagramEventText, socialAccount, socialPost, videoInTime, type Channel } from "../social/social.js";
import { materialOf } from "./mailMaterial.js";
import { templateName, templatesFor, templateUses, usedLabel, VIDEO_TEMPLATES } from "../social/videoTemplates.js";

/** Requested (the chair, 3 Nov 2026): "de designskabeloner, vi har lavet til eventoprettelse, skal kun bruges i cockpittet, så man - eller det
 * vil sige mig til at begynde med - kan bruge dem" - and "Det er vigtigt, at jeg i cockpittet kan bruge alt det materiale, der er lagt op i
 * forbindelse med eventet, og også har en sektion med alt fra den pågældende underviser."
 *
 * Events → Plakater og opslag (/plakater): the chair picks an event; the designs are drawn in the browser (src/poster-studio.tsx, the same
 * templates as before) from any picture the event or its teacher has given Hjerterum, and can be downloaded - and, for the house's own events,
 * kept as the event's design on the website. Members no longer see the templates (the chair's answer: the website shows their own photo
 * until a design is made here). Every picture is served from admin's own address, so the canvas may save what it draws. */

/** An event as the studio knows it: "h<n>" is one of the house's own (room_bookings), 24 hex one from the membership system's calendar. */
export type StudioEvent = { id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; lines: string[];
  /** The house's own event: its design on the website can be set from here. */
  bookingId: number | null; design: string | null };
export type StudioPicture = { url: string; label: string; width?: number | null; height?: number | null };
export type StudioTeacher = { name: string; consent: "given" | "withdrawn" | "none"; quotes: PrQuotes; pictures: StudioPicture[]; events: Array<{ title: string; startsAt: string; picture: string | null }> };
export type StudioData = { event: StudioEvent; eventPictures: StudioPicture[]; files: Array<{ url: string; label: string }>; teacher: StudioTeacher | null;
  /** The words of the PR mails linked to the event (mailMaterial.ts). */
  mailTexts: Array<{ subject: string; text: string }>;
  /** The event's open post in PR og SoMe, which a design can be used in ("Brug i opslaget"). */
  post: { id: number; status: string; week: string | null; monday: string | null; image: string | null; design: boolean;
    /** The finished post as it goes out (requested: "så kan jeg se det færdige opslag med billede og tekst, som jeg så kan publicere"). */
    text: string; instagramText: string; channels: Channel[]; publishAtMs: number | null; link: string | null; instagram: boolean;
    /** Instagram's own time (else Facebook's). */
    instagramAtMs: number | null;
    /** The event's video for Instagram, and whether the chair took it off. */
    video: string | null; noVideo: boolean;
    /** The video's template, the templates it can be made in, and whether a new one can still be made before it goes out (social/videoTemplates.ts). */
    videoTemplate: number | null; videoTemplates: Array<{ no: number; name: string; used: string }>; videoRemake: boolean;
    /** "flere ... video designs på kommando": the videos made to choose among, and the templates Saga is making now. */
    videoChoices: Array<{ template: number; name: string; video: string }>; videoAsked: number[]; stillAsked: boolean } | null };

/** The event's key in the calendar and PR og SoMe ("mw:SF<hex>", "hr:<n>") and its address here (the hex, "h<n>"). */
export const eventKeyOf = (studioId: string) => /^h(\d+)$/.test(studioId) ? `hr:${studioId.slice(1)}` : `mw:SF${studioId}`;
export const studioIdOf = (key: string) => /^mw:SF([0-9a-f]{24})$/.exec(key)?.[1] ?? (/^hr:(\d+)$/.test(key) ? `h${key.slice(3)}` : null);

const plain = (html: string | null) => (html ?? "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").split(/\n+/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const isImage = (type: string) => /^image\/(jpe?g|png|webp|gif)$/i.test(type);

type Booking = { id: number; title: string; teacher_name: string; description: string | null; starts_at_ms: number; ends_at_ms: number; clerk_user_id: string };

/** The people behind a name: a teacher can be known by their bookings, their membership or their public profile. */
async function idsByName(db: D1Database, name: string): Promise<string[]> {
  const key = name.trim().toLowerCase();
  if (!key) return [];
  const rows = await db.prepare(`SELECT DISTINCT clerk_user_id AS id FROM (SELECT clerk_user_id, teacher_name AS name FROM room_bookings UNION SELECT clerk_user_id, full_name FROM members
      UNION SELECT clerk_user_id, json_extract(draft_json, '$.name') FROM public_profiles) WHERE lower(trim(name)) = ? AND clerk_user_id NOT LIKE 'cockpit:%'`)
    .bind(key).all<{ id: string }>().then(r => r.results ?? []).catch(() => []);
  return rows.map(r => r.id).filter(Boolean).slice(0, 5);
}

export async function studioData(db: D1Database, id: string, nowMs: number, fetcher: typeof fetch = fetch): Promise<StudioData | null> {
  const base = "/plakater/billede";
  const house = /^h(\d+)$/.exec(id);
  let event: StudioEvent, eventPictures: StudioPicture[] = [], files: StudioData["files"] = [], owners: string[] = [];
  if (house) {
    const b = await db.prepare("SELECT id, title, teacher_name, description, starts_at_ms, ends_at_ms, clerk_user_id FROM room_bookings WHERE id = ? AND status = 'scheduled'")
      .bind(Number(house[1])).first<Booking>().catch(() => null);
    if (!b) return null;
    const design = await db.prepare("SELECT created_at_ms FROM room_booking_designs WHERE room_booking_id = ?").bind(b.id).first<{ created_at_ms: number }>().catch(() => null);
    event = { id, title: b.title, startsAt: iso(b.starts_at_ms)!, endsAt: iso(b.ends_at_ms), host: b.teacher_name || null, category: null, lines: plain(b.description),
      bookingId: b.id, design: design ? `${base}/design/${b.id}?v=${design.created_at_ms}` : null };
    // Everything uploaded with the event: the cover, the pictures among its files (the others are listed), and the teacher's own poster.
    const rows = await db.prepare("SELECT id, kind, filename, content_type FROM room_booking_files WHERE room_booking_id = ? ORDER BY kind, id").bind(b.id)
      .all<{ id: number; kind: string; filename: string; content_type: string }>().then(r => r.results ?? []).catch(() => []);
    for (const f of rows) {
      if (isImage(f.content_type)) eventPictures.push({ url: `${base}/fil/${f.id}`, label: f.kind === "cover" ? "Eventets foto" : f.filename });
      else files.push({ url: `/arrangementer/fil/${f.id}`, label: f.filename });
    }
    const poster = await db.prepare("SELECT width, height FROM room_booking_posters WHERE room_booking_id = ?").bind(b.id).first<{ width: number; height: number }>().catch(() => null);
    if (poster) eventPictures.push({ url: `${base}/plakat/${b.id}`, label: "Underviserens eget opslag", width: poster.width, height: poster.height });
    owners = b.clerk_user_id.startsWith("cockpit:") ? [] : [b.clerk_user_id];
  } else if (/^[0-9a-f]{24}$/.test(id)) {
    const stored = await db.prepare("SELECT title, starts_at_ms, ends_at_ms, host, category, image_url, description FROM house_events WHERE id = ?").bind(`SF${id}`)
      .first<{ title: string; starts_at_ms: number; ends_at_ms: number | null; host: string | null; category: string | null; image_url: string | null; description: string | null }>().catch(() => null);
    const detail = stored ? null : await eventDetail(id, fetcher, nowMs).catch(() => null);
    if (!stored && !detail) return null;
    const image = stored?.image_url ?? detail?.imageUrl ?? null;
    event = stored ? { id, title: stored.title, startsAt: iso(stored.starts_at_ms)!, endsAt: iso(stored.ends_at_ms), host: stored.host, category: stored.category, lines: plain(stored.description), bookingId: null, design: null }
      : { id, title: detail!.title, startsAt: detail!.startsAt, endsAt: detail!.endsAt, host: detail!.host, category: detail!.category, lines: [], bookingId: null, design: null };
    if (posterImageAllowed(image)) eventPictures.push({ url: `${base}/ekstern?src=${encodeURIComponent(image)}`, label: "Eventets foto" });
  } else return null;

  // What a PR mail brought (mailMaterial.ts, the chair: "materialet, der er sendt allerede ligger klar ... under det pågældende event"): its pictures first.
  const material = await materialOf(db, eventKeyOf(id));
  eventPictures.unshift(...material.filter(m => m.kind === "image").map(m => ({ url: `${base}/materiale/${m.id}`, label: `Fra mailen: ${m.filename ?? "billede"}` })));
  files.unshift(...material.filter(m => m.kind === "file").map(m => ({ url: `/plakater/materiale/${m.id}`, label: `Fra mailen: ${m.filename ?? "fil"}` })));
  const mailTexts = material.filter(m => m.kind === "text" && m.text).map(m => ({ subject: m.filename ?? "", text: m.text! })).slice(0, 3);

  // The teacher: by their login when the event is their own, else by name.
  if (!owners.length && event.host) owners = await idsByName(db, event.host);
  let teacher: StudioTeacher | null = null;
  if (owners.length || event.host) {
    const marks = owners.map(() => "?").join(",") || "NULL";
    const material = owners.length ? await db.prepare(`SELECT quotes_json, consent_at_ms, withdrawn_at_ms FROM pr_material WHERE clerk_user_id IN (${marks}) ORDER BY updated_at_ms DESC LIMIT 1`)
      .bind(...owners).first<{ quotes_json: string; consent_at_ms: number | null; withdrawn_at_ms: number | null }>().catch(() => null) : null;
    let quotes = EMPTY_QUOTES;
    try { quotes = material ? parsePrQuotes(JSON.parse(material.quotes_json)) : EMPTY_QUOTES; } catch { quotes = EMPTY_QUOTES; }
    const pictures: StudioPicture[] = [];
    if (owners.length) {
      const photos = await db.prepare(`SELECT id, width, height FROM pr_photos WHERE clerk_user_id IN (${marks}) ORDER BY created_at_ms`).bind(...owners)
        .all<{ id: string; width: number | null; height: number | null }>().then(r => r.results ?? []).catch(() => []);
      photos.forEach((p, i) => pictures.push({ url: `${base}/pr/${p.id}`, label: `PR-billede ${i + 1}`, width: p.width, height: p.height }));
      const profiles = await db.prepare(`SELECT json_extract(draft_json, '$.photoUrl') AS photo FROM public_profiles WHERE clerk_user_id IN (${marks})`).bind(...owners)
        .all<{ photo: string | null }>().then(r => r.results ?? []).catch(() => []);
      for (const p of profiles) { const m = /^\/api\/profile-photos\/([0-9a-f-]{36})\.jpg$/.exec(p.photo ?? ""); if (m) pictures.push({ url: `${base}/profil/${m[1]}`, label: "Profilfoto" }); }
    }
    // Their other events in the house, newest first, with the pictures they gave them.
    const others = owners.length ? await db.prepare(`SELECT b.id, b.title, b.starts_at_ms, (SELECT f.id FROM room_booking_files f WHERE f.room_booking_id = b.id AND f.kind = 'cover' LIMIT 1) AS cover
        FROM room_bookings b WHERE b.clerk_user_id IN (${marks}) AND b.status = 'scheduled' AND b.id <> ? ORDER BY b.starts_at_ms DESC LIMIT 12`)
      .bind(...owners, event.bookingId ?? -1).all<{ id: number; title: string; starts_at_ms: number; cover: number | null }>().then(r => r.results ?? []).catch(() => []) : [];
    for (const o of others) if (o.cover) pictures.push({ url: `${base}/fil/${o.cover}`, label: `Fra "${o.title}"` });
    const consent = material?.consent_at_ms && !material.withdrawn_at_ms ? "given" : material?.withdrawn_at_ms ? "withdrawn" : "none";
    teacher = { name: event.host ?? "Underviseren", consent, quotes, pictures, events: others.map(o => ({ title: o.title, startsAt: iso(o.starts_at_ms)!, picture: o.cover ? `${base}/fil/${o.cover}` : null })) };
  }
  const open = await db.prepare(`SELECT id, status, week, images, publish_at_ms, json_extract(source, '$.design') AS design FROM social_posts WHERE kind = 'event' AND json_extract(source, '$.key') = ?
      AND status IN ('draft', 'approved', 'failed') ORDER BY coalesce(json_extract(source, '$.shout'), 1), publish_at_ms, id LIMIT 1`).bind(eventKeyOf(id))
    .first<{ id: number; status: string; week: string | null; images: string; publish_at_ms: number | null; design: number | null }>().catch(() => null);
  const full = open ? await socialPost(db, open.id) : null;
  const instagram = Boolean((await socialAccount(db).catch(() => null))?.ig_user_id);
  const uses = full ? await templateUses(db) : new Map();
  const post = open && full ? { id: open.id, status: open.status, week: open.week, monday: open.publish_at_ms ? mondayOfMs(Date.parse(event.startsAt)) : null,
    image: (() => { try { return (JSON.parse(open.images) as string[])[0] ?? null; } catch { return null; } })(), design: Boolean(open.design),
    text: full.text, instagramText: full.source.instagramText || instagramEventText(full.text), channels: full.channels, publishAtMs: full.publish_at_ms, link: full.link, instagram,
    instagramAtMs: full.source.instagramAtMs ?? null, video: full.source.video ?? null, noVideo: Boolean(full.source.noVideo),
    videoTemplate: full.source.videoTemplate ?? null, videoTemplates: VIDEO_TEMPLATES.filter(t => templatesFor(full).includes(t.no)).map(t => ({ no: t.no, name: t.name, used: usedLabel(uses.get(t.no)) })),
    videoRemake: videoInTime(full, nowMs), videoChoices: (full.source.videoChoices ?? []).map(c => ({ template: c.template, name: choiceName(c, templateName), video: c.video })), videoAsked: full.source.videoAsk?.templates ?? [],
    stillAsked: Boolean(full.source.stillAsk) } : null;
  return { event, eventPictures, files, teacher, post, mailTexts };
}

const IMAGE_HEADERS = { "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };

/** A picture for the studio, from admin's own address: an event's file, a teacher's own poster, a design, a PR photo, a profile photo, or the calendar's photo. */
export async function studioPicture(db: D1Database, bucket: EventMediaBucket | undefined, kind: string, ref: string, src: string | null, fetcher: typeof fetch = fetch): Promise<Response> {
  const none = () => new Response("Ikke fundet", { status: 404 });
  if (kind === "ekstern") return posterImage(src, fetcher);
  if (!bucket) return none();
  let key: string | null = null, type = "image/jpeg";
  if (kind === "fil" && /^\d+$/.test(ref)) {
    const row = await db.prepare("SELECT r2_key, content_type FROM room_booking_files WHERE id = ?").bind(Number(ref)).first<{ r2_key: string; content_type: string }>().catch(() => null);
    if (row && isImage(row.content_type)) { key = row.r2_key; type = row.content_type; }
  } else if (kind === "plakat" && /^\d+$/.test(ref)) {
    const row = await db.prepare("SELECT r2_key, content_type FROM room_booking_posters WHERE room_booking_id = ?").bind(Number(ref)).first<{ r2_key: string; content_type: string }>().catch(() => null);
    if (row) { key = row.r2_key; type = row.content_type; }
  } else if (kind === "design" && /^\d+$/.test(ref)) {
    const row = await db.prepare("SELECT r2_key, content_type FROM room_booking_designs WHERE room_booking_id = ?").bind(Number(ref)).first<{ r2_key: string; content_type: string }>().catch(() => null);
    if (row) { key = row.r2_key; type = row.content_type; }
  } else if (kind === "pr" && /^[0-9a-f-]{36}$/.test(ref)) {
    const row = await db.prepare("SELECT content_type FROM pr_photos WHERE id = ?").bind(ref).first<{ content_type: string }>().catch(() => null);
    if (row) { key = `pr/${ref}`; type = row.content_type; }
  } else if (kind === "profil" && /^[0-9a-f-]{36}$/.test(ref)) key = `portraits/${ref}.jpg`;
  const object = key ? await bucket.get(key).catch(() => null) : null;
  if (!object) return none();
  return new Response(object.body, { headers: { "content-type": type, ...IMAGE_HEADERS } });
}

/** "Brug som design på hjemmesiden": the wide design (1920 × 1005) drawn in the studio becomes the house event's picture on the website. */
export async function setStudioDesign(db: D1Database, bucket: EventMediaBucket, bookingId: number, bytes: ArrayBuffer | null, nowMs: number) {
  if (!bytes) { await removeDesign(db, bucket, bookingId); return { ok: true as const }; }
  return storeDesign(db, bucket, bookingId, bytes, nowMs);
}

export type StudioListItem = { id: string; title: string; startsMs: number; host: string | null; house: boolean; design: boolean };

/** The coming events the studio can make posters for: the house's own and the calendar's (not the partner houses'), the next six weeks. */
export async function studioEvents(db: D1Database, nowMs: number): Promise<StudioListItem[]> {
  const until = nowMs + 42 * 86_400_000, from = nowMs - 6 * 3_600_000;
  const calendar = await db.prepare(`SELECT id, title, starts_at_ms, host, location, category FROM house_events WHERE starts_at_ms >= ? AND starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms LIMIT 200`)
    .bind(from, until).all<{ id: string; title: string; starts_at_ms: number; host: string | null; location: string | null; category: string | null }>().then(r => r.results ?? []).catch(() => []);
  const own = await db.prepare(`SELECT b.id, b.title, b.teacher_name, b.starts_at_ms, (SELECT 1 FROM room_booking_designs d WHERE d.room_booking_id = b.id) AS design FROM room_bookings b
      WHERE b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved' AND b.cirkler_meeting_id IS NULL AND b.starts_at_ms >= ? AND b.starts_at_ms < ? ORDER BY b.starts_at_ms LIMIT 200`)
    .bind(from, until).all<{ id: number; title: string; teacher_name: string | null; starts_at_ms: number; design: number | null }>().then(r => r.results ?? []).catch(() => []);
  const partner = /hjerteland/i;
  return [
    ...calendar.filter(e => /^SF[0-9a-f]{24}$/.test(e.id) && ![e.location, e.category, e.title].some(v => v && partner.test(v)))
      .map(e => ({ id: e.id.slice(2), title: e.title, startsMs: e.starts_at_ms, host: e.host, house: false, design: false })),
    ...own.map(b => ({ id: `h${b.id}`, title: b.title, startsMs: b.starts_at_ms, host: b.teacher_name, house: true, design: Boolean(b.design) }))
  ].sort((a, b) => a.startsMs - b.startsMs);
}

const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

export function studioListPage(base: string, who: string | null, events: StudioListItem[]): string {
  const rows = events.map(e => `<li><a href="${base}/plakater/${esc(e.id)}"><span class="at">${esc(WHEN.format(e.startsMs))}</span><span><b>${esc(e.title)}</b>${e.host ? ` <span class="muted">· ${esc(e.host)}</span>` : ""}
${e.house ? `<small>${e.design ? "Har et design på hjemmesiden" : "Medlemmets eget foto på hjemmesiden"}</small>` : ""}</span></a></li>`).join("");
  return layout(base, "Plakater og opslag", `<main class="studio-list"><div class="hero"><h1>Plakater og opslag</h1>
<p>Vælg et event, og lav opslag til Instagram og Facebook med Hjerterums skabeloner - af eventets eget materiale eller det, underviseren har delt med os. Kun for formanden indtil videre.</p></div>
<section class="panel">${events.length ? `<ul>${rows}</ul>` : `<p class="empty">Ingen events de næste seks uger.</p>`}</section></main>`,
    { section: "/plakater", who, style: `.studio-list ul{list-style:none;margin:0;padding:0}.studio-list li a{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:11px 0;border-top:1px solid var(--line);text-decoration:none;color:var(--ink)}
.studio-list li:first-child a{border-top:0}.studio-list .at{color:var(--muted);font-size:13.5px}.studio-list small{display:block;color:var(--faint);font-size:12.5px}@media (max-width:760px){.studio-list li a{grid-template-columns:1fr;gap:2px}}` });
}

/** "Brug i opslaget": the design (a jpg, as drawn in the studio) is kept in R2 under a long random name and served publicly - Facebook and Instagram fetch
 * it from there when the post goes out (worker/config-entry.ts /api/social-designs/<name>.jpg). Only a jpg the size of a post or a wide picture. */
export async function storeSocialDesign(bucket: EventMediaBucket, bytes: ArrayBuffer, site = "https://www.hjerterum.info"): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const b = new Uint8Array(bytes);
  if (b.length < 1000 || b.length > 8 * 1024 * 1024) return { ok: false, error: "size" };
  if (b[0] !== 0xff || b[1] !== 0xd8) return { ok: false, error: "not_jpeg" };
  const name = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");
  await bucket.put(`social/designs/${name}.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return { ok: true, url: `${site}/api/social-designs/${name}.jpg` };
}
