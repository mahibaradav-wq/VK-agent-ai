#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Safe test-only defaults; never reads production env files.
export DATABASE_URL="${DATABASE_URL:-postgresql://polka:polka_dev_password@localhost:5432/polka_social}"
export PROBE_HARNESS_ADMIN_URL="${PROBE_HARNESS_ADMIN_URL:-$DATABASE_URL}"
export AUTH_SECRET="${AUTH_SECRET:-test-full-local-secret-not-for-production}"
export AUTH_URL="${AUTH_URL:-http://127.0.0.1:3000}"
export AUTH_DEV_MAILBOX="true"
export AUTH_ALLOW_PUBLIC_REGISTRATION="true"
export SOCIAL_PUBLISH_LIVE="false"
export STORAGE_DRIVER="local"
export LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-./data/media}"

STAGE_NAMES=()
STAGE_STATUSES=()
STAGE_DURATIONS=()
CURRENT_STAGE=""
CURRENT_START=0

print_report() {
  local exit_code="$1"
  echo ""
  echo "============================================================"
  echo "Polka Social — test:full report"
  echo "============================================================"
  local i
  for i in "${!STAGE_NAMES[@]}"; do
    printf "  [%s] %s (%ss)\n" "${STAGE_STATUSES[$i]}" "${STAGE_NAMES[$i]}" "${STAGE_DURATIONS[$i]}"
  done
  echo "------------------------------------------------------------"
  if [[ "$exit_code" -eq 0 ]]; then
    echo "OVERALL: PASS (${#STAGE_NAMES[@]} stages)"
  else
    echo "OVERALL: FAIL (exit=$exit_code)"
  fi
  echo "============================================================"
}

on_exit() {
  local exit_code="$?"
  if [[ -n "$CURRENT_STAGE" ]]; then
    local now
    now="$(date +%s)"
    STAGE_NAMES+=("$CURRENT_STAGE")
    STAGE_STATUSES+=("FAIL")
    STAGE_DURATIONS+=("$((now - CURRENT_START))")
    CURRENT_STAGE=""
  fi
  print_report "$exit_code"
}

trap on_exit EXIT

run_stage() {
  local label="$1"
  shift
  CURRENT_STAGE="$label"
  CURRENT_START="$(date +%s)"
  echo ""
  echo ">>> [$label]"
  "$@"
  local now
  now="$(date +%s)"
  STAGE_NAMES+=("$label")
  STAGE_STATUSES+=("PASS")
  STAGE_DURATIONS+=("$((now - CURRENT_START))")
  CURRENT_STAGE=""
}

reset_clean_test_db() {
  node -e '
    const raw = process.env.DATABASE_URL || "";
    const url = new URL(raw);
    const host = url.hostname;
    const port = url.port || "5432";
    const db = url.pathname.replace(/^\//, "");
    const user = decodeURIComponent(url.username);
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error(`Refusing non-local DATABASE_URL host: ${host}`);
    }
    if (port !== "5432") {
      throw new Error(`Refusing unexpected port: ${port}`);
    }
    if (user !== "polka") {
      throw new Error(`Refusing unexpected DB user: ${user}`);
    }
    if (!["polka_social", "polka_test"].includes(db)) {
      throw new Error(`Refusing to reset non-test database: ${db}`);
    }
  '

  local pg_info
  pg_info="$(node -e '
    const u = new URL(process.env.DATABASE_URL);
    console.log([u.hostname, u.port || "5432", decodeURIComponent(u.username), decodeURIComponent(u.password), u.pathname.replace(/^\//, "")].join("\t"));
  ')"
  local pg_host pg_port pg_user pg_pass pg_db
  IFS=$'\t' read -r pg_host pg_port pg_user pg_pass pg_db <<<"$pg_info"

  PGPASSWORD="$pg_pass" psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$pg_db' AND pid <> pg_backend_pid();" >/dev/null
  PGPASSWORD="$pg_pass" psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d postgres -v ON_ERROR_STOP=1 -c \
    "DROP DATABASE IF EXISTS \"$pg_db\";"
  PGPASSWORD="$pg_pass" psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d postgres -v ON_ERROR_STOP=1 -c \
    "CREATE DATABASE \"$pg_db\";"
}

check_vps_syntax() {
  bash -n \
    scripts/lib/vps-common.sh \
    scripts/backup-vps.sh \
    scripts/restore-vps.sh \
    scripts/vps-up.sh \
    scripts/vps-pull.sh \
    scripts/vps-migrate.sh \
    scripts/vps-rollback.sh \
    scripts/tests/vps-ops.test.sh \
    scripts/test-full.sh
}

check_no_tracked_secrets() {
  local pattern
  pattern='sk-live''-|whsec''_|BEGIN OPENSSH ''PRIVATE KEY|BEGIN RSA ''PRIVATE KEY|YOOKASSA_SECRET_KEY''='
  if git grep -I -E "$pattern" -- \
    ':!.github/workflows/vps-readiness.yml' \
    ':!scripts/test-full.sh' \
    ':!src/server/security/secrets.ts' \
    ':!**/*.test.ts' \
    ':!**/*.test.sh' \
    ':!docs' \
    ':!.env.example'; then
    echo "Possible secret material found in tracked files." >&2
    return 1
  fi
}

run_stage "1. Clean test PostgreSQL" reset_clean_test_db
run_stage "2. Prisma generate" npx prisma generate
run_stage "3. Prisma validate" npx prisma validate
run_stage "4. Prisma migrate deploy" npx prisma migrate deploy
run_stage "5. TypeScript typecheck" npm run typecheck
run_stage "6. ESLint" npm run lint
run_stage "7. Vitest unit & integration" npm test
run_stage "8. VPS ops tests" npm run test:vps
run_stage "9. Production build" npm run build
run_stage "10. Playwright E2E" npm run test:e2e
run_stage "11. VPS shell syntax (bash -n)" check_vps_syntax
run_stage "12. Tracked secrets scan" check_no_tracked_secrets
