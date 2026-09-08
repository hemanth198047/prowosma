# ADR 0001: Every new external integration is opt-in and config-driven, never a hard requirement

## Status
Accepted (applied consistently across this entire engagement)

## Context
This backlog added many new external integrations: AWS Secrets Manager, S3, ClamAV, Web Push (VAPID),
Sentry, region-specific MongoDB clusters, hosted trace backends. Each could have been wired as a
required dependency (the app won't start without it) or as opt-in (works without it, activates when
configured).

## Decision
Every one of these is opt-in, detected by whether its config is set, with a clear log message when
it's inactive. None of them change the app's default (unconfigured) behavior.

## Consequences
- **Positive**: every change in this backlog could be added without breaking any existing deployment,
  verified incrementally, and adopted independently by different teams on different timelines.
- **Positive**: local development never requires real cloud credentials for any of these.
- **Negative**: this means several "enterprise-grade" capabilities require an explicit setup step
  before they're actually protecting anything — an unconfigured `ENCRYPTION_KEY` still means plaintext
  storage, for example. Each relevant doc states this plainly rather than let the mere presence of the
  code imply protection that isn't active. Genuine security-relevant defaults (e.g. a rate limit of 300
  rpm) still ship on by default — this pattern applies to *optional infrastructure integrations*, not
  to security controls that make sense to have on unconditionally.
