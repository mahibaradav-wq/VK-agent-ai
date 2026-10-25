#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo "Нужен Docker. На Ubuntu: apt-get install -y docker.io docker-compose-v2" >&2
  exit 1
fi

if [[ ! -f .env.production ]]; then
  echo "Скопируйте .env.production.example в .env.production и укажите домен, AUTH_SECRET и пароль БД." >&2
  exit 1
fi

value_of() {
  local key="$1"
  awk -F= -v key="$key" '$1==key {print substr($0, index($0,"=")+1); exit}' .env.production
}

domain="$(value_of SITE_DOMAIN)"
secret="$(value_of AUTH_SECRET)"
password="$(value_of POSTGRES_PASSWORD)"
site_url="$(value_of NEXT_PUBLIC_SITE_URL)"
mailbox="$(value_of AUTH_DEV_MAILBOX)"

if [[ -z "$domain" || "$domain" == "example.com" || "$domain" == *your-domain* ]]; then
  echo "Задайте настоящий SITE_DOMAIN в .env.production (купленный домен без https://)." >&2
  exit 1
fi

if [[ ${#secret} -lt 32 || "$secret" == *replace-with* ]]; then
  echo "AUTH_SECRET должен быть случайной строкой не короче 32 символов." >&2
  exit 1
fi

if [[ -z "$password" || "$password" == *replace-with* ]]; then
  echo "Задайте POSTGRES_PASSWORD в .env.production." >&2
  exit 1
fi

if [[ "$site_url" != "https://$domain" ]]; then
  echo "NEXT_PUBLIC_SITE_URL должен быть https://$domain без слэша в конце." >&2
  exit 1
fi

if [[ "$mailbox" == "true" ]]; then
  echo "AUTH_DEV_MAILBOX нельзя включать на публичном хостинге." >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
echo "Сайт должен открыться на https://$domain после выпуска сертификата (обычно 1–2 минуты)."
