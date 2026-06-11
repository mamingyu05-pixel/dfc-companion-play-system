#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/server-bootstrap.sh"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git ufw docker.io docker-compose-plugin

systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Server bootstrap complete."
echo "Next: copy project files, create .env from .env.production.example, then run scripts/deploy.sh."
