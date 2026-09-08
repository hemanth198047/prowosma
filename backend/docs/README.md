# Documentation Index

Every document below was written as part of turning this codebase's enterprise-readiness backlog
(16 partial/missing items) into real, working, tested code and config — not just a report. This index
is the map of everything that engagement produced, organized by concern.

## Getting oriented

| Doc | What it covers |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System diagram, component overview, data flow |
| [`adr/`](./adr/) | Architecture Decision Records — the *why* behind key choices made |
| [`CHANGELOG.md`](../CHANGELOG.md) | Everything that changed, in order, with rationale |

## Identity, access & security

| Doc | Covers |
|---|---|
| [`SSO_SETUP.md`](./SSO_SETUP.md) | Auth0 + SAML (Okta/Azure/Google/custom) — zero-code-change setup |
| [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) | Secrets management, field-level encryption, security headers, WAF/DDoS |
| [`SECURITY_TESTING.md`](./SECURITY_TESTING.md) | SAST, SCA, DAST, SBOM — the automated security pipeline |
| [`API_CONTRACT.md`](./API_CONTRACT.md) | OpenAPI breaking-change detection between frontend/backend |
| `../SECURITY.md` | Vulnerability disclosure process and response SLAs |

## Data & compliance

| Doc | Covers |
|---|---|
| [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md) | Real per-region MongoDB routing infrastructure, and its honest limits |
| [`COMPLIANCE.md`](./COMPLIANCE.md) | GDPR/CCPA self-service flows, audit-log tamper-evidence, SOC 2 control mapping |
| [`SUBPROCESSORS.md`](./SUBPROCESSORS.md) | Third-party data processor list (template — needs legal review) |
| [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) | Backup scheduling, off-site storage, restore drills, RTO/RPO |
| [`EMAIL_SETUP.md`](./EMAIL_SETUP.md) | SMTP provider setup, bounce/complaint handling, suppression list |
| [`FILE_STORAGE_SETUP.md`](./FILE_STORAGE_SETUP.md) | S3/MinIO storage backend, malware scanning |

## Operations & reliability

| Doc | Covers |
|---|---|
| [`OBSERVABILITY_SETUP.md`](./OBSERVABILITY_SETUP.md) | Distributed tracing, metrics, alerting stack |
| [`SLO.md`](./SLO.md) | Availability/latency targets tied to real metrics |
| [`RUNBOOKS.md`](./RUNBOOKS.md) | What to do when each alert fires |
| [`SCALABILITY_HA.md`](./SCALABILITY_HA.md) | MongoDB replica sets, autoscaling, CDN, multi-region |
| [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) | Versioning, deployment, rollback |
| [`TRUST.md`](./TRUST.md) | Customer-facing security/reliability summary |
| [`STATUS_PAGE.md`](./STATUS_PAGE.md) | Public status page setup (Upptime) |

## Testing & quality

| Doc | Covers |
|---|---|
| [`TESTING.md`](./TESTING.md) | Coverage gates, ratchet plan, new test suites |
| [`API.md`](./API.md) | API documentation, versioning policy |

## Frontend-specific (see `prowosma-frontend` repo's own `docs/`)

| Doc | Covers |
|---|---|
| `ACCESSIBILITY.md` | WCAG tooling, measured baseline, ratchet plan |
| `I18N.md` | i18next setup, translation adoption path |
| `TESTING.md` | Frontend coverage gates |
| `RELEASE_PROCESS.md` | Frontend-specific release notes |
| [`MOBILE_OFFLINE.md`](./MOBILE_OFFLINE.md) | PWA, push notifications, offline capability, native mobile scope |

## How to use this if you're new here

1. Start with `ARCHITECTURE.md` for the big picture.
2. Read the ADRs in `adr/` if you want the reasoning behind a specific design choice, not just what it
   is.
3. Each topic doc above is self-contained — you don't need to read them in order, just find the one
   for whatever you're working on.
4. Every doc in this list follows the same honesty convention: it states plainly what's real/verified
   versus what's a documented starting point for a decision someone else needs to make (usually: which
   cloud, which deployment target). Look for the "What this still doesn't cover" section near the
   bottom of most of them.
