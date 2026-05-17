#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required on the host." >&2
  exit 1
fi

BACKUP_ROOT="${WINDOW_BACKUP_ROOT:-/var/backups/window}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_ROOT}/window-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_ROOT}"

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${DUMP_FILE}" \
  "${DATABASE_URL}"

if [[ -n "${WINDOW_BACKUP_BUCKET:-}" && -n "${WINDOW_BACKUP_NAMESPACE:-}" ]]; then
  if ! command -v oci >/dev/null 2>&1; then
    echo "OCI CLI is required to upload backups to Oracle Object Storage." >&2
    exit 1
  fi

  OBJECT_PREFIX="${WINDOW_BACKUP_PREFIX:-postgres}"
  OBJECT_NAME="${OBJECT_PREFIX}/$(basename "${DUMP_FILE}")"

  oci os object put \
    --bucket-name "${WINDOW_BACKUP_BUCKET}" \
    --namespace "${WINDOW_BACKUP_NAMESPACE}" \
    --name "${OBJECT_NAME}" \
    --file "${DUMP_FILE}" \
    --force
fi

find "${BACKUP_ROOT}" -type f -name 'window-*.dump' -mtime +"${WINDOW_BACKUP_RETENTION_DAYS:-14}" -delete

echo "Backup completed: ${DUMP_FILE}"
