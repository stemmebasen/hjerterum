# holistisk.org: a separate event portal in this repository

Status: Accepted — 2026-10-11

## Context

Hjerterum moves to hjerterum.info. holistisk.org (which today serves Hjerterum) becomes a portal that collects holistic events from many organisers, starting in Østjylland and later covering Denmark. The two products must not be mixed: the portal must not touch Hjerterum's members, logins, payments, bookings, data or deployment.

## Decision

The portal is its own workspace app, `apps/holistisk`, in this repository:

- **Own Worker, own data, own schedule.** `holistisk-portal-staging` (workers.dev only, no routes or custom domains), its own D1 database `holistisk-portal-staging` with its own migrations (`apps/holistisk/migrations`), and its own cron. It has no Hjerterum bindings or secrets, and it imports nothing from `apps/web` or `packages/core`.
- **Own deployment.** `.github/workflows/holistisk-staging.yml` deploys only the portal, under its own concurrency group. Hjerterum's workflows are unchanged.
- **Same tools and conventions.** pnpm workspace, TypeScript, Vitest, Wrangler and D1, as Hjerterum uses them; Danish wall-clock time stored as UTC epoch milliseconds and money in minor units (ADR 0003's time and money contracts).
- **Server-rendered HTML, no client framework.** Event pages must be indexable and the filters must work without JavaScript. The Worker renders HTML; one small script adds conveniences (submit on change, "near me").
- **Hjerterum is a source, read like any other.** The portal reads Hjerterum's public MembershipWorks calendar over HTTP. It never reads Hjerterum's database.

A new repository was considered and rejected: it would duplicate the toolchain, CI and Cloudflare credentials for no isolation gain, since the runtime, data and deployment are already separate.

## Consequences

- One CI run checks both products; a failing portal test fails `pnpm test` for the repository, so the portal's tests must stay green.
- Moving holistisk.org from Hjerterum to the portal is a separate, explicitly approved step (docs/holistisk/LAUNCH.md).
- The portal can later get organiser profiles, partnerships and member benefits (`organizers` table) without touching Hjerterum.
