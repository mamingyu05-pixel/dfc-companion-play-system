#!/usr/bin/env bash
# Get a Let's Encrypt certificate for DOMAIN and www.DOMAIN, switch nginx to HTTPS,
# and install a daily renewal job. Run from the deployment directory as root.
set -euo pipefail

if [ ! -f ".env" ]; then
  echo "Missing .env."
  exit 1
fi

env_value() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
DOMAIN="$(env_value DOMAIN)"
LETSENCRYPT_EMAIL="$(env_value LETSENCRYPT_EMAIL)"

if [ -z "${DOMAIN}" ] || [ "${DOMAIN}" = "example.com" ]; then
  echo "Set DOMAIN in .env before enabling HTTPS."
  exit 1
fi

if [ -z "${LETSENCRYPT_EMAIL}" ]; then
  echo "Set LETSENCRYPT_EMAIL in .env before enabling HTTPS."
  exit 1
fi

# The plain-HTTP config already serves /.well-known/acme-challenge/ for the webroot check.
docker compose up -d nginx

docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --domain "${DOMAIN}" \
  --domain "www.${DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --keep-until-expiring \
  --non-interactive

bash scripts/apply-https-nginx.sh

# Renew twice a day (certbot only acts within 30 days of expiry), then reload nginx to pick it up.
cat > /etc/cron.d/dfc-certbot <<CRON
SHELL=/bin/bash
17 3,15 * * * root cd $(pwd) && docker compose run --rm certbot renew --quiet && docker compose exec -T nginx nginx -s reload >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/dfc-certbot

echo "HTTPS enabled: https://${DOMAIN}/"
