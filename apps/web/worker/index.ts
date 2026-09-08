import {
  checkDatabase,
  listUpcomingPublicRoomBookings,
  type D1Database
} from "./db.js";

interface Env {
  ENVIRONMENT?: string;
  DB?: D1Database;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
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
  if (!env.DB) {
    return json({ error: "database_unbound" }, { status: 503 });
  }

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
      {
        headers: {
          "cache-control": "public, max-age=60, s-maxage=300"
        }
      }
    );
  } catch {
    return json({ error: "database_query_failed" }, { status: 503 });
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

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
