import appWorker from "./entry.js";
import { getExternalEvents } from "./external-events.js";

interface Env {
  CLERK_PUBLISHABLE_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  [key: string]: unknown;
}

interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

const app = appWorker as unknown as {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(controller: ScheduledControllerLike, env: Env): Promise<void>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/events/external") {
      try {
        return Response.json(await getExternalEvents(), {
          headers: { "cache-control": "public, max-age=60, s-maxage=300" }
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "external_events_failed";
        return Response.json({ error: code }, { status: 503 });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/client-config") {
      return Response.json(
        {
          clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY ?? null,
          stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null
        },
        { headers: { "cache-control": "public, max-age=300" } }
      );
    }
    return app.fetch(request, env);
  },

  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    return app.scheduled(controller, env);
  }
};
