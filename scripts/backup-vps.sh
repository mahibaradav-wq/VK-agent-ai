#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/vps-common.sh
source "$SCRIPT_DIR/lib/vps-common.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/opt/polka-social-backups}"
VPS_RUNTIME="${VPS_RUNTIME:-compose}"

vps_require_cmd tar sha256sum || exit 1
if [[ "$VPS_RUNTIME" == "probe" ]]; then
  vps_require_cmd pg_dump pg_restore pg_isready psql || exit 1
  : "${PROBE_PGHOST:?Set PROBE_PGHOST for isolated backup tests}"
  : "${PROBE_PGPORT:?Set PROBE_PGPORT}"
  : "${PROBE_PGUSER:?Set PROBE_PGUSER}"
  : "${PROBE_PGDATABASE:?Set PROBE_PGDATABASE}"
  : "${PROBE_MEDIA_DIR:?Set PROBE_MEDIA_DIR}"
  : "${PROBE_STATE_DIR:?Set PROBE_STATE_DIR}"
  PROBE_PGPASSWORD="${PROBE_PGPASSWORD:-}"
  vps_probe_assert_isolated_target || exit 1
else
  vps_require_cmd docker || exit 1
  vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || exit 1
fi

vps_require_free_bytes "$BACKUP_DIR" || exit 1
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_name="polka-db-$timestamp.dump"
media_name="polka-media-$timestamp.tar.gz"
manifest_name="polka-$timestamp.sha256"
db_tmp="$BACKUP_DIR/.$db_name.tmp.$$"
media_tmp="$BACKUP_DIR/.$media_name.tmp.$$"
manifest_tmp="$BACKUP_DIR/.$manifest_name.tmp.$$"

APP_WAS_RUNNING=false
WORKER_WAS_RUNNING=false
services_stopped=false
backup_complete=false

restart_services() {
  vps_restart_writers
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

vps_postgres_running || {
  echo "PostgreSQL is not available." >&2
  exit 1
}

vps_service_running app && APP_WAS_RUNNING=true
vps_service_running worker && WORKER_WAS_RUNNING=true

services_stopped=true
vps_stop_writers

vps_dump_database "$db_tmp"
[[ -s "$db_tmp" ]] || {
  echo "Database dump is empty." >&2
  exit 1
}
vps_list_dump "$db_tmp"

vps_archive_media "$media_tmp"
[[ -s "$media_tmp" ]] || {
  echo "Media archive is empty." >&2
  exit 1
}
tar -tzf "$media_tmp" >/dev/null

mv "$db_tmp" "$BACKUP_DIR/$db_name"
mv "$media_tmp" "$BACKUP_DIR/$media_name"
chmod 600 "$BACKUP_DIR/$db_name" "$BACKUP_DIR/$media_name"
(
  cd "$BACKUP_DIR"
  sha256sum "$db_name" "$media_name" >"$manifest_tmp"
)
chmod 600 "$manifest_tmp"
mv "$manifest_tmp" "$BACKUP_DIR/$manifest_name"
backup_complete=true

restart_services
services_stopped=false

echo "Backup completed:"
echo "  Database: $BACKUP_DIR/$db_name"
echo "  Media:    $BACKUP_DIR/$media_name"
echo "  Checksums:$BACKUP_DIR/$manifest_name"
echo "Store an encrypted copy off this VPS. Do not commit backup files to Git."
