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

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore is destructive. Set CONFIRM_RESTORE=YES after verifying the backup." >&2
  exit 1
fi

: "${DB_BACKUP:?Set DB_BACKUP to the PostgreSQL dump file}"
: "${MEDIA_BACKUP:?Set MEDIA_BACKUP to the media archive}"
: "${BACKUP_MANIFEST:?Set BACKUP_MANIFEST to the matching .sha256 file}"

vps_require_cmd tar sha256sum realpath || exit 1
if [[ "$VPS_RUNTIME" == "probe" ]]; then
  vps_require_cmd pg_restore pg_isready psql || exit 1
  : "${PROBE_PGHOST:?Set PROBE_PGHOST for isolated restore tests}"
  : "${PROBE_PGPORT:?Set PROBE_PGPORT}"
  : "${PROBE_PGUSER:?Set PROBE_PGUSER}"
  : "${PROBE_PGDATABASE:?Set PROBE_PGDATABASE}"
  : "${PROBE_MEDIA_DIR:?Set PROBE_MEDIA_DIR}"
  : "${PROBE_STATE_DIR:?Set PROBE_STATE_DIR}"
  PROBE_PGPASSWORD="${PROBE_PGPASSWORD:-}"
  vps_refuse_production_probe "$PROBE_PGHOST$PROBE_PGDATABASE$PROBE_MEDIA_DIR" || exit 1
else
  vps_require_cmd docker || exit 1
  vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || exit 1
fi

for file in "$DB_BACKUP" "$MEDIA_BACKUP" "$BACKUP_MANIFEST"; do
  [[ -f "$file" ]] || {
    echo "Backup file not found: $file" >&2
    exit 1
  }
done

DB_BACKUP="$(realpath "$DB_BACKUP")"
MEDIA_BACKUP="$(realpath "$MEDIA_BACKUP")"
BACKUP_MANIFEST="$(realpath "$BACKUP_MANIFEST")"
backup_dir="$(dirname "$BACKUP_MANIFEST")"
if [[ "$(dirname "$DB_BACKUP")" != "$backup_dir" || "$(dirname "$MEDIA_BACKUP")" != "$backup_dir" ]]; then
  echo "DB_BACKUP, MEDIA_BACKUP, and BACKUP_MANIFEST must be in the same directory." >&2
  exit 1
fi
if ! vps_same_backup_set "$DB_BACKUP" "$MEDIA_BACKUP" "$BACKUP_MANIFEST"; then
  echo "Backup filenames must share one timestamp (YYYYMMDDTHHMMSSZ)." >&2
  exit 1
fi

manifest_files="$(awk '{ separator = index($0, "  "); if (separator > 0) print substr($0, separator + 2) }' "$BACKUP_MANIFEST" | sort)"
expected_files="$(printf '%s\n%s\n' "$(basename "$DB_BACKUP")" "$(basename "$MEDIA_BACKUP")" | sort)"
if [[ "$manifest_files" != "$expected_files" ]]; then
  echo "Checksum manifest must contain exactly the selected database and media files." >&2
  exit 1
fi
(
  cd "$backup_dir"
  sha256sum --check "$(basename "$BACKUP_MANIFEST")"
)
tar -tzf "$MEDIA_BACKUP" >/dev/null
vps_list_dump "$DB_BACKUP"

echo "This will replace the current PostgreSQL database and media files."
echo "Backup manifest verified: $BACKUP_MANIFEST"
if [[ "${RESTORE_CONFIRM:-}" == "RESTORE" ]]; then
  echo "RESTORE_CONFIRM=RESTORE accepted for isolated validation."
else
  if [[ ! -t 0 && -z "${RESTORE_CONFIRM:-}" ]]; then
    echo "No TTY. Re-run with RESTORE_CONFIRM=RESTORE after CONFIRM_RESTORE=YES, or type RESTORE on a terminal." >&2
    exit 1
  fi
  read -r -p "Type RESTORE to continue: " answer
  if [[ "$answer" != "RESTORE" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
fi

restore_ok=false
vps_stop_writers
if vps_restore_database "$DB_BACKUP" && vps_verify_database && vps_extract_media "$MEDIA_BACKUP"; then
  restore_ok=true
fi

if [[ "$restore_ok" != true ]]; then
  echo "Restore failed. Application and worker stay stopped. Do not start them until the backup is re-checked." >&2
  exit 1
fi

if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
  vps_mark_service app running
  vps_mark_service worker running
else
  vps_compose up -d app worker
fi

echo "Restore completed. Verify /api/health, login, media files, and queue state."
