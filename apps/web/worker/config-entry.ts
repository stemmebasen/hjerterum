import appWorker from "./entry.js";
import { getExternalEvents } from "./external-events.js";
import type { SagaEnv } from "./saga/env.js";
import { handleSagaRequest } from "./saga/handler.js";
import { handleCockpitRequest, isCockpitRequest } from "./cockpit/handler.js";
import { handleCalculatorRequest, isCalculatorRequest } from "./beregner/handler.js";
import { runSagaJobs } from "./saga/saga.js";
import { runEventSync } from "./cockpit/events.js";
import { logoResponse } from "./cockpit/logo.js";
import { handleLoginMail, LOGIN_MAIL_PATH, type LoginMailEnv } from "./login-mail.js";

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

/** medlem.<domain>: the member area's own address. */
export const isMemberHost = (hostname: string) => /^medlem\./i.test(hostname);

const app = appWorker as unknown as {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(controller: ScheduledControllerLike, env: Env): Promise<void>;
};

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    // Requested: the price calculator "i systemet - den skal også bruges som iframe" (beregner/handler.ts): /beregner and
    // /ny-beregner-2026 on every address (before the cockpit, which otherwise takes every path on its own address).
    if (isCalculatorRequest(url)) {
      return handleCalculatorRequest(request, env as SagaEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() });
    }

    // Requested: "Kan du ligge den på medlem.hjerterum.info?" - the member area's own address opens in the member
    // area; everything else (sign-in, the public pages, the API) works there as on any other address.
    if (isMemberHost(url.hostname) && url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(null, { status: 302, headers: { location: "/member-portal" + url.search, "cache-control": "no-store" } });
    }

    // Hjerterum Lys (apps/web/lys.ts): one top on every page, so the hands are served on every address, not only the cockpit's.
    if (url.pathname === "/logo.png" && (request.method === "GET" || request.method === "HEAD")) return logoResponse();

    // Clerk's login emails, delivered through Resend from Hjerterum's own address (login-mail.ts).
    if (url.pathname === LOGIN_MAIL_PATH) {
      return handleLoginMail(request, env as LoginMailEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() });
    }

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
    await runEventSync(env as SagaEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() })
      .catch(error => console.warn("house_events_failed", error instanceof Error ? error.message : error));
  }
};
