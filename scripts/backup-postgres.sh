#!/usr/bin/env bash
# Daily backup of the database and uploaded files. Run from the deployment directory (cron: scripts/install-backup-cron.sh).
# Keeps BACKUP_KEEP_DAYS (default 14) days locally; copy backups/ off the server too, a disk failure takes both.
set -euo pipefail

cd "$(dirname "$0")/.."
env_value() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
DB_USER="$(env_value POSTGRES_USER)"; DB_USER="${DB_USER:-dfc}"
DB_NAME="$(env_value POSTGRES_DB)"; DB_NAME="${DB_NAME:-dfc}"
KEEP_DAYS="$(env_value BACKUP_KEEP_DAYS)"; KEEP_DAYS="${KEEP_DAYS:-14}"

umask 077
mkdir -p backups
stamp="$(date +%Y%m%d_%H%M%S)"
db_file="backups/dfc_${stamp}.sql.gz"
uploads_file="backups/uploads_${stamp}.tar.gz"

docker compose exec -T postgres pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${db_file}.partial"
# A dump that is corrupt or cut short must not enter the rotation as if it were good.
gzip -t "${db_file}.partial"
if ! zcat "${db_file}.partial" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  echo "Backup incomplete: ${db_file}" >&2
  rm -f "${db_file}.partial"
  exit 1
fi
mv "${db_file}.partial" "${db_file}"

# The media archive must succeed too: a failed tar is an error, never an empty "backup" that pushes good ones out.
docker compose exec -T api-server sh -c 'cd "${UPLOAD_DIR:-/app/uploads}" && tar czf - .' > "${uploads_file}.partial"
if ! tar tzf "${uploads_file}.partial" > /dev/null; then
  echo "Uploads archive unreadable: ${uploads_file}" >&2
  rm -f "${uploads_file}.partial"
  exit 1
fi
mv "${uploads_file}.partial" "${uploads_file}"

# Rotate only after both new files are verified and in place.
find backups -maxdepth 1 -type f -name '*.partial' -mmin +60 -delete
find backups -maxdepth 1 -type f \( -name 'dfc_*.sql.gz' -o -name 'uploads_*.tar.gz' \) -mtime +"${KEEP_DAYS}" -delete

echo "Backup written: ${db_file} ($(du -h "${db_file}" | cut -f1)), ${uploads_file} ($(du -h "${uploads_file}" | cut -f1))"
