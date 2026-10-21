# Changelog

## Unreleased

- Department and project access control, phase 1 (projects, tasks, live feed): see `docs/DEPARTMENT_ACCESS.md`. Off until an admin enables it.
- Department access, documents: docs follow the workspace's sharing setting (departments, creator and shared people, or both); see `docs/DEPARTMENT_ACCESS.md`. Fix: docs list/search/recent/favourites and document creation now use the verified workspace.
- Department access, phase 2: dashboard summary, notifications, activity log, search, Gantt and the meeting assistant (incl. Fireflies) are scoped; see `docs/DEPARTMENT_ACCESS.md`.
- Fix: task subtasks, checklists, watchers, relationships, SLA and goal-link endpoints now check that the caller may see the task (adding a watcher could otherwise grant access).
- Fix: `/api/search` and the Tasks/Projects results of global search no longer return other workspaces' records.
- Fix: `PATCH /api/tasks/{id}` now persists project, sprint, type, severity, SLA, assignees and custom fields (they were dropped).
- Fix: `/api/projects/roots` and sub-project lists are now limited to the caller's workspace.

All notable changes from the enterprise-readiness backlog engagement, in the order they were
completed. Each entry links to the doc with full detail.

## Account Security: two-factor login, backup codes, forged client addresses, leaked credentials
- **Fixed**: two-factor authentication was switchable but never asked for. An account with 2FA on could be entered with
  the password alone. Login is now two steps for those accounts (password, then a code), on web and mobile.
  Codes can't be replayed, and five wrong codes lock code entry for 15 minutes.
- **Fixed**: turning on 2FA created no backup codes (a lost phone would have meant a locked-out account once 2FA was
  enforced). It now returns ten single-use codes, shown once; they can be regenerated and used to sign in or switch 2FA off.
- **Fixed**: `/2fa/setup` replaced the *active* secret immediately, with no proof of the old one, so a stolen session
  could swap in its own authenticator. The new secret now stays pending until a code from it is verified, and replacing an
  active authenticator needs the current code (or a backup code).
- **Fixed**: `/api/auth/profile` and `/api/users/me` returned the raw user record: password hash, TOTP secret, backup
  codes, refresh token, magic-link, OTP and guest tokens. The web app copied that into `localStorage`. None of it is
  serialised any more (existing copies are overwritten at the next profile refresh).
- **Fixed**: `X-Forwarded-For` was believed from any caller, so the rate limiter could be dodged by rotating the header
  and a workspace IP allow-list could be walked through by claiming an allowed address. The header is now believed only
  from a trusted proxy (`TRUSTED_PROXIES`; default: loopback and private ranges).
- **Fixed**: IP allow-list entries were matched as string prefixes: CIDR ranges never matched and `1.2` allowed `1.20.x.x`.
  Exact addresses, CIDR and whole-octet wildcards (`10.1.*`) now match correctly.
- **Action needed**: if your load balancer or CDN reaches the app from a *public* address, set `TRUSTED_PROXIES` (see
  `docs/ACCOUNT_SECURITY.md`). API clients that call `/api/auth/login` for accounts with 2FA must now follow with
  `/api/auth/login/2fa`.
- See `docs/ACCOUNT_SECURITY.md`.

## Integrations: GitLab, Microsoft Teams, Datadog / Sentry / Jenkins
- **GitLab** (gitlab.com and self-managed): open issues and merge requests sync as tasks, de-duplicated within the workspace.
- **Microsoft Teams**: Adaptive Card messages via Workflows or legacy connector webhooks, restricted to Microsoft hosts.
- **Datadog, Sentry, Jenkins**: alerts, errors and failed builds open tasks through a per-workspace secret URL; repeats don't
  duplicate, recoveries close the task. Sentry signatures are verified when a client secret is set.
- Calls to user-supplied hosts go through a new URL policy (https only, public addresses, no redirects, timeouts, size cap).
- See `docs/INTEGRATIONS.md`.

## Tenant Isolation & Webhook Security
- **Fixed**: the outbound-webhook management API (`/api/webhooks`) was reachable with no login (the
  `/api/webhooks/**` wildcard existed for the Stripe/email callbacks) and its by-id endpoints ignored workspace
  ownership, so signing secrets could be read, rotated or deleted across workspaces.
- **Fixed**: by-id access to any workspace-owned record was unchecked (89 call sites). Added a tenant guard around
  every workspace-owned repository, switchable with `TENANT_GUARD_MODE=enforce|log|off`.
- **Fixed**: several services fell back to a *global* query when no `X-Workspace-Id` was sent: notifications
  (including "mark all read" and "clear all", which acted on every workspace), the recent-activity feed, and team
  lookup by email. The security dashboard (`/api/security/sessions/all`, `/stats`) listed every user on the platform.
- **Fixed**: WebSocket traffic was unauthenticated and unauthorised (anonymous CONNECT, no SUBSCRIBE/SEND checks, and
  `/app/doc/{id}/edit` persisted content for any document). `useDocCollab` also now sends its token.
- See `docs/TENANT_ISOLATION.md`.

## Documentation & Enablement
- Added `docs/ARCHITECTURE.md` with three verified-syntax Mermaid diagrams (system overview, request
  flow, data-residency routing).
- Added `docs/adr/` — 7 Architecture Decision Records covering the real trade-offs behind this
  engagement's key design choices.
- Added `docs/README.md` — master index of all 20 documentation files this engagement produced.
- Added `docs/API.md`, `docs/TRUST.md`.
- This changelog.

## Mobile & Offline
- **Fixed a real gap**: `PWAInstallBanner.jsx` advertised push notifications with no way to enable
  them. Added full Web Push (VAPID) send capability, subscription management, and a working toggle UI.
- Investigated and corrected the original assessment that offline caching didn't exist — `public/sw.js`
  already had a real, working caching strategy; documented rather than duplicated.
- See `docs/MOBILE_OFFLINE.md`.

## Internationalization
- Added i18next + react-i18next, 52 real translated keys (English/Spanish), fully converted
  `Login.jsx` as a proven working example.
- See `docs/I18N.md`.

## Observability & Operational Readiness
- Added a real local Prometheus + Alertmanager + Grafana stack, 7 alert rules, SLO definitions, and 8
  incident runbooks.
- Added frontend error tracking (Sentry), opt-in.
- **Fixed a bug found during this item**: Playwright's E2E specs were being incorrectly picked up by
  Vitest's test runner, crashing 2 of 6 test files — caught by actually re-running the suite.
- See `docs/OBSERVABILITY_SETUP.md`, `docs/SLO.md`, `docs/RUNBOOKS.md`.

## Security Hardening
- Added AES-256-GCM field-level encryption (verified by compiling and running the actual crypto logic
  standalone before finalizing).
- Added security response headers (CSP, HSTS, X-Frame-Options), managed secrets store integration
  (opt-in), WAF/DDoS Terraform examples, `SECURITY.md`.
- See `docs/SECURITY_HARDENING.md`.

## Compliance & Data Governance
- **Fixed a real security bug**: `DELETE /api/users/me` didn't actually verify the account password
  despite documentation claiming it did — a leaked JWT alone was enough to delete an account.
- **Fixed a real stub**: the deferred-deletion GDPR endpoint promised a 30-day deletion that nothing
  scheduled — built a real scheduled job for it.
- Added audit-log tamper-evidence (SHA-256 hash chain), verified by directly tampering with/deleting
  entries via `MongoTemplate` and confirming detection.
- Added a SOC 2/ISO 27001 control mapping and a subprocessor list template.
- See `docs/COMPLIANCE.md`, `docs/SUBPROCESSORS.md`.

## Scalability & High Availability
- Converted local MongoDB to a genuine replica set (unlocks transactions/change streams).
- **Fixed a bug this introduced**: the API contract-check workflow started MongoDB directly, bypassing
  replica-set initialization — caught and fixed before it could break CI.
- Added a Kubernetes HorizontalPodAutoscaler, CDN/ECS autoscaling examples, multi-region architecture
  documentation.
- See `docs/SCALABILITY_HA.md`.

## Testing & Quality Assurance
- Added CodeQL (SAST), Trivy + Dependency Review (SCA), OWASP ZAP (DAST), SBOM generation.
- Added a real Playwright E2E suite — selectors verified directly against actual component source
  after catching myself initially guessing at them.
- Added OpenAPI-diff breaking-change detection for frontend/backend contract drift.
- See `docs/SECURITY_TESTING.md`, `docs/API_CONTRACT.md`.

## CI/CD & Release Engineering
- Added backend/frontend CI pipelines, container image publishing to GHCR with SBOM, Dependabot,
  an example Kubernetes deployment manifest, and a real rollback procedure.
- See `docs/RELEASE_PROCESS.md`.

## Accessibility
- Added `eslint-plugin-jsx-a11y` and `vitest-axe`; measured a real baseline (863 violations across 72
  files) rather than estimating one.
- Fixed all 5 real violations in `Login.jsx`; verified the fix and caught (then corrected) an
  overclaiming test comment after empirically finding axe-core has real blind spots in jsdom.
- See `docs/ACCESSIBILITY.md`.

## Data Residency / Multi-Region
- Built real, opt-in per-collection MongoDB region-routing infrastructure.
- **Closed a real honesty gap**: a workspace could previously declare any data region with zero backing
  infrastructure — now rejected unless explicitly overridden.
- See `docs/DATA_RESIDENCY.md`.

## Load & Performance Testing
- Added a realistic multi-step workflow load test with per-endpoint latency budgets, and CI wiring to
  actually run the existing (previously unexecuted) k6 scripts.

## Automated Testing
- Added JaCoCo (backend) and Vitest coverage (frontend) gates — **corrected the frontend threshold
  from an initial aspirational 15% down to the real measured 0.5%** after actually running the
  coverage command.
- Added 5 new backend test suites covering the security-relevant code from earlier items.

## File Storage
- Added S3/MinIO backend support (SSE-256 encryption by default), malware scanning (ClamAV),
  presigned-URL downloads — all opt-in, local disk remains the zero-config default.

## Email Delivery
- Made SMTP fully provider-agnostic (was hardcoded to Gmail).
- Added bounce/complaint webhook handling (SES/SendGrid/Postmark) and an automatic suppression list.

## Backup, Restore & Disaster Recovery
- Added off-site backup upload, retention policy, a genuinely runnable restore-drill script (spins up a
  disposable container, restores into it, verifies, tears down), and scheduled backup workflows.

## Distributed Tracing
- Wired a real local OTel Collector → Jaeger pipeline (previously configured but pointed at nothing),
  plus vendor recipes for Honeycomb/Grafana Cloud/Datadog/New Relic.

## SAML SSO & Auth0
- **Fixed the actual gap**: Auth0 tenant was hardcoded in `main.jsx`, not env-driven — now fully
  config-driven with production-safe fallback behavior.
