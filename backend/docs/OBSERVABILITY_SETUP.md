# Observability Setup — Distributed Tracing

Tracing is fully wired end-to-end and, as of this change, genuinely verifiable in local dev:
`docker compose up` starts an OTel Collector + Jaeger alongside the app, and every request through
the backend produces a trace visible at **http://localhost:16686**.

Every setting below is an environment variable — pointing this at a different backend (a self-hosted
collector, or any hosted vendor) is **always a config change, never a code change**.

## How it fits together

```
backend (Micrometer Tracing + OTel bridge)
   │  OTLP/HTTP, see OTLP_TRACING_ENDPOINT
   ▼
OTel Collector  ── local dev: otel-collector-config.yaml, forwards to Jaeger
   │                real deployment: point straight at your vendor instead, or
   │                run your own collector with your own routing/sampling rules
   ▼
Jaeger / Tempo / Honeycomb / Datadog / New Relic / ...
```

You can also skip the collector entirely and point `OTLP_TRACING_ENDPOINT` straight at a vendor's
OTLP ingest URL — the collector in `docker-compose.yml` exists for local-dev convenience (a UI you can
open immediately) and as an example of a self-hosted pipeline, not because one is required.

## Config reference

| Env var | Purpose | Default |
|---|---|---|
| `APPLICATION_NAME` | Service name attached to every trace/metric | `prowosma-backend` |
| `DEPLOYMENT_ENV` | Environment tag (dev/staging/prod) on every metric | `development` |
| `OTLP_TRACING_ENDPOINT` | Where spans are sent (OTLP/HTTP) | `http://localhost:4318/v1/traces` |
| `OTLP_TRACING_TIMEOUT` | Export timeout | `10s` |
| `OTLP_TRACING_COMPRESSION` | `gzip` or `none` | `gzip` |
| `OTEL_TRACING_SAMPLING_PROBABILITY` | Fraction of requests traced (`1.0` = all) | `1.0` |
| `OTLP_TRACING_AUTH_HEADER` | `Header-Name=value` — only needed for vendors requiring an API key/token header | *(blank)* |

## Recipes

### Self-hosted Jaeger / Tempo / your own OTel Collector

```bash
OTLP_TRACING_ENDPOINT=https://your-collector.internal:4318/v1/traces
```
No auth header needed for most self-hosted setups behind your own network boundary.

### Honeycomb

```bash
OTLP_TRACING_ENDPOINT=https://api.honeycomb.io/v1/traces
OTLP_TRACING_AUTH_HEADER=x-honeycomb-team=YOUR_API_KEY
```

### Grafana Cloud Tempo

```bash
OTLP_TRACING_ENDPOINT=https://tempo-prod-xx.grafana.net/tempo/api/push
OTLP_TRACING_AUTH_HEADER=Authorization=Basic <base64 of instance-id:api-token>
```

### Datadog (OTLP ingest)

```bash
OTLP_TRACING_ENDPOINT=https://otlp.datadoghq.com/v1/traces
OTLP_TRACING_AUTH_HEADER=dd-api-key=YOUR_DATADOG_API_KEY
```

### New Relic

```bash
OTLP_TRACING_ENDPOINT=https://otlp.nr-data.net:4318/v1/traces
OTLP_TRACING_AUTH_HEADER=api-key=YOUR_NEW_RELIC_LICENSE_KEY
```

> Double-check each vendor's current OTLP endpoint URL and required header name in their own docs
> before going live — vendors do change these occasionally, and this list is a starting point, not a
> guarantee of correctness at the moment you read it.

## Reducing sampling before real production traffic

`OTEL_TRACING_SAMPLING_PROBABILITY=1.0` traces every request — fine for dev and for verifying the
pipeline, expensive against most paid trace backends at real production volume. Set it to something
like `0.1` (10%) once traffic is real, or implement head/tail-based sampling in your own collector
config for more control (see `otel-collector-config.yaml` as a starting point).

## Metrics vs. traces

Prometheus metrics (`/actuator/prometheus`) are separate from tracing and were already fully working
before this change — this document only covers the tracing pipeline. Both are tagged with the same
`application` / `region` / `environment` values (`management.metrics.tags.*` in
`application.properties`) so dashboards and traces can be correlated by those tags.

## Alerting

`docker compose up` now also starts a real local Prometheus + Alertmanager + Grafana stack (previously
`/actuator/prometheus` existed but nothing scraped or alerted on it):

- Prometheus UI: `http://localhost:9091`
- Alertmanager UI: `http://localhost:9095`
- Grafana: `http://localhost:3001` (default `admin`/`admin`, change on first login)

See `observability/alert-rules.yml` for the actual rules and `docs/SLO.md` for the reasoning behind
each threshold, and `docs/RUNBOOKS.md` for what to actually do when each one fires.

**Paging**: `observability/alertmanager.yml` routes `severity: critical` alerts to PagerDuty — replace
the placeholder routing key in that file before it should page anyone for real (Alertmanager's config
format doesn't support runtime environment-variable substitution, so this is a direct file edit for a
real deployment, not an env var — see that file's own header comment for why).

### Starting-point Grafana queries

No dashboards are pre-provisioned (would need real traffic data to design meaningfully) — these are
the same metrics `alert-rules.yml` already uses, as a starting point for building one:

- Request rate: `sum(rate(http_server_requests_seconds_count[5m])) by (uri)`
- Error rate: `sum(rate(http_server_requests_seconds_count{outcome="SERVER_ERROR"}[5m])) / sum(rate(http_server_requests_seconds_count[5m]))`
- p50/p95/p99 latency: `histogram_quantile(0.50|0.95|0.99, sum(rate(http_server_requests_seconds_bucket[5m])) by (le))`
- JVM heap usage: `jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}`
- Email suppressions over time: `sum(rate(email_suppression_added_total[1h])) by (reason)`
- File upload outcomes: `sum(rate(file_upload_success_total[1h])) by (backend)` vs. `sum(rate(file_upload_blocked_total[1h])) by (reason)`
