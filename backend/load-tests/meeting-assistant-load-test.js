// Meeting Assistant API under moderate load: the everyday read paths (capabilities, list, validate-url) plus a low-rate write path that
// registers a meeting and uploads a transcript — without AI configured the transcript step is storage + parsing only, which is what we
// want to measure here (the AI work happens in background jobs, not in requests).
//
// Written to be correct k6 and ready to run; NOT executed from the sandbox this was written in. Run it against a staging stack:
//   k6 run -e BASE_URL=https://staging.example.com -e TOKEN=<jwt> -e WORKSPACE=<workspaceId> load-tests/meeting-assistant-load-test.js
// The user behind TOKEN must be an admin/member of WORKSPACE, and Google Meet must be ENABLED for that workspace (Integrations → Meeting Platforms).

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:9090";
const TOKEN = __ENV.TOKEN;
const WORKSPACE = __ENV.WORKSPACE;
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, "X-Workspace-Id": WORKSPACE };

const listTrend = new Trend("ma_list_sessions_duration");
const uploadTrend = new Trend("ma_upload_transcript_duration");
const bigTranscript = Array.from({ length: 4000 }, (_, i) => `${i % 2 ? "Tom Becker" : "Priya Nair"}: point number ${i} about the roadmap and the budget details`).join("\n");

export const options = {
  scenarios: {
    readers: { executor: "constant-vus", vus: 10, duration: "2m", exec: "reader" },
    writers: { executor: "constant-arrival-rate", rate: 1, timeUnit: "5s", duration: "2m", preAllocatedVUs: 5, exec: "writer" },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    ma_list_sessions_duration: ["p(95)<600"],
    ma_upload_transcript_duration: ["p(95)<3000"],   // a ~4,000-line transcript parsed and stored
  },
};

export function setup() {
  if (!TOKEN || !WORKSPACE) throw new Error("Set -e TOKEN=... and -e WORKSPACE=...");
}

export function reader() {
  check(http.get(`${BASE_URL}/api/meeting-assistant/capabilities`, { headers }), { "capabilities 200": (r) => r.status === 200 });
  const list = http.get(`${BASE_URL}/api/meeting-assistant/sessions`, { headers });
  listTrend.add(list.timings.duration);
  check(list, { "list 200": (r) => r.status === 200 });
  check(http.post(`${BASE_URL}/api/meeting-assistant/validate-url`, JSON.stringify({ url: "https://meet.google.com/abc-defg-hij" }), { headers }), { "validate 200": (r) => r.status === 200 });
  sleep(1);
}

export function writer() {
  const L = "abcdefghijklmnopqrstuvwxyz";
  const rnd = (n) => Array.from({ length: n }, () => L[Math.floor(Math.random() * 26)]).join("");
  const url = `https://meet.google.com/${rnd(3)}-${rnd(4)}-${rnd(3)}`;           // abc-defg-hij shape
  const created = http.post(`${BASE_URL}/api/meeting-assistant/sessions`, JSON.stringify({ meetingUrl: url, title: "k6 load test" }), { headers });
  if (!check(created, { "session created (201) or already registered (409)": (r) => r.status === 201 || r.status === 409 })) return;
  if (created.status !== 201) return;
  const id = created.json("id");
  const up = http.post(`${BASE_URL}/api/meeting-assistant/sessions/${id}/transcript`, JSON.stringify({ content: bigTranscript, format: "TEXT" }), { headers });
  uploadTrend.add(up.timings.duration);
  check(up, { "transcript accepted": (r) => r.status === 200 });
  http.post(`${BASE_URL}/api/meeting-assistant/sessions/${id}/cancel`, "{}", { headers });   // tidy up so the run is repeatable
}
