#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-https://maycatplay.com}}"
BASE_URL="${BASE_URL%/}"

paths=(
  "/api/health"
  "/customer/"
  "/admin/"
  "/companion/"
)

for path in "${paths[@]}"; do
  url="${BASE_URL}${path}"
  status="$(curl -fsS -L --max-time 20 -o /dev/null -w "%{http_code}" "$url")"
  case "$status" in
    200|204|301|302|307|308)
      echo "OK $status $url"
      ;;
    *)
      echo "FAIL $status $url" >&2
      exit 1
      ;;
  esac
done

echo "Smoke check passed for ${BASE_URL}"
