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

health_url="${NEXT_PUBLIC_SITE_URL:-https://24dom-po-polochkam.ru}/api/health"
health_attempts="${HEALTHCHECK_ATTEMPTS:-10}"
health_interval="${HEALTHCHECK_INTERVAL_SECONDS:-3}"

if [[ ! "$health_attempts" =~ ^[1-9][0-9]*$ || ! "$health_interval" =~ ^[1-9][0-9]*$ ]]; then
  echo "HEALTHCHECK_ATTEMPTS and HEALTHCHECK_INTERVAL_SECONDS must be positive integers." >&2
  exit 1
fi

for ((attempt = 1; attempt <= health_attempts; attempt++)); do
  if curl -fsS --max-time 10 "$health_url"; then
    echo "Health check passed on attempt $attempt/$health_attempts."
    exit 0
  fi

  if (( attempt < health_attempts )); then
    echo "Health check failed on attempt $attempt/$health_attempts; retrying in ${health_interval}s..." >&2
    sleep "$health_interval"
  fi
done

echo "Deployment health check failed after $health_attempts attempts: $health_url" >&2
exit 1
