#!/usr/bin/env bash
# Install the daily backup job. Run once as root from the deployment directory.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
cat > /etc/cron.d/dfc-backup <<CRON
SHELL=/bin/bash
# 04:20 server time, quietly; failures go to backups/backup.log.
20 4 * * * root cd ${dir} && bash scripts/backup-postgres.sh >> backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/dfc-backup
echo "Installed /etc/cron.d/dfc-backup"
