#!/usr/bin/env bash
set -euo pipefail

root="${VPS_APP_DIR:-/opt/polka-social}"
cd "$root"

ref="${1:-}"
if [[ -n "$ref" ]]; then
  git fetch origin "$ref"
  git checkout "$ref"
  git pull --ff-only origin "$ref"
else
  git pull --ff-only
fi

args=(-f docker-compose.prod.yml)
if [[ -f docker-compose.timeweb.yml ]]; then
  args+=(-f docker-compose.timeweb.yml)
fi

docker compose "${args[@]}" --env-file .env.production up -d --build
curl -fsS --max-time 30 "${NEXT_PUBLIC_SITE_URL:-https://24dom-po-polochkam.ru}/api/health" || true
