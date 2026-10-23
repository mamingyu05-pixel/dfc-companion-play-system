#!/usr/bin/env bash
# Render the HTTPS nginx config for DOMAIN into an untracked file and switch nginx to it.
# The tracked infra/nginx/nginx.conf stays the plain-HTTP config, so `git pull` never conflicts.
set -euo pipefail

if [ ! -f ".env" ]; then
  echo "Missing .env."
  exit 1
fi

# Read only the keys we need instead of sourcing .env as shell code.
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
DOMAIN="$(env_value DOMAIN)"

if [ -z "${DOMAIN}" ] || [ "${DOMAIN}" = "example.com" ]; then
  echo "Set DOMAIN in .env before applying HTTPS nginx config."
  exit 1
fi
if ! docker compose run --rm --entrypoint test certbot -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"; then
  echo "No certificate for ${DOMAIN} yet. Run scripts/enable-https.sh first."
  exit 1
fi

sed "s/__DOMAIN__/${DOMAIN}/g" infra/nginx/nginx.ssl.conf.template > infra/nginx/nginx.https.conf
# Check the new config in a throwaway container first, so a mistake never takes the live site down.
docker compose run --rm --no-deps -v "$PWD/infra/nginx/nginx.https.conf:/etc/nginx/nginx.conf:ro" nginx nginx -t

if grep -q '^NGINX_CONF_FILE=' .env; then
  sed -i 's#^NGINX_CONF_FILE=.*#NGINX_CONF_FILE=./infra/nginx/nginx.https.conf#' .env
else
  echo 'NGINX_CONF_FILE=./infra/nginx/nginx.https.conf' >> .env
fi

# The bind mount source changes, so nginx must be recreated rather than reloaded.
docker compose up -d --force-recreate nginx
docker compose exec -T nginx nginx -t

echo "HTTPS nginx config applied: https://${DOMAIN}/"
