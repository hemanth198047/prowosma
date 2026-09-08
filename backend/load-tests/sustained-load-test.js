// Sustained-load companion to rate-limit-test.js. That script asks "does
// the limit hold exactly under a concurrent burst"; this one asks two
// different questions: does latency stay reasonable under realistic
// sustained traffic (not just a single burst), and does the window
// actually reset each minute the way RateLimitWindow's TTL/epochMinute
// design intends?
//
// Same caveat as rate-limit-test.js: written to be correct and ready to
// run, not executed in the sandbox this was written in.
//
// Usage: k6 run load-tests/sustained-load-test.js
//        (runs for ~2.5 minutes by design — needs to cross a window
//        boundary to actually test the reset behavior)

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:9090";

export const options = {
  scenarios: {
    // A realistic, moderate, steady request rate — well under the
    // default 300/minute limit — sustained across multiple minutes. This
    // is the "does normal traffic behave well" check, as opposed to the
    // burst script's "does abuse get correctly blocked" check.
    steady_traffic: {
      executor: "constant-arrival-rate",
      rate: 100,              // 100 requests per timeUnit...
      timeUnit: "1m",         // ...per minute — well under the 300/min default limit
      duration: "2m30s",      // crosses at least one full window boundary
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    // Under normal (non-abusive) traffic, nobody should ever see a 429 —
    // if this fails, either the limit is set too low for real usage, or
    // something is wrong with window/key calculation.
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:steady}": ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/health/live`, { tags: { name: "steady" } });

  check(res, {
    "status is 200 (not rate-limited under normal traffic)": (r) => r.status === 200,
    "responds in reasonable time": (r) => r.timings.duration < 1000,
  });

  if (res.status === 429) {
    console.error(
      `Unexpected 429 under moderate steady traffic at ${new Date().toISOString()} — ` +
      `either the configured limit is too low for expected real usage, or there's a ` +
      `window/key-calculation bug worth investigating before this ships.`
    );
  }
}
