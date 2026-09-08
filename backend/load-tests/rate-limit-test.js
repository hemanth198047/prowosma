// Load test for RateLimitFilter — the specific, falsifiable question this
// answers: under real concurrent load, does the limit hold EXACTLY, or
// does a race condition let more requests through than it should?
//
// This exists because "the code looks correct" and "verified under real
// load" are different claims — RateLimitFilter uses MongoDB's atomic
// findAndModify ($inc + upsert), which should make lost-increment races
// impossible even under heavy concurrency. This script is what actually
// tests that claim against a real running instance, rather than trusting
// the code review alone.
//
// Could not be run in the sandbox this was written in — no way to boot
// the Spring Boot app there (see the containerization item in this same
// backlog for why). Written to be correct and ready to run against a
// real instance, not executed and confirmed passing.
//
// Usage:
//   1. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
//   2. Start the backend (docker compose up, or ./gradlew bootRun)
//   3. k6 run load-tests/rate-limit-test.js
//      (override the target with: k6 run -e BASE_URL=http://your-host:9090 load-tests/rate-limit-test.js)

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:9090";
const LIMIT = parseInt(__ENV.EXPECTED_LIMIT || "300"); // matches app.rate-limit.requests-per-minute default

const accepted = new Counter("rate_limit_accepted");
const rejected = new Counter("rate_limit_rejected");

export const options = {
  scenarios: {
    // Fires far more requests than the limit, as fast as possible, in a
    // single burst — this is the scenario that would expose a race
    // condition if one existed (many concurrent writers hitting the same
    // MongoDB document at once). Uses a shared IP identity (no auth
    // header) so every virtual user counts against the SAME rate-limit
    // window, which is the point: testing one limit's correctness under
    // concurrency, not many separate limits in parallel.
    burst_past_the_limit: {
      executor: "shared-iterations",
      vus: 50,                       // 50 concurrent virtual users
      iterations: LIMIT + 100,       // deliberately more than the limit
      maxDuration: "30s",
    },
  },
  thresholds: {
    // The real pass/fail signal for this test: exactly LIMIT requests
    // should succeed, no more. Some slack (±2) is allowed only for
    // window-boundary timing (a request landing right at the minute
    // rollover) — anything beyond that means the limit didn't hold.
    rate_limit_accepted: [`count<=${LIMIT + 2}`],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/health/live`, {
    // No X-Forwarded-For set — k6's virtual users all originate from this
    // one machine, so they naturally share one IP-based rate-limit key,
    // which is exactly the concurrency scenario being tested.
    tags: { name: "rate_limit_burst" },
  });

  if (res.status === 429) {
    rejected.add(1);
    check(res, {
      "429 has correct content-type": (r) => r.headers["Content-Type"] === "application/json",
      "429 body has error field": (r) => JSON.parse(r.body).error === "Too many requests",
    });
  } else if (res.status === 200) {
    accepted.add(1);
    check(res, {
      "200 has rate limit headers": (r) =>
        r.headers["X-Ratelimit-Limit"] !== undefined &&
        r.headers["X-Ratelimit-Remaining"] !== undefined,
    });
  } else {
    console.error(`Unexpected status ${res.status} — investigate before trusting any other result here`);
  }
}

export function handleSummary(data) {
  const acceptedCount = data.metrics.rate_limit_accepted ? data.metrics.rate_limit_accepted.values.count : 0;
  const rejectedCount = data.metrics.rate_limit_rejected ? data.metrics.rate_limit_rejected.values.count : 0;

  console.log("");
  console.log("═══ Rate Limit Correctness Result ═══");
  console.log(`Accepted: ${acceptedCount}  (expected: exactly ${LIMIT}, small boundary slack tolerated)`);
  console.log(`Rejected: ${rejectedCount}`);
  console.log(
    acceptedCount > LIMIT + 2
      ? "❌ FAIL — more requests got through than the configured limit. This means the atomic " +
        "findAndModify is NOT preventing lost increments under this load, or maxRequestsPerMinute " +
        "doesn't match what was passed as EXPECTED_LIMIT — check both before assuming a real bug."
      : "✅ PASS — the limit held under concurrent load."
  );

  return { stdout: "" }; // suppress k6's default JSON summary dump; the console.log above is the real output
}
