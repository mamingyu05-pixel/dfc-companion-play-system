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
  echo "Set DOMAIN in .env before enabling HTTPS."
  exit 1
fi

if [ -z "${LETSENCRYPT_EMAIL:-}" ]; then
  echo "Set LETSENCRYPT_EMAIL in .env before enabling HTTPS."
  exit 1
fi

docker compose up -d nginx

docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --domain "${DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos \
  --no-eff-email

cp infra/nginx/nginx.conf "infra/nginx/nginx.conf.before-ssl.$(date +%Y%m%d_%H%M%S)"
sed "s/__DOMAIN__/${DOMAIN}/g" infra/nginx/nginx.ssl.conf.template > infra/nginx/nginx.conf

docker compose up -d nginx
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload

echo "HTTPS enabled: https://${DOMAIN}/customer"
