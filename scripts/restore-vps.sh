#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore is destructive. Set CONFIRM_RESTORE=YES after verifying the backup." >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Compose file or production env file not found." >&2
  exit 1
fi
: "${DB_BACKUP:?Set DB_BACKUP to the PostgreSQL dump file}"
: "${MEDIA_BACKUP:?Set MEDIA_BACKUP to the media archive}"
: "${BACKUP_MANIFEST:?Set BACKUP_MANIFEST to the matching .sha256 file}"

for command in docker tar sha256sum realpath; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

for file in "$DB_BACKUP" "$MEDIA_BACKUP" "$BACKUP_MANIFEST"; do
  [[ -f "$file" ]] || {
    echo "Backup file not found: $file" >&2
    exit 1
  }
done

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

DB_BACKUP="$(realpath "$DB_BACKUP")"
MEDIA_BACKUP="$(realpath "$MEDIA_BACKUP")"
BACKUP_MANIFEST="$(realpath "$BACKUP_MANIFEST")"
backup_dir="$(dirname "$BACKUP_MANIFEST")"
if [[ "$(dirname "$DB_BACKUP")" != "$backup_dir" || "$(dirname "$MEDIA_BACKUP")" != "$backup_dir" ]]; then
  echo "DB_BACKUP, MEDIA_BACKUP, and BACKUP_MANIFEST must be in the same directory." >&2
  exit 1
fi
manifest_files="$(awk '{ separator = index($0, "  "); if (separator > 0) print substr($0, separator + 2) }' "$BACKUP_MANIFEST" | sort)"
expected_files="$(printf '%s\\n%s\\n' "$(basename "$DB_BACKUP")" "$(basename "$MEDIA_BACKUP")" | sort)"
if [[ "$manifest_files" != "$expected_files" ]]; then
  echo "Checksum manifest must contain exactly the selected database and media files." >&2
  exit 1
fi
(
  cd "$backup_dir"
  sha256sum --check "$(basename "$BACKUP_MANIFEST")"
)
tar -tzf "$MEDIA_BACKUP" >/dev/null
compose exec -T postgres pg_restore --list < "$DB_BACKUP" >/dev/null

echo "This will replace the current PostgreSQL database and media files."
echo "Backup manifest verified: $BACKUP_MANIFEST"
read -r -p "Type RESTORE to continue: " answer
if [[ "$answer" != "RESTORE" ]]; then
  echo "Restore cancelled."
  exit 1
fi

# Keep the web app and worker stopped until both data stores are restored.
compose stop app worker
compose exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DB_BACKUP"

# Run a one-off container with the production media volume mounted. Clear old
# files first so objects absent from the backup do not remain on disk.
compose run --rm --no-deps -T --entrypoint sh app -lc 'find /app/data/media -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf - -C /app/data/media' < "$MEDIA_BACKUP"

compose up -d app worker
echo "Restore completed. Verify /api/health, login, media files, and queue state."
