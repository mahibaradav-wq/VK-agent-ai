#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/vps-common.sh
source "$SCRIPT_DIR/lib/vps-common.sh"

ROOT_DIR="${VPS_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
STATE_DIR="${VPS_STATE_DIR:-$ROOT_DIR/.vps-state}"
mode="plan"
scenario=""

usage() {
  cat <<'EOF'
Rollback helper. Default is --plan (prints instructions, changes nothing).

  bash scripts/vps-rollback.sh --plan A|B
  bash scripts/vps-rollback.sh --apply A
  bash scripts/vps-rollback.sh --apply B

A  Application error without a schema change: restore previous Git SHA and polka-social:prod-prev.
   Do not restore the database.

B  Failure after migrate deploy: restore the verified backup, then previous Git SHA / image.
   Git checkout alone is not enough.

--apply B still requires CONFIRM_RESTORE=YES and RESTORE_CONFIRM=RESTORE plus backup file paths.
This script does not SSH and does not run against production from CI.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) mode="plan"; shift ;;
    --apply) mode="apply"; shift ;;
    -h|--help) usage; exit 0 ;;
    A|B) scenario="$1"; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

[[ -n "$scenario" ]] || { echo "Specify scenario A or B." >&2; usage >&2; exit 1; }

previous_sha="unknown"
if [[ -f "$STATE_DIR/previous-sha" ]]; then
  previous_sha="$(cat "$STATE_DIR/previous-sha")"
fi

echo "=== Rollback scenario $scenario ($mode) ==="
echo "Recorded previous SHA: $previous_sha"
echo "TOKEN_ENCRYPTION_KEY and AUTH_SECRET must stay the current production values. Do not restore secrets from Git."

if [[ "$scenario" == "A" ]]; then
  cat <<EOF
Scenario A — app/image only:
  1. docker compose stop app worker
  2. git checkout $previous_sha
  3. docker tag polka-social:prod-prev polka-social:prod   (if the previous image exists)
  4. docker compose up -d app worker caddy
  5. health-check /api/health
  Do not run prisma migrate deploy and do not restore PostgreSQL.
EOF
else
  cat <<'EOF'
Scenario B — schema already changed:
  1. Stop app and worker
  2. Restore PostgreSQL + media from the backup taken immediately before migrate
     CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
       DB_BACKUP=... MEDIA_BACKUP=... BACKUP_MANIFEST=... \
       bash scripts/restore-vps.sh
  3. git checkout the previous SHA
  4. Retag polka-social:prod-prev if present
  5. Start app/worker and health-check
  Returning Git without restore leaves Prisma and the database on different versions.
EOF
fi

if [[ "$mode" != "apply" ]]; then
  echo "Plan only. Re-run with --apply after the owner confirms."
  exit 0
fi

if [[ "$scenario" == "A" ]]; then
  [[ "$previous_sha" != "unknown" ]] || {
    echo "No previous SHA recorded in $STATE_DIR/previous-sha." >&2
    exit 1
  }
  vps_require_cmd docker git || exit 1
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop app worker
  git checkout "$previous_sha"
  if docker image inspect polka-social:prod-prev >/dev/null 2>&1; then
    docker tag polka-social:prod-prev polka-social:prod
  fi
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d app worker caddy
  echo "Scenario A apply finished. Check /api/health."
  exit 0
fi

: "${DB_BACKUP:?Set DB_BACKUP for scenario B}"
: "${MEDIA_BACKUP:?Set MEDIA_BACKUP for scenario B}"
: "${BACKUP_MANIFEST:?Set BACKUP_MANIFEST for scenario B}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-}" RESTORE_CONFIRM="${RESTORE_CONFIRM:-}" \
  COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
  DB_BACKUP="$DB_BACKUP" MEDIA_BACKUP="$MEDIA_BACKUP" BACKUP_MANIFEST="$BACKUP_MANIFEST" \
  bash "$SCRIPT_DIR/restore-vps.sh"
if [[ "$previous_sha" != "unknown" ]]; then
  git checkout "$previous_sha"
fi
if command -v docker >/dev/null 2>&1 && docker image inspect polka-social:prod-prev >/dev/null 2>&1; then
  docker tag polka-social:prod-prev polka-social:prod
fi
echo "Scenario B apply finished. Verify health, login, media, and queue."
