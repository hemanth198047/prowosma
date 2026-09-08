#!/usr/bin/env bash
# Restores a Prowosma MongoDB backup produced by backup-db.sh.
#
# REQUIRES: mongorestore on PATH (see backup-db.sh for install link).
#
# Usage:
#   ./scripts/restore-db.sh ./backups/prowosma-20260811-100000.archive.gz
#   MONGODB_URI="mongodb://target-host:27017/prowosma" ./scripts/restore-db.sh <archive>

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-archive.gz>" >&2
    echo "Example: $0 ./backups/prowosma-20260811-100000.archive.gz" >&2
    exit 1
fi

ARCHIVE="$1"
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/prowosma}"

if ! command -v mongorestore &> /dev/null; then
    echo "ERROR: mongorestore not found on PATH." >&2
    echo "Install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/installation/" >&2
    exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "ERROR: archive not found: ${ARCHIVE}" >&2
    exit 1
fi

echo "About to restore ${ARCHIVE} into ${MONGODB_URI}"
echo "THIS WILL OVERWRITE EXISTING COLLECTIONS OF THE SAME NAME (--drop)."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

# --drop: restore is meant to bring the target to exactly the backup's
# state, not merge with whatever's already there — a partial merge of old
# and restored data is usually worse than either state cleanly on its own.
mongorestore --uri="$MONGODB_URI" --archive="$ARCHIVE" --gzip --drop

echo "Restore complete."
