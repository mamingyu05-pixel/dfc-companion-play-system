#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ".env" ]; then
  echo "Missing .env."
  exit 1
fi

git pull origin main
docker compose up -d --build
docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy

if [ -f "scripts/apply-https-nginx.sh" ]; then
  bash scripts/apply-https-nginx.sh
else
  docker compose restart nginx
fi

docker compose ps

echo "Production update complete."
