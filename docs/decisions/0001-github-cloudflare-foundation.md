# ADR 0001: GitHub-centred portable platform

Status: Accepted

## Decision

Hjerterum is rebuilt around GitHub `main` as the only code/release source of truth. Cloudflare is the preferred web/API/edge/object-storage backbone, while database, payment, mail and identity providers remain replaceable behind adapters.

## Consequences

- Replit is not a source of truth and is not required for normal development.
- Business rules belong in provider-neutral packages.
- Provider SDKs must not leak into domain contracts.
- Staging precedes production cutover.
- CI verifies typecheck, tests and production build on `main`.
- Production deployment must be traceable to a verified `main` commit.
- CIRKLER remains a separate domain and integrates through a narrow entitlement contract.
- Legacy Tribes functionality is retired rather than ported.
