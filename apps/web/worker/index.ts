import { authenticateBearer, type AuthenticatedUser } from "./auth.js";
import {
  checkDatabase,
  listUpcomingPublicRoomBookings,
  type D1Database
} from "./db.js";
import { runTeacherAutoCharge } from "./jobs.js";
import {
  cancelMembership,
  createBillingPortalUrl,
  createMembershipCheckout,
  getMemberByClerkUserId,
  parseCheckoutInput,
  processMemberStripeEvent
} from "./members.js";
import {
  createRoomBooking,
  normalizeCreateRoomBookingInput
} from "./room-bookings.js";
import { verifyStripeWebhook } from "./stripe.js";

interface Env {
  ENVIRONMENT?: string;
  APP_BASE_URL?: string;
  CLERK_JWT_ISSUER?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_MEMBER_WEBHOOK_SECRET?: string;
  DB?: D1Database;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

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

async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser | Response> {
  try {
    return await authenticateBearer(request, env.CLERK_JWT_ISSUER);
  } catch (error) {
    const code = error instanceof Error ? error.message : "auth_failed";
    const status = code === "auth_not_configured" ? 503 : 401;
    return json({ error: code }, { status });
  }
}

function isResponse(value: AuthenticatedUser | Response): value is Response {
  return value instanceof Response;
}

async function readiness(env: Env): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        status: "degraded",
        service: "hjerterum-platform",
        environment: env.ENVIRONMENT ?? "unknown",
        database: "unbound"
      },
      { status: 503 }
    );
  }

  try {
    await checkDatabase(env.DB);
    return json({
      status: "ready",
      service: "hjerterum-platform",
      environment: env.ENVIRONMENT ?? "unknown",
      database: "ready"
    });
  } catch {
    return json(
      {
        status: "degraded",
        service: "hjerterum-platform",
        environment: env.ENVIRONMENT ?? "unknown",
        database: "unhealthy"
      },
      { status: 503 }
    );
  }
}

async function publicRoomBookings(env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });

  try {
    const rows = await listUpcomingPublicRoomBookings(env.DB);
    return json(
      rows.map((row) => ({
        id: row.id,
        teacherName: row.teacher_name,
        teacherEmail: row.teacher_email,
        title: row.title,
        description: row.description,
        startsAt: new Date(row.starts_at_ms).toISOString(),
        endsAt: new Date(row.ends_at_ms).toISOString(),
        maxAttendees: row.max_attendees
      })),
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } }
    );
  } catch {
    return json({ error: "database_query_failed" }, { status: 503 });
  }
}

async function postRoomBooking(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const input = normalizeCreateRoomBookingInput(body);
    const result = await createRoomBooking(env.DB, user.userId, input);
    return json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "booking_failed";
    if (code === "booking_conflict") return json({ error: code }, { status: 409 });
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function memberCheckout(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY || !env.APP_BASE_URL) {
    return json({ error: "payments_not_configured" }, { status: 503 });
  }
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const input = parseCheckoutInput(body);
    const result = await createMembershipCheckout(
      env.DB,
      env.STRIPE_SECRET_KEY,
      env.APP_BASE_URL,
      user.userId,
      input
    );
    return json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "checkout_failed";
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function memberMe(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const member = await getMemberByClerkUserId(env.DB, user.userId);
  return member ? json(member) : json({ error: "member_not_found" }, { status: 404 });
}

async function memberCancel(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY) return json({ error: "payments_not_configured" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  try {
    await cancelMembership(env.DB, env.STRIPE_SECRET_KEY, user.userId);
    return json({ status: "cancel_at_period_end_requested" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "cancel_failed";
    return json({ error: code }, { status: code === "membership_subscription_missing" ? 404 : 503 });
  }
}

async function memberPortal(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY || !env.APP_BASE_URL) {
    return json({ error: "payments_not_configured" }, { status: 503 });
  }
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  try {
    return json(
      await createBillingPortalUrl(env.DB, env.STRIPE_SECRET_KEY, env.APP_BASE_URL, user.userId)
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "portal_failed";
    return json({ error: code }, { status: code === "membership_customer_missing" ? 404 : 503 });
  }
}

async function memberWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_MEMBER_WEBHOOK_SECRET) {
    return json({ error: "member_webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  try {
    const event = await verifyStripeWebhook(
      rawBody,
      request.headers.get("stripe-signature"),
      env.STRIPE_MEMBER_WEBHOOK_SECRET
    );
    const result = await processMemberStripeEvent(env.DB, event);
    return json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    const code = error instanceof Error ? error.message : "member_webhook_failed";
    const status = code.startsWith("stripe_signature_") ? 400 : 503;
    return json({ error: code }, { status });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        status: "ok",
        service: "hjerterum-platform",
        environment: env.ENVIRONMENT ?? "unknown"
      });
    }

    if (request.method === "GET" && url.pathname === "/api/readiness") {
      return readiness(env);
    }
    if (request.method === "GET" && url.pathname === "/api/room-bookings/public") {
      return publicRoomBookings(env);
    }
    if (request.method === "POST" && url.pathname === "/api/room-bookings") {
      return postRoomBooking(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/members/checkout") {
      return memberCheckout(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/members/me") {
      return memberMe(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/members/me/cancel") {
      return memberCancel(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/members/portal-url") {
      return memberPortal(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/stripe/member-webhook") {
      return memberWebhook(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    if (!env.DB || !env.STRIPE_SECRET_KEY) return;
    await runTeacherAutoCharge(env.DB, env.STRIPE_SECRET_KEY, controller.scheduledTime);
  }
};
