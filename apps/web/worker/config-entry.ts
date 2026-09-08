import appWorker from "./entry.js";

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
