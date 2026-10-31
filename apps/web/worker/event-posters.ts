import type { D1Database } from "./db.js";
import { checkUpload, imageSize, type EventMediaBucket } from "./event-files.js";
import { completeAs, type ChatPart } from "./saga/ai.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";

/** Requested: "Når man opretter event skal man også kunne vælge en af skabelonerne eller alternativt uploade sit eget. Uploader man
 * sit eget skal Saga tjekke om der er nødvendigt info på, om dimensionerne er rigtige og om kvaliteten er høj nok".
 * The organiser chooses one of the poster designs (src/event-poster.ts) - or none, and the system chooses - or sends their own
 * finished poster. Their own is measured here first (format and size), then looked at by Saga (the information on it and its
 * quality); only then is it kept. Saga fails closed: when she cannot look, the poster is not kept. */

export const POSTER_VARIANTS = ["rolig", "foto", "organisk", "typografi", "split", "eget"] as const;
export type PosterVariant = (typeof POSTER_VARIANTS)[number];
export const isPosterVariant = (value: unknown): value is PosterVariant => typeof value === "string" && (POSTER_VARIANTS as readonly string[]).includes(value);

export { POSTER_MAX_BYTES, POSTER_MIN_WIDTH, POSTER_SHAPES, posterSizeProblem } from "../site/poster-rules.js";
import { POSTER_MAX_BYTES, posterSizeProblem } from "../site/poster-rules.js";

export type PosterFacts = { title: string; day: string; time: string };

const SYSTEM = `Du er Saga, Hjerterums assistent. Et medlem har uploadet sit eget færdige opslag (en plakat til Instagram og Facebook) til et event i Hjerterum. Se på billedet og tjek to ting:
1. INFORMATION: Står eventets titel (eller en tydeligt genkendelig udgave af den), datoen (dag og måned) og tidspunktet på billedet - og passer de med eventets fakta herunder? Ugedag er ikke nødvendig. Mangler noget, eller er en dato eller tid forkert, er det ikke i orden.
2. KVALITET: Er billedet skarpt (ikke pixeleret, sløret eller stærkt komprimeret), er al tekst læsbar og ikke skåret af i kanten, og er det et færdigt opslag (ikke et skærmbillede med telefonens bjælker eller en app rundt om)? Passer det til et roligt, varmt sted for fællesskab - intet stødende.
Vær venlig, men streng: et opslag, der ikke er i orden, kommer ikke ud. Skriv begrundelsen kort på dansk til medlemmet, med et konkret råd.
Svar KUN med JSON: {"info_ok":true|false,"quality_ok":true|false,"missing":["titel"|"dato"|"tid"],"wrong":"hvad der står forkert, eller tom","reason":"kort begrundelse til medlemmet"}`;

export type SagaVerdict = { ok: boolean; reason: string };

export function parseVerdict(answer: string): SagaVerdict | null {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  if (!json) return null;
  try {
    const data = JSON.parse(json) as { info_ok?: unknown; quality_ok?: unknown; missing?: unknown; wrong?: unknown; reason?: unknown };
    if (typeof data.info_ok !== "boolean" || typeof data.quality_ok !== "boolean") return null;
    const missing = Array.isArray(data.missing) ? data.missing.filter((m): m is string => typeof m === "string").slice(0, 3) : [];
    let reason = typeof data.reason === "string" ? data.reason.trim().slice(0, 500) : "";
    if (!reason) reason = data.info_ok && data.quality_ok ? "Opslaget ser godt ud." : "Opslaget kan ikke bruges, som det er.";
    // The verdict is the model's two answers - never a friendly sentence that says otherwise.
    const ok = data.info_ok && data.quality_ok && missing.length === 0;
    if (!ok && missing.length && !/mangler/i.test(reason)) reason = `Der mangler ${missing.join(", ")} på opslaget. ${reason}`;
    return { ok, reason };
  } catch { return null; }
}

const base64 = (bytes: ArrayBuffer) => {
  const view = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
};

/** Saga looks at the poster itself. Throws when she cannot answer, so the caller keeps nothing. */
export async function sagaChecksPoster(env: SagaEnv, deps: SagaDeps, bytes: ArrayBuffer, contentType: string, facts: PosterFacts): Promise<SagaVerdict> {
  const parts: ChatPart[] = [
    { type: "text", text: `Eventets fakta: titel "${facts.title}", dato ${facts.day}, tid ${facts.time}.` },
    { type: "image_url", image_url: { url: `data:${contentType};base64,${base64(bytes)}` } }
  ];
  // The main model: reading small type on a poster needs the best eyes.
  const answer = await completeAs("opslag-tjek", false, 400)(env, deps, [{ role: "system", content: SYSTEM }, { role: "user", content: parts }]);
  const verdict = parseVerdict(answer);
  if (!verdict) throw new Error("poster_check_unreadable");
  return verdict;
}

const TZ = "Europe/Copenhagen";
/** The event's date and time as the poster should say them. */
export function factsOf(booking: { title: string; starts_at_ms: number; ends_at_ms: number }): PosterFacts {
  const day = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(booking.starts_at_ms);
  const clock = (ms: number) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(ms).replace(":", ".");
  return { title: booking.title, day, time: `${clock(booking.starts_at_ms)}-${clock(booking.ends_at_ms)}` };
}

export type PosterView = { url: string; width: number; height: number; note: string | null };
export type PosterInfo = { variant: PosterVariant | null; poster: PosterView | null };

type PosterRow = { room_booking_id: number; r2_key: string; content_type: string; width: number; height: number; saga_note: string | null };

export async function posterInfo(db: D1Database, bookingId: number): Promise<PosterInfo> {
  const booking = await db.prepare("SELECT poster_variant FROM room_bookings WHERE id = ?").bind(bookingId).first<{ poster_variant: string | null }>();
  const row = await db.prepare("SELECT room_booking_id, r2_key, content_type, width, height, saga_note FROM room_booking_posters WHERE room_booking_id = ?").bind(bookingId).first<PosterRow>();
  const variant = isPosterVariant(booking?.poster_variant) ? booking!.poster_variant as PosterVariant : null;
  return { variant: variant === "eget" && !row ? null : variant, poster: row ? { url: `/api/room-bookings/${bookingId}/poster`, width: row.width, height: row.height, note: row.saga_note } : null };
}

/** Many events at once, for the public list. */
export async function postersByBooking(db: D1Database, ids: number[]): Promise<Map<number, PosterInfo>> {
  const found = new Map<number, PosterInfo>();
  if (!ids.length) return found;
  const marks = ids.map(() => "?").join(",");
  const variants = (await db.prepare(`SELECT id, poster_variant FROM room_bookings WHERE id IN (${marks})`).bind(...ids).all<{ id: number; poster_variant: string | null }>()).results ?? [];
  const rows = (await db.prepare(`SELECT room_booking_id, r2_key, content_type, width, height, saga_note FROM room_booking_posters WHERE room_booking_id IN (${marks})`).bind(...ids).all<PosterRow>()).results ?? [];
  const byId = new Map(rows.map(r => [r.room_booking_id, r]));
  for (const v of variants) {
    const row = byId.get(v.id);
    const variant = isPosterVariant(v.poster_variant) ? v.poster_variant as PosterVariant : null;
    found.set(v.id, { variant: variant === "eget" && !row ? null : variant, poster: row ? { url: `/api/room-bookings/${v.id}/poster`, width: row.width, height: row.height, note: null } : null });
  }
  return found;
}

export async function setPosterVariant(db: D1Database, bookingId: number, variant: PosterVariant | null, now: number): Promise<void> {
  await db.prepare("UPDATE room_bookings SET poster_variant = ?, updated_at_ms = ? WHERE id = ?").bind(variant, now, bookingId).run();
}

export type PosterUpload =
  | { ok: true; poster: PosterView }
  | { ok: false; error: "file_too_large" | "file_type" | "empty_file" | "poster_size" | "poster_rejected" | "saga_unavailable"; reason: string };

/** Measures, lets Saga look, and keeps the organiser's own poster - replacing an earlier one. */
export async function storePoster(env: SagaEnv, deps: SagaDeps, db: D1Database, bucket: EventMediaBucket, input: {
  booking: { id: number; title: string; starts_at_ms: number; ends_at_ms: number }; userId: string; name: string; bytes: ArrayBuffer;
}, look: typeof sagaChecksPoster = sagaChecksPoster): Promise<PosterUpload> {
  if (input.bytes.byteLength > POSTER_MAX_BYTES) return { ok: false, error: "file_too_large", reason: `Filen er ${(input.bytes.byteLength / 1024 / 1024).toFixed(1).replace(".", ",")} MB - et opslag må højst fylde 4,5 MB. Gem det som jpg.` };
  // The cover's rules for what a picture is: jpg or png, read from the file's first bytes.
  const check = checkUpload("cover", input.name, input.bytes.byteLength, new Uint8Array(input.bytes, 0, Math.min(input.bytes.byteLength, 2048)));
  if (!check.ok) return { ok: false, error: check.error === "empty_file" ? "empty_file" : check.error === "file_too_large" ? "file_too_large" : "file_type", reason: check.error === "empty_file" ? "Filen er tom." : "Opslaget skal være et billede i jpg eller png." };
  const size = imageSize(new Uint8Array(input.bytes));
  const problem = posterSizeProblem(size?.width ?? 0, size?.height ?? 0);
  if (problem) return { ok: false, error: "poster_size", reason: problem };
  let verdict: SagaVerdict;
  try { verdict = await look(env, deps, input.bytes, check.contentType, factsOf(input.booking)); }
  catch (error) {
    console.warn("poster_check_failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "saga_unavailable", reason: "Saga kan ikke se på opslaget lige nu, så det er ikke gemt. Prøv igen om lidt." };
  }
  if (!verdict.ok) return { ok: false, error: "poster_rejected", reason: verdict.reason };
  const key = `events/${input.booking.id}/poster-${crypto.randomUUID()}.${check.extension}`;
  await bucket.put(key, input.bytes, { httpMetadata: { contentType: check.contentType } });
  const old = await db.prepare("SELECT r2_key FROM room_booking_posters WHERE room_booking_id = ?").bind(input.booking.id).first<{ r2_key: string }>();
  try {
    await db.prepare(`INSERT INTO room_booking_posters (room_booking_id, r2_key, content_type, width, height, size_bytes, saga_note, uploaded_by, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_booking_id) DO UPDATE SET r2_key = excluded.r2_key, content_type = excluded.content_type, width = excluded.width, height = excluded.height,
      size_bytes = excluded.size_bytes, saga_note = excluded.saga_note, uploaded_by = excluded.uploaded_by, created_at_ms = excluded.created_at_ms`)
      .bind(input.booking.id, key, check.contentType, size!.width, size!.height, input.bytes.byteLength, verdict.reason, input.userId, deps.now()).run();
    await setPosterVariant(db, input.booking.id, "eget", deps.now());
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    throw error;
  }
  if (old) await bucket.delete(old.r2_key).catch(() => undefined);
  return { ok: true, poster: { url: `/api/room-bookings/${input.booking.id}/poster`, width: size!.width, height: size!.height, note: verdict.reason } };
}

export async function removePoster(db: D1Database, bucket: EventMediaBucket, bookingId: number, now: number): Promise<boolean> {
  const row = await db.prepare("SELECT r2_key FROM room_booking_posters WHERE room_booking_id = ?").bind(bookingId).first<{ r2_key: string }>();
  if (!row) return false;
  await db.prepare("DELETE FROM room_booking_posters WHERE room_booking_id = ?").bind(bookingId).run();
  await db.prepare("UPDATE room_bookings SET poster_variant = NULL, updated_at_ms = ? WHERE id = ? AND poster_variant = 'eget'").bind(now, bookingId).run();
  await bucket.delete(row.r2_key).catch(() => undefined);
  return true;
}

/** The poster file and whether anyone may see it: once its event is approved and still on - like the cover photo. */
export async function posterForDownload(db: D1Database, bookingId: number): Promise<(PosterRow & { owner_id: string; public: boolean }) | null> {
  return await db.prepare(`SELECT p.room_booking_id, p.r2_key, p.content_type, p.width, p.height, p.saga_note, b.clerk_user_id AS owner_id,
      CASE WHEN COALESCE(b.review_status, 'approved') = 'approved' AND b.status = 'scheduled' THEN 1 ELSE 0 END AS public
    FROM room_booking_posters p JOIN room_bookings b ON b.id = p.room_booking_id WHERE p.room_booking_id = ?`).bind(bookingId)
    .first<PosterRow & { owner_id: string; public: number }>().then(row => row ? { ...row, public: row.public === 1 } : null);
}
