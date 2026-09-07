# Hjerterum

This repository is the source of truth for Hjerterum's website, member platform, event system, booking flows, architecture, migrations and deployment configuration.

## Operating principles

- `main` is the release source of truth.
- Replit is not a development or production dependency.
- Cloudflare is the initial web/API/edge/static-asset backbone, while domain code remains provider-neutral.
- Provider-specific services live behind adapters.
- Staging and production are separate environments.
- A change is not done because it is committed. Before deployment, typecheck, relevant tests, production build and runtime verification must pass.
- CIRKLER is a separate product/organisation. Hjerterum may integrate with it through a narrow entitlement adapter, but CIRKLER domain logic does not live in this repository.

## Repository layout

- `apps/web` — unified React/Vite application and Cloudflare Worker API. Static pages/assets and `/api/*` ship as one deployment.
- `packages/core` — provider-independent domain types, policies and application contracts.
- `docs` — architecture, migration plan, legacy inventory and decision log.
- `.github/workflows` — CI, preview smoke tests and controlled staging deployment.

## Environments

- local — development only
- temporary preview — isolated Cloudflare runtime verification without touching production
- staging — permanent pre-production environment, deployed only with account-scoped Cloudflare credentials
- production — no automatic deployment during migration

## Migration status

The portable platform foundation is established and verified in CI. The legacy Hjerterum application has not yet been imported because the connected Replit account does not expose it. Legacy content, data and functions will be migrated deliberately rather than copied 1:1. The existing public site must remain untouched until staging acceptance and cutover are complete.
