#!/usr/bin/env bash
# Installs the Cloudflare Origin CA certificate for the Window Postgres on Oracle.
#
# Why: Workers VPC verifies the database certificate against public CAs and
# Cloudflare Origin CA only, so the Coolify-generated certificate (private CA)
# cannot be verified. The Origin CA certificate for window-db.explosion.fun can.
#
# Coolify bind-mounts <db dir>/ssl/server.{crt,key} into the container and
# rewrites them from its own record whenever it starts or redeploys the
# database. This script is idempotent: run it again after any such event.
#
#   sudo window-db-tls.sh install <certificate.pem> <private-key.pem>   # first time or renewal
#   sudo window-db-tls.sh reinstall                                      # after a Coolify redeploy
#   sudo window-db-tls.sh status
#
# The key never leaves root-owned files (0600) and is never printed.
set -euo pipefail

DB_UUID="${WINDOW_DB_UUID:-w2c1as5kuqogvg0mb4jilfvy}"
DB_HOSTNAME="${WINDOW_DB_HOSTNAME:-window-db.explosion.fun}"
STORE="${WINDOW_DB_TLS_STORE:-/etc/window-db-tls}"
SSL_DIR="/data/coolify/databases/${DB_UUID}/ssl"
PG_UID="${WINDOW_DB_PG_UID:-70}"

die() { echo "error: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"

validate() {
  local crt="$1" key="$2"
  openssl x509 -in "$crt" -noout -checkend 86400 >/dev/null || die "certificate is expired or expires within a day"
  openssl x509 -in "$crt" -noout -ext subjectAltName | grep -q "DNS:${DB_HOSTNAME}" \
    || die "certificate does not list DNS:${DB_HOSTNAME}"
  [[ "$(openssl x509 -in "$crt" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$key" -pubout | openssl sha256)" ]] \
    || die "private key does not match certificate"
}

deploy() {
  local crt="$1" key="$2"
  [[ -d "$SSL_DIR" ]] || die "$SSL_DIR not found (is the Coolify database ${DB_UUID} created?)"
  # Write in place: Docker bind-mounts these single files by inode, so replacing
  # them (as `install` or `mv` would) leaves the container reading the old ones.
  cat "$crt" > "${SSL_DIR}/server.crt"
  cat "$key" > "${SSL_DIR}/server.key"
  chown "${PG_UID}:${PG_UID}" "${SSL_DIR}/server.crt" "${SSL_DIR}/server.key"
  chmod 0644 "${SSL_DIR}/server.crt"
  chmod 0600 "${SSL_DIR}/server.key"
  # If something replaced the host files (new inode), the container still sees the
  # old ones until it restarts; otherwise a configuration reload is enough.
  if docker exec -i "$DB_UUID" cmp -s /var/lib/postgresql/certs/server.crt - < "${SSL_DIR}/server.crt"; then
    docker exec "$DB_UUID" psql -U postgres -d window -Atc 'select pg_reload_conf()' >/dev/null
  else
    echo "container mount is stale; restarting ${DB_UUID}"
    docker restart "$DB_UUID" >/dev/null
  fi
  echo "installed certificate for ${DB_HOSTNAME}; Postgres configuration reloaded"
}

case "${1:-status}" in
  install)
    [[ $# -eq 3 ]] || die "usage: install <certificate.pem> <private-key.pem>"
    validate "$2" "$3"
    install -d -m 0700 "$STORE"
    install -m 0644 "$2" "${STORE}/origin.crt"
    install -m 0600 "$3" "${STORE}/origin.key"
    deploy "${STORE}/origin.crt" "${STORE}/origin.key"
    ;;
  reinstall)
    validate "${STORE}/origin.crt" "${STORE}/origin.key"
    deploy "${STORE}/origin.crt" "${STORE}/origin.key"
    ;;
  status)
    for f in "${SSL_DIR}/server.crt" "${STORE}/origin.crt"; do
      [[ -f "$f" ]] || { echo "$f: missing"; continue; }
      echo "$f: $(openssl x509 -in "$f" -noout -issuer -enddate | tr '\n' ' ')"
    done
    fp() { openssl x509 -in "$1" -noout -fingerprint -sha256; }
    [[ "$(fp "${SSL_DIR}/server.crt")" == "$(fp "${STORE}/origin.crt")" ]] \
      && echo "active certificate is the stored Origin CA certificate" \
      || echo "active certificate differs from the stored Origin CA certificate (run: reinstall)"
    ;;
  *) die "usage: $0 install <crt> <key> | reinstall | status" ;;
esac
