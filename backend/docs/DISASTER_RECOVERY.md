# Backup, Restore & Disaster Recovery

This document is deliberately honest about the line between what's actually implemented and working
versus what still requires an infrastructure decision only you can make (which cloud, which bucket,
which schedule) — same approach as the rest of this codebase's config-driven pieces (SSO, tracing).

## What's real today

- **`scripts/backup-db.sh`** — `mongodump`-based backup. Produces a per-collection directory dump and
  a single compressed archive. **Off-site upload is built in and optional** (`BACKUP_UPLOAD_PROVIDER=s3
  |gcs|azure`, see the script header for the exact env vars per provider) — unset, it behaves exactly
  as before (local disk only). **Local retention pruning is built in and on by default**
  (`BACKUP_RETENTION_DAYS`, default 14; set to `0` to disable).
- **`scripts/restore-db.sh`** — `mongorestore`-based restore, with an explicit confirmation prompt
  before it drops and replaces existing collections.
- **`scripts/restore-drill.sh`** *(new)* — actually proves a backup is restorable: spins up a
  disposable, throwaway MongoDB container (never touches your real database), restores an archive
  into it, checks that core collections aren't empty, times the whole thing, and logs the result to
  `backups/drill-results.log`. This is what turns "we have backups" into "we know they restore."
- **Scheduling** *(new)* — two ready-to-use options, pick whichever fits your deployment:
  - `.github/workflows/scheduled-backup.yml` — daily backup + weekly automated restore drill, entirely
    driven by repo secrets/variables (`MONGODB_URI`, `BACKUP_UPLOAD_PROVIDER`, cloud credentials).
    Works when your database has a reachable endpoint from GitHub's runners.
  - `k8s/backup-cronjob.yaml` — Kubernetes CronJob alternative for a database that's only reachable
    from inside your own cluster network. Same config surface, via a ConfigMap + Secrets instead of
    GitHub secrets.
- **Schema migrations** — `src/main/java/.../migration/` (`Migration` interface + `MigrationRunner`).
  Runs automatically on startup, tracks completed migrations in a `_migrations` collection so each
  runs exactly once, and uses a Mongo-based lock so simultaneous instances during a rolling deploy
  don't double-run a migration. One real example is included (`M001BackfillWorkspaceDataRegion`).

All scripts were written and reviewed carefully but — same caveat as every change in this codebase —
could not be executed against a real MongoDB, a real cloud bucket, or a real Kubernetes cluster from
this environment (those are separate platform binaries/accounts, not something available here).
**Run `restore-drill.sh` once for real (it's designed to be safe to run — disposable container, never
touches production) before trusting any of this against something that matters.**

## What is still genuinely an infrastructure decision, not code

**Which schedule and which cloud.** Both scheduling options above are ready to use, but only once you:
pick GitHub Actions vs. Kubernetes, supply real cloud credentials as secrets, and pick an actual bucket
name. None of that can be decided generically — it's in the setup steps in each file's header comments.

**Remote/off-site retention.** `BACKUP_RETENTION_DAYS` prunes local copies only, by design — it never
reaches back into S3/GCS/Azure to delete objects it already uploaded. Set a lifecycle rule on the
bucket/container itself for that (each provider supports this natively and it's the safer place for
it — a bug in this script should never be able to delete your only durable copy). Example for S3:

```bash
aws s3api put-bucket-lifecycle-configuration --bucket your-backups-bucket --lifecycle-configuration '{
  "Rules": [{
    "ID": "prowosma-backup-retention",
    "Filter": {"Prefix": "prowosma/"},
    "Status": "Enabled",
    "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}],
    "Expiration": {"Days": 365}
  }]
}'
```

**Encryption at rest for the backup archive itself.** `mongodump --gzip` compresses but does not
encrypt. If backups may contain sensitive data (they will — this is the whole database), enable
server-side encryption on the destination bucket (S3 SSE, GCS default encryption, Azure Storage
Service Encryption — all on by default on most providers today, but worth confirming explicitly) and
consider `gpg`-encrypting the archive before upload for defense in depth.

## RTO / RPO

With scheduling now in place (see above), these become real, boundable numbers **once you've actually
turned scheduling on and run at least one restore drill** — until then, treat the numbers below as the
design target, not a verified guarantee:

- **RPO (Recovery Point Objective)** — bounded by your chosen schedule interval. The default daily
  cron means RPO ≤ 24 hours once enabled; switch to an hourly cron for a tighter RPO if your data
  volume/backup duration supports it.
- **RTO (Recovery Time Objective)** — `restore-drill.sh` logs a real, measured restore duration to
  `backups/drill-results.log` every time it runs. Use the actual numbers accumulating there — not an
  estimate — as your RTO baseline, plus your own team's measured time-to-notice and time-to-decide.

Publishing a target RTO/RPO before scheduling is actually turned on and at least one drill has run
would be asserting a guarantee this document can't back up yet — turn on scheduling, run the drill
once, and the numbers above stop being targets and start being measurements.

## Restore procedure (manual / emergency)

1. Locate the archive to restore from (`./backups/prowosma-<timestamp>.archive.gz`, or retrieved from
   off-site storage).
2. `MONGODB_URI="<target>" ./scripts/restore-db.sh <path-to-archive>`
3. Confirm the prompt (`yes`) — this drops and replaces existing collections with the backup's contents.
4. Verify application connectivity and spot-check a few collections before considering it complete.

## Practicing a restore drill (not an emergency — do this periodically)

```bash
./scripts/restore-drill.sh                                    # drills the newest local archive
./scripts/restore-drill.sh ./backups/prowosma-<ts>.archive.gz # drills a specific one
```

Safe to run any time — it never touches your real database, only a disposable container it creates
and tears down itself.

## Adding a new schema migration

1. Create a new class in `src/main/java/.../migration/` implementing `Migration`, named
   `M00N<ShortDescription>` following `M001BackfillWorkspaceDataRegion`'s pattern.
2. Give it a sortable, unique `id()` — `YYYY-MM-DD-NNN-short-description`.
3. Annotate it `@Component` so Spring discovers it automatically.
4. It runs on the next application startup, exactly once, everywhere.
