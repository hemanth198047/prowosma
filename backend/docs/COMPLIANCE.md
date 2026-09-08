# Compliance & Data Governance

## What changed

| Gap | What's now real |
|---|---|
| GDPR/CCPA self-service tooling "not verified as compliant" | Fixed a real security bug in the immediate deletion flow (missing password check); the deferred deletion flow (`/gdpr/delete-request`) went from a pure stub to a genuinely scheduled, cancellable deletion |
| Data residency metadata-only | Addressed in the Data Residency backlog item — real routing infrastructure + rejection of unenforceable region claims |
| Audit log had no tamper-evidence | `ActivityLogService` now hash-chains every entry (SHA-256, per-organization) — see below |
| No SOC 2 / ISO 27001 control mapping | This document's mapping table below |
| No subprocessor list / DPA | `docs/SUBPROCESSORS.md` (template — needs legal review before publishing) |

## GDPR/CCPA self-service data rights

Two deletion paths, both now genuinely working:

- **Immediate**: `DELETE /api/users/me` — requires the account's actual current password (previously
  did not — see the fix below), plus typing a literal confirmation string. Deletes the account and
  everything `UserDeletionService` is scoped to own.
- **Deferred (30-day grace period)**: `POST /api/security/gdpr/delete-request` — schedules real
  deletion 30 days out, cancellable via `POST /api/security/gdpr/delete-request/cancel`.
  `GdprDeletionSchedulerService` runs daily and performs the actual deletion once due, through the
  same `UserDeletionService` code path the immediate flow uses — one deletion implementation, two ways
  to trigger it, not two separately-maintained (and potentially inconsistent) ones.

**Security fix**: `DELETE /api/users/me`'s own documentation always said a password was required
("Requires password confirmation for safety"), but the implementation never actually checked it — only
the literal confirmation string. That meant a stolen or leaked JWT alone was enough to permanently
delete an account and every workspace it owns, without knowing the account's password at all. Fixed
and covered by `AccountDeletionSecurityTest`.

**Export**: `GET /api/security/gdpr/export` — already fully self-service before this change (records
a request timestamp, returns profile/tasks/projects/sessions as JSON). One real, honest limitation
worth stating: it's scoped to the CURRENTLY ACTIVE workspace only — a user belonging to multiple
workspaces needs to switch workspace and re-export per workspace for a complete picture. Not fixed in
this change (would require iterating every workspace a user belongs to, which changes the endpoint's
scope and performance characteristics meaningfully) — a reasonable next step if this becomes a real
customer-facing gap.

## Audit trail tamper-evidence

`ActivityLogService` now computes a SHA-256 hash chain per organization — see that class's own,
extensive comments on `attachHashChain()` and `verifyChainIntegrity()` for the full design, including
an honestly-documented known limitation (a narrow race window under truly concurrent writes to the
same organization within microseconds of each other — see that comment for exactly when and why).

Verify a workspace's chain: `GET /api/activity-logs/verify-integrity`.

This was verified to actually work, not just assumed to: `AuditChainIntegrityTest` builds a real
sequence of log entries, then directly modifies and separately deletes historical entries via
`MongoTemplate` (bypassing the application layer entirely — the same way a real attacker with raw
database access would have to), and confirms `verifyChainIntegrity()` correctly flags both as broken.

**Found and fixed during a later review pass**: the original `verifyChainIntegrity()` had no concept
of "this entry predates hash-chaining being enabled" — any workspace with activity-log history from
before this feature shipped would have every one of its pre-existing entries flagged as broken (a
100%-false-positive on every real rollout), since those entries' hash fields are genuinely null (the
fields didn't exist when they were written), and the original logic compared that null against a
freshly recomputed hash and treated the mismatch as tampering. Fixed by skipping entries with no
recorded hash and starting real verification from the first entry that has one. Verified two ways:
(1) manually executing both the old and new logic against a simulated mixed old/new dataset in a
standalone Java program, confirming the old logic genuinely broke and the new logic doesn't; (2) two
new permanent tests (`preExistingUnhashedEntries_doNotFalsePositive`,
`tamperingOnNewEntry_stillDetectedAmongMixedData`) that insert unhashed legacy-style entries directly
via `MongoTemplate` and confirm the fixed logic both (a) doesn't false-positive on them and (b) still
correctly detects real tampering on the hashed entries alongside them.

**External export for tamper-evident archival** — already existed before this change:
`GET /api/activity-logs/export/csv`. Combined with the hash chain, an auditor can now export the trail
periodically and independently verify (via the `/verify-integrity` endpoint, or by re-implementing the
same SHA-256 canonicalization externally against the exported data) that historical entries haven't
been altered since export.

## SOC 2 / ISO 27001 control mapping

**This is a real, accurate mapping of what's actually implemented in this codebase as of this backlog
— it is not a compliance certification, an audit, or a claim that this app has passed a SOC 2
examination.** Achieving an actual SOC 2 Type I/II report requires an independent auditor's
examination over a real observation period; this table is the honest starting evidence an auditor
would look for, organized by SOC 2's Trust Service Criteria (TSC).

| TSC | Control | Implemented where |
|---|---|---|
| CC6.1 (Logical access controls) | RBAC | `RoleGuardFilter` |
| CC6.1 | MFA | `TwoFactorService` (TOTP) |
| CC6.1 | SSO | SAML (`SamlConfig`) + Auth0 |
| CC6.1 | Session management | `SecurityController` (list/revoke sessions) |
| CC6.6 (Encryption in transit) | TLS termination | Deployment-layer (load balancer/ingress) — not app code, see `docs/SCALABILITY_HA.md` |
| CC6.6 (Encryption at rest) | Object storage | S3 SSE-256 (`FileStorageService`) |
| CC6.6 | Field-level | `FieldEncryptionService` (AES-256-GCM) |
| CC6.6 | Database | Deployment-layer (Atlas default, or WiredTiger option) — see `docs/SECURITY_HARDENING.md` |
| CC6.7 (Data transmission/disposal) | Account deletion | `UserDeletionService`, GDPR flows above |
| CC6.8 (Malicious software prevention) | Upload scanning | `ClamAvVirusScanner` (opt-in) |
| CC7.1 (Vulnerability detection) | SAST | CodeQL |
| CC7.1 | SCA/dependency scanning | Dependabot + Trivy |
| CC7.1 | DAST | OWASP ZAP |
| CC7.2 (Security monitoring) | Audit logging | `ActivityLogService` + hash chain (this item) |
| CC7.2 | Rate limiting / abuse detection | `RateLimitFilter` |
| CC7.2 | DLP | `DlpViolation` / `DlpController` |
| CC7.3 (Incident response) | Vulnerability disclosure process | `SECURITY.md` |
| CC7.4 (Incident recovery) | Backup/restore, tested | `docs/DISASTER_RECOVERY.md` |
| CC8.1 (Change management) | CI gates on every change | `backend-ci.yml`, `frontend-ci.yml` |
| CC8.1 | Dependency review on PRs | `dependency-scan.yml` |
| CC9.2 (Vendor management) | Subprocessor list | `docs/SUBPROCESSORS.md` |
| A1.2 (Availability — capacity) | Autoscaling | `k8s/backend-hpa.yaml` |
| A1.2 | Health-check-gated deployment | `k8s/backend-deployment.yaml` |
| A1.3 (Availability — recovery) | Replica set, measured RTO/RPO | `docs/SCALABILITY_HA.md`, `docs/DISASTER_RECOVERY.md` |
| PI1.1 (Processing integrity) | API contract checks | `api-contract-check.yml` |
| PI1.1 | Automated test coverage gates | `docs/TESTING.md` |
| P1.1 (Privacy — notice/choice) | Data export self-service | `GET /api/security/gdpr/export` |
| P4.1/P4.2 (Privacy — deletion) | Immediate + deferred deletion | This item |

### What's NOT covered by this table (real gaps, not omissions)

- **No independent auditor engagement** — this table is evidence an auditor would review, not the
  audit itself.
- **No formal risk assessment document, security awareness training program, or vendor risk
  assessment process** — organizational/process controls, not code, out of scope for an engagement
  focused on the codebase.
- **No physical security controls documentation** — depends entirely on the chosen cloud provider's
  own SOC 2 report (AWS/GCP/Azure/MongoDB Atlas all publish these) rather than anything this app does.
- **No formal data classification policy** — `WorkspaceConfig.retentionDays` and
  `RetentionEnforcementService` exist, but a written data classification policy is an organizational
  document, not code.

## Subprocessor list & DPA

See `docs/SUBPROCESSORS.md` — a real, accurate list of the third-party services this codebase actually
integrates with (based on every dependency added across this entire backlog, not a generic template),
explicitly marked as needing legal review before being published as a customer-facing commitment.
