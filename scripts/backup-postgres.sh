#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups

timestamp="$(date +%Y%m%d_%H%M%S)"
backup_file="backups/dfc_${timestamp}.sql.gz"

docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-dfc}" "${POSTGRES_DB:-dfc}" | gzip > "${backup_file}"

echo "Backup written: ${backup_file}"
