import appWorker from "./entry.js";
import { getExternalEvents } from "./external-events.js";
import type { SagaEnv } from "./saga/env.js";
import { handleSagaRequest } from "./saga/handler.js";
import { handleCockpitRequest, isCockpitRequest } from "./cockpit/handler.js";
import { runSagaJobs } from "./saga/saga.js";

interface Env {
  CLERK_PUBLISHABLE_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  [key: string]: unknown;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
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
  async fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    // The board's cockpit (cockpit/handler.ts): cockpit.<domain>, or /cockpit on any other host.
    if (isCockpitRequest(url)) {
      return handleCockpitRequest(request, env as SagaEnv, {
        fetcher: (input, init) => fetch(input, init),
        now: () => Date.now(),
        ...(ctx ? { waitUntil: (work: Promise<unknown>) => ctx.waitUntil(work) } : {})
      });
    }

    // Saga, the board assistant (docs/decisions/0005-saga-board-assistant.md).
    if (url.pathname.startsWith("/api/saga/")) {
      return handleSagaRequest(request, env as SagaEnv, {
        fetcher: (input, init) => fetch(input, init),
        now: () => Date.now(),
        ...(ctx ? { waitUntil: (work: Promise<unknown>) => ctx.waitUntil(work) } : {})
      });
    }

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
    await app.scheduled(controller, env);
    await runSagaJobs(env as SagaEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() })
      .catch(error => console.warn("saga_jobs_failed", error instanceof Error ? error.message : error));
  }
};
