#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/opt/polka-social-backups}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi
for command in docker tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_name="polka-db-$timestamp.dump"
media_name="polka-media-$timestamp.tar.gz"
manifest_name="polka-$timestamp.sha256"
db_tmp="$BACKUP_DIR/.$db_name.tmp.$$"
media_tmp="$BACKUP_DIR/.$media_name.tmp.$$"
manifest_tmp="$BACKUP_DIR/.$manifest_name.tmp.$$"

app_was_running=false
worker_was_running=false
services_stopped=false
backup_complete=false

restart_services() {
  local failed=0
  if [[ "$app_was_running" == true ]]; then
    compose up -d app >/dev/null || failed=1
  fi
  if [[ "$worker_was_running" == true ]]; then
    compose up -d worker >/dev/null || failed=1
  fi
  if (( failed != 0 )); then
    echo "WARNING: could not restart all services; inspect docker compose status." >&2
    return 1
  fi
}

cleanup() {
  local status=$?
  rm -f "$db_tmp" "$media_tmp" "$manifest_tmp"
  if [[ "$backup_complete" != true ]]; then
    rm -f "$BACKUP_DIR/$db_name" "$BACKUP_DIR/$media_name" "$BACKUP_DIR/$manifest_name"
  fi
  if [[ "$services_stopped" == true ]]; then
    restart_services || true
  fi
  exit "$status"
}
trap cleanup EXIT

[[ -n "$(compose ps -q postgres)" ]] || {
  echo "PostgreSQL container is not running." >&2
  exit 1
}
[[ -n "$(compose ps -q app)" ]] && app_was_running=true
[[ -n "$(compose ps -q worker)" ]] && worker_was_running=true

# Pause writers so the database dump and media archive describe the same
# application state. PostgreSQL remains online for pg_dump.
services_stopped=true
compose stop app worker >/dev/null

compose exec -T postgres sh -lc 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$db_tmp"
[[ -s "$db_tmp" ]] || {
  echo "Database dump is empty." >&2
  exit 1
}
compose exec -T postgres pg_restore --list < "$db_tmp" >/dev/null

# A one-off app container mounts the same media_data volume without starting
# the web server or running migrations.
compose run --rm --no-deps -T --entrypoint sh app -lc 'tar -czf - -C /app/data/media .' > "$media_tmp"
tar -tzf "$media_tmp" >/dev/null

mv "$db_tmp" "$BACKUP_DIR/$db_name"
mv "$media_tmp" "$BACKUP_DIR/$media_name"
(
  cd "$BACKUP_DIR"
  sha256sum "$db_name" "$media_name" > "$manifest_tmp"
)
mv "$manifest_tmp" "$BACKUP_DIR/$manifest_name"
backup_complete=true

restart_services
services_stopped=false

echo "Backup completed:"
echo "  Database: $BACKUP_DIR/$db_name"
echo "  Media:    $BACKUP_DIR/$media_name"
echo "  Checksums:$BACKUP_DIR/$manifest_name"
echo "Store an encrypted copy off this VPS. Do not commit backup files to Git."
