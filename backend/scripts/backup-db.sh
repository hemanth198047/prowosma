#!/usr/bin/env bash
# Backs up the Prowosma MongoDB database using mongodump — the standard,
# officially-supported MongoDB backup tool.
#
# REQUIRES: mongodump on PATH (part of the MongoDB Database Tools —
# https://www.mongodb.com/docs/database-tools/installation/ — a separate
# install from the MongoDB server itself). Not vendored here since these
# tools are platform-specific binaries, not something to commit to source
# control.
#
# Off-site upload and local retention are both OPTIONAL and OFF by
# default (BACKUP_UPLOAD_PROVIDER unset = local-disk-only, same as
# before) — set the env vars below to turn them on. No code change is
# ever needed to point this at a different bucket/container or to change
# how long backups are kept.
#
# Usage:
#   ./scripts/backup-db.sh                    # backs up using MONGODB_URI env var, or the local default
#   MONGODB_URI="mongodb://prod-host:27017/prowosma" ./scripts/backup-db.sh
#
# Off-site upload (pick one, leave the rest unset):
#   BACKUP_UPLOAD_PROVIDER=s3    BACKUP_S3_BUCKET=my-backups-bucket        [BACKUP_S3_PREFIX=prowosma/]
#   BACKUP_UPLOAD_PROVIDER=gcs   BACKUP_GCS_BUCKET=my-backups-bucket       [BACKUP_GCS_PREFIX=prowosma/]
#   BACKUP_UPLOAD_PROVIDER=azure BACKUP_AZURE_CONTAINER=my-container \
#                                BACKUP_AZURE_ACCOUNT=my-storage-account
#
# Retention (local disk only — see docs/DISASTER_RECOVERY.md for how to
# set a lifecycle policy on the bucket/container itself for off-site
# retention, which each provider manages natively rather than this script
# reaching back in to delete remote objects):
#   BACKUP_RETENTION_DAYS=14     # default: 14. Set to 0 to disable pruning entirely.

set -euo pipefail

MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/prowosma}"
BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_UPLOAD_PROVIDER="${BACKUP_UPLOAD_PROVIDER:-}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

if ! command -v mongodump &> /dev/null; then
    echo "ERROR: mongodump not found on PATH." >&2
    echo "Install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/installation/" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "Backing up ${MONGODB_URI} to ${BACKUP_DIR} ..."

mongodump --uri="$MONGODB_URI" --out="$BACKUP_DIR" --gzip

# Also produce a single compressed archive alongside the directory dump —
# easier to move/upload as one file to off-site storage than a whole
# directory tree of per-collection files.
ARCHIVE="${BACKUP_ROOT}/prowosma-${TIMESTAMP}.archive.gz"
mongodump --uri="$MONGODB_URI" --archive="$ARCHIVE" --gzip

echo ""
echo "Backup complete:"
echo "  Directory form: ${BACKUP_DIR}  (per-collection BSON files)"
echo "  Archive form:   ${ARCHIVE}     (single file — used for off-site upload below)"

# ── Off-site upload (optional) ──────────────────────────────────────────
UPLOAD_STATUS="skipped (BACKUP_UPLOAD_PROVIDER not set — local disk only)"
case "$BACKUP_UPLOAD_PROVIDER" in
  s3)
    : "${BACKUP_S3_BUCKET:?BACKUP_UPLOAD_PROVIDER=s3 requires BACKUP_S3_BUCKET}"
    if ! command -v aws &> /dev/null; then
      echo "ERROR: BACKUP_UPLOAD_PROVIDER=s3 but the AWS CLI ('aws') is not on PATH." >&2
      exit 1
    fi
    DEST="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-}prowosma-${TIMESTAMP}.archive.gz"
    echo "Uploading to ${DEST} ..."
    aws s3 cp "$ARCHIVE" "$DEST"
    UPLOAD_STATUS="uploaded to ${DEST}"
    ;;
  gcs)
    : "${BACKUP_GCS_BUCKET:?BACKUP_UPLOAD_PROVIDER=gcs requires BACKUP_GCS_BUCKET}"
    if ! command -v gsutil &> /dev/null; then
      echo "ERROR: BACKUP_UPLOAD_PROVIDER=gcs but 'gsutil' is not on PATH." >&2
      exit 1
    fi
    DEST="gs://${BACKUP_GCS_BUCKET}/${BACKUP_GCS_PREFIX:-}prowosma-${TIMESTAMP}.archive.gz"
    echo "Uploading to ${DEST} ..."
    gsutil cp "$ARCHIVE" "$DEST"
    UPLOAD_STATUS="uploaded to ${DEST}"
    ;;
  azure)
    : "${BACKUP_AZURE_CONTAINER:?BACKUP_UPLOAD_PROVIDER=azure requires BACKUP_AZURE_CONTAINER}"
    : "${BACKUP_AZURE_ACCOUNT:?BACKUP_UPLOAD_PROVIDER=azure requires BACKUP_AZURE_ACCOUNT}"
    if ! command -v az &> /dev/null; then
      echo "ERROR: BACKUP_UPLOAD_PROVIDER=azure but the Azure CLI ('az') is not on PATH." >&2
      exit 1
    fi
    echo "Uploading to Azure Blob container ${BACKUP_AZURE_CONTAINER} ..."
    az storage blob upload \
      --account-name "$BACKUP_AZURE_ACCOUNT" \
      --container-name "$BACKUP_AZURE_CONTAINER" \
      --name "prowosma-${TIMESTAMP}.archive.gz" \
      --file "$ARCHIVE" \
      --auth-mode login
    UPLOAD_STATUS="uploaded to azure://${BACKUP_AZURE_ACCOUNT}/${BACKUP_AZURE_CONTAINER}/prowosma-${TIMESTAMP}.archive.gz"
    ;;
  "")
    : # provider not set — local-disk-only, matches pre-existing behavior exactly
    ;;
  *)
    echo "ERROR: Unknown BACKUP_UPLOAD_PROVIDER '${BACKUP_UPLOAD_PROVIDER}' (expected s3, gcs, or azure)." >&2
    exit 1
    ;;
esac
echo "  Off-site upload: ${UPLOAD_STATUS}"

# ── Local retention (optional, on by default at 14 days) ───────────────
if [ "$BACKUP_RETENTION_DAYS" != "0" ]; then
  echo ""
  echo "Pruning local backups older than ${BACKUP_RETENTION_DAYS} days from ${BACKUP_ROOT} ..."
  # Only touch this script's own output (timestamped dirs and
  # prowosma-*.archive.gz files) — never a blind rm across the whole
  # BACKUP_ROOT, in case something else also writes there.
  find "$BACKUP_ROOT" -maxdepth 1 -type d -regextype posix-extended \
    -regex ".*/[0-9]{8}-[0-9]{6}" -mtime "+${BACKUP_RETENTION_DAYS}" -print -exec rm -rf {} \;
  find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'prowosma-*.archive.gz' \
    -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete
  echo "  (pruning only ever deletes LOCAL copies — off-site copies already uploaded are"
  echo "   untouched; set a lifecycle rule on the bucket/container itself for off-site"
  echo "   retention, see docs/DISASTER_RECOVERY.md)"
else
  echo ""
  echo "Local retention pruning disabled (BACKUP_RETENTION_DAYS=0)."
fi

echo ""
echo "Done. To automate this on a schedule, see docs/DISASTER_RECOVERY.md"
echo "(GitHub Actions workflow and Kubernetes CronJob examples included)."
