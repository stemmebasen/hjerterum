# ADR 0002: Unified Cloudflare Vite platform

Status: Accepted

## Context

The first bootstrap split the React frontend and Cloudflare API into separate workspace applications. Current Cloudflare Workers guidance supports React/Vite, Worker routes and static assets as one deployment unit.

## Decision

Use one deployable application in `apps/web`:

- React/Vite for browser UI.
- Cloudflare Worker for `/api/*`.
- Workers Static Assets for frontend assets and SPA navigation.
- Separate staging and production environment configuration.

Keep all business rules and provider contracts in `packages/core`; the unified deployable does not make Cloudflare a domain dependency.

## Consequences

- Same-origin frontend/API traffic with no unnecessary CORS boundary.
- One build and deploy pipeline instead of coordinating separate web and API releases.
- Fewer runtime components and lower operational complexity.
- Cloudflare can still be replaced because domain rules and external-service contracts remain outside the Worker transport layer.
- Production deploys remain disabled until migration acceptance.
