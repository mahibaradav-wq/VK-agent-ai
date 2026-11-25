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
BACKUP_DIR="${BACKUP_DIR:-/opt/polka-social-backups}"
STATE_DIR="${VPS_STATE_DIR:-$ROOT_DIR/.vps-state}"
mode="plan"
ref=""

usage() {
  cat <<'EOF'
Safe VPS update. Does not run unless you pass --apply.

  bash scripts/vps-pull.sh --plan [git-ref]
  bash scripts/vps-pull.sh --apply [git-ref]

--plan  Read-only preflight: git, Docker, disk, env keys, locally available target ref.
        Does not create files or directories, does not git fetch/checkout, and does not
        write previous-sha. If a check would need a write or fetch, it stops.
--apply Records the current SHA, creates and verifies a backup, then checkout, image tag,
        build, migrate, start, health-check. Never runs if backup fails.

This script never SSHs anywhere. Run it on the VPS after an owner decision.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) mode="plan"; shift ;;
    --apply) mode="apply"; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      ref="$1"
      shift
      ;;
  esac
done
[[ $# -eq 0 ]] || { ref="$1"; shift; }

read_only_preflight() {
  vps_require_cmd git docker tar sha256sum || return 1
  vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || return 1
  vps_validate_production_env_file "$ENV_FILE" || return 1
  if [[ "${VPS_SKIP_GIT_CLEAN:-}" != "true" ]]; then
    vps_git_clean || return 1
  fi
  vps_check_free_bytes "$BACKUP_DIR" || return 1
  echo "Current commit: $(git rev-parse HEAD)"
  if [[ -n "$ref" ]]; then
    if git rev-parse --verify "$ref^{commit}" >/dev/null 2>&1; then
      echo "Target ref is already available locally: $ref"
    elif git rev-parse --verify "origin/$ref^{commit}" >/dev/null 2>&1; then
      echo "Target ref is already available locally as origin/$ref"
    else
      echo "Target ref is not available locally. --plan does not git fetch or change refs. Fetch on the VPS, then re-run --plan." >&2
      return 1
    fi
  else
    echo "No target ref given; --apply would fast-forward the current branch."
  fi
  docker info >/dev/null
  echo "Docker is available. Free space check passed."
  echo "--plan is read-only: no files, directories, Git objects, backup, migrate, or restart."
}

apply_preflight() {
  vps_require_cmd git docker tar sha256sum || return 1
  vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || return 1
  vps_validate_production_env_file "$ENV_FILE" || return 1
  if [[ "${VPS_SKIP_GIT_CLEAN:-}" != "true" ]]; then
    vps_git_clean || return 1
  fi
  vps_require_free_bytes "$BACKUP_DIR" || return 1
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  vps_record_sha "$STATE_DIR/previous-sha"
  echo "Current commit: $(git rev-parse HEAD)"
  if [[ -n "$ref" ]]; then
    git fetch origin "$ref"
    git rev-parse --verify "origin/$ref^{commit}" >/dev/null 2>&1 || git rev-parse --verify "$ref^{commit}" >/dev/null
    echo "Target ref is reachable: $ref"
  else
    echo "No target ref given; fast-forwarding the current branch after backup."
  fi
  docker info >/dev/null
  echo "Docker is available. Free space check passed."
}

echo "=== Polka Social VPS update ($mode) ==="
if [[ "$mode" == "apply" ]]; then
  apply_preflight
else
  read_only_preflight
fi

if [[ "$mode" != "apply" ]]; then
  cat <<'EOF'
Plan (not executed):
  1. Record current Git SHA
  2. Create and verify backup (scripts/backup-vps.sh)
  3. Tag current image as polka-social:prod-prev
  4. Checkout the target Git ref
  5. Build the new image
  6. Run Prisma migrate deploy as a separate step (scripts/vps-migrate.sh)
  7. Start app and worker
  8. Health-check via the app container /api/health
  9. On failure: stop and follow docs/runbooks/rollback.md

Re-run with --apply only after the owner confirms this plan.
EOF
  exit 0
fi

echo "Creating backup before any checkout or migrate..."
BACKUP_DIR="$BACKUP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/backup-vps.sh"
latest_manifest=""
shopt -s nullglob
manifests=("$BACKUP_DIR"/polka-*.sha256)
shopt -u nullglob
if ((${#manifests[@]} > 0)); then
  latest_manifest="$(ls -1t "${manifests[@]}" | head -n1)"
fi
[[ -n "$latest_manifest" && -f "$latest_manifest" ]] || {
  echo "Backup did not produce a manifest. Refusing to update." >&2
  exit 1
}
echo "Backup verified: $latest_manifest" >"$STATE_DIR/last-backup"
echo "$latest_manifest" >>"$STATE_DIR/last-backup"

if docker image inspect polka-social:prod >/dev/null 2>&1; then
  docker tag polka-social:prod polka-social:prod-prev
  echo "Tagged current image as polka-social:prod-prev"
fi

if [[ -n "$ref" ]]; then
  git checkout "$ref"
  git pull --ff-only origin "$ref"
else
  git pull --ff-only
fi

compose_args=(-f "$COMPOSE_FILE")
if [[ -f docker-compose.timeweb.yml ]]; then
  echo "Using local overlay docker-compose.timeweb.yml (not in git)."
  compose_args+=(-f docker-compose.timeweb.yml)
fi

docker compose "${compose_args[@]}" --env-file "$ENV_FILE" build app

BACKUP_VERIFIED=YES COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/vps-migrate.sh"

docker compose "${compose_args[@]}" --env-file "$ENV_FILE" up -d app worker caddy

# Compose app healthcheck start_period is 90s; default wait must cover that window.
health_attempts="${HEALTHCHECK_ATTEMPTS:-40}"
health_interval="${HEALTHCHECK_INTERVAL_SECONDS:-3}"
if [[ ! "$health_attempts" =~ ^[1-9][0-9]*$ || ! "$health_interval" =~ ^[1-9][0-9]*$ ]]; then
  echo "HEALTHCHECK_ATTEMPTS and HEALTHCHECK_INTERVAL_SECONDS must be positive integers." >&2
  exit 1
fi

for ((attempt = 1; attempt <= health_attempts; attempt++)); do
  if COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" vps_internal_health; then
    echo "Health check passed on attempt $attempt/$health_attempts."
    git rev-parse HEAD >"$STATE_DIR/current-sha"
    exit 0
  fi
  if ((attempt < health_attempts)); then
    echo "Health check failed on attempt $attempt/$health_attempts; retrying in ${health_interval}s..." >&2
    sleep "$health_interval"
  fi
done

echo "Update health check failed. Leave app/worker as they are and follow docs/runbooks/rollback.md" >&2
echo "Previous SHA: $(cat "$STATE_DIR/previous-sha")" >&2
echo "Backup manifest: $latest_manifest" >&2
exit 1
