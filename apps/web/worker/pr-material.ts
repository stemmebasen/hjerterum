import { EMPTY_QUOTES, parsePrQuotes, PR_MAX_PHOTOS, PR_MIN_SIDE, PR_PHOTO_MAX_BYTES, type PrMaterial, type PrPhoto } from "../pr-material.js";
import { authenticateBearer } from "./auth.js";
import type { D1Database } from "./db.js";
import { imageSize, sniff, type EventMediaBucket } from "./event-files.js";
import { resolveActiveMembership } from "./membership-access.js";

/** A teacher's PR material (pr-material.ts): their own, at /api/members/me/pr-material. Photos are kept in R2 under pr/ and shown at
 * /api/pr-photos/<id> (a random address only the teacher knows until they consent) - once consent is withdrawn, to no one. The board sees a
 * teacher's photos only with their consent (cockpit/prMaterial.ts). */
type Env = { DB?: D1Database; CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string; EVENT_MEDIA?: EventMediaBucket };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const TYPES: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
type PhotoRow = { id: string; content_type: string; width: number | null; height: number | null };
const photoUrl = (id: string) => `/api/pr-photos/${id}`;

export async function prMaterialOf(db: D1Database, userId: string): Promise<PrMaterial> {
  const [row, photos] = await Promise.all([
    db.prepare("SELECT quotes_json, consent_at_ms, withdrawn_at_ms FROM pr_material WHERE clerk_user_id = ?").bind(userId).first<{ quotes_json: string; consent_at_ms: number | null; withdrawn_at_ms: number | null }>(),
    db.prepare("SELECT id, content_type, width, height FROM pr_photos WHERE clerk_user_id = ? ORDER BY created_at_ms, id").bind(userId).all<PhotoRow>().then(r => r.results ?? [])
  ]);
  let quotes = { ...EMPTY_QUOTES };
  try { quotes = parsePrQuotes(JSON.parse(row?.quotes_json ?? "{}")); } catch { /* an empty set */ }
  return { photos: photos.map((p): PrPhoto => ({ id: p.id, url: photoUrl(p.id), width: p.width, height: p.height })), quotes, consentAt: row?.consent_at_ms ?? null, withdrawnAt: row?.withdrawn_at_ms ?? null };
}

async function signedIn(request: Request, env: Env): Promise<string | null> {
  try { return (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; } catch { return null; }
}

/** GET: one's own material. PUT {quotes?, consent?: true | false}: the quotes saved; consent given (true) or withdrawn (false), with when. */
export async function ownPrMaterial(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const userId = await signedIn(request, env);
  if (!userId) return json({ error: "authentication_required" }, 401);
  const db = env.DB, now = Date.now();
  if (request.method === "GET") return json(await prMaterialOf(db, userId));
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  const raw = await request.text();
  if (raw.length > 4000) return json({ error: "invalid_body" }, 400);
  let body: { quotes?: unknown; consent?: unknown };
  try { body = JSON.parse(raw) as typeof body; if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); } catch { return json({ error: "invalid_body" }, 400); }
  if (Object.keys(body).some(k => k !== "quotes" && k !== "consent") || (body.consent !== undefined && typeof body.consent !== "boolean")) return json({ error: "invalid_body" }, 400);
  let quotes: string | null = null;
  if (body.quotes !== undefined) { try { quotes = JSON.stringify(parsePrQuotes(body.quotes)); } catch { return json({ error: "invalid_quotes" }, 400); } }
  if (body.consent === true && !(await resolveActiveMembership(db, userId, env.CLERK_SECRET_KEY).catch(() => null))) return json({ error: "membership_required" }, 403);
  await db.prepare(`INSERT INTO pr_material (clerk_user_id, quotes_json, consent_at_ms, withdrawn_at_ms, updated_at_ms) VALUES (?, COALESCE(?, '{}'), ?, ?, ?)
    ON CONFLICT(clerk_user_id) DO UPDATE SET quotes_json = COALESCE(?, pr_material.quotes_json),
      consent_at_ms = CASE WHEN ? = 1 THEN excluded.consent_at_ms WHEN ? = 0 THEN NULL ELSE pr_material.consent_at_ms END,
      withdrawn_at_ms = CASE WHEN ? = 1 THEN NULL WHEN ? = 0 THEN excluded.withdrawn_at_ms ELSE pr_material.withdrawn_at_ms END,
      updated_at_ms = excluded.updated_at_ms`)
    .bind(userId, quotes, body.consent === true ? now : null, body.consent === false ? now : null, now, quotes,
      body.consent === true ? 1 : body.consent === false ? 0 : -1, body.consent === true ? 1 : body.consent === false ? 0 : -1,
      body.consent === true ? 1 : body.consent === false ? 0 : -1, body.consent === true ? 1 : body.consent === false ? 0 : -1).run();
  return json(await prMaterialOf(db, userId));
}

/** POST (form field "photo"): a jpg, png or webp up to 10 MB, at least 1080 px on its short side when its size can be read; at most ten. DELETE /<id>: gone. */
export async function ownPrPhotos(request: Request, env: Env, id: string | null): Promise<Response> {
  if (!env.DB || !env.EVENT_MEDIA) return json({ error: "uploads_not_configured" }, 503);
  const userId = await signedIn(request, env);
  if (!userId) return json({ error: "authentication_required" }, 401);
  const db = env.DB, bucket = env.EVENT_MEDIA;
  if (request.method === "DELETE" && id) {
    const done = await db.prepare("DELETE FROM pr_photos WHERE id = ? AND clerk_user_id = ?").bind(id, userId).run();
    if (Number(done.meta?.changes ?? 0) === 1) await bucket.delete(`pr/${id}`);
    return json(await prMaterialOf(db, userId));
  }
  if (request.method !== "POST" || id) return json({ error: "method_not_allowed" }, 405);
  if (!(await resolveActiveMembership(db, userId, env.CLERK_SECRET_KEY).catch(() => null))) return json({ error: "membership_required" }, 403);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM pr_photos WHERE clerk_user_id = ?").bind(userId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= PR_MAX_PHOTOS) return json({ error: "too_many_photos" }, 409);
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || typeof file === "string") return json({ error: "invalid_form" }, 400);
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (!bytes.byteLength) return json({ error: "empty_file" }, 400);
  if (bytes.byteLength > PR_PHOTO_MAX_BYTES) return json({ error: "file_too_large" }, 413);
  const kind = sniff(bytes.subarray(0, 16));
  const type = kind ? TYPES[kind] : undefined;
  if (!type) return json({ error: "file_type" }, 415);
  const size = imageSize(bytes);
  if (size && Math.min(size.width, size.height) < PR_MIN_SIDE) return json({ error: "photo_too_small", minSide: PR_MIN_SIDE, width: size.width, height: size.height }, 422);
  const photoId = crypto.randomUUID();
  await bucket.put(`pr/${photoId}`, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: type } });
  await db.prepare("INSERT INTO pr_photos (id, clerk_user_id, content_type, width, height, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(photoId, userId, type, size?.width ?? null, size?.height ?? null, Date.now()).run();
  return json(await prMaterialOf(db, userId), 201);
}

/** A PR photo - not once its owner has withdrawn their consent. */
export async function prPhoto(id: string, env: Env): Promise<Response> {
  if (!env.DB || !env.EVENT_MEDIA || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "not_found" }, 404);
  const row = await env.DB.prepare(`SELECT p.content_type FROM pr_photos p LEFT JOIN pr_material m ON m.clerk_user_id = p.clerk_user_id
    WHERE p.id = ? AND m.withdrawn_at_ms IS NULL`).bind(id).first<{ content_type: string }>();
  if (!row) return json({ error: "not_found" }, 404);
  const object = await env.EVENT_MEDIA.get(`pr/${id}`);
  if (!object) return json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: { "content-type": row.content_type, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
