#!/usr/bin/env bash
set -euo pipefail

docker compose logs -f --tail=200 nginx api-server customer-web companion-web admin-web discord-bot kook-bot
