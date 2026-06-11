#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ".env" ]; then
  echo "Missing .env."
  exit 1
fi

set -a
. ./.env
set +a

if [ -z "${DOMAIN:-}" ] || [ "${DOMAIN}" = "example.com" ]; then
  echo "Set DOMAIN in .env before applying HTTPS nginx config."
  exit 1
fi

sed "s/__DOMAIN__/${DOMAIN}/g" infra/nginx/nginx.ssl.conf.template > infra/nginx/nginx.conf

docker compose up -d nginx
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload

echo "HTTPS nginx config applied: https://${DOMAIN}/customer/"
