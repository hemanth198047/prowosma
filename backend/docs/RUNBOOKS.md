# Incident Runbooks

Previously no runbooks existed for any incident class. Each one below corresponds directly to an alert
in `observability/alert-rules.yml` and links back here via that alert's `runbook` annotation.

## High Error Rate

**Alert**: `HighErrorRate` — 5xx rate above 2% sustained 5 minutes.

1. Check Grafana / Prometheus for which endpoints are failing (`sum by (uri) (rate(http_server_requests_seconds_count{outcome="SERVER_ERROR"}[5m]))`).
2. Check Jaeger (`http://localhost:16686` locally, or your real deployment's trace UI — see
   `docs/OBSERVABILITY_SETUP.md`) for a sample failing trace — the span that errored usually names the
   root cause directly (a downstream dependency timeout, an unhandled exception, etc.).
3. Check whether this correlates with a recent deploy — `git log` on `main` around the alert's start
   time, and the CI/CD history in `docker-publish.yml`'s workflow runs.
4. If it's a bad deploy: roll back immediately (see `docs/RELEASE_PROCESS.md`'s Rollback section) —
   don't wait for a root-cause diagnosis before mitigating.
5. If it's not a recent deploy: check dependency health — MongoDB (`docker compose logs mongodb`, or
   your replica set's own monitoring), Redis, RabbitMQ, and any configured external services (Auth0,
   Stripe, the SMTP provider) for their own status pages.

## High Latency

**Alert**: `HighLatencyP95` — p95 request latency above 1s sustained 10 minutes.

1. Check MongoDB replica lag first — the most common latency-degradation cause for a MongoDB-backed
   app under load (`rs.printSecondaryReplicationInfo()` on the primary, or your managed provider's own
   replication-lag metric).
2. Check connection pool saturation — if the app is waiting on MongoDB connections rather than MongoDB
   itself being slow, this looks like latency but is really a pool-sizing issue.
3. Check for a specific slow endpoint dominating the p95 (`histogram_quantile(0.95, sum(rate(http_server_requests_seconds_bucket[5m])) by (le, uri))`)
   — a single slow report/analytics endpoint can pull the whole p95 up even if most traffic is fine.
4. Check `HorizontalPodAutoscaler` status if running on Kubernetes (`kubectl get hpa`) — confirm
   autoscaling is actually keeping up with load, not stuck at `maxReplicas`.

## Backend Down

**Alert**: `BackendDown` — Prometheus can't scrape the backend at all.

1. Check `/actuator/health` directly — if it responds, this may be a Prometheus/network issue, not a
   real outage.
2. Check container/pod status and recent logs (`docker compose logs backend --tail 200`, or
   `kubectl logs deployment/prowosma-backend --tail 200`).
3. Check for an OOM kill (`docker inspect` for `OOMKilled: true`, or `kubectl describe pod` for the
   same) — see Memory Pressure below if so.
4. If a rolling deploy is in progress and this is expected/transient, confirm
   `k8s/backend-deployment.yaml`'s `maxUnavailable: 0` setting is actually in effect — this alert
   firing during a supposedly zero-downtime rollout means that guarantee isn't holding, which is
   itself worth investigating separately from the immediate outage.

## Rate Limit Storm

**Alert**: `RateLimitStorm` — sustained high rate of 429 responses.

1. Identify the source — `RateLimitFilter` keys by authenticated user or IP (see that class's own
   comments); check which key is generating the volume.
2. If it's a single client: this is either abuse (consider `IpAllowlistFilter` / manual blocking) or a
   misconfigured integration retrying too aggressively without backoff (reach out to that customer's
   integration if identifiable).
3. If it's broad/distributed: possible credential-stuffing or scraping attempt — check `LOGIN_FAILED`
   activity-log entries for a correlated spike (`GET /api/activity-logs?action=LOGIN_FAILED`).
4. If it's legitimate traffic growth: `RATE_LIMIT_RPM` may need raising — a genuine capacity decision,
   not just an incident to suppress.

## Email Deliverability Degradation

**Alert**: `EmailSuppressionSpike` — unusually high rate of new bounce/complaint suppressions.

1. Check `GET /api/admin/email-suppressions` for the pattern — many suppressions from one domain
   (e.g. many `@company.com` bounces) suggests that domain's mail server is rejecting this app's mail,
   not a problem with this app's list quality broadly.
2. Check the configured SMTP provider's own dashboard (SES/SendGrid/Postmark all publish
   reputation/deliverability metrics) — a spike here often correlates with a sending-domain reputation
   drop that needs the provider's own remediation steps.
3. If suppressions look wrong (e.g. valid addresses being marked as hard bounces), check
   `EmailWebhookController`'s recent raw event payloads (`EmailSuppression.rawEvent`) for a
   misclassification — see `docs/EMAIL_SETUP.md`'s "What this still doesn't cover" section for known
   gaps in the bounce/complaint classification logic.

## Malware Scanner Down

**Alert**: `FileUploadScanErrors` — ClamAV unreachable, uploads proceeding unscanned (fail-open default).

1. Check the ClamAV container/instance directly — a common cause is it still being mid-startup
   (initial virus-definition download can take several minutes on first boot, see
   `docs/FILE_STORAGE_SETUP.md`).
2. If ClamAV is confirmed down for longer than expected: decide whether to temporarily set
   `VIRUS_SCAN_FAIL_CLOSED=true` (blocks ALL uploads until scanning is restored — appropriate if
   malware scanning is a hard compliance requirement) versus leaving fail-open (appropriate if it's a
   defense-in-depth layer and blocking all uploads would be worse than the residual risk).
3. Once restored, there is no automatic backfill scan of files uploaded during the outage — see
   `docs/FILE_STORAGE_SETUP.md`'s "What this still doesn't cover" section; a manual backfill scan is a
   separate, deployment-specific task if the outage window is a real concern.

## Memory Pressure

**Alert**: `JvmMemoryPressure` — JVM heap usage above 90% sustained 10 minutes.

1. Check for a recent traffic spike or a specific endpoint loading unusually large result sets (this
   codebase's pagination defaults — see `PagedResponse` usage across controllers — should prevent most
   of this, but a raw `findAll()`-style call bypassing pagination is the classic cause if one exists).
2. Check `k8s/backend-deployment.yaml`'s memory `limits`/`requests` — if consistently near the limit
   under normal load, the limit itself may need raising, not just this specific incident's traffic.
3. If this precedes an `OOMKilled` restart, treat it as the same incident as **Backend Down** above,
   not a separate one.

## Stripe Webhook Failure

Not currently backed by its own Prometheus alert rule (a reasonable future addition — Stripe's own
dashboard already provides webhook delivery failure visibility, which is why this wasn't duplicated
into a Prometheus rule in this change).

1. Check Stripe's own Dashboard → Developers → Webhooks for delivery failure details — Stripe retries
   automatically and shows the exact failure reason (signature verification failure, 5xx from this
   app, timeout).
2. If it's a signature verification failure: confirm `STRIPE_WEBHOOK_SECRET` matches the endpoint's
   actual configured secret in the Stripe dashboard — a common cause is testing against the wrong
   Stripe environment (test vs. live) or a secret that was rotated on one side but not the other.
3. Stripe replays failed webhooks automatically for a limited window — if the underlying issue is
   fixed before that window closes, no manual replay is needed; check the Stripe dashboard's retry
   history to confirm.

## MongoDB Replica Set Failover

1. Confirm which member is now primary (`rs.status()`) — the driver should have failed over
   automatically (no code change needed, see `docs/SCALABILITY_HA.md`'s replica set section).
2. Check application logs for a burst of connection errors around the failover moment — brief errors
   during the actual failover window (typically a few seconds) are expected; sustained errors after
   that window suggests the driver isn't reconnecting properly and needs investigation.
3. Once stable, check replication lag on the new secondaries — a failover during already-degraded
   replication can leave the cluster in a fragile state worth monitoring closely for a while after.
