#!/usr/bin/env bash
# Runs coolify-window-db-cert.php inside the Coolify container.
#
#   window-db-coolify-cert.sh inspect                     # read-only metadata
#   sudo window-db-coolify-cert.sh apply                  # persist /etc/window-db-tls/origin.{crt,key}
#
# The certificate and key are streamed on stdin and are never printed or written
# to disk by this script.
set -euo pipefail

MODE="${1:-inspect}"
STORE="${WINDOW_DB_TLS_STORE:-/etc/window-db-tls}"
PHP_FILE="$(dirname "$(readlink -f "$0")")/coolify-window-db-cert.php"

docker cp "$PHP_FILE" coolify:/tmp/coolify-window-db-cert.php
trap 'docker exec -u root coolify rm -f /tmp/coolify-window-db-cert.php' EXIT

if [[ "$MODE" == "apply" ]]; then
  [[ $EUID -eq 0 ]] || { echo "error: apply must run as root (reads ${STORE})" >&2; exit 1; }
  node_input="$(printf '{"crt":%s,"key":%s}' \
    "$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "${STORE}/origin.crt")" \
    "$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "${STORE}/origin.key")")"
  printf '%s' "$node_input" | docker exec -i -e MODE=apply coolify \
    php artisan tinker --execute="require '/tmp/coolify-window-db-cert.php';"
else
  docker exec -e MODE=inspect coolify php artisan tinker --execute="require '/tmp/coolify-window-db-cert.php';"
fi
