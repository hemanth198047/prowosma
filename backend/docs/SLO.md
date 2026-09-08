# Service Level Objectives (SLOs)

## What changed

Previously no SLOs/SLAs or error-budget policy were defined anywhere. These are now defined, tied
directly to metrics this app already emits (`/actuator/prometheus`) and the alert rules in
`observability/alert-rules.yml` — not aspirational numbers disconnected from what's actually measured.

## Availability

**Target: 99.9% successful (non-5xx) responses, measured monthly.**

- Query: `sum(rate(http_server_requests_seconds_count{outcome!="SERVER_ERROR"}[30d])) / sum(rate(http_server_requests_seconds_count[30d]))`
- Error budget: 0.1% of monthly requests may fail = ~43 minutes of full downtime-equivalent per month,
  or a proportionally larger amount of partial degradation.
- Backed by: `HighErrorRate` alert (fires at 2% error rate sustained 5 minutes — a much tighter,
  earlier warning threshold than the monthly SLO itself, so problems are caught long before they
  threaten the monthly budget).

**Honest caveat**: this SLO is measured from the application's own perspective (Micrometer/Prometheus
running inside the same infrastructure). A true external SLO would also need synthetic monitoring from
outside the deployment (confirms DNS, load balancer, and network path are also healthy, not just the
app process) — not implemented in this change; a reasonable addition once a real deployment target and
external monitoring provider (Pingdom, UptimeRobot, Grafana Synthetic Monitoring, etc.) are chosen.

## Latency

**Target: p95 response time under 500ms, p99 under 1.5s, measured over rolling 5-minute windows.**

- Query: `histogram_quantile(0.95, sum(rate(http_server_requests_seconds_bucket[5m])) by (le))`
- Backed by: `HighLatencyP95` alert (fires at p95 > 1s sustained 10 minutes).
- **These targets are reasoned defaults, not yet validated against real production traffic** — this
  application has no production traffic history to calibrate against as of this backlog. Revisit once
  real usage data exists; a target set before any real traffic is a starting hypothesis, not a
  measured commitment.

## Error budget policy

When the monthly error budget (0.1%) is exhausted before the month ends:
1. Feature work pauses; the team's focus shifts to reliability work until the budget resets.
2. Any change with a plausible reliability risk gets extra scrutiny (canary/gradual rollout preferred
   over an immediate full deploy) until the budget has recovered some margin.
3. A retrospective is written for whatever consumed the budget, with concrete follow-up actions, not
   just a postmortem doc that gets filed away.

This policy is straightforward to state and genuinely hard to enforce without organizational buy-in —
writing it down here is necessary but not sufficient; it only works if a real team agrees to actually
follow it when the budget is tight and shipping the next feature feels urgent.

## What's NOT covered

- **No formal SLA with financial/contractual consequences** — an SLO is an internal target; an SLA is
  a customer-facing commitment with consequences (service credits, etc.) if missed. Turning this SLO
  into an SLA is a business/legal decision, not something this document can decide unilaterally — see
  `docs/COMPLIANCE.md`'s subprocessor list for the same "needs legal review" framing.
- **Per-endpoint or per-tenant SLOs** — this is a single blanket SLO across the whole API surface. A
  more mature setup might define tighter SLOs for critical paths (login, task creation) and looser ones
  for less critical ones (analytics dashboards) — a reasonable future refinement once real usage
  patterns are understood.
- **Dependency SLOs** (MongoDB, S3, Auth0, Stripe, the SMTP provider) — this app's own SLO is only as
  good as its dependencies'; each of those publishes its own SLA separately, and a full picture would
  compose them, which this document doesn't attempt.
