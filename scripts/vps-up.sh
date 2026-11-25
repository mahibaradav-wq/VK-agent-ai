#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/vps-common.sh
source "$SCRIPT_DIR/lib/vps-common.sh"

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

vps_require_cmd docker || {
  echo "Нужен Docker. На Ubuntu: apt-get install -y docker.io docker-compose-v2" >&2
  exit 1
}
vps_require_file "$COMPOSE_FILE" "$ENV_FILE" || {
  echo "Скопируйте .env.production.example в .env.production и укажите домен, AUTH_SECRET, TOKEN_ENCRYPTION_KEY и пароль БД." >&2
  exit 1
}

vps_validate_production_env_file "$ENV_FILE" || exit 1
vps_require_free_bytes "$ROOT_DIR" || exit 1

domain="$(vps_env_get "$ENV_FILE" SITE_DOMAIN)"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d postgres
echo "Waiting for PostgreSQL..."
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres pg_isready >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres pg_isready >/dev/null

# Refuse FIRST_INSTALL when the volume already has Prisma migrations (re-run would skip backup gate).
if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM \"_prisma_migrations\" LIMIT 1;"' 2>/dev/null | grep -q 1; then
  echo "База уже содержит миграции Prisma. scripts/vps-up.sh только для первой установки." >&2
  echo "Для обновления: bash scripts/vps-pull.sh --plan, затем --apply (с backup)." >&2
  exit 1
fi

FIRST_INSTALL=YES COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/vps-migrate.sh"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build app worker caddy
echo "Сайт должен открыться на https://$domain после выпуска сертификата (обычно 1–2 минуты)."
echo "Проверьте: curl -fsS https://$domain/api/health"
echo "Миграции Prisma больше не выполняются при каждом старте app — только через scripts/vps-migrate.sh."
