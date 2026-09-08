// Broader performance budget than rate-limit-test.js / sustained-load-test.js
// (both of which only exercise one health endpoint). This one walks a real
// user workflow — register, login, list projects, create a task, list
// tasks — under moderate concurrent load, and asserts a latency budget per
// step. This is the "performance regression gate" piece that was
// previously entirely missing: these scripts existed but were never run,
// wired into CI, or given pass/fail thresholds beyond the rate-limit ones.
//
// Same caveat as the other two scripts in this directory: written to be
// correct k6 (1.3.0 syntax) and ready to run, not executed against a real
// instance from the sandbox this was written in — see
// .github/workflows/load-test.yml, which DOES run this for real in CI
// against a real docker-compose-started backend, closing that gap.
//
// Usage:
//   k6 run load-tests/api-workflow-load-test.js
//   k6 run -e BASE_URL=http://your-host:9090 load-tests/api-workflow-load-test.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:9090";

const registerTrend = new Trend("workflow_register_duration");
const loginTrend = new Trend("workflow_login_duration");
const listProjectsTrend = new Trend("workflow_list_projects_duration");
const createTaskTrend = new Trend("workflow_create_task_duration");
const listTasksTrend = new Trend("workflow_list_tasks_duration");

export const options = {
  scenarios: {
    realistic_workflow: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 20 },  // ramp up
        { duration: "40s", target: 20 },  // hold
        { duration: "10s", target: 0 },   // ramp down
      ],
    },
  },
  thresholds: {
    // Per-step latency budgets — the actual regression gate. If a change
    // makes task creation meaningfully slower, this fails CI instead of
    // being noticed only once it's already in production.
    workflow_register_duration: ["p(95)<800"],
    workflow_login_duration: ["p(95)<400"],
    workflow_list_projects_duration: ["p(95)<400"],
    workflow_create_task_duration: ["p(95)<500"],
    workflow_list_tasks_duration: ["p(95)<400"],
    http_req_failed: ["rate<0.02"], // allow a small margin for the intentional rate-limit test running in parallel
  },
};

export default function () {
  // Each VU iteration is a distinct user — registration must use a unique
  // email or every iteration after the first would just fail with a
  // "duplicate email" error rather than exercising the real workflow.
  const uniqueId = `${__VU}-${__ITER}-${Date.now()}`;
  const email = `loadtest-${uniqueId}@example.com`;
  const password = "LoadTest123!";

  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ name: `Load Test ${uniqueId}`, email, password }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "register" } }
  );
  registerTrend.add(registerRes.timings.duration);
  const registered = check(registerRes, {
    "register: 200": (r) => r.status === 200,
    "register: has token": (r) => {
      try { return JSON.parse(r.body).token !== undefined; } catch { return false; }
    },
  });
  if (!registered) return; // no point continuing this iteration without a token

  const token = JSON.parse(registerRes.body).token;
  const authHeaders = { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };

  sleep(0.2);

  // Login separately too — a distinct, real code path (password verification,
  // not just JWT issuance), and one users hit far more often than register.
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "login" } }
  );
  loginTrend.add(loginRes.timings.duration);
  check(loginRes, { "login: 200": (r) => r.status === 200 });

  sleep(0.2);

  const projectsRes = http.get(`${BASE_URL}/api/projects`, { ...authHeaders, tags: { name: "list_projects" } });
  listProjectsTrend.add(projectsRes.timings.duration);
  check(projectsRes, { "list projects: 200": (r) => r.status === 200 });

  sleep(0.2);

  const createTaskRes = http.post(
    `${BASE_URL}/api/tasks`,
    JSON.stringify({ title: `Load test task ${uniqueId}`, status: "TODO", priority: "MEDIUM" }),
    { ...authHeaders, tags: { name: "create_task" } }
  );
  createTaskTrend.add(createTaskRes.timings.duration);
  check(createTaskRes, { "create task: 200": (r) => r.status === 200 });

  sleep(0.2);

  const listTasksRes = http.get(`${BASE_URL}/api/tasks`, { ...authHeaders, tags: { name: "list_tasks" } });
  listTasksTrend.add(listTasksRes.timings.duration);
  check(listTasksRes, { "list tasks: 200": (r) => r.status === 200 });

  sleep(0.5);
}

export function handleSummary(data) {
  const p95 = (metric) => data.metrics[metric] ? data.metrics[metric].values["p(95)"].toFixed(1) : "n/a";
  console.log("");
  console.log("═══ API Workflow Performance Budget ═══");
  console.log(`register       p95: ${p95("workflow_register_duration")}ms  (budget: 800ms)`);
  console.log(`login          p95: ${p95("workflow_login_duration")}ms  (budget: 400ms)`);
  console.log(`list projects  p95: ${p95("workflow_list_projects_duration")}ms  (budget: 400ms)`);
  console.log(`create task    p95: ${p95("workflow_create_task_duration")}ms  (budget: 500ms)`);
  console.log(`list tasks     p95: ${p95("workflow_list_tasks_duration")}ms  (budget: 400ms)`);
  return {
    stdout: "",
    "load-test-results/api-workflow-summary.json": JSON.stringify(data, null, 2),
  };
}
