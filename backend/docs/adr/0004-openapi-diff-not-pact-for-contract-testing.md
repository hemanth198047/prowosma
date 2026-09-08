# ADR 0004: OpenAPI breaking-change detection instead of full Pact-style contract testing

## Status
Accepted (revisit if the gap this doesn't cover becomes a real recurring problem)

## Context
No contract testing existed between frontend and backend. Two paths: (1) full consumer-driven contract
testing (Pact) — frontend tests record real contracts, backend replays and verifies them; (2) generate
the real OpenAPI spec from each side of a PR and diff for breaking changes.

## Decision
Option 2 — see `docs/API_CONTRACT.md` for the full comparison.

## Consequences
- **Positive**: far smaller footprint — no Pact Broker to run, no consumer-test instrumentation needed
  in the frontend's existing test suite, works from an artifact (the OpenAPI spec) both repos already
  produce.
- **Positive**: catches the most common and most damaging failure mode (removed/changed
  endpoints and fields) directly in CI on every PR.
- **Negative**: does NOT catch behavior drift that doesn't show up in the schema (a field that's still
  technically optional but the frontend has started assuming is always present). This is a real,
  accepted gap, not an oversight — `docs/API_CONTRACT.md` documents the adoption path to Pact if this
  gap causes real incidents later.
