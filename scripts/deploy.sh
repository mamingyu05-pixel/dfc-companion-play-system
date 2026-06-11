#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.production.example to .env and fill real values first."
  exit 1
fi

docker compose build
docker compose up -d postgres
docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
docker compose run --rm api-server pnpm --filter @dfc/database seed:admin
docker compose up -d
docker compose ps

echo "Deployment complete."
echo "Open: http://YOUR_DOMAIN/customer"
echo "Open: http://YOUR_DOMAIN/companion"
echo "Open: http://YOUR_DOMAIN/admin"
