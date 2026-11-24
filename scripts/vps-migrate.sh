#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/vps-common.sh
source "$SCRIPT_DIR/lib/vps-common.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
VPS_RUNTIME="${VPS_RUNTIME:-compose}"

if [[ "${FIRST_INSTALL:-}" != "YES" && "${BACKUP_VERIFIED:-}" != "YES" ]]; then
  echo "Refusing migrations without a verified backup. Set BACKUP_VERIFIED=YES after backup-vps.sh, or FIRST_INSTALL=YES for an empty database." >&2
  exit 1
fi

if [[ "$VPS_RUNTIME" == "probe" ]]; then
  : "${PROBE_DATABASE_URL:?Set PROBE_DATABASE_URL for isolated migrate tests}"
  vps_probe_assert_isolated_url || exit 1
  (cd "$ROOT_DIR" && DATABASE_URL="$PROBE_DATABASE_URL" npx prisma migrate deploy)
  exit 0
fi

vps_require_cmd docker || exit 1
vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || exit 1
vps_postgres_running || {
  echo "PostgreSQL is not running. Start postgres before migrate." >&2
  exit 1
}

vps_compose run --rm --no-deps --entrypoint npx app prisma migrate deploy
