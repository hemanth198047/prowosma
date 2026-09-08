# Backup, Restore & Disaster Recovery

None of this existed before this project's enterprise-readiness backlog
work — no backup script, no restore procedure, no migration tooling, no
documented recovery expectations. This document is deliberately honest
about the line between what's actually implemented and working versus
what still requires an infrastructure decision this document can't make
on its own — consistent with how the rest of this backlog (data
residency, deploy pipelines, tracing) has been handled.

## What's real today

- **`scripts/backup-db.sh`** — a working `mongodump`-based backup script.
  Produces both a per-collection directory dump and a single compressed
  archive (the archive form is what you'd actually upload somewhere).
- **`scripts/restore-db.sh`** — a working `mongorestore`-based restore
  script, with an explicit confirmation prompt before it drops and
  replaces existing collections.
- **Schema migrations** — `src/main/java/.../migration/` (`Migration`
  interface + `MigrationRunner`). Runs automatically on every application
  startup, tracks completed migrations in a `_migrations` collection so
  each one runs exactly once ever, and uses a simple Mongo-based lock so
  two application instances starting simultaneously during a rolling
  deploy don't both try to run the same migration at once. One real
  example migration is included (`M001BackfillWorkspaceDataRegion`) —
  see that file for why it's needed, not a placeholder.

Both scripts were written and reviewed carefully but — same caveat as
every backend change across this whole engagement — could not be run
against a real MongoDB instance in the sandbox this was written in
(`mongodump`/`mongorestore` are separate platform binaries, not something
installable via the same tooling used to verify everything else here).
**Run both scripts once against a disposable local database before
trusting them against anything real.**

## What is genuinely not implemented — infrastructure decisions, not code

**Backup scheduling.** The script exists; nothing runs it automatically.
Needs a cron job, a Kubernetes CronJob, or a scheduled CI/CD workflow —
whichever fits wherever this eventually deploys (still undecided, see the
CI/CD item in this same backlog).

**Off-site / durable storage.** The script writes to local disk only.
A backup that lives on the same machine as the database it's backing up
survives a bad deploy but not a lost machine, a lost disk, or a lost
region. Needs the backup archive uploaded somewhere durable and separate
(S3, GCS, etc.) as a follow-up step after the script runs.

**Retention policy.** Nothing here deletes old backups. Indefinite local
accumulation isn't sustainable; a real retention policy (e.g. daily for
2 weeks, weekly for 3 months, monthly for a year) needs both a decision
and an implementation once off-site storage exists to enforce it against.

**Tested restore drills.** A backup nobody has ever restored from is a
hope, not a guarantee. Practicing the restore procedure — on a schedule,
against a non-production environment — is what actually validates RTO/RPO
numbers rather than just asserting them.

## RTO / RPO — honest numbers for the current state, not aspirational ones

With backups triggered manually and stored locally only:

- **RPO (Recovery Point Objective)** — data loss on restore = however long
  it's been since someone last manually ran `backup-db.sh`. Not a real,
  boundable number until scheduling exists.
- **RTO (Recovery Time Objective)** — time to restore = however long
  `mongorestore` takes for the current data volume, plus however long it
  takes a person to notice something is wrong, find the latest local
  backup file, and run the script. Not a number worth publishing as an SLA
  until the scheduling/off-site/drill gaps above are closed.

Publishing target RTO/RPO numbers before those gaps are closed would be
asserting a guarantee the current implementation can't back up — this
section states the real, current numbers instead.

## Restore procedure (what actually exists today)

1. Locate the archive to restore from (`./backups/prowosma-<timestamp>.archive.gz`,
   or wherever off-site storage is retrieved from, once that exists).
2. `MONGODB_URI="<target>" ./scripts/restore-db.sh <path-to-archive>`
3. Confirm the prompt (`yes`) — this drops and replaces existing
   collections with the backup's contents.
4. Verify application connectivity and spot-check a few collections
   before considering the restore complete.

## Adding a new schema migration

1. Create a new class in `src/main/java/.../migration/` implementing
   `Migration`, named `M00N<ShortDescription>` following
   `M001BackfillWorkspaceDataRegion`'s pattern.
2. Give it a sortable, unique `id()` — `YYYY-MM-DD-NNN-short-description`.
3. Annotate it `@Component` so Spring discovers it automatically.
4. It runs on the next application startup, exactly once, everywhere.
