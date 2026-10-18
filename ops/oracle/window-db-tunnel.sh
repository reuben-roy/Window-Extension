#!/usr/bin/env bash
# (Re)creates the cloudflared connector that carries Window's private Postgres
# traffic. Tunnel "window-postgres-oracle" is remotely managed; the connector
# joins the Coolify Docker network. Hostname resolution (window-db.explosion.fun
# -> the database container's address) is done through the Workers VPC service
# and a DNS-only record; see sync-window-db-dns.sh. The connector itself does not
# depend on the database's address, so it survives database redeploys. No ports
# are published.
#
# Requires ~/.window-deploy/tunnel.token (mode 600; from `cf tunnels token get`).
set -euo pipefail

TOKEN_FILE="${WINDOW_TUNNEL_TOKEN_FILE:-$HOME/.window-deploy/tunnel.token}"
NAME="${WINDOW_TUNNEL_CONTAINER:-window-postgres-tunnel}"

[[ -r "$TOKEN_FILE" ]] || { echo "error: $TOKEN_FILE not readable" >&2; exit 1; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --user "$(id -u):$(id -g)" --network coolify \
  -v "${TOKEN_FILE}:/etc/tunnel.token:ro" \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run --token-file /etc/tunnel.token >/dev/null
echo "connector ${NAME} started"
