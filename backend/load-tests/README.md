# Load Tests

Answers a specific question raised in this project's enterprise-readiness
review: rate limiting exists in code (`RateLimitFilter`, backed by
MongoDB's atomic `findAndModify` rather than an in-memory counter — see
that file's own comments for why that distinction matters once more than
one backend instance exists), but "the code looks correct" and "verified
under real load" are different claims. Nothing here existed before —
there was no way to actually test either claim.

**These now run in CI** — see `.github/workflows/load-test.yml`, which
starts the real `docker compose` stack, waits for it to be healthy, and
runs all three scripts below against it. k6 exits non-zero on a threshold
failure, which fails that workflow — that's the actual performance-
regression gate this backlog item was missing. Triggered on demand from
the Actions tab, and weekly on a schedule; see the workflow file for how
to also gate every PR if the team wants that tradeoff.

## What's here

- **`rate-limit-test.js`** — fires far more concurrent requests than the
  configured limit at a single shared rate-limit key, as fast as
  possible. The real question it answers: does MongoDB's atomic
  `$inc`/upsert actually prevent lost increments under real concurrency,
  or does more traffic get through than the limit allows? Pass/fail is
  explicit in the output, not something you have to interpret from raw
  metrics.
- **`sustained-load-test.js`** — a different question: does normal,
  moderate traffic (well under the limit) ever get incorrectly
  rate-limited, does latency stay reasonable, and does the per-minute
  window actually reset the way it's supposed to. Runs for ~2.5 minutes
  specifically so it crosses at least one real window boundary.
- **`api-workflow-load-test.js`** *(new)* — the actual performance-budget
  test: walks a realistic user workflow (register → login → list projects
  → create task → list tasks) under ramping concurrent load and asserts a
  p95 latency budget per step. This is the piece that turns "we have load
  test scripts" into "we have a performance regression gate," since the
  other two scripts only ever exercised a single health-check endpoint.

## Running them locally

```bash
# Install k6 once: https://grafana.com/docs/k6/latest/set-up/install-k6/

# Start the backend first (either):
docker compose up                    # from the backend repo root
# or
./gradlew bootRun

# Then, from the backend repo root:
k6 run load-tests/rate-limit-test.js
k6 run load-tests/sustained-load-test.js
k6 run load-tests/api-workflow-load-test.js

# Against a non-default target:
k6 run -e BASE_URL=http://your-host:9090 load-tests/rate-limit-test.js
```

## Honest status — what this does and doesn't prove yet

All three scripts were written and reviewed carefully — real k6 syntax,
syntax-checked with `node --check` for basic correctness — but this
change could not actually boot the full docker-compose stack (Mongo,
Redis, RabbitMQ, the Spring Boot backend itself) in the sandbox it was
written in to run them directly. **The CI workflow now does exactly
that on GitHub's runners, which do have Docker available** — so once
this change merges and the workflow runs once for real, this section can
be updated to state real, observed results instead of "should work."
Until then: treat the k6 scripts as reviewed-but-not-yet-executed, same
as everything else in this backlog with that caveat, and check the most
recent `load-test-results-*` workflow artifact for the real numbers once
available.

**Multi-instance behavior is still out of scope for what's here.** The
whole point of `RateLimitFilter`'s MongoDB-backed design is that the
limit stays correct across multiple backend instances sharing one
database, not just one process's in-memory counter — but testing that
specifically requires two real running instances behind a load balancer,
which the current `docker-compose.yml` (one backend instance) and CI
workflow don't set up. Once a real multi-instance deploy target exists:
run `rate-limit-test.js` with `BASE_URL` pointed at a load balancer in
front of 2+ instances, and the same pass/fail logic applies — if the
limit still holds exactly, the shared-database design is confirmed
working across instances, not just within one.
