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
import { resolveActiveMembership, type ActiveMembership } from "./membership-access.js";
import {
  createEventCheckout,
  createPayoutOnboarding,
  getHandlingFeeMinor,
  getPayoutAccount,
  processEventPaymentWebhook,
  requireActivePayoutAccount
} from "./event-payments.js";
import {
  attendRoomBooking,
  createRoomBooking,
  deleteOwnedRoomBooking,
  listBookingAttendees,
  listMemberCalendarBookings,
  listOwnedRoomBookings,
  normalizeCreateRoomBookingInput,
  unattendRoomBooking,
  updateOwnedRoomBooking,
  isFixedTeacher,
  type RoomBookingRow
} from "./room-bookings.js";
import { verifyStripeWebhook } from "./stripe.js";

interface Env {
  ENVIRONMENT?: string;
  APP_BASE_URL?: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_MEMBER_WEBHOOK_SECRET?: string;
  STRIPE_EVENT_WEBHOOK_SECRET?: string;
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

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function requireActiveMembershipForUser(
  env: Env,
  clerkUserId: string
): Promise<ActiveMembership | Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  try {
    const membership = await resolveActiveMembership(env.DB, clerkUserId, env.CLERK_SECRET_KEY);
    return membership ?? json({ error: "active_membership_required" }, { status: 403 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "membership_lookup_failed";
    return json({ error: code }, { status: 503 });
  }
}

function parseRouteId(pathname: string, pattern: RegExp): number | null {
  const match = pathname.match(pattern);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function roomBookingView(row: RoomBookingRow) {
  return {
    id: row.id,
    ownerClerkUserId: row.clerk_user_id,
    teacherName: row.teacher_name,
    teacherEmail: row.teacher_email,
    title: row.title,
    description: row.description,
    startsAt: new Date(row.starts_at_ms).toISOString(),
    endsAt: new Date(row.ends_at_ms).toISOString(),
    maxAttendees: row.max_attendees,
    feeKr: row.fee_minor / 100,
    ticketPriceKr: row.ticket_price_minor / 100,
    bookingType: row.booking_type ?? "standard",
    reviewStatus: row.review_status ?? "approved",
    reviewNote: row.review_note ?? null
  };
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

async function ownedRoomBookings(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    const rows = await listOwnedRoomBookings(env.DB, user.userId);
    return json(rows.map(roomBookingView));
  } catch {
    return json({ error: "database_query_failed" }, { status: 503 });
  }
}

async function postRoomBooking(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const input = normalizeCreateRoomBookingInput(body);
    if (input.ticketPriceMinor > 0) {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_EVENT_WEBHOOK_SECRET) {
        throw new Error("payments_not_configured");
      }
      await requireActivePayoutAccount(env.DB, env.STRIPE_SECRET_KEY, user.userId);
    }
    const result = await createRoomBooking(env.DB, user.userId, {
      ...input,
      preApproved: await isFixedTeacher(env.DB, membership.email),
      teacherName: membership.fullName,
      teacherEmail: membership.email,
      memberName: membership.fullName,
      memberEmail: membership.email
    });
    return json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "booking_failed";
    if (code === "booking_conflict" || code === "payout_onboarding_required") {
      return json({ error: code }, { status: 409 });
    }
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function putRoomBooking(
  request: Request,
  env: Env,
  bookingId: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const input = normalizeCreateRoomBookingInput(body);
    if (input.ticketPriceMinor > 0) {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_EVENT_WEBHOOK_SECRET) {
        throw new Error("payments_not_configured");
      }
      await requireActivePayoutAccount(env.DB, env.STRIPE_SECRET_KEY, user.userId);
    }
    const result = await updateOwnedRoomBooking(
      env.DB,
      user.userId,
      bookingId,
      { ...input, preApproved: await isFixedTeacher(env.DB, membership.email) }
    );
    return json({ status: "updated", ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "booking_update_failed";
    if (code === "booking_not_found") return json({ error: code }, { status: 404 });
    if (code === "booking_conflict" || code === "booking_has_registrations" ||
        code === "payout_onboarding_required") {
      return json({ error: code }, { status: 409 });
    }
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function deleteRoomBooking(
  request: Request,
  env: Env,
  bookingId: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    await deleteOwnedRoomBooking(env.DB, user.userId, bookingId);
    return json({ status: "cancelled" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "booking_delete_failed";
    return json({ error: code }, { status: code === "booking_not_found" ? 404 : 503 });
  }
}

async function bookingAttendees(
  request: Request,
  env: Env,
  bookingId: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    const attendees = await listBookingAttendees(env.DB, user.userId, bookingId);
    return json(
      attendees.map((attendee) => ({
        id: attendee.id,
        clerkUserId: attendee.clerk_user_id,
        memberName: attendee.member_name,
        memberEmail: attendee.member_email,
        createdAt: new Date(attendee.created_at_ms).toISOString()
      }))
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "attendee_list_failed";
    return json({ error: code }, { status: code === "booking_not_found" ? 404 : 503 });
  }
}

async function attendBooking(
  request: Request,
  env: Env,
  bookingId: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    await attendRoomBooking(env.DB, user.userId, bookingId, {
      memberName: membership.fullName,
      memberEmail: membership.email
    });
    return json({ status: "attending" }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "attendance_failed";
    if (code === "event_payment_required") {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_EVENT_WEBHOOK_SECRET || !env.APP_BASE_URL) {
        return json({ error: "payments_not_configured" }, { status: 503 });
      }
      try {
        const result = await createEventCheckout(
          env.DB, env.STRIPE_SECRET_KEY, env.APP_BASE_URL, bookingId, user.userId,
          { fullName: membership.fullName, email: membership.email }
        );
        return json(result, { status: 201 });
      } catch (checkoutError) {
        const checkoutCode = checkoutError instanceof Error
          ? checkoutError.message : "event_checkout_failed";
        const checkoutStatus = checkoutCode === "booking_not_found" ? 404 :
          ["already_attending", "booking_full", "booking_full_or_pending"].includes(checkoutCode)
            ? 409 : 503;
        return json({ error: checkoutCode }, { status: checkoutStatus });
      }
    }
    if (code === "booking_not_found") return json({ error: code }, { status: 404 });
    if (code === "booking_started") return json({ error: code }, { status: 409 });
    if (code === "already_attending" || code === "booking_full" ||
        code === "booking_full_or_pending") {
      return json({ error: code }, { status: 409 });
    }
    if (code.startsWith("invalid_")) return json({ error: code }, { status: 400 });
    return json({ error: code }, { status: 503 });
  }
}

async function unattendBooking(
  request: Request,
  env: Env,
  bookingId: number
): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    await unattendRoomBooking(env.DB, user.userId, bookingId);
    return json({ status: "not_attending" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unattend_failed";
    if (code === "attendance_not_found" || code === "booking_not_found") {
      return json({ error: code }, { status: 404 });
    }
    return json({ error: code }, { status: code === "booking_started" ? 409 : 503 });
  }
}

async function memberCalendar(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;

  try {
    const rows = await listMemberCalendarBookings(env.DB, user.userId);
    const handlingFeeMinor = await getHandlingFeeMinor(env.DB);
    return json(rows.map((row) => ({
      ...roomBookingView(row),
      handlingFeeKr: row.ticket_price_minor > 0 ? handlingFeeMinor / 100 : 0,
      attendeeCount: row.attendee_count,
      isAttending: row.is_attending === 1,
      registrationStatus: row.registration_status,
      isOwner: row.clerk_user_id === user.userId
    })));
  } catch {
    return json({ error: "database_query_failed" }, { status: 503 });
  }
}

async function payoutAccount(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_EVENT_WEBHOOK_SECRET || !env.APP_BASE_URL) {
    return json({ configured: false, account: null });
  }
  try {
    const account = await getPayoutAccount(env.DB, env.STRIPE_SECRET_KEY, user.userId);
    return json({ configured: true, account });
  } catch (error) {
    const code = error instanceof Error ? error.message : "payout_lookup_failed";
    return json({ error: code }, { status: 503 });
  }
}

async function payoutOnboarding(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_EVENT_WEBHOOK_SECRET || !env.APP_BASE_URL) {
    return json({ error: "payments_not_configured" }, { status: 503 });
  }
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const membership = await requireActiveMembershipForUser(env, user.userId);
  if (isResponse(membership)) return membership;
  try {
    return json(await createPayoutOnboarding(
      env.DB, env.STRIPE_SECRET_KEY, env.APP_BASE_URL, user.userId,
      { fullName: membership.fullName, email: membership.email }
    ), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "payout_onboarding_failed";
    return json({ error: code }, { status: 503 });
  }
}

async function eventPaymentWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unbound" }, { status: 503 });
  if (!env.STRIPE_EVENT_WEBHOOK_SECRET) {
    return json({ error: "event_webhook_not_configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  try {
    const event = await verifyStripeWebhook(
      rawBody, request.headers.get("stripe-signature"), env.STRIPE_EVENT_WEBHOOK_SECRET
    );
    const result = await processEventPaymentWebhook(env.DB, event);
    return json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_webhook_failed";
    return json({ error: code }, { status: code.startsWith("stripe_signature_") ? 400 : 503 });
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
    if (request.method === "GET" && url.pathname === "/api/room-bookings/calendar") {
      return memberCalendar(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/room-bookings") {
      return ownedRoomBookings(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/room-bookings") {
      return postRoomBooking(request, env);
    }

    const attendeeListId = parseRouteId(url.pathname, /^\/api\/room-bookings\/(\d+)\/attendees$/);
    if (request.method === "GET" && attendeeListId !== null) {
      return bookingAttendees(request, env, attendeeListId);
    }
    const attendanceId = parseRouteId(url.pathname, /^\/api\/room-bookings\/(\d+)\/attend$/);
    if (request.method === "POST" && attendanceId !== null) {
      return attendBooking(request, env, attendanceId);
    }
    if (request.method === "DELETE" && attendanceId !== null) {
      return unattendBooking(request, env, attendanceId);
    }
    const bookingId = parseRouteId(url.pathname, /^\/api\/room-bookings\/(\d+)$/);
    if (request.method === "PUT" && bookingId !== null) {
      return putRoomBooking(request, env, bookingId);
    }
    if (request.method === "DELETE" && bookingId !== null) {
      return deleteRoomBooking(request, env, bookingId);
    }

    if (request.method === "GET" && url.pathname === "/api/members/payout-account") {
      return payoutAccount(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/members/payout-account/onboarding") {
      return payoutOnboarding(request, env);
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
    if (request.method === "POST" && url.pathname === "/api/stripe/event-webhook") {
      return eventPaymentWebhook(request, env);
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
