import { authenticateAdmin, clerkPrimaryEmail } from "./admin-auth.js";
import { getAdminOverview, listAdminBookings, listAdminMembers } from "./admin-dashboard.js";
import { authenticateBearer } from "./auth.js";
import type { D1Database } from "./db.js";
import {
  listMemberInvoices,
  parseMemberProfileUpdate,
  updateMemberProfile
} from "./member-profile.js";
import { getMemberByClerkUserId } from "./members.js";
import {
  findMembershipWorksMemberByEmail,
  importMembershipWorksCsv,
  listMembershipImportBatches,
  listMembershipWorksMembers
} from "./membership-import.js";
import {
  beginTeacherCardSetup,
  createTeacher,
  createTeacherSetupLink,
  getTeacher,
  getTeacherBySetupToken,
  listTeachers,
  parseTeacherCreate,
  parseTeacherUpdate,
  processTeacherStripeEvent,
  updateTeacher
} from "./teachers.js";
import { verifyStripeWebhook } from "./stripe.js";
import baseWorker from "./index.js";

interface Env {
  APP_BASE_URL?: string;
  ALLOWED_EMAILS?: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
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

async function requireAdmin(request: Request, env: Env) {
  try {
    return await authenticateAdmin(request, {
      ...(env.CLERK_JWT_ISSUER ? { issuer: env.CLERK_JWT_ISSUER } : {}),
      ...(env.CLERK_SECRET_KEY ? { clerkSecretKey: env.CLERK_SECRET_KEY } : {}),
      ...(env.ALLOWED_EMAILS ? { allowedEmails: env.ALLOWED_EMAILS } : {})
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "admin_auth_failed";
    if (code === "admin_auth_not_configured") return json({ error: code }, { status: 503 });
    if (code === "admin_forbidden") return json({ error: code }, { status: 403 });
    return json({ error: code }, { status: 401 });
  }
}

async function parseJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }
}

async function memberMe(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const localMember = await getMemberByClerkUserId(env.DB, user.userId);
  if (localMember) {
    if (localMember.status !== "active") {
      return json({ error: "membership_inactive" }, { status: 403 });
    }
    return json({ ...localMember, source: "hjerterum", managedExternally: false });
  }
  if (!env.CLERK_SECRET_KEY) return json({ error: "membership_lookup_not_configured" }, { status: 503 });

  try {
    const email = await clerkPrimaryEmail(user.userId, env.CLERK_SECRET_KEY);
    const externalMember = await findMembershipWorksMemberByEmail(env.DB, email);
    if (!externalMember) return json({ error: "membership_required" }, { status: 403 });
    if (externalMember.status !== "active") {
      return json({ error: "membership_inactive" }, { status: 403 });
    }
    return json({
      id: -externalMember.id,
      tier: externalMember.membershipLevel ?? "MembershipWorks",
      interval: "legacy",
      status: externalMember.status,
      fullName: externalMember.fullName,
      email: externalMember.email,
      phone: null,
      streetAddress: null,
      isTeacher: false,
      source: "membershipworks",
      managedExternally: true
    });
  } catch {
    return json({ error: "membership_lookup_failed" }, { status: 503 });
  }
}

async function membershipImports(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    if (request.method === "GET") return json(await listMembershipImportBatches(env.DB));
    const body = await parseJson(request);
    if (body instanceof Response) return body;
    return json(await importMembershipWorksCsv(env.DB, body, admin.email), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "membership_import_failed";
    return json({ error: code }, { status: code.startsWith("invalid_") ? 400 : 503 });
  }
}

async function membershipWorksMembers(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  try {
    return json(await listMembershipWorksMembers(env.DB));
  } catch {
    return json({ error: "membership_list_failed" }, { status: 503 });
  }
}

async function putMemberMe(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const body = await parseJson(request);
  if (body instanceof Response) return body;

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

async function adminRead(
  request: Request,
  env: Env,
  resource: "overview" | "members" | "room-bookings"
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    if (resource === "overview") return json(await getAdminOverview(env.DB));
    if (resource === "members") return json(await listAdminMembers(env.DB));
    return json(await listAdminBookings(env.DB));
  } catch (error) {
    const code = error instanceof Error ? error.message : "admin_query_failed";
    return json({ error: code }, { status: 503 });
  }
}

async function teachersListOrCreate(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    if (request.method === "GET") return json(await listTeachers(env.DB));
    const body = await parseJson(request);
    if (body instanceof Response) return body;
    return json(await createTeacher(env.DB, parseTeacherCreate(body)), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "teacher_request_failed";
    return json({ error: code }, { status: code.startsWith("invalid_") ? 400 : 503 });
  }
}

async function teacherDetail(request: Request, env: Env, teacherId: number): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    if (request.method === "GET") {
      const teacher = await getTeacher(env.DB, teacherId);
      return teacher ? json(teacher) : json({ error: "teacher_not_found" }, { status: 404 });
    }
    const body = await parseJson(request);
    if (body instanceof Response) return body;
    return json(await updateTeacher(env.DB, teacherId, parseTeacherUpdate(body)));
  } catch (error) {
    const code = error instanceof Error ? error.message : "teacher_request_failed";
    if (code === "teacher_not_found") return json({ error: code }, { status: 404 });
    return json({ error: code }, { status: code.startsWith("invalid_") ? 400 : 503 });
  }
}

async function teacherSetupLink(request: Request, env: Env, teacherId: number): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.APP_BASE_URL) return json({ error: "app_base_url_not_configured" }, { status: 503 });
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    return json(await createTeacherSetupLink(env.DB, teacherId, env.APP_BASE_URL), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "teacher_setup_link_failed";
    return json({ error: code }, { status: code === "teacher_not_found" ? 404 : 503 });
  }
}

async function teacherSetupView(env: Env, token: string): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const teacher = await getTeacherBySetupToken(env.DB, token);
  if (!teacher) return json({ error: "setup_token_not_found" }, { status: 404 });
  return json({ id: teacher.id, name: teacher.name, email: teacher.email, cardStatus: teacher.card_status });
}

async function teacherSetupConfirm(env: Env, token: string): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY) return json({ error: "payments_not_configured" }, { status: 503 });
  try {
    return json(await beginTeacherCardSetup(env.DB, env.STRIPE_SECRET_KEY, token), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "teacher_setup_failed";
    return json({ error: code }, { status: code === "setup_token_not_found" ? 404 : 503 });
  }
}

async function teacherStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "teacher_webhook_not_configured" }, { status: 503 });
  const rawBody = await request.text();
  try {
    const event = await verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
    const result = await processTeacherStripeEvent(env.DB, event);
    return json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    const code = error instanceof Error ? error.message : "teacher_webhook_failed";
    return json({ error: code }, { status: code.startsWith("stripe_signature_") ? 400 : 503 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/client-config") {
      return json({
        clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY ?? null
      }, { headers: { "cache-control": "public, max-age=300" } });
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/admin/membership-imports") {
      return membershipImports(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/membershipworks-members") {
      return membershipWorksMembers(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/overview") return adminRead(request, env, "overview");
    if (request.method === "GET" && url.pathname === "/api/admin/members") return adminRead(request, env, "members");
    if (request.method === "GET" && url.pathname === "/api/admin/room-bookings") return adminRead(request, env, "room-bookings");

    if (request.method === "GET" && url.pathname === "/api/members/me") return memberMe(request, env);
    if (request.method === "PUT" && url.pathname === "/api/members/me") return putMemberMe(request, env);
    if (request.method === "GET" && url.pathname === "/api/members/me/payments") return memberInvoices(request, env);

    const legacyPayments = url.pathname.match(/^\/api\/members\/(\d+)\/payments$/);
    if (request.method === "GET" && legacyPayments?.[1]) {
      const memberId = Number(legacyPayments[1]);
      if (!Number.isInteger(memberId) || memberId <= 0) return json({ error: "invalid_member_id" }, { status: 400 });
      return memberInvoices(request, env, memberId);
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/teachers") {
      return teachersListOrCreate(request, env);
    }
    const teacherSetupLinkMatch = url.pathname.match(/^\/api\/teachers\/(\d+)\/setup-link$/);
    if (request.method === "POST" && teacherSetupLinkMatch?.[1]) {
      return teacherSetupLink(request, env, Number(teacherSetupLinkMatch[1]));
    }
    const teacherMatch = url.pathname.match(/^\/api\/teachers\/(\d+)$/);
    if ((request.method === "GET" || request.method === "PUT") && teacherMatch?.[1]) {
      return teacherDetail(request, env, Number(teacherMatch[1]));
    }

    const setupConfirmMatch = url.pathname.match(/^\/api\/setup\/([^/]+)\/confirm$/);
    if (request.method === "POST" && setupConfirmMatch?.[1]) return teacherSetupConfirm(env, setupConfirmMatch[1]);
    const setupMatch = url.pathname.match(/^\/api\/setup\/([^/]+)$/);
    if (request.method === "GET" && setupMatch?.[1]) return teacherSetupView(env, setupMatch[1]);
    if (request.method === "POST" && url.pathname === "/api/stripe/webhook") return teacherStripeWebhook(request, env);

    return base.fetch(request, env);
  },

  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    return base.scheduled(controller, env);
  }
};
