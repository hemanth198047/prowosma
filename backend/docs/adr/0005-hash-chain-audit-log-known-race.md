# ADR 0005: Per-organization hash-chained audit log, with an accepted narrow concurrency race

## Status
Accepted

## Context
The audit log needed tamper-evidence (detecting a record modified or deleted via direct database
access, bypassing the application entirely). A hash chain (each entry hashes its own content plus the
previous entry's hash) is the standard mechanism. The hard part: making the "claim the previous hash
and extend the chain" step safe under concurrent writes from multiple backend instances, without
requiring a full distributed-lock/queue system.

## Decision
A two-step atomic claim/finalize pattern (see `ActivityLogService.attachHashChain`'s own extensive
comments): atomically swap in a random claim token to capture the real previous hash, compute this
entry's hash, then atomically finalize using the claim token as a guard. This closes MOST of the race
a naive read-then-write would have, but not all of it — two writes to the *same organization* landing
within the same sub-millisecond claim-to-finalize window can still both observe a pending claim and
independently treat it as "no previous entry," which `verifyChainIntegrity()` would then flag as a
break even though nothing malicious happened.

## Consequences
- **Positive**: a massive improvement over the complete absence of tamper-evidence before this change,
  verified working via `AuditChainIntegrityTest`'s direct-database-tampering tests.
- **Negative**: a legitimate, documented false-positive mode exists under true concurrency. A fully
  airtight version would serialize all writes for one organization through a single writer (an
  actor/queue) — a real, larger change, not implemented here. `docs/COMPLIANCE.md`'s audit endpoint
  documentation tells an operator how to distinguish the benign race from real tampering when
  investigating a break.

## Addendum (post-delivery review)
A second, more damaging correctness gap was found and fixed in a later review pass: the original
`verifyChainIntegrity()` treated any pre-existing (pre-feature) activity-log entry's null hash fields
as a broken chain — meaning every real deployment with activity-log history older than this feature
would see 100% of workspaces reported as tampered on day one, with zero actual tampering. Fixed by
skipping unhashed entries and starting verification from the first entry that actually has a hash. See
`docs/COMPLIANCE.md` for the full account and how it was verified (both a standalone executable
reproduction of the bug and two new permanent regression tests).
