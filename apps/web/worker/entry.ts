import { authenticateBearer } from "./auth.js";
import type { D1Database } from "./db.js";
import {
  listMemberInvoices,
  parseMemberProfileUpdate,
  updateMemberProfile
} from "./member-profile.js";
import { getMemberByClerkUserId } from "./members.js";
import baseWorker from "./index.js";

interface Env {
  CLERK_JWT_ISSUER?: string;
  STRIPE_SECRET_KEY?: string;
  DB?: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}

interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

const base = baseWorker as unknown as {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(controller: ScheduledControllerLike, env: Env): Promise<void>;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {})
    }
  });
}

async function requireUser(request: Request, env: Env) {
  try {
    return await authenticateBearer(request, env.CLERK_JWT_ISSUER);
  } catch (error) {
    const code = error instanceof Error ? error.message : "auth_failed";
    return json({ error: code }, { status: code === "auth_not_configured" ? 503 : 401 });
  }
}

async function putMemberMe(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await updateMemberProfile(
      env.DB,
      env.STRIPE_SECRET_KEY,
      user.userId,
      parseMemberProfileUpdate(body)
    );
    return json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "member_update_failed";
    if (code === "member_not_found") return json({ error: code }, { status: 404 });
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function memberInvoices(
  request: Request,
  env: Env,
  requestedMemberId?: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY) return json({ error: "payments_not_configured" }, { status: 503 });
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const member = await getMemberByClerkUserId(env.DB, user.userId);
    if (!member) return json({ error: "member_not_found" }, { status: 404 });
    if (requestedMemberId !== undefined && requestedMemberId !== member.id) {
      return json({ error: "forbidden" }, { status: 403 });
    }
    return json(await listMemberInvoices(env.DB, env.STRIPE_SECRET_KEY, user.userId));
  } catch (error) {
    const code = error instanceof Error ? error.message : "invoice_history_failed";
    if (code === "member_not_found" || code === "membership_customer_missing") {
      return json({ error: code }, { status: 404 });
    }
    return json({ error: code }, { status: 503 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "PUT" && url.pathname === "/api/members/me") {
      return putMemberMe(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/members/me/payments") {
      return memberInvoices(request, env);
    }

    const legacyPayments = url.pathname.match(/^\/api\/members\/(\d+)\/payments$/);
    if (request.method === "GET" && legacyPayments?.[1]) {
      const memberId = Number(legacyPayments[1]);
      if (!Number.isInteger(memberId) || memberId <= 0) {
        return json({ error: "invalid_member_id" }, { status: 400 });
      }
      return memberInvoices(request, env, memberId);
    }

    return base.fetch(request, env);
  },

  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    return base.scheduled(controller, env);
  }
};
