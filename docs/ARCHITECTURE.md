# Target architecture

## Goal

Hjerterum must be portable, inexpensive to operate, easy to continue developing and not depend on a specific coding agent or hosting provider.

## Boundaries

### Web
Public website, member portal and admin UI. The web app talks only to the Hjerterum API and does not contain provider-specific database/payment/storage logic.

### API
Cloudflare Worker used for routing, authentication boundary, caching, edge logic and orchestration. Business rules stay in the core package.

### Core
Provider-independent domain model and use-case contracts for members, events, room bookings, payments, profiles and entitlements.

### Adapters
Concrete providers are isolated behind adapters. Expected adapter families include database, object storage, email, payments, identity and CIRKLER entitlement lookup.

## Data strategy

Transactional data should use a relational database with explicit migrations. The application must not depend directly on vendor SDK types outside adapter packages. File assets should use object storage through a storage interface. Cloudflare R2 is the preferred initial file-storage target unless migration evidence shows a better reason not to use it.

## Environments

- local
- staging
- production

Production data must never be used as a casual development database. Environment-specific configuration is injected at runtime and is not committed as secrets.

## Release rule

A deploy may only proceed when:

1. The intended change is present on GitHub `main`.
2. TypeScript/type checks pass.
3. Relevant automated tests pass.
4. Production build succeeds.
5. Staging/runtime smoke checks pass for changed flows.
6. The deployed production revision is traceable back to the verified GitHub commit.

## Product boundaries

CIRKLER remains separate. Hjerterum may grant or display CIRKLER access for eligible members, but membership matching is an integration contract rather than shared application code.

The old Tribes feature is not part of the target product and must not be rebuilt. Legacy Tribes URLs/data are handled only as migration/redirect concerns.
