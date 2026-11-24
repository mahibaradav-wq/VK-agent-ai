#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
PROBE_DB=""
WORK=""

log_pass() {
  PASS=$((PASS + 1))
  echo "PASS $1"
}

log_fail() {
  FAIL=$((FAIL + 1))
  echo "FAIL $1" >&2
}

assert_ok() {
  local name="$1"
  shift
  if "$@" >/tmp/vps-ops-cmd.out 2>/tmp/vps-ops-cmd.err; then
    log_pass "$name"
  else
    log_fail "$name"
    cat /tmp/vps-ops-cmd.err >&2 || true
  fi
}

assert_fail() {
  local name="$1"
  shift
  if "$@" >/tmp/vps-ops-cmd.out 2>/tmp/vps-ops-cmd.err; then
    log_fail "$name (expected failure)"
  else
    log_pass "$name"
  fi
}

assert_file_missing() {
  local name="$1" path="$2"
  if [[ -e "$path" ]]; then
    log_fail "$name"
  else
    log_pass "$name"
  fi
}

assert_fail_no_secret() {
  local name="$1" needle="$2"
  shift 2
  if "$@" >/tmp/vps-ops-cmd.out 2>/tmp/vps-ops-cmd.err; then
    log_fail "$name (expected failure)"
    return
  fi
  if grep -F "$needle" /tmp/vps-ops-cmd.out /tmp/vps-ops-cmd.err >/dev/null 2>&1; then
    log_fail "$name leaked secret material"
    return
  fi
  if grep -E 'postgresql://[^[:space:]]+' /tmp/vps-ops-cmd.out /tmp/vps-ops-cmd.err >/dev/null 2>&1; then
    log_fail "$name leaked a database URL"
    return
  fi
  log_pass "$name"
}

assert_block_no_client() {
  local name="$1"
  shift
  local log
  log="$(mktemp /tmp/vps-probe-client.XXXXXX)"
  rm -f "$log"
  if PROBE_CLIENT_LOG="$log" "$@" >/tmp/vps-ops-cmd.out 2>/tmp/vps-ops-cmd.err; then
    log_fail "$name (expected failure)"
    rm -f "$log"
    return
  fi
  if [[ -s "$log" ]]; then
    log_fail "$name launched a PostgreSQL client before refusal"
    cat "$log" >&2 || true
    rm -f "$log"
    return
  fi
  rm -f "$log"
  log_pass "$name"
}

# Successful probe paths must not inherit developer/CI libpq knobs or leftover PROBE_*.
while IFS= read -r __pg_line; do
  __pg_key="${__pg_line%%=*}"
  case "$__pg_key" in
    PG*|PROBE_PG*|PROBE_DATABASE_URL|PROBE_CLIENT_LOG)
      unset "$__pg_key"
      ;;
  esac
done < <(printenv)
unset __pg_line __pg_key VPS_RUNTIME

cleanup() {
  if [[ -n "$PROBE_DB" ]]; then
    python3 - "$PROBE_DB" <<'PY' >/dev/null 2>&1 || true
import os, sys, subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse

name = sys.argv[1]
url = os.environ.get("DATABASE_URL")
if not url and Path(".env").exists():
    for line in Path(".env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1]
            break
if not url:
    raise SystemExit(0)
parsed = urlparse(url)
admin = urlunparse(parsed)
subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{name}';"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f'DROP DATABASE IF EXISTS "{name}";'], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PY
  fi
  [[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK"
}
trap cleanup EXIT

bash -n scripts/lib/vps-common.sh
bash -n scripts/backup-vps.sh
bash -n scripts/restore-vps.sh
bash -n scripts/vps-up.sh
bash -n scripts/vps-pull.sh
bash -n scripts/vps-migrate.sh
bash -n scripts/vps-rollback.sh
log_pass "bash -n all VPS scripts"

# shellcheck source=../lib/vps-common.sh
source scripts/lib/vps-common.sh

assert_ok "localhost with isolated test database" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_ci vps_probe_assert_isolated_target'
assert_ok "127.0.0.1 with isolated test database" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=127.0.0.1 PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe vps_probe_assert_isolated_target'
assert_ok "::1 with isolated test database" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=::1 PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_v6 vps_probe_assert_isolated_target'
assert_ok "CI container hostname is allowlisted" \
  bash -c 'source scripts/lib/vps-common.sh && vps_probe_host_allowlisted postgres'

assert_block_no_client "localhost + PGHOSTADDR public IPv4 is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGHOSTADDR=8.8.8.8 && vps_probe_exec pg_isready'
assert_block_no_client "localhost + PGHOSTADDR public IPv6 is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGHOSTADDR=2001:4860:4860::8888 && vps_probe_exec pg_isready'
assert_block_no_client "localhost + PGHOSTADDR production-like IP is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGHOSTADDR=203.0.113.10 && vps_probe_exec pg_isready'
assert_block_no_client "PGHOSTADDR without PROBE host is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGHOSTADDR=8.8.8.8 && unset PROBE_PGHOST && vps_probe_exec pg_isready'
assert_block_no_client "PGSERVICE with foreign service is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGSERVICE=remote_prod && vps_probe_exec psql -c "SELECT 1"'
assert_block_no_client "PGSERVICEFILE override is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGSERVICEFILE=/tmp/fake-pg-service.conf && vps_probe_exec psql -c "SELECT 1"'
assert_block_no_client "PGOPTIONS override is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGOPTIONS="-c search_path=evil" && vps_probe_exec psql -c "SELECT 1"'
assert_block_no_client "conflicting PGHOST is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGHOST=db.example.test && vps_probe_exec pg_isready'
assert_block_no_client "conflicting PGPORT is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGPORT=6543 && vps_probe_exec pg_isready'
assert_block_no_client "conflicting PGUSER is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGUSER=postgres && vps_probe_exec pg_isready'
assert_block_no_client "conflicting PGDATABASE is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGDATABASE=polka_social && vps_probe_exec pg_isready'
assert_block_no_client "extra PG* channel binding override is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 PGCHANNELBINDING=require && vps_probe_exec pg_isready'
assert_block_no_client "DROP SCHEMA refuses when PGHOSTADDR is set" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_x PROBE_PGPASSWORD=should-not-appear PGHOSTADDR=8.8.8.8 && vps_reset_public_schema'
assert_block_no_client "probe migrate refuses production URL before prisma" \
  env VPS_RUNTIME=probe FIRST_INSTALL=YES \
  PROBE_DATABASE_URL='postgresql://polka:not-a-real-secret@24dom-po-polochkam.ru:5432/polka_social' \
  bash scripts/vps-migrate.sh
assert_block_no_client "probe migrate refuses when PGSERVICE is set" \
  env VPS_RUNTIME=probe FIRST_INSTALL=YES PGSERVICE=remote_prod \
  PROBE_DATABASE_URL='postgresql://polka:not-a-real-secret@127.0.0.1:5432/polka_vps_probe_migrate' \
  bash scripts/vps-migrate.sh
assert_fail "public IPv4 is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=8.8.8.8 PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "public IPv6 is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=2001:4860:4860::8888 PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "unknown DNS hostname is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=db.example.test PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "production hostname is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=24dom-po-polochkam.ru PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "production-like database name is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_social vps_probe_assert_isolated_target'
assert_fail "empty probe host is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST= PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "incorrect probe port is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=1 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "missing probe user is blocked" \
  bash -c 'source scripts/lib/vps-common.sh && VPS_RUNTIME=probe PROBE_PGHOST=localhost PROBE_PGPORT=5432 PROBE_PGUSER= PROBE_PGDATABASE=polka_vps_probe_1 vps_probe_assert_isolated_target'
assert_fail "VPS_RUNTIME=probe is not enough without fields" \
  bash -c 'source scripts/lib/vps-common.sh && unset PROBE_PGHOST PROBE_PGPORT PROBE_PGUSER PROBE_PGDATABASE PROBE_PGPASSWORD PROBE_DATABASE_URL && VPS_RUNTIME=probe vps_probe_assert_isolated_target'
assert_fail "schema drop refuses before isolated target checks" \
  bash -c 'source scripts/lib/vps-common.sh && export VPS_RUNTIME=probe PROBE_PGHOST=8.8.8.8 PROBE_PGPORT=5432 PROBE_PGUSER=polka PROBE_PGDATABASE=polka_vps_probe_x PROBE_PGPASSWORD=should-not-appear && vps_reset_public_schema'
assert_fail_no_secret "probe migrate rejects production URL without leaking secrets" "not-a-real-secret" \
  env VPS_RUNTIME=probe FIRST_INSTALL=YES \
  PROBE_DATABASE_URL='postgresql://polka:not-a-real-secret@24dom-po-polochkam.ru:5432/polka_social' \
  bash scripts/vps-migrate.sh
assert_fail_no_secret "probe migrate rejects production-like database on localhost" "not-a-real-secret" \
  env VPS_RUNTIME=probe FIRST_INSTALL=YES \
  PROBE_DATABASE_URL='postgresql://polka:not-a-real-secret@localhost:5432/polka_social' \
  bash scripts/vps-migrate.sh

if grep -E '24dom-po-polochkam|timeweb' scripts/lib/vps-common.sh >/dev/null; then
  log_fail "probe allowlist must not depend on production hostname substrings"
else
  log_pass "probe allowlist does not use production hostname substrings"
fi
if grep -E 'uses:[[:space:]]*[[:alnum:]_.-]+/ssh-action|appleboy/ssh-action' .github/workflows/deploy-vps.yml >/dev/null; then
  log_fail "GitHub Deploy VPS still has an SSH action"
else
  log_pass "GitHub Deploy VPS cannot SSH"
fi
if grep -E 'up -d --build|docker compose' .github/workflows/deploy-vps.yml >/dev/null; then
  log_fail "GitHub Deploy VPS still rebuilds production services"
else
  log_pass "GitHub Deploy VPS does not rebuild production services"
fi

assert_fail "password with @ is rejected" \
  bash -c 'source scripts/lib/vps-common.sh && vps_validate_password_charset "ab@cd"'
assert_ok "hex password is accepted" \
  bash -c 'source scripts/lib/vps-common.sh && vps_validate_password_charset "abcDEF0123._~-"'

assert_fail "restore without confirmation" \
  env -u CONFIRM_RESTORE DB_BACKUP=/tmp/x MEDIA_BACKUP=/tmp/y BACKUP_MANIFEST=/tmp/z \
  bash scripts/restore-vps.sh

assert_fail "migrate without backup proof" bash scripts/vps-migrate.sh

PROBE_DB="polka_vps_probe_$$"
WORK="$(mktemp -d /tmp/polka-vps-ops.XXXXXX)"
MEDIA="$WORK/media"
BACKUP="$WORK/backups"
STATE="$WORK/state"
mkdir -p "$MEDIA" "$BACKUP" "$STATE"
echo "cabinet-photo" >"$MEDIA/photo.txt"
: >"$STATE/app.running"
: >"$STATE/worker.running"

readarray -t pg_fields < <(python3 - "$PROBE_DB" <<'PY'
import os, sys, subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse

name = sys.argv[1]
url = os.environ.get("DATABASE_URL")
if not url and Path(".env").exists():
    for line in Path(".env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1]
            break
if not url:
    raise SystemExit("DATABASE_URL is required in the environment or .env")
parsed = urlparse(url)
admin = urlunparse(parsed)
subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f'DROP DATABASE IF EXISTS "{name}";'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["psql", admin, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}";'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(parsed.hostname or "127.0.0.1")
print(parsed.port or 5432)
print(parsed.username or "polka")
print(parsed.password or "")
print(name)
print(urlunparse(parsed._replace(path="/" + name)))
PY
)

PROBE_PGHOST="${pg_fields[0]}"
PROBE_PGPORT="${pg_fields[1]}"
PROBE_PGUSER="${pg_fields[2]}"
PROBE_PGPASSWORD="${pg_fields[3]}"
PROBE_PGDATABASE="${pg_fields[4]}"
PROBE_DATABASE_URL="${pg_fields[5]}"

export VPS_RUNTIME=probe
export PROBE_PGHOST PROBE_PGPORT PROBE_PGUSER PROBE_PGPASSWORD PROBE_PGDATABASE
export PROBE_MEDIA_DIR="$MEDIA"
export PROBE_STATE_DIR="$STATE"
export BACKUP_DIR="$BACKUP"
export PROBE_DATABASE_URL

assert_fail "probe backup missing host never reaches PostgreSQL" \
  env -u PROBE_PGHOST VPS_RUNTIME=probe PROBE_PGPORT="$PROBE_PGPORT" PROBE_PGUSER="$PROBE_PGUSER" \
  PROBE_PGDATABASE="$PROBE_PGDATABASE" PROBE_PGPASSWORD="$PROBE_PGPASSWORD" \
  PROBE_MEDIA_DIR="$MEDIA" PROBE_STATE_DIR="$STATE" BACKUP_DIR="$BACKUP" \
  bash scripts/backup-vps.sh

assert_ok "isolated migrate on empty probe db" \
  env FIRST_INSTALL=YES bash scripts/vps-migrate.sh

assert_ok "probe db has Plan table leftover from historical migrations" \
  vps_probe_exec psql -v ON_ERROR_STOP=1 -c 'SELECT 1 FROM "Plan" LIMIT 1;'

common_probe=(
  env
  VPS_RUNTIME=probe
  PROBE_PGHOST="$PROBE_PGHOST"
  PROBE_PGPORT="$PROBE_PGPORT"
  PROBE_PGUSER="$PROBE_PGUSER"
  PROBE_PGPASSWORD="$PROBE_PGPASSWORD"
  PROBE_PGDATABASE="$PROBE_PGDATABASE"
  PROBE_MEDIA_DIR="$MEDIA"
  PROBE_STATE_DIR="$STATE"
  BACKUP_DIR="$BACKUP"
)

assert_ok "successful backup" "${common_probe[@]}" bash scripts/backup-vps.sh
mapfile -t first_set < <(ls -1 "$BACKUP"/polka-db-*.dump "$BACKUP"/polka-media-*.tar.gz "$BACKUP"/polka-*.sha256 | sort)
if ((${#first_set[@]} == 3)); then
  log_pass "backup wrote dump, archive, and manifest"
else
  log_fail "backup file set (${#first_set[@]})"
fi
chmod_stat="$(stat -c %a "$BACKUP"/polka-*.sha256 | head -n1)"
if [[ "$chmod_stat" == "600" ]]; then
  log_pass "backup files are mode 600"
else
  log_fail "backup mode $chmod_stat"
fi
if grep -E 'AUTH_SECRET|TOKEN_ENCRYPTION_KEY|POSTGRES_PASSWORD|sk-|Bearer ' "$BACKUP"/* >/dev/null 2>&1; then
  log_fail "backup files mention secret names"
else
  log_pass "backup files do not mention secret names"
fi

assert_ok "second backup keeps the first set" "${common_probe[@]}" bash scripts/backup-vps.sh
if [[ -f "${first_set[0]}" && -f "${first_set[1]}" && -f "${first_set[2]}" ]]; then
  log_pass "previous successful backup retained"
else
  log_fail "previous backup was removed"
fi

dump="$(ls -1t "$BACKUP"/polka-db-*.dump | head -n1)"
media="$(ls -1t "$BACKUP"/polka-media-*.tar.gz | head -n1)"
manifest="$(ls -1t "$BACKUP"/polka-*.sha256 | head -n1)"

echo "changed-after-backup" >"$MEDIA/photo.txt"
vps_probe_exec psql -c 'CREATE TABLE IF NOT EXISTS vps_probe_marker(id int);' >/dev/null

assert_ok "successful restore" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$dump" MEDIA_BACKUP="$media" BACKUP_MANIFEST="$manifest" \
  bash scripts/restore-vps.sh

if grep -q "cabinet-photo" "$MEDIA/photo.txt"; then
  log_pass "restore replaced media content"
else
  log_fail "media restore content"
fi
if vps_probe_exec psql -tAc "SELECT to_regclass('public.vps_probe_marker');" | grep -q vps_probe_marker; then
  log_fail "marker table should not survive restore"
else
  log_pass "database restore dropped post-backup objects"
fi
if [[ -f "$STATE/app.running" && -f "$STATE/worker.running" ]]; then
  log_pass "probe services marked running after successful restore"
else
  log_fail "services not restarted after restore"
fi

printf 'deadbeef  %s\ndeadbeef  %s\n' "$(basename "$dump")" "$(basename "$media")" >"$WORK/bogus.sha256"
assert_fail "manifest not next to backup files" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$dump" MEDIA_BACKUP="$media" BACKUP_MANIFEST="$WORK/bogus.sha256" \
  bash scripts/restore-vps.sh

echo "deadbeef  $(basename "$dump")" >"$WORK/bad.sha256"
echo "deadbeef  $(basename "$media")" >>"$WORK/bad.sha256"
cp "$dump" "$WORK/$(basename "$dump")"
cp "$media" "$WORK/$(basename "$media")"
assert_fail "checksum mismatch" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$WORK/$(basename "$dump")" MEDIA_BACKUP="$WORK/$(basename "$media")" BACKUP_MANIFEST="$WORK/bad.sha256" \
  bash scripts/restore-vps.sh

printf 'not-a-tar' >"$WORK/polka-media-20990101T000000Z.tar.gz"
printf 'not-a-dump' >"$WORK/polka-db-20990101T000000Z.dump"
printf 'deadbeef  polka-db-20990101T000000Z.dump\ndeadbeef  polka-media-20990101T000000Z.tar.gz\n' >"$WORK/polka-20990101T000000Z.sha256"
# Rebuild a valid-checksum invalid dump/archive pair
(
  cd "$WORK"
  sha256sum polka-db-20990101T000000Z.dump polka-media-20990101T000000Z.tar.gz >polka-20990101T000000Z.sha256
)
assert_fail "unreadable dump" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$WORK/polka-db-20990101T000000Z.dump" \
  MEDIA_BACKUP="$WORK/polka-media-20990101T000000Z.tar.gz" \
  BACKUP_MANIFEST="$WORK/polka-20990101T000000Z.sha256" \
  bash scripts/restore-vps.sh

cp "$dump" "$WORK/polka-db-19990101T000000Z.dump"
cp "$media" "$WORK/polka-media-20990101T000000Z.tar.gz"
(
  cd "$WORK"
  sha256sum polka-db-19990101T000000Z.dump polka-media-20990101T000000Z.tar.gz >polka-19990101T000000Z.sha256
)
assert_fail "mismatched backup timestamps" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$WORK/polka-db-19990101T000000Z.dump" \
  MEDIA_BACKUP="$WORK/polka-media-20990101T000000Z.tar.gz" \
  BACKUP_MANIFEST="$WORK/polka-19990101T000000Z.sha256" \
  bash scripts/restore-vps.sh

assert_fail "user cancelled restore" \
  "${common_probe[@]}" CONFIRM_RESTORE=YES RESTORE_CONFIRM=NOPE \
  DB_BACKUP="$dump" MEDIA_BACKUP="$media" BACKUP_MANIFEST="$manifest" \
  bash scripts/restore-vps.sh

rm -f "$STATE/app.running" "$STATE/worker.running"
assert_fail "restore postgres error leaves services stopped" \
  "${common_probe[@]}" PROBE_FAIL_RESTORE_DB=true CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP="$dump" MEDIA_BACKUP="$media" BACKUP_MANIFEST="$manifest" \
  bash scripts/restore-vps.sh
assert_file_missing "app not started after failed db restore" "$STATE/app.running"

: >"$STATE/app.running"
: >"$STATE/worker.running"
assert_fail "postgres unavailable" \
  "${common_probe[@]}" PROBE_PGPORT=1 bash scripts/backup-vps.sh

assert_fail "missing media directory" \
  "${common_probe[@]}" PROBE_MEDIA_DIR="$WORK/missing-media" bash scripts/backup-vps.sh

assert_fail "insufficient space" \
  "${common_probe[@]}" MIN_FREE_BYTES=99999999999999 bash scripts/backup-vps.sh

before_count="$(find "$BACKUP" -name 'polka-db-*.dump' | wc -l)"
assert_fail "dump error" "${common_probe[@]}" PROBE_FAIL_DUMP=true bash scripts/backup-vps.sh
after_count="$(find "$BACKUP" -name 'polka-db-*.dump' | wc -l)"
if [[ "$before_count" == "$after_count" ]]; then
  log_pass "failed dump did not add a successful copy"
else
  log_fail "failed dump created an extra dump"
fi
assert_fail "archive error" "${common_probe[@]}" PROBE_FAIL_TAR=true bash scripts/backup-vps.sh

: >"$STATE/app.running"
assert_fail "restart failure after backup still keeps the copy" \
  "${common_probe[@]}" PROBE_FAIL_RESTART=true bash scripts/backup-vps.sh
if ls "$BACKUP"/polka-*.sha256 >/dev/null 2>&1; then
  log_pass "backup files remain when restart fails"
else
  log_fail "backup files lost on restart failure"
fi

: >"$STATE/app.running"
PAUSE_DIR="$BACKUP"
"${common_probe[@]}" BACKUP_PAUSE_SECONDS=8 bash scripts/backup-vps.sh >/tmp/vps-ops-pause.out 2>/tmp/vps-ops-pause.err &
pause_pid=$!
sleep 1
kill -TERM "$pause_pid" >/dev/null 2>&1 || true
wait "$pause_pid" >/dev/null 2>&1 || true
if find "$BACKUP" -name '.polka-*.tmp.*' | grep -q .; then
  log_fail "temp backup files remain after interrupt"
else
  log_pass "interrupt cleaned temp backup files"
fi
if [[ -f "$STATE/app.running" ]]; then
  log_pass "app restored after interrupted backup"
else
  log_fail "app not restored after interrupt"
fi

ENV_PROBE="$WORK/prod.env"
cat >"$ENV_PROBE" <<'EOF'
SITE_DOMAIN=probe.example.test
ACME_EMAIL=ops@probe.example.test
NEXT_PUBLIC_SITE_URL=https://probe.example.test
AUTH_URL=https://probe.example.test
AUTH_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TOKEN_ENCRYPTION_KEY=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
POSTGRES_USER=polka
POSTGRES_PASSWORD=probe_password_ok
POSTGRES_DB=polka_social
EOF
cp docker-compose.prod.yml "$WORK/docker-compose.prod.yml"
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "info" ]]; then
  exit 0
fi
exit 0
EOF
chmod +x "$WORK/bin/docker"

plan_state_dir="$WORK/vps-state"
plan_missing_backup="$WORK/plan-backup-does-not-exist"
head_before="$(git rev-parse HEAD)"
status_before="$(git status --porcelain)"
env_hash_before="$(sha256sum "$ENV_PROBE" | awk '{print $1}')"
compose_hash_before="$(sha256sum "$WORK/docker-compose.prod.yml" | awk '{print $1}')"
repo_state_before=""
if [[ -e "$ROOT/.vps-state" ]]; then
  repo_state_before="$(find "$ROOT/.vps-state" -type f -print | sort | xargs -r sha256sum)"
fi
assert_file_missing "plan state dir absent before --plan" "$plan_state_dir"
assert_file_missing "plan backup dir absent before --plan" "$plan_missing_backup"

assert_ok "vps-pull --plan is read-only preflight" \
  env PATH="$WORK/bin:$PATH" VPS_APP_DIR="$ROOT" COMPOSE_FILE="$WORK/docker-compose.prod.yml" \
  ENV_FILE="$ENV_PROBE" BACKUP_DIR="$plan_missing_backup" VPS_STATE_DIR="$plan_state_dir" \
  VPS_SKIP_GIT_CLEAN=true bash scripts/vps-pull.sh --plan

assert_file_missing "--plan did not create state dir" "$plan_state_dir"
assert_file_missing "--plan did not create backup dir" "$plan_missing_backup"
head_after="$(git rev-parse HEAD)"
status_after="$(git status --porcelain)"
env_hash_after="$(sha256sum "$ENV_PROBE" | awk '{print $1}')"
compose_hash_after="$(sha256sum "$WORK/docker-compose.prod.yml" | awk '{print $1}')"
repo_state_after=""
if [[ -e "$ROOT/.vps-state" ]]; then
  repo_state_after="$(find "$ROOT/.vps-state" -type f -print | sort | xargs -r sha256sum)"
fi
if [[ "$head_before" == "$head_after" ]]; then
  log_pass "--plan did not change Git HEAD"
else
  log_fail "--plan changed Git HEAD"
fi
if [[ "$status_before" == "$status_after" ]]; then
  log_pass "--plan did not change git status"
else
  log_fail "--plan changed git status"
fi
if [[ "$env_hash_before" == "$env_hash_after" && "$compose_hash_before" == "$compose_hash_after" ]]; then
  log_pass "--plan did not change env or compose files"
else
  log_fail "--plan changed env or compose files"
fi
if [[ "$repo_state_before" == "$repo_state_after" ]]; then
  log_pass "--plan did not write repo .vps-state"
else
  log_fail "--plan wrote repo .vps-state"
fi
if [[ -e "$ROOT/.vps-state/previous-sha" ]]; then
  # Allow a pre-existing file, but --plan must not have created it in this run
  :
fi

assert_fail "--plan does not git fetch a missing ref" \
  env PATH="$WORK/bin:$PATH" VPS_APP_DIR="$ROOT" COMPOSE_FILE="$WORK/docker-compose.prod.yml" \
  ENV_FILE="$ENV_PROBE" BACKUP_DIR="$plan_missing_backup" VPS_STATE_DIR="$plan_state_dir" \
  VPS_SKIP_GIT_CLEAN=true bash scripts/vps-pull.sh --plan definitely-not-a-git-ref-xyz
assert_file_missing "--plan missing-ref did not create state dir" "$plan_state_dir"

assert_ok "vps-rollback --plan A" bash scripts/vps-rollback.sh --plan A
assert_ok "vps-rollback --plan B" bash scripts/vps-rollback.sh --plan B

assert_fail "vps-up rejects mailbox" \
  bash -c 'source scripts/lib/vps-common.sh && echo AUTH_DEV_MAILBOX=true >>'"$ENV_PROBE"' && vps_validate_production_env_file "'"$ENV_PROBE"'"'

echo "AUTH_DEV_MAILBOX=" >"$WORK/mailbox.env"
cat "$ENV_PROBE" >"$WORK/ok.env"
echo "TOKEN_ENCRYPTION_KEY=$(grep AUTH_SECRET "$WORK/ok.env" | cut -d= -f2-)" >>"$WORK/dup.env"
# rebuild dup env properly
python3 - "$WORK/ok.env" "$WORK/dup.env" <<'PY'
from pathlib import Path
import sys
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
lines = []
secret = ""
for line in src.read_text().splitlines():
    if line.startswith("AUTH_SECRET="):
        secret = line.split("=", 1)[1]
    if line.startswith("TOKEN_ENCRYPTION_KEY="):
        lines.append(f"TOKEN_ENCRYPTION_KEY={secret}")
    else:
        lines.append(line)
dest.write_text("\n".join(lines) + "\n")
PY
assert_fail "env rejects identical token key" \
  bash -c 'source scripts/lib/vps-common.sh && vps_validate_production_env_file "'"$WORK/dup.env"'"'

if [[ "$FAIL" -ne 0 ]]; then
  echo "vps-ops tests: $PASS passed, $FAIL failed" >&2
  exit 1
fi
echo "vps-ops tests: $PASS passed"
