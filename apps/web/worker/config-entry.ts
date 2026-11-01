import { runNewsletterJob, type NewsletterEnv } from "./newsletter-send.js";
import appWorker from "./entry.js";
import { getExternalEvents } from "./external-events.js";
import { eventDetail } from "./event-detail.js";
import { program, programCandidates, upcomingFeed } from "./program.js";
import type { D1Database } from "./db.js";
import type { SagaEnv } from "./saga/env.js";
import { handleSagaRequest } from "./saga/handler.js";
import { handleCockpitRequest, isCockpitRequest } from "./cockpit/handler.js";
import { handleCalculatorRequest, isCalculatorRequest } from "./beregner/handler.js";
import { isMailRun, runSagaJobs, runTeamMailRound } from "./saga/saga.js";
import { runEventSync } from "./cockpit/events.js";
import { handleCirklerIntegrationRequest, isCirklerIntegrationRequest, type CirklerIntegrationEnv } from "./cirkler-integration.js";
import { logoResponse } from "./cockpit/logo.js";
import { handleLoginMail, LOGIN_MAIL_PATH, type LoginMailEnv } from "./login-mail.js";
import { redirectFor } from "../site/redirects.js";
import { handleStatsApi, handleVisit, pruneVisits, STATS_API_PATH, VISIT_PATH, type StatsEnv } from "./site-stats.js";
import { ENQUIRY_PATH, handleEnquiry } from "./enquiries.js";
import { posterImage } from "./poster-image.js";

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

/** Asked: "The sign in seems broken - I keep getting message: You are signed out". The login (Clerk) belongs to medlem.<domain>;
 * on the website's own address (hjerterum.info, www.hjerterum.info) its session cannot hold. So signing in, signing up, the member
 * area and the members' admin open on medlem.<domain>. Other addresses (previews, local) are left as they are. */
export function memberAddress(url: URL): string | null {
  const site = /^(?:www\.)?([a-z0-9-]+\.[a-z]+)$/i.exec(url.hostname)?.[1];
  if (!site || isMemberHost(url.hostname)) return null;
  if (!/^\/(?:sign-in|sign-up|signup|login|member-portal|admin)(?:\/|$)/.test(url.pathname)) return null;
  return `https://medlem.${site.toLowerCase()}${url.pathname}${url.search}`;
}

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

    const member = (request.method === "GET" || request.method === "HEAD") ? memberAddress(url) : null;
    if (member) return new Response(null, { status: 302, headers: { location: member, "cache-control": "no-store" } });

    // Hjerterum Lys (apps/web/lys.ts): one top on every page, so the hands are served on every address, not only the cockpit's.
    if (url.pathname === "/logo.png" && (request.method === "GET" || request.method === "HEAD")) return logoResponse();

    // Clerk's login emails, delivered through Resend from Hjerterum's own address (login-mail.ts).
    if (url.pathname === LOGIN_MAIL_PATH) {
      return handleLoginMail(request, env as LoginMailEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() });
    }

    // The website's visits, counted without cookies, for admin → Statistik and the read-only statistics API (site-stats.ts).
    if (url.pathname === VISIT_PATH) return handleVisit(request, env as StatsEnv, Date.now());
    if (url.pathname === STATS_API_PATH) return handleStatsApi(request, env as StatsEnv, Date.now());
    // The website's enquiry forms, laid in team@'s inbox (enquiries.ts).
    if (url.pathname === ENQUIRY_PATH) return handleEnquiry(request, env as SagaEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() });

    // The board's cockpit (cockpit/handler.ts): cockpit.<domain>, or /cockpit on any other host.
    if (isCockpitRequest(url)) {
      return handleCockpitRequest(request, env as SagaEnv, {
        fetcher: (input, init) => fetch(input, init),
        now: () => Date.now(),
        ...(ctx ? { waitUntil: (work: Promise<unknown>) => ctx.waitUntil(work) } : {})
      });
    }

    // The website (site/pages.ts): holistisk.org's old addresses lead to the page that now carries their content.
    if (request.method === "GET" || request.method === "HEAD") {
      const target = redirectFor(url.pathname);
      if (target) return new Response(null, { status: 301, headers: { location: target, "cache-control": "public, max-age=3600" } });
    }

    // Saga, the board assistant (docs/decisions/0005-saga-board-assistant.md).
    if (url.pathname.startsWith("/api/saga/")) {
      return handleSagaRequest(request, env as SagaEnv, {
        fetcher: (input, init) => fetch(input, init),
        now: () => Date.now(),
        ...(ctx ? { waitUntil: (work: Promise<unknown>) => ctx.waitUntil(work) } : {})
      });
    }

    // CIRKLER: tilmelding fra medlemsportalen og det daglige tjek af medlemskab (cirkler-integration.ts).
    if (isCirklerIntegrationRequest(url)) {
      return handleCirklerIntegrationRequest(request, env as CirklerIntegrationEnv, { now: () => Date.now() });
    }

    // The overview's programme: the next five events with a line each (program.ts).
    if (request.method === "GET" && url.pathname === "/api/events/program") {
      const db = (env as { DB?: D1Database }).DB;
      if (!db) return Response.json({ error: "database_unbound" }, { status: 503 });
      return Response.json(await program(db, await getExternalEvents().catch(() => []), Date.now()), { headers: { "cache-control": "public, max-age=60" } });
    }
    // The house's coming events as a public feed for Audiofolk's radio spots (program.ts, upcomingFeed).
    if (request.method === "GET" && url.pathname === "/api/events/upcoming") {
      const db = (env as { DB?: D1Database }).DB;
      if (!db) return Response.json({ error: "database_unbound" }, { status: 503 });
      const now = Date.now();
      return Response.json(upcomingFeed(await programCandidates(db, await getExternalEvents().catch(() => []), now), now, url.origin), { headers: { "cache-control": "public, max-age=300" } });
    }
    // An event's poster is drawn in the browser (src/event-poster.ts); a canvas may only export a photo from its own address,
    // so the membership system's event photos are passed through here - from that one host only.
    if (request.method === "GET" && url.pathname === "/api/poster-image") return posterImage(url.searchParams.get("src"));
    // An event from the membership system's calendar, on its own page (event-detail.ts).
    const detailMatch = /^\/api\/events\/external\/([0-9a-f]{24})$/.exec(url.pathname);
    if (request.method === "GET" && detailMatch) {
      const detail = await eventDetail(detailMatch[1]!).catch(() => null);
      return detail ? Response.json(detail, { headers: { "cache-control": "public, max-age=300" } }) : Response.json({ error: "not_found" }, { status: 404 });
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
    const deps = { fetcher: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), now: () => Date.now() };
    // The test site (wrangler.jsonc env "test") runs only the platform's own jobs: no Saga, no team mail, no Telegram.
    if (env.ENVIRONMENT === "test") {
      await app.scheduled(controller, env).catch(error => console.warn("app_scheduled_failed", error instanceof Error ? error.message : error));
      return;
    }
    // team@ in a run of its own (saga.ts isMailRun): a mailbox that stops the run can no longer take Saga's other jobs with it.
    if (isMailRun(controller.scheduledTime)) {
      await runTeamMailRound(env as SagaEnv, deps).catch(error => console.warn("saga_team_mail_failed", error instanceof Error ? error.message : error));
      return;
    }
    await app.scheduled(controller, env).catch(error => console.warn("app_scheduled_failed", error instanceof Error ? error.message : error));
    await runSagaJobs(env as SagaEnv, deps, { mail: false })
      .catch(error => console.warn("saga_jobs_failed", error instanceof Error ? error.message : error));
    await runEventSync(env as SagaEnv, { fetcher: (input, init) => fetch(input, init), now: () => Date.now() })
      .catch(error => console.warn("house_events_failed", error instanceof Error ? error.message : error));
    // Requested: "this is how the newsletter should be designed and compiled each month, sent out on the first" (newsletter.ts).
    await runNewsletterJob(env as NewsletterEnv, deps).catch(error => console.warn("newsletter_failed", error instanceof Error ? error.message : error));
    const db = (env as StatsEnv).DB;
    if (db) await pruneVisits(db, Date.now()).catch(error => console.warn("site_visits_prune_failed", error instanceof Error ? error.message : error));
  }
};
