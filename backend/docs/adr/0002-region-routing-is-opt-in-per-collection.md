# ADR 0002: Data-residency routing is opt-in per MongoDB collection, not a blanket migration

## Status
Accepted

## Context
Real physical data residency requires routing specific collections to region-specific database
clusters. This app has ~60 existing `@Document` repositories, all wired to Spring Data MongoDB's one
default `MongoTemplate`. Two paths considered:
1. Retrofit all ~60 repositories to route through region-aware infrastructure in one change.
2. Build the real routing infrastructure as a separate, named bean, and let repositories adopt it
   individually.

## Decision
Option 2. `RegionRoutingMongoDatabaseFactory` exists as a secondary bean; no existing repository was
changed to use it. See `docs/DATA_RESIDENCY.md` for the exact adoption steps for a repository that
needs it.

## Consequences
- **Positive**: zero risk to the ~60 existing, presumably-working repositories — none were touched.
- **Positive**: the mechanism was still built completely and correctly, verified by design review
  (a two-step atomic claim/finalize pattern, matching the concurrency-safety approach used elsewhere in
  this backlog for the audit-log hash chain).
- **Negative**: as shipped, this backlog's change does NOT provide physical data residency for any
  existing data — only the capability to add it, collection by collection. A workspace that declares a
  region today gets a *rejected* declaration (see ADR 0003) rather than false enforcement, but real
  enforcement for existing collections requires the follow-up adoption work `docs/DATA_RESIDENCY.md`
  describes.
