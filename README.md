# Hjerterum

This repository is the source of truth for Hjerterum's website, member platform, event system, booking flows, architecture, migrations and deployment configuration.

## Operating principles

- `main` is the release source of truth.
- Replit is not a development or production dependency.
- Cloudflare is the shared web/API/edge/storage backbone where technically appropriate.
- Provider-specific services live behind adapters.
- Staging and production are separate environments.
- A change is not done because it is committed. Before deployment, typecheck, relevant tests, production build and runtime verification must pass.
- CIRKLER is a separate product/organisation. Hjerterum may integrate with it through a narrow entitlement adapter, but CIRKLER domain logic does not live in this repository.

## Repository layout

- `apps/web` — public website and member/admin frontend
- `apps/api` — Cloudflare Worker API
- `packages/core` — provider-independent domain types and application contracts
- `docs` — architecture, migration plan and decision log
- `.github/workflows` — CI gates

## Migration status

The legacy Hjerterum application has not yet been imported. The new portable foundation is being established first, then legacy content/data/functions will be migrated deliberately rather than copied 1:1.
