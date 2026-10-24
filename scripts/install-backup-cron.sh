#!/usr/bin/env bash
# Install the daily backup job. Run once as root from the deployment directory.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
# The log lives in backups/, so it must exist before cron's first redirect, or the job never starts.
mkdir -p "${dir}/backups"
chmod 700 "${dir}/backups"
cat > /etc/cron.d/dfc-backup <<CRON
SHELL=/bin/bash
# 04:20 server time, quietly; failures go to backups/backup.log.
20 4 * * * root cd ${dir} && mkdir -p backups && bash scripts/backup-postgres.sh >> backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/dfc-backup
echo "Installed /etc/cron.d/dfc-backup"
