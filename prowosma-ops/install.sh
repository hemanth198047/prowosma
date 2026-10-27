#!/usr/bin/env bash
# Run once as root:  ./install.sh
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
OPS=/opt/prowosma-ops

mkdir -p "$OPS/data"
install -m 0755 "$SRC/prowosma-ops" /usr/local/bin/prowosma-ops
[ -f "$OPS/prowosma-ops.conf" ] || { install -m 0600 "$SRC/prowosma-ops.conf.example" "$OPS/prowosma-ops.conf"; echo "Created $OPS/prowosma-ops.conf  <- edit this"; }
[ -f "$OPS/frontend.env" ]      || { install -m 0600 "$SRC/frontend.env.example" "$OPS/frontend.env"; echo "Created $OPS/frontend.env     <- set production values"; }
install -m 0644 "$SRC/systemd/prowosma-ops-auto.service" /etc/systemd/system/
install -m 0644 "$SRC/systemd/prowosma-ops-auto.timer"   /etc/systemd/system/
systemctl daemon-reload

echo
echo "Installed. Missing tools you may need for building on this server:"
for t in git curl flock java node npm; do command -v $t >/dev/null || echo "  - $t"; done
echo
echo "Next:"
echo "  1. nano $OPS/prowosma-ops.conf  and  $OPS/frontend.env"
echo "  2. prowosma-ops discover   (paste the output to Claude if unsure about any setting)"
echo "  3. prowosma-ops check"
echo "  4. prowosma-ops deploy --dry-run   then   prowosma-ops deploy"
echo "  5. systemctl enable --now prowosma-ops-auto.timer     # automatic deploys after every push"
