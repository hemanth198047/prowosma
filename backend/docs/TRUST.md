# Trust & Security

**Content for a customer-facing trust/security page — accurate as of this engagement, needs the same
legal/marketing review as `docs/SUBPROCESSORS.md` before being published externally as a formal
commitment.** Every claim below links to the real, verifiable implementation, not marketing copy.

## Security

- **Authentication**: JWT-based sessions, Auth0 (OAuth/OIDC), SAML 2.0 SSO (Okta/Azure AD/Google
  Workspace/custom IdPs), TOTP two-factor authentication, magic-link login. See `docs/SSO_SETUP.md`.
- **Access control**: role-based access control enforced on every request, workspace-level data
  isolation (independently tested), IP allowlisting, per-workspace API keys.
- **Encryption in transit**: TLS (deployment-layer — see `docs/SCALABILITY_HA.md`).
- **Encryption at rest**: field-level AES-256-GCM for sensitive stored credentials, S3 server-side
  encryption (SSE-256) for file attachments. See `docs/SECURITY_HARDENING.md`.
- **Security headers**: Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options on every
  response.
- **Malware scanning**: uploaded files are optionally scanned via ClamAV before storage.
- **Rate limiting**: per-user/IP request limits, backed by a distributed-safe (not per-instance)
  counter, load-tested.

## Continuous security testing

Every code change is automatically checked by:
- **Static analysis (SAST)**: CodeQL, on every push and weekly.
- **Dependency scanning (SCA)**: GitHub Dependency Review on every PR, Trivy daily.
- **Dynamic analysis (DAST)**: OWASP ZAP, weekly.
- **Software Bill of Materials**: generated for every released version.

See `docs/SECURITY_TESTING.md` for the full pipeline.

## Vulnerability disclosure

See `SECURITY.md` — response-time commitments for reported vulnerabilities, by severity.

## Reliability

- **Availability target**: 99.9% (see `docs/SLO.md` for the measured, metric-backed definition).
- **Database**: MongoDB replica set (multi-node in production — see `docs/SCALABILITY_HA.md`).
- **Autoscaling**: automatic, based on real CPU/memory load.
- **Monitoring & alerting**: continuous, with defined runbooks for every alert class (`docs/RUNBOOKS.md`).
- **Backups**: automated, off-site, with regularly-drilled (not just assumed) restore procedures — see
  `docs/DISASTER_RECOVERY.md` for the actual measured restore time, once drills have run.

## Data governance

- **Self-service data export**: available to every user for their own data.
- **Self-service account deletion**: immediate (with password confirmation) or a 30-day deferred option
  with cancellation — see `docs/COMPLIANCE.md`.
- **Audit trail**: every security-relevant action is logged with tamper-evident hash chaining — an
  auditor can cryptographically verify the trail hasn't been altered.
- **Data residency**: workspace-level region declaration, backed by real infrastructure when
  configured — never an unenforceable promise (see `docs/DATA_RESIDENCY.md`).
- **Subprocessors**: see `docs/SUBPROCESSORS.md` for the full list.

## Compliance posture

See `docs/COMPLIANCE.md` for a control-by-control mapping against SOC 2's Trust Service Criteria —
**this is an honest evidence inventory, not a claim of SOC 2 certification.** Achieving an actual SOC 2
report requires an independent auditor's examination, which is a separate engagement from what this
document describes.

## What we're still working on

In the interest of the same honesty this entire document is built on: independent third-party audit
engagement (SOC 2, penetration testing), a customer-facing SLA with contractual remedies, and full
physical data residency for every existing collection (the infrastructure exists — see
`docs/DATA_RESIDENCY.md` — but adoption across every collection is ongoing work, not complete). A trust
page that only lists strengths and omits open work invites exactly the kind of scrutiny this document
is trying to earn confidence through — better to say plainly what's still in progress.
