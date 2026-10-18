#!/usr/bin/env bash
# Points window-db.explosion.fun at the Window Postgres container's current
# address on the Coolify Docker network. Run from a machine with `cf` and the
# `oracle` SSH alias after anything that recreates or restarts the database
# container (Coolify redeploy, host reboot).
#
# Why a DNS record at all: the Workers VPC service resolves the hostname through
# the tunnel using the public resolver 1.1.1.1 (the Oracle host's resolver drops
# private answers), and the Origin CA certificate is issued for this hostname so
# Workers VPC can verify it (verify_full). The record is DNS-only and points at a
# private (RFC 1918) address, so it exposes nothing.
#
# Usage: sync-window-db-dns.sh [--dry-run]
set -euo pipefail

ZONE="${WINDOW_DNS_ZONE:-2d2e6ba37ebce5a62425af3ec1183974}"  # explosion.fun
NAME="${WINDOW_DB_HOSTNAME:-window-db.explosion.fun}"
DB_UUID="${WINDOW_DB_UUID:-w2c1as5kuqogvg0mb4jilfvy}"

ip="$(ssh oracle "docker inspect ${DB_UUID} --format '{{ (index .NetworkSettings.Networks \"coolify\").IPAddress }}'")"
[[ "$ip" =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: unexpected container address '${ip}'" >&2; exit 1; }

record="$(cf dns records list -z "$ZONE" --name "$NAME" 2>/dev/null)"
current="$(node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); const a=(Array.isArray(r)?r:r.result??[]).find(x=>x.type==="A"); console.log(a?a.id+" "+a.content:"")' <<<"$record")"
[[ -n "$current" ]] || { echo "error: no A record for ${NAME} in ${ZONE}" >&2; exit 1; }
id="${current%% *}"; content="${current##* }"

if [[ "$content" == "$ip" ]]; then
  echo "${NAME} already points at ${ip}"
  exit 0
fi
echo "${NAME}: ${content} -> ${ip}"
[[ "${1:-}" == "--dry-run" ]] && exit 0
cf dns records edit "$id" -z "$ZONE" --body "{\"content\":\"${ip}\"}" >/dev/null
echo "updated"
