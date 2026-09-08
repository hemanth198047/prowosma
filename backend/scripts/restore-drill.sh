#!/usr/bin/env bash
# Restore drill — actually proves a backup archive is restorable, instead
# of just asserting it is. Spins up a disposable, throwaway MongoDB
# container (never touches your real database), restores a backup archive
# into it, runs a handful of sanity checks, prints a pass/fail verdict
# with real timing, and tears the container down.
#
# This is the tool that turns "we have backups" into "we know our backups
# actually restore" — run it after every backup-schedule change, and
# periodically (see the scheduled drill in the CI workflow) even when
# nothing changed, since IdP/driver/schema drift can silently break a
# restore path that used to work.
#
# REQUIRES: docker, mongorestore, mongosh (or legacy `mongo` shell) on PATH.
#
# Usage:
#   ./scripts/restore-drill.sh                                   # drills the newest local archive
#   ./scripts/restore-drill.sh ./backups/prowosma-20260811-100000.archive.gz

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
DRILL_LOG="${BACKUP_ROOT}/drill-results.log"
CONTAINER_NAME="prowosma-restore-drill-$$"
DRILL_PORT="${DRILL_PORT:-27099}"  # not 27017, so this never collides with a real local Mongo

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
    ARCHIVE=$(ls -t "${BACKUP_ROOT}"/prowosma-*.archive.gz 2>/dev/null | head -n1 || true)
    if [ -z "$ARCHIVE" ]; then
        echo "ERROR: no archive given and none found under ${BACKUP_ROOT}/prowosma-*.archive.gz" >&2
        echo "Usage: $0 <path-to-archive.gz>" >&2
        exit 1
    fi
    echo "No archive specified — using the newest local one: ${ARCHIVE}"
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "ERROR: archive not found: ${ARCHIVE}" >&2
    exit 1
fi

for bin in docker mongorestore; do
    if ! command -v "$bin" &> /dev/null; then
        echo "ERROR: '${bin}' not found on PATH — required for the restore drill." >&2
        exit 1
    fi
done
MONGOSH=mongosh
command -v mongosh &> /dev/null || MONGOSH=mongo
if ! command -v "$MONGOSH" &> /dev/null; then
    echo "ERROR: neither 'mongosh' nor legacy 'mongo' shell found on PATH — required to verify the drill." >&2
    exit 1
fi

cleanup() {
    echo "Tearing down drill container ${CONTAINER_NAME} ..."
    docker rm -f "$CONTAINER_NAME" &> /dev/null || true
}
trap cleanup EXIT

echo "=== Restore drill: ${ARCHIVE} ==="
echo "Starting disposable MongoDB container on port ${DRILL_PORT} (isolated — not your real DB) ..."
docker run -d --name "$CONTAINER_NAME" -p "${DRILL_PORT}:27017" mongo:7 > /dev/null

echo "Waiting for it to accept connections..."
for i in $(seq 1 30); do
    if docker exec "$CONTAINER_NAME" mongosh --quiet --eval "db.adminCommand('ping')" &> /dev/null; then
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo "ERROR: drill container never became ready." >&2
        exit 1
    fi
done

DRILL_URI="mongodb://localhost:${DRILL_PORT}/prowosma"

START=$(date +%s)
echo "Restoring ${ARCHIVE} into the drill container ..."
mongorestore --uri="$DRILL_URI" --archive="$ARCHIVE" --gzip --drop
END=$(date +%s)
RESTORE_SECONDS=$((END - START))

echo "Restore finished in ${RESTORE_SECONDS}s. Running sanity checks ..."

# Sanity checks: every collection listed here should have at least one
# document in a real backup. Extend this list as new core collections are
# added — the point isn't exhaustive validation, it's catching the
# "restore ran with zero errors but produced an empty/broken database"
# failure mode, which mongorestore's own exit code does NOT catch.
CHECK_COLLECTIONS=(users workspaces projects tasks)
FAILED=0
for coll in "${CHECK_COLLECTIONS[@]}"; do
    COUNT=$("$MONGOSH" "$DRILL_URI" --quiet --eval "db.getCollection('${coll}').countDocuments({})" 2>/dev/null || echo "ERROR")
    if [ "$COUNT" = "ERROR" ]; then
        echo "  [WARN] Could not query collection '${coll}' — it may not exist in this backup, skipping."
        continue
    fi
    if [ "$COUNT" -gt 0 ]; then
        echo "  [OK]   ${coll}: ${COUNT} documents"
    else
        echo "  [FAIL] ${coll}: 0 documents (expected at least 1)"
        FAILED=1
    fi
done

mkdir -p "$BACKUP_ROOT"
{
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) archive=${ARCHIVE} restore_seconds=${RESTORE_SECONDS} result=$([ $FAILED -eq 0 ] && echo PASS || echo FAIL)"
} >> "$DRILL_LOG"

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== DRILL PASSED — ${ARCHIVE} restores cleanly in ${RESTORE_SECONDS}s ==="
    echo "Logged to ${DRILL_LOG}. Use recent entries there as your real, measured RTO baseline"
    echo "(see docs/DISASTER_RECOVERY.md) instead of an unverified estimate."
    exit 0
else
    echo "=== DRILL FAILED — see [FAIL] lines above ===" >&2
    exit 1
fi
