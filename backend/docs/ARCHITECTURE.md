# Architecture

## System overview

```mermaid
flowchart TB
    subgraph Client
        Browser["Browser / PWA\n(React 19 + i18next)"]
    end

    subgraph Edge["Edge (deployment-target-dependent — see docs/SCALABILITY_HA.md)"]
        CDN["CDN\n(CloudFront/Cloudflare)"]
        WAF["WAF\n(rate limiting, managed rules)"]
    end

    subgraph App["Application tier"]
        FE["Frontend\n(nginx, static build)"]
        BE1["Backend instance 1\n(Spring Boot)"]
        BE2["Backend instance 2..N\n(Spring Boot)"]
    end

    subgraph Data["Data tier"]
        Mongo[("MongoDB\nreplica set")]
        Redis[("Redis\npresence/cache")]
        MQ["RabbitMQ\nSTOMP relay"]
        S3[("S3 / MinIO\nattachments")]
    end

    subgraph Obs["Observability"]
        OTel["OTel Collector"]
        Jaeger["Jaeger"]
        Prom["Prometheus"]
        AM["Alertmanager"]
        Grafana["Grafana"]
        Sentry["Sentry\n(frontend errors)"]
    end

    subgraph Ext["External services (all opt-in)"]
        Auth0["Auth0"]
        SAML["Customer SAML IdPs"]
        Stripe["Stripe"]
        SMTP["SMTP provider\n(SES/SendGrid/Postmark)"]
        SecretsMgr["AWS Secrets Manager"]
        PagerDuty["PagerDuty"]
    end

    Browser -->|HTTPS| CDN --> WAF --> FE
    Browser -->|HTTPS API + WebSocket| WAF --> BE1
    Browser -->|Web Push| BE1

    FE -.->|"static assets\n(cache-first SW)"| Browser

    BE1 & BE2 <-->|replica set| Mongo
    BE1 & BE2 <--> Redis
    BE1 & BE2 <--> MQ
    BE1 & BE2 -->|SSE-256 encrypted| S3

    BE1 & BE2 -->|traces| OTel --> Jaeger
    BE1 & BE2 -->|metrics| Prom --> AM --> PagerDuty
    Prom --> Grafana
    Browser -->|errors| Sentry

    BE1 & BE2 -.->|opt-in| Auth0
    BE1 & BE2 -.->|opt-in, per customer| SAML
    BE1 & BE2 -.->|opt-in| Stripe
    BE1 & BE2 -.->|opt-in| SMTP
    BE1 & BE2 -.->|opt-in| SecretsMgr
```

## Request flow: authenticated API call

```mermaid
sequenceDiagram
    participant B as Browser
    participant WAF as WAF (edge)
    participant RL as RateLimitFilter
    participant WS as WorkspaceFilter
    participant Role as RoleGuardFilter
    participant Plan as PlanGuardFilter
    participant Region as DataRegionRoutingFilter
    participant C as Controller
    participant M as MongoDB

    B->>WAF: HTTPS request + JWT
    WAF->>RL: forwarded (edge rate limit already passed)
    RL->>RL: check MongoDB-backed counter (atomic)
    alt over limit
        RL-->>B: 429 Too Many Requests
    else under limit
        RL->>WS: resolve workspace from JWT/header
        WS->>Role: workspace context set
        Role->>Role: check role permits this route
        alt insufficient role
            Role-->>B: 403 Forbidden
        else authorized
            Role->>Plan: check plan permits this feature
            alt plan doesn't include feature
                Plan-->>B: 402 Payment Required
            else
                Plan->>Region: resolve workspace's data region
                Region->>C: RegionContext set for this request
                C->>M: query/write (routed if collection has adopted region routing)
                M-->>C: result
                C-->>B: 200 + response
            end
        end
    end
```

## Data residency routing (opt-in — see `docs/DATA_RESIDENCY.md`)

```mermaid
flowchart LR
    Req["Incoming request"] --> Filter["DataRegionRoutingFilter"]
    Filter -->|"looks up workspace.dataRegion\n(always from home DB)"| Home[("Home MongoDB\nWorkspace/User records")]
    Filter -->|sets| Ctx["RegionContext (ThreadLocal)"]
    Ctx --> Factory["RegionRoutingMongoDatabaseFactory"]
    Factory -->|region=US| USDB[("US MongoDB")]
    Factory -->|region=EU| EUDB[("EU MongoDB")]
    Factory -->|"region unset\nor not configured"| Home
```

## Component inventory

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19, Vite, i18next, Sentry | Served via nginx or a CDN |
| Backend | Spring Boot 4, Java 21 | 76+ controllers/services |
| Database | MongoDB (replica set) | Optional per-region routing |
| Cache/presence | Redis | WebSocket presence tracking |
| Message relay | RabbitMQ (STOMP) | Cross-instance WebSocket delivery |
| Object storage | S3-compatible | Optional — falls back to local disk |
| Tracing | OpenTelemetry → Jaeger | Or any OTLP-compatible vendor |
| Metrics/alerting | Prometheus + Alertmanager | Local stack or any Prometheus-compatible vendor |
| Dashboards | Grafana | |
| Error tracking | Sentry | Frontend only (opt-in) |
| CI/CD | GitHub Actions | Build, test, security scan, publish, deploy-ready images |

## Why these choices — see the ADRs

This document describes *what* the architecture is. For *why* specific choices were made (why
per-organization hash chaining instead of a global one, why OpenAPI-diff instead of full Pact, why
region routing is opt-in per-collection rather than a blanket change), see [`adr/`](./adr/) — each
significant decision made across this engagement has a corresponding ADR explaining the trade-offs
actually considered, not just the final answer.
