# Target architecture

## Goal

Hjerterum must be portable, inexpensive to operate, easy to continue developing and not depend on a specific coding agent or hosting provider.

## Deployment shape

The initial Cloudflare deployment is a single React/Vite application with a Worker API and static assets in the same deployable unit. Browser navigation and assets stay same-origin with the API, reducing operational surface and avoiding an unnecessary CORS boundary.

This is an operational packaging choice, not a domain coupling decision. Business rules remain in provider-neutral packages and provider-specific infrastructure stays behind adapters.

## Boundaries

### Platform app

`apps/web` contains the public website, member/admin frontend and the thin Cloudflare Worker transport layer. Requests under `/api/*` execute Worker code first. Static assets and SPA navigation are served through Workers Static Assets.

### Core

`packages/core` contains provider-independent domain models and use-case contracts for members, events, room bookings, payments, profiles and entitlements. Cloudflare, payment-provider and database SDK types must not leak into this package.

### Adapters

Concrete providers are isolated behind adapters. Expected adapter families include database, object storage, email, payments, identity and CIRKLER entitlement lookup.

## Data strategy

Transactional data should use a relational database with explicit migrations. The application must not depend directly on vendor SDK types outside adapter packages. File assets should use object storage through a storage interface. Cloudflare R2 is the preferred initial file-storage target unless migration evidence shows a better reason not to use it.

## Environments

- local
- temporary preview
- staging
- production

Temporary previews are disposable runtime-verification environments and never contain production secrets or production data. Production data must never be used as a casual development database. Environment-specific configuration is injected at runtime and is not committed as secrets.

## Release rule

A deploy may only proceed when:

1. The intended change is present on GitHub `main`.
2. TypeScript/type checks pass.
3. Relevant automated tests pass.
4. Production build succeeds.
5. Staging/runtime smoke checks pass for changed flows.
6. The deployed production revision is traceable back to the verified GitHub commit.

Production deployment remains intentionally non-automatic during migration.

## Product boundaries

CIRKLER remains separate. Hjerterum may grant or display CIRKLER access for eligible members, but membership matching is an integration contract rather than shared application code.

The old Tribes feature is not part of the target product and must not be rebuilt. Legacy Tribes URLs/data are handled only as migration/redirect concerns.
