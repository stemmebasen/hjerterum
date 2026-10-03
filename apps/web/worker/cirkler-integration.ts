// CIRKLER-integrationen (docs/BLUEPRINT.md, "CIRKLER is a separate product/domain and integrates only through
// explicit entitlement contracts"). Hjerterum kender ikke til cirkler eller deltagere; det svarer kun på to ting:
//
//   POST /api/integrations/cirkler/handoff      Et medlem, der er logget ind, trykker "Tilmeld dig CIRKLER".
//                                               Svaret er en adresse på cirkler.net med en signeret billet.
//   POST /api/integrations/cirkler/eligibility  CIRKLERs daglige tjek: er disse medlemmer stadig berettigede?
//
// Begge kører automatisk; Hjerterums team har ingen manuelle trin (Jake, 3. oktober 2026).
// Medlemmer med medlemsgoder (Standard, Generøst, Reduceret pris) er berettigede; Support er ikke.
import type { CirclesEntitlementGateway } from "../../../packages/core/src/index.js";
import { includesMemberBenefits } from "../membership.js";
import { clerkPrimaryEmail } from "./admin-auth.js";
import { authenticateBearer } from "./auth.js";
import type { D1Database } from "./db.js";
import { resolveActiveMembership, type ActiveMembership } from "./membership-access.js";

export interface CirklerIntegrationEnv {
  CLERK_JWT_ISSUER?: string;
  CLERK_SECRET_KEY?: string;
  CIRKLER_BASE_URL?: string;
  CIRKLER_HANDOFF_PRIVATE_KEY?: string;
  CIRKLER_SERVICE_KEY?: string;
  DB?: D1Database;
  [key: string]: unknown;
}

export interface CirklerIntegrationDeps {
  now: () => number;
  authenticate?: (request: Request, issuer?: string) => Promise<{ userId: string }>;
  primaryEmail?: (userId: string, secretKey: string) => Promise<string>;
}

// Billetten skal holde, mens medlemmet udfylder CIRKLERs spørgsmål. CIRKLER bruger den kun én gang.
export const HANDOFF_TTL_SECONDS = 2 * 60 * 60;
export const MAX_ELIGIBILITY_REFS = 500;
const DEFAULT_CIRKLER_BASE_URL = "https://cirkler.net";

export type EligibilityReason = "not_found" | "inactive" | "blocked" | "no_member_benefits";
export type Eligibility = { ref: string; eligible: true } | { ref: string; eligible: false; reason: EligibilityReason };

export function isCirklerIntegrationRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/integrations/cirkler/");
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) }
  });
}

// Medlemsreferencen er Hjerterums egen nøgle, aldrig e-mail: HR-<members.id> for medlemmer i den nye platform,
// MW-<external_memberships.id> for medlemmer, der stadig betaler gennem MembershipWorks.
export function membershipReference(membership: ActiveMembership): string {
  return membership.source === "hjerterum" ? `HR-${membership.member.id}` : `MW-${membership.externalId}`;
}

function parseReference(ref: string): { kind: "HR" | "MW"; id: number } | null {
  const match = /^(HR|MW)-([1-9]\d{0,15})$/.exec(ref);
  if (!match) return null;
  return { kind: match[1] as "HR" | "MW", id: Number(match[2]) };
}

type MembershipRow = { level: string | null; status: string; blocked: number };

function judge(ref: string, row: MembershipRow | null): Eligibility {
  if (!row) return { ref, eligible: false, reason: "not_found" };
  if (row.status !== "active") return { ref, eligible: false, reason: "inactive" };
  if (row.blocked === 1) return { ref, eligible: false, reason: "blocked" };
  if (!includesMemberBenefits(row.level)) return { ref, eligible: false, reason: "no_member_benefits" };
  return { ref, eligible: true };
}

export async function checkEligibility(db: D1Database, ref: string): Promise<Eligibility> {
  const parsed = parseReference(ref);
  if (!parsed) return { ref, eligible: false, reason: "not_found" };

  if (parsed.kind === "HR") {
    const row = await db.prepare(
      `SELECT tier AS level, status, access_blocked AS blocked FROM members WHERE id = ? LIMIT 1`
    ).bind(parsed.id).first<MembershipRow>();
    return judge(ref, row);
  }

  const external = await db.prepare(
    `SELECT membership_level AS level, status, access_blocked AS blocked, normalized_email AS email
     FROM external_memberships WHERE source = 'membershipworks' AND id = ? LIMIT 1`
  ).bind(parsed.id).first<MembershipRow & { email: string }>();
  const verdict = judge(ref, external);
  if (verdict.eligible || !external) return verdict;

  // Et MembershipWorks-medlem, der er gået over til den nye platform, beholder sin kobling til CIRKLER.
  const native = await db.prepare(
    `SELECT tier AS level, status, access_blocked AS blocked FROM members
     WHERE lower(email) = ? AND status = 'active' LIMIT 1`
  ).bind(external.email).first<MembershipRow>();
  return native ? judge(ref, native) : verdict;
}

export function circlesEntitlementGateway(db: D1Database): CirclesEntitlementGateway {
  return {
    async getEligibility(memberId) {
      const result = await checkEligibility(db, String(memberId));
      return result.eligible ? { eligible: true } : { eligible: false, reason: result.reason };
    }
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export type HandoffClaims = {
  iss: "hjerterum";
  aud: "cirkler";
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  email: string;
  name: string;
  phone: string | null;
};

// En almindelig JWT signeret med Ed25519 (EdDSA). CIRKLER kender kun den offentlige nøgle.
export async function signHandoff(privateKeyPkcs8Base64: string, claims: HandoffClaims): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", decodeBase64(privateKeyPkcs8Base64), { name: "Ed25519" }, false, ["sign"]);
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(signature)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function handoff(request: Request, env: CirklerIntegrationEnv, deps: CirklerIntegrationDeps): Promise<Response> {
  if (!env.DB || !env.CLERK_SECRET_KEY || !env.CIRKLER_HANDOFF_PRIVATE_KEY) {
    return json({ error: "cirkler_integration_not_configured" }, { status: 503 });
  }
  let userId: string;
  try {
    userId = (await (deps.authenticate ?? authenticateBearer)(request, env.CLERK_JWT_ISSUER)).userId;
  } catch (error) {
    const code = error instanceof Error ? error.message : "auth_failed";
    return json({ error: code }, { status: code === "auth_not_configured" ? 503 : 401 });
  }

  try {
    const membership = await resolveActiveMembership(env.DB, userId, env.CLERK_SECRET_KEY);
    if (!membership) return json({ error: "active_membership_required" }, { status: 403 });
    // Clerks bekræftede e-mail, så CIRKLER trygt kan logge medlemmet ind uden et mail-link.
    const email = await (deps.primaryEmail ?? clerkPrimaryEmail)(userId, env.CLERK_SECRET_KEY);
    const iat = Math.floor(deps.now() / 1000);
    const token = await signHandoff(env.CIRKLER_HANDOFF_PRIVATE_KEY, {
      iss: "hjerterum",
      aud: "cirkler",
      sub: membershipReference(membership),
      jti: crypto.randomUUID(),
      iat,
      exp: iat + HANDOFF_TTL_SECONDS,
      email,
      name: membership.fullName,
      phone: membership.source === "hjerterum" ? membership.member.phone ?? null : null
    });
    const base = (env.CIRKLER_BASE_URL || DEFAULT_CIRKLER_BASE_URL).replace(/\/+$/, "");
    // Billetten ligger efter #, så den aldrig når en server-log.
    return json({ url: `${base}/hjerterum#token=${encodeURIComponent(token)}` });
  } catch (error) {
    console.warn("cirkler_handoff_failed", error instanceof Error ? error.message : error);
    return json({ error: "cirkler_handoff_failed" }, { status: 503 });
  }
}

async function eligibility(request: Request, env: CirklerIntegrationEnv): Promise<Response> {
  if (!env.DB || !env.CIRKLER_SERVICE_KEY) return json({ error: "cirkler_integration_not_configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !constantTimeEqual(authorization.slice(7).trim(), env.CIRKLER_SERVICE_KEY)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as { refs?: unknown } | null;
  const refs = body?.refs;
  if (!Array.isArray(refs) || refs.length > MAX_ELIGIBILITY_REFS || refs.some(ref => typeof ref !== "string")) {
    return json({ error: "invalid_refs" }, { status: 400 });
  }
  const results: Eligibility[] = [];
  for (const ref of new Set(refs as string[])) results.push(await checkEligibility(env.DB, ref));
  return json({ checkedAt: new Date().toISOString(), results });
}

export async function handleCirklerIntegrationRequest(
  request: Request,
  env: CirklerIntegrationEnv,
  deps: CirklerIntegrationDeps
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === "/api/integrations/cirkler/handoff") return handoff(request, env, deps);
  if (request.method === "POST" && pathname === "/api/integrations/cirkler/eligibility") return eligibility(request, env);
  return json({ error: "not_found" }, { status: 404 });
}
