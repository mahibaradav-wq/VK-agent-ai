#!/usr/bin/env bash
# Shared helpers for VPS backup, restore, migrate, pull and rollback.
# Never print secret values. Never use production DATABASE_URL in probe mode.

umask 077

vps_root() {
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  pwd
}

vps_env_get() {
  local file="$1" key="$2"
  awk -F= -v key="$key" '$1==key {print substr($0, index($0,"=")+1); exit}' "$file"
}

vps_require_cmd() {
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null 2>&1 || {
      echo "Required command not found: $name" >&2
      return 1
    }
  done
}

vps_require_file() {
  local path
  for path in "$@"; do
    [[ -f "$path" ]] || {
      echo "Required file not found: $path" >&2
      return 1
    }
  done
}

# Probe mode is never trusted by itself. Isolated PostgreSQL is allowed only when
# host, port, user and database all match a local test allowlist and the host
# resolves only to loopback. Fail before any client talks to PostgreSQL.
# Never print passwords or connection URLs.

vps_probe_python() {
  python3 -c 'import ipaddress, os, re, socket, sys
from urllib.parse import unquote, urlparse

ALLOWED_HOSTS = {"localhost", "postgres"}
ALLOWED_PORTS = {5432}
ALLOWED_USERS = {"polka"}
DB_RE = re.compile(r"^polka_vps_probe(_[A-Za-z0-9]+)*$")

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)

def normalize_host(host):
    host = (host or "").strip()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host

def is_ip(host):
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False

def is_loopback_ip(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False

def host_allowlisted(host):
    host = normalize_host(host)
    if not host:
        return False
    if is_ip(host):
        return is_loopback_ip(host)
    return host in ALLOWED_HOSTS

def check_host(host):
    host = normalize_host(host)
    if not host:
        fail("Probe host is missing.")
    if is_ip(host):
        if not is_loopback_ip(host):
            fail("Probe host is not a loopback address.")
        return
    if host not in ALLOWED_HOSTS:
        fail("Probe host is not on the isolated allowlist.")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        fail("Probe host cannot be resolved; refusing.")
    if not infos:
        fail("Probe host cannot be resolved; refusing.")
    for info in infos:
        ip = info[4][0]
        if "%" in ip:
            ip = ip.split("%", 1)[0]
        if not is_loopback_ip(ip):
            fail("Probe host does not resolve only to loopback.")

def check_fields(host, port, user, database):
    check_host(host)
    try:
        port_n = int(port)
    except (TypeError, ValueError):
        fail("Probe port is not allowed.")
    if port_n not in ALLOWED_PORTS:
        fail("Probe port is not allowed.")
    if (user or "") not in ALLOWED_USERS:
        fail("Probe user is not allowed.")
    if not DB_RE.fullmatch(database or ""):
        fail("Probe database name is not an isolated test database.")

def parse_url():
    raw = os.environ.get("PROBE_DATABASE_URL") or ""
    if not raw.strip():
        fail("Probe DATABASE_URL is missing.")
    if "?" in raw or "#" in raw:
        fail("Probe DATABASE_URL must not include query parameters.")
    parsed = urlparse(raw)
    if parsed.scheme not in {"postgres", "postgresql"}:
        fail("Probe DATABASE_URL scheme is not allowed.")
    host = parsed.hostname or ""
    if parsed.port is None:
        fail("Probe port is not allowed.")
    user = unquote(parsed.username or "")
    database = unquote((parsed.path or "").lstrip("/"))
    if "/" in database or not database:
        fail("Probe database name is not an isolated test database.")
    check_fields(host, str(parsed.port), user, database)
    return host, str(parsed.port), user, database

mode = sys.argv[1]
if mode == "host-allowlisted":
    raise SystemExit(0 if host_allowlisted(sys.argv[2] if len(sys.argv) > 2 else "") else 1)
if mode == "check-fields":
    if len(sys.argv) < 6:
        fail("Probe connection fields are incomplete.")
    check_fields(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    raise SystemExit(0)
if mode == "parse-url":
    host, port, user, database = parse_url()
    print(host)
    print(port)
    print(user)
    print(database)
    raise SystemExit(0)
fail("Unknown probe check.")
' "$@"
}

vps_probe_host_allowlisted() {
  vps_probe_python host-allowlisted "${1:-}"
}

vps_probe_assert_isolated_target() {
  if [[ "${VPS_RUNTIME:-}" != "probe" ]]; then
    echo "Isolated probe checks require VPS_RUNTIME=probe." >&2
    return 1
  fi
  if [[ -z "${PROBE_PGHOST:-}" || -z "${PROBE_PGPORT:-}" || -z "${PROBE_PGUSER:-}" || -z "${PROBE_PGDATABASE:-}" ]]; then
    echo "Probe connection fields are incomplete." >&2
    return 1
  fi
  vps_probe_python check-fields "$PROBE_PGHOST" "$PROBE_PGPORT" "$PROBE_PGUSER" "$PROBE_PGDATABASE"
}

vps_probe_assert_isolated_url() {
  if [[ "${VPS_RUNTIME:-}" != "probe" ]]; then
    echo "Isolated probe checks require VPS_RUNTIME=probe." >&2
    return 1
  fi
  local parsed host port user database
  parsed="$(vps_probe_python parse-url)" || return 1
  host="$(printf '%s\n' "$parsed" | sed -n '1p')"
  port="$(printf '%s\n' "$parsed" | sed -n '2p')"
  user="$(printf '%s\n' "$parsed" | sed -n '3p')"
  database="$(printf '%s\n' "$parsed" | sed -n '4p')"
  if [[ -n "${PROBE_PGHOST:-}" && "$PROBE_PGHOST" != "$host" ]]; then
    echo "Probe host does not match the isolated URL." >&2
    return 1
  fi
  if [[ -n "${PROBE_PGPORT:-}" && "$PROBE_PGPORT" != "$port" ]]; then
    echo "Probe port does not match the isolated URL." >&2
    return 1
  fi
  if [[ -n "${PROBE_PGUSER:-}" && "$PROBE_PGUSER" != "$user" ]]; then
    echo "Probe user does not match the isolated URL." >&2
    return 1
  fi
  if [[ -n "${PROBE_PGDATABASE:-}" && "$PROBE_PGDATABASE" != "$database" ]]; then
    echo "Probe database does not match the isolated URL." >&2
    return 1
  fi
  PROBE_PGHOST="$host"
  PROBE_PGPORT="$port"
  PROBE_PGUSER="$user"
  PROBE_PGDATABASE="$database"
}

# Refuse any inherited libpq / service-file knobs before a client binary starts.
# Defense in depth: callers still launch clients under env -i.
vps_probe_refuse_inherited_libpq() {
  local line key
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    case "$key" in
      PG*)
        echo "Probe refuses inherited libpq environment ($key)." >&2
        return 1
        ;;
    esac
  done < <(printenv)
  return 0
}

vps_probe_note_client() {
  if [[ -n "${PROBE_CLIENT_LOG:-}" ]]; then
    printf '%s\n' "$1" >>"$PROBE_CLIENT_LOG"
  fi
}

vps_probe_clean_env_prefix() {
  # Prints env -i argv prefix for a minimal process environment.
  # Never includes PGHOST/PGHOSTADDR/PGSERVICE*/PGOPTIONS/DATABASE_URL from the parent.
  printf '%s\0' env -i
  printf '%s\0' "PATH=${PATH:?PATH is required for probe clients}"
  if [[ -n "${HOME:-}" ]]; then
    printf '%s\0' "HOME=$HOME"
  else
    printf '%s\0' "HOME=/tmp"
  fi
  [[ -n "${LANG:-}" ]] && printf '%s\0' "LANG=$LANG"
  [[ -n "${LC_ALL:-}" ]] && printf '%s\0' "LC_ALL=$LC_ALL"
  [[ -n "${LC_CTYPE:-}" ]] && printf '%s\0' "LC_CTYPE=$LC_CTYPE"
  [[ -n "${TMPDIR:-}" ]] && printf '%s\0' "TMPDIR=$TMPDIR"
  [[ -n "${TERM:-}" ]] && printf '%s\0' "TERM=$TERM"
}

# Run psql / pg_dump / pg_isready / pg_restore against the allowlisted probe target only.
# Usage: vps_probe_exec <client> [client-args...]
vps_probe_exec() {
  local client="${1:-}"
  shift || true
  case "$client" in
    psql|pg_dump|pg_isready|pg_restore) ;;
    *)
      echo "Unsupported probe PostgreSQL client." >&2
      return 1
      ;;
  esac
  vps_probe_assert_isolated_target || return 1
  vps_probe_refuse_inherited_libpq || return 1
  command -v "$client" >/dev/null 2>&1 || {
    echo "Required command not found: $client" >&2
    return 1
  }

  local -a run_env=()
  local -a run_cmd=()
  local item
  while IFS= read -r -d '' item; do
    run_env+=("$item")
  done < <(vps_probe_clean_env_prefix)
  if [[ -n "${PROBE_PGPASSWORD:-}" ]]; then
    run_env+=("PGPASSWORD=$PROBE_PGPASSWORD")
  fi
  run_cmd=("${run_env[@]}" "$client"
    -h "$PROBE_PGHOST"
    -p "$PROBE_PGPORT"
    -U "$PROBE_PGUSER"
    -d "$PROBE_PGDATABASE"
    "$@")

  vps_probe_note_client "$client"
  "${run_cmd[@]}"
}

# Prisma migrate under env -i with only the validated PROBE_DATABASE_URL.
vps_probe_migrate_deploy() {
  local root="${1:?probe migrate root required}"
  vps_probe_assert_isolated_url || return 1
  vps_probe_refuse_inherited_libpq || return 1
  [[ -d "$root" ]] || {
    echo "Probe migrate root is missing." >&2
    return 1
  }
  command -v npx >/dev/null 2>&1 || {
    echo "Required command not found: npx" >&2
    return 1
  }

  local -a run_env=()
  local item
  while IFS= read -r -d '' item; do
    run_env+=("$item")
  done < <(vps_probe_clean_env_prefix)
  run_env+=("DATABASE_URL=$PROBE_DATABASE_URL")
  # Node/npm need a writable cache when HOME is minimal.
  if [[ -n "${npm_config_cache:-}" ]]; then
    run_env+=("npm_config_cache=$npm_config_cache")
  fi
  if [[ -n "${NPM_CONFIG_CACHE:-}" ]]; then
    run_env+=("NPM_CONFIG_CACHE=$NPM_CONFIG_CACHE")
  fi

  vps_probe_note_client "prisma-migrate-deploy"
  (
    cd "$root"
    "${run_env[@]}" npx prisma migrate deploy
  )
}

vps_check_free_bytes() {
  local path="$1"
  local needed="${MIN_FREE_BYTES:-268435456}"
  if [[ ! "$needed" =~ ^[0-9]+$ ]]; then
    echo "MIN_FREE_BYTES must be a non-negative integer." >&2
    return 1
  fi
  local probe="$path"
  while [[ ! -e "$probe" && "$probe" != "/" && "$probe" != "." ]]; do
    probe="$(dirname "$probe")"
  done
  [[ -e "$probe" ]] || probe="."
  local available
  available="$(df -Pk "$probe" | awk 'NR==2 {print $4 * 1024}')"
  if (( available < needed )); then
    echo "Not enough free space at $path (need ${needed} bytes)." >&2
    return 1
  fi
}

vps_require_free_bytes() {
  local path="$1"
  vps_check_free_bytes "$path" || return 1
  mkdir -p "$path"
}

vps_validate_password_charset() {
  local password="$1"
  [[ "$password" =~ ^[A-Za-z0-9._~-]+$ ]] || {
    echo "POSTGRES_PASSWORD must use URL-safe characters (A-Z a-z 0-9 . _ ~ -) so DATABASE_URL interpolation stays valid." >&2
    return 1
  }
}

vps_validate_production_env_file() {
  local file="$1"
  vps_require_file "$file" || return 1
  local domain secret password token site_url auth_url mailbox live_ai hard_limit
  domain="$(vps_env_get "$file" SITE_DOMAIN)"
  secret="$(vps_env_get "$file" AUTH_SECRET)"
  password="$(vps_env_get "$file" POSTGRES_PASSWORD)"
  token="$(vps_env_get "$file" TOKEN_ENCRYPTION_KEY)"
  site_url="$(vps_env_get "$file" NEXT_PUBLIC_SITE_URL)"
  auth_url="$(vps_env_get "$file" AUTH_URL)"
  mailbox="$(vps_env_get "$file" AUTH_DEV_MAILBOX)"
  live_ai="$(vps_env_get "$file" AI_LIVE_ENABLED)"
  hard_limit="$(vps_env_get "$file" AI_MONTHLY_HARD_LIMIT)"

  if [[ -z "$domain" || "$domain" == "example.com" || "$domain" == *your-domain* ]]; then
    echo "Set a real SITE_DOMAIN in the production env file (domain only, no https://)." >&2
    return 1
  fi
  if [[ ${#secret} -lt 32 || "$secret" == *replace-with* ]]; then
    echo "AUTH_SECRET must be a random string at least 32 characters." >&2
    return 1
  fi
  if [[ -z "$password" || "$password" == *replace-with* ]]; then
    echo "Set POSTGRES_PASSWORD in the production env file." >&2
    return 1
  fi
  vps_validate_password_charset "$password" || return 1
  if [[ ${#token} -lt 32 || "$token" == *replace-with* ]]; then
    echo "TOKEN_ENCRYPTION_KEY is required in production and must be at least 32 characters." >&2
    return 1
  fi
  if [[ "$token" == "$secret" ]]; then
    echo "TOKEN_ENCRYPTION_KEY must be different from AUTH_SECRET." >&2
    return 1
  fi
  if [[ "$site_url" != "https://$domain" ]]; then
    echo "NEXT_PUBLIC_SITE_URL must be https://\$SITE_DOMAIN with no trailing slash." >&2
    return 1
  fi
  if [[ -n "$auth_url" && "$auth_url" != "$site_url" ]]; then
    echo "AUTH_URL must match NEXT_PUBLIC_SITE_URL." >&2
    return 1
  fi
  if [[ "$mailbox" == "true" ]]; then
    echo "AUTH_DEV_MAILBOX cannot be enabled on public hosting." >&2
    return 1
  fi
  if [[ "$live_ai" == "true" ]]; then
    if [[ ! "$hard_limit" =~ ^[1-9][0-9]*$ ]]; then
      echo "AI_LIVE_ENABLED=true requires AI_MONTHLY_HARD_LIMIT as a positive integer. Leave both unset until the owner approves paid calls." >&2
      return 1
    fi
  fi
}

vps_compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

vps_postgres_running() {
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    vps_probe_exec pg_isready >/dev/null 2>&1
    return
  fi
  [[ -n "$(vps_compose ps -q postgres 2>/dev/null)" ]]
}

vps_service_running() {
  local name="$1"
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    [[ -f "$PROBE_STATE_DIR/${name}.running" ]]
    return
  fi
  [[ -n "$(vps_compose ps -q "$name" 2>/dev/null)" ]]
}

vps_mark_service() {
  local name="$1" state="$2"
  mkdir -p "$PROBE_STATE_DIR"
  if [[ "$state" == "running" ]]; then
    : >"$PROBE_STATE_DIR/${name}.running"
  else
    rm -f "$PROBE_STATE_DIR/${name}.running"
  fi
}

vps_stop_writers() {
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    vps_mark_service app stopped
    vps_mark_service worker stopped
    return 0
  fi
  vps_compose stop app worker >/dev/null
}

vps_restart_writers() {
  local failed=0
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    if [[ "${PROBE_FAIL_RESTART:-}" == "true" ]]; then
      echo "WARNING: could not restart all services; inspect probe state." >&2
      return 1
    fi
    [[ "${APP_WAS_RUNNING:-false}" == true ]] && vps_mark_service app running
    [[ "${WORKER_WAS_RUNNING:-false}" == true ]] && vps_mark_service worker running
    return 0
  fi
  if [[ "${APP_WAS_RUNNING:-false}" == true ]]; then
    vps_compose up -d app >/dev/null || failed=1
  fi
  if [[ "${WORKER_WAS_RUNNING:-false}" == true ]]; then
    vps_compose up -d worker >/dev/null || failed=1
  fi
  if (( failed != 0 )); then
    echo "WARNING: could not restart all services; inspect docker compose status." >&2
    return 1
  fi
}

vps_dump_database() {
  local dest="$1"
  if [[ "${PROBE_FAIL_DUMP:-}" == "true" ]]; then
    echo "Simulated dump failure." >&2
    return 1
  fi
  if [[ "${BACKUP_PAUSE_SECONDS:-0}" =~ ^[1-9][0-9]*$ ]]; then
    sleep "$BACKUP_PAUSE_SECONDS"
  fi
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    # Plain SQL so a newer client can restore into PostgreSQL 16 (custom dumps
    # from PG17+ emit SET transaction_timeout, which 16 rejects).
    vps_probe_exec pg_dump --format=plain --no-owner --no-acl \
      | grep -v transaction_timeout >"$dest"
    return
  fi
  vps_compose exec -T postgres sh -lc 'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' >"$dest"
}

vps_list_dump() {
  local dump="$1"
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    if grep -q '^-- PostgreSQL database dump' "$dump"; then
      return 0
    fi
    echo "Probe dump is not a readable PostgreSQL SQL dump." >&2
    return 1
  fi
  vps_compose exec -T postgres pg_restore --list <"$dump" >/dev/null
}

vps_reset_public_schema() {
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    vps_probe_exec psql -v ON_ERROR_STOP=1 \
      -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO CURRENT_USER; GRANT ALL ON SCHEMA public TO public;' >/dev/null
    return
  fi
  vps_compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO CURRENT_USER; GRANT ALL ON SCHEMA public TO public;"' >/dev/null
}

vps_restore_database() {
  local dump="$1"
  if [[ "${PROBE_FAIL_RESTORE_DB:-}" == "true" ]]; then
    echo "Simulated PostgreSQL restore failure." >&2
    return 1
  fi
  vps_reset_public_schema || return 1
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    vps_probe_exec psql -v ON_ERROR_STOP=1 -f "$dump" >/dev/null
    return
  fi
  vps_compose exec -T postgres sh -lc 'pg_restore --no-owner --no-privileges --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$dump"
}

vps_verify_database() {
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    vps_probe_exec psql -v ON_ERROR_STOP=1 -c 'SELECT 1 FROM "_prisma_migrations" LIMIT 1;' >/dev/null
    return
  fi
  vps_compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT 1 FROM \"_prisma_migrations\" LIMIT 1;"' >/dev/null
}

vps_archive_media() {
  local dest="$1"
  local source
  if [[ "${PROBE_FAIL_TAR:-}" == "true" ]]; then
    echo "Simulated media archive failure." >&2
    return 1
  fi
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    source="${PROBE_MEDIA_DIR:?PROBE_MEDIA_DIR is required in probe mode}"
    if [[ ! -d "$source" ]]; then
      echo "Media directory is missing: $source" >&2
      return 1
    fi
    tar -czf "$dest" -C "$source" .
    return
  fi
  vps_compose run --rm --no-deps -T --entrypoint sh app -lc 'test -d /app/data/media && tar -czf - -C /app/data/media .' >"$dest"
}

vps_extract_media() {
  local archive="$1"
  local source staging
  if [[ "${PROBE_FAIL_RESTORE_MEDIA:-}" == "true" ]]; then
    echo "Simulated media extract failure." >&2
    return 1
  fi
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    source="${PROBE_MEDIA_DIR:?PROBE_MEDIA_DIR is required in probe mode}"
    mkdir -p "$source"
    staging="$(mktemp -d "$source/.restore-staging.XXXXXX")"
    tar -xzf "$archive" -C "$staging"
    find "$source" -mindepth 1 -maxdepth 1 ! -name "$(basename "$staging")" -exec rm -rf -- {} +
    find "$staging" -mindepth 1 -maxdepth 1 -exec mv -t "$source" -- {} +
    rmdir "$staging"
    return
  fi
  vps_compose run --rm --no-deps -T --entrypoint sh app -lc '
    set -euo pipefail
    test -d /app/data/media
    staging=$(mktemp -d /app/data/media/.restore-staging.XXXXXX)
    tar -xzf - -C "$staging"
    find /app/data/media -mindepth 1 -maxdepth 1 ! -name "$(basename "$staging")" -exec rm -rf -- {} +
    find "$staging" -mindepth 1 -maxdepth 1 -exec mv -t /app/data/media -- {} +
    rmdir "$staging"
  ' <"$archive"
}

vps_backup_timestamp_from_name() {
  local name="$1"
  if [[ "$name" =~ ([0-9]{8}T[0-9]{6}Z) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

vps_same_backup_set() {
  local db_name media_name manifest_name
  db_name="$(basename "$1")"
  media_name="$(basename "$2")"
  manifest_name="$(basename "$3")"
  local db_ts media_ts manifest_ts
  db_ts="$(vps_backup_timestamp_from_name "$db_name")" || return 1
  media_ts="$(vps_backup_timestamp_from_name "$media_name")" || return 1
  manifest_ts="$(vps_backup_timestamp_from_name "$manifest_name")" || return 1
  [[ "$db_ts" == "$media_ts" && "$media_ts" == "$manifest_ts" ]]
}

vps_git_clean() {
  local dirty
  dirty="$(git status --porcelain)"
  if [[ -n "$dirty" ]]; then
    echo "Working tree is not clean. Commit or stash local changes before an update." >&2
    return 1
  fi
}

vps_record_sha() {
  local dest="$1"
  git rev-parse HEAD >"$dest"
  chmod 600 "$dest"
}

vps_internal_health() {
  if [[ "${VPS_RUNTIME:-compose}" == "probe" ]]; then
    [[ -f "$PROBE_STATE_DIR/app.running" ]]
    return
  fi
  vps_compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
}
