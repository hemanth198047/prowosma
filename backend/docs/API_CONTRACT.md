# API Contract Testing

## What this is

`.github/workflows/api-contract-check.yml` generates the real OpenAPI spec from the running backend
(both the PR branch's version and `main`'s version), lints it for structural correctness, and diffs
the two to flag breaking changes (removed endpoints, newly-required fields, changed response types) —
directly as a PR check, before the change merges.

## What this deliberately is NOT

**Full consumer-driven contract testing (e.g. Pact).** A Pact-based setup would have the frontend
record what it *actually* calls and expects in its own tests ("consumer" contracts), and verify the
backend against those exact recorded expectations ("provider verification") — catching drift even in
parts of the API surface an OpenAPI diff wouldn't flag as a "breaking change" by spec alone (e.g. a
field that's still present and still optional, but the frontend silently started relying on it always
being non-null).

This wasn't implemented here because adopting Pact properly means:
1. Instrumenting the frontend's API client tests to record real Pact contracts (not just mocking axios
   responses, as the existing frontend tests do).
2. Standing up a Pact Broker (or using PactFlow) to publish and share contracts between the two repos'
   separate CI pipelines.
3. Backend provider-verification tests that replay every recorded consumer interaction against a real
   running backend.

That's a genuine, valuable adoption project — but a bigger one than fits alongside everything else in
this backlog, and importantly, **the OpenAPI-diff approach implemented here already covers the most
common and most damaging failure mode** (an endpoint or field silently disappearing or changing shape)
with a much smaller footprint: no new schema-recording infrastructure, no broker to run, and it works
from artifacts (the OpenAPI spec) both repos can already produce independently.

## Adopting Pact later, if wanted

If the OpenAPI-diff approach proves insufficient (e.g. repeated incidents where the frontend and
backend agreed on the spec but disagreed on real behavior), the natural next step:

1. Add `@pact-foundation/pact` to the frontend, write consumer tests for the highest-risk API
   interactions (auth, task/project CRUD) that record real contracts instead of hand-written mocks.
2. Stand up a Pact Broker (self-hosted via Docker, or PactFlow's hosted free tier for small teams).
3. Add a provider-verification test suite to the backend (`pact-jvm-provider`) that replays every
   published consumer contract against a real running instance.
4. Gate deployment on Pact's "can-i-deploy" check, which is aware of which contract versions are
   actually compatible with what's currently deployed — a capability the current OpenAPI-diff approach
   doesn't have at all (it only compares two branches, not "what's actually live").

## What breaking-change detection actually catches today

Verified categories `oasdiff breaking` flags: removed endpoints, removed or newly-required request
fields, removed response fields client code might read, incompatible type changes, removed enum
values. It does **not** catch runtime behavior changes that don't show up in the schema itself (e.g. a
field that's still optional per the schema but the frontend has started assuming is always present) —
that class of bug is exactly what Pact's consumer-driven approach would catch and this doesn't.
