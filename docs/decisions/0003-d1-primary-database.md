# ADR 0003: Cloudflare D1 as the initial Hjerterum primary database

## Status

Accepted for the target migration architecture.

## Context

The validated legacy production baseline is very small and uses only conventional relational features: nine business tables, fewer than 250 current business rows, ordinary primary/foreign keys, unique constraints and simple status/date queries. No Postgres extensions, triggers, views or database-specific functions are required by the product.

Hjerterum's target architecture is already Cloudflare Workers/Vite, and the operating goal is low cost, low platform complexity and no Replit dependency.

Cloudflare D1 provides managed SQLite semantics, enforced foreign keys, atomic batch transactions, versioned SQL migrations and scale-to-zero billing. The target application does not need a dedicated always-on Postgres service at its present scale.

## Decision

Use Cloudflare D1 as the initial primary transactional database for the new Hjerterum platform.

Keep all domain/business rules provider-neutral. D1-specific SQL and bindings live in the infrastructure/migration layer so the database can later be replaced without rewriting product logic.

Historical Tribes applicant data is not part of the active product schema. It must be retained separately under restricted access according to the eventual retention decision; it must not be copied into normal active-member/event tables.

## Required safeguards

- Preserve legacy integer IDs during import.
- Normalize legacy timestamps to one canonical UTC representation during migration.
- Enforce attendee uniqueness at database level.
- Use atomic database batches/conditional writes for capacity-sensitive booking flows.
- Add explicit webhook-event idempotency storage.
- Add explicit scheduled-job/charge claim idempotency storage.
- Store migration/reconciliation state separately from payment-provider mutations.
- Keep Stripe/Clerk/provider identifiers as opaque strings and preserve them unchanged.
- Do not automatically create missing Stripe invoice items during data import.

## Consequences

Hjerterum can operate without a separate database hosting bill or database network hop. The migration requires a deliberate Postgres-to-SQLite data transformation, especially for timestamps and numeric values. If future workload or transactional requirements materially outgrow D1, the provider-neutral repository/domain interfaces allow migration to Postgres through an adapter rather than a product rewrite.
