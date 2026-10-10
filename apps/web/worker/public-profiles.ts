import { includesMemberBenefits } from "../membership.js";
import { isCompleteProfile, parsePublicProfile } from "../public-profile.js";
import { authenticateBearer } from "./auth.js";
import type { D1Database } from "./db.js";
import { resolveActiveMembership } from "./membership-access.js";
import { imageSize, sniff, type EventMediaBucket } from "./event-files.js";
import { PHOTO_SIZE } from "../public-profile.js";

type Env = { DB?: D1Database; CLERK_JWT_ISSUER?: string; CLERK_SECRET_KEY?: string; EVENT_MEDIA?: EventMediaBucket };
type Row = { draft_json: string; published_json: string | null; revision: number };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function publicProfiles(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  try {
    // Native membership is authoritative if present. Never expose drafts or owner identifiers.
    const result = await env.DB.prepare(`SELECT p.public_id, p.published_json,
      CASE WHEN m.id IS NOT NULL THEN m.tier ELSE e.membership_level END AS tier
      FROM public_profiles p
      LEFT JOIN members m ON m.clerk_user_id = p.clerk_user_id
      LEFT JOIN external_memberships e ON e.id = p.external_member_id
      WHERE p.published_json IS NOT NULL AND
        ((m.id IS NOT NULL AND m.status = 'active' AND m.access_blocked = 0) OR
         (m.id IS NULL AND e.status = 'active' AND e.access_blocked = 0))
      ORDER BY p.public_id`).all<{ public_id: string; published_json: string; tier: string | null }>();
    return json((result.results ?? []).filter(row => includesMemberBenefits(row.tier)).map(row => ({ id: row.public_id, ...parsePublicProfile(JSON.parse(row.published_json)) })));
  } catch { return json({ error: "profiles_unavailable" }, 503); }
}

export async function ownPublicProfile(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; }
  catch { return json({ error: "authentication_required" }, 401); }
  const db = env.DB;
  try {
    if (request.method === "GET") {
      const row = await db.prepare("SELECT draft_json, published_json, revision FROM public_profiles WHERE clerk_user_id = ?").bind(userId).first<Row>();
      // Reading/hiding one's profile remains possible after membership expires.
      const membership = await resolveActiveMembership(db, userId, env.CLERK_SECRET_KEY).catch(() => null);
      return json({ draft: row ? parsePublicProfile(JSON.parse(row.draft_json)) : null,
        published: row?.published_json ? parsePublicProfile(JSON.parse(row.published_json)) : null,
        revision: row?.revision ?? 0, canPublish: Boolean(membership) });
    }
    if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "invalid_body" }, 400);
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch { return json({ error: "invalid_body" }, 400); }
    if (Object.keys(body).some(key => !["action", "revision", "profile", "consent"].includes(key)) ||
        !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 ||
        !["save", "publish", "hide"].includes(String(body.action))) return json({ error: "invalid_body" }, 400);
    if (body.action === "hide") {
      const result = await db.prepare(`UPDATE public_profiles SET published_json = NULL, consent_at_ms = NULL,
        revision = revision + 1, updated_at_ms = ? WHERE clerk_user_id = ? AND revision = ?`)
        .bind(Date.now(), userId, body.revision).run();
      return (result.meta?.changes ?? 0) === 1 ? json({ revision: (body.revision as number) + 1 }) : json({ error: "profile_conflict" }, 409);
    }
    const profile = parsePublicProfile(body.profile);
    const publish = body.action === "publish";
    if (publish && body.consent !== true) return json({ error: "consent_required" }, 400);
    if (publish && !isCompleteProfile(profile)) return json({ error: "profile_incomplete" }, 400);
    const membership = await resolveActiveMembership(db, userId, env.CLERK_SECRET_KEY, publish);
    if (!membership) return json({ error: "membership_required" }, 403);
    const snapshot = JSON.stringify(profile);
    const result = await db.prepare(`INSERT INTO public_profiles
        (clerk_user_id, public_id, draft_json, published_json, external_member_id, revision, consent_at_ms, updated_at_ms)
      SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE ? = 0 OR EXISTS
        (SELECT 1 FROM public_profiles WHERE clerk_user_id = ? AND revision = ?)
      ON CONFLICT(clerk_user_id) DO UPDATE SET draft_json = excluded.draft_json,
        published_json = CASE WHEN ? THEN excluded.published_json ELSE public_profiles.published_json END,
        external_member_id = excluded.external_member_id,
        consent_at_ms = CASE WHEN ? THEN excluded.consent_at_ms ELSE public_profiles.consent_at_ms END,
        revision = public_profiles.revision + 1, updated_at_ms = excluded.updated_at_ms
      WHERE public_profiles.revision = ?`)
      .bind(userId, crypto.randomUUID(), snapshot, publish ? snapshot : null,
        membership.source === "membershipworks" ? membership.externalId : null,
        publish ? Date.now() : null, Date.now(), body.revision, userId, body.revision,
        publish ? 1 : 0, publish ? 1 : 0, body.revision).run();
    return (result.meta?.changes ?? 0) === 1 ? json({ revision: (body.revision as number) + 1, profile }) : json({ error: "profile_conflict" }, 409);
  } catch (error) {
    return error instanceof Error && error.message === "invalid_profile"
      ? json({ error: "invalid_profile" }, 400) : json({ error: "profile_unavailable" }, 503);
  }
}

/** Requested: a photo on the visit card, cut round. The member's browser cuts it to a 480 × 480 jpg; the worker only keeps a jpg of exactly
 * that size (up to 1 MB) under a random name, and the visit card points to it. Anyone with the address can see it, as on the website. */
export async function uploadProfilePhoto(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB || !env.EVENT_MEDIA) return json({ error: "uploads_not_configured" }, 503);
  let userId: string;
  try { userId = (await authenticateBearer(request, env.CLERK_JWT_ISSUER)).userId; }
  catch { return json({ error: "authentication_required" }, 401); }
  const membership = await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY).catch(() => null);
  if (!membership) return json({ error: "membership_required" }, 403);
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || typeof file === "string") return json({ error: "invalid_form" }, 400);
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) return json({ error: "file_too_large" }, 413);
  const size = imageSize(bytes);
  if (sniff(bytes.subarray(0, 16)) !== "jpeg" || size?.width !== PHOTO_SIZE || size.height !== PHOTO_SIZE) return json({ error: "photo_size" }, 422);
  const id = crypto.randomUUID();
  await env.EVENT_MEDIA.put(`portraits/${id}.jpg`, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
  return json({ photoUrl: `/api/profile-photos/${id}.jpg` }, 201);
}

export async function profilePhoto(id: string, env: Env): Promise<Response> {
  if (!env.EVENT_MEDIA || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "not_found" }, 404);
  const object = await env.EVENT_MEDIA.get(`portraits/${id}.jpg`);
  if (!object) return json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
